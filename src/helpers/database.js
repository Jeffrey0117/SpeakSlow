const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

class DatabaseManager {
  constructor(logger = null) {
    this.db = null;
    this.dbPath = null;
    this.logger = logger;
  }

  initialize(dataDirectory) {
    this.dbPath = path.join(dataDirectory, "transcriptions.db");
    
    // 确保数据目录存在
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.createTables();
  }

  createTables() {
    // 创建转录记录表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transcriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        raw_text TEXT,
        processed_text TEXT,
        confidence REAL,
        language TEXT DEFAULT 'zh-CN',
        duration REAL,
        file_size INTEGER,
        audio_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 確保 audio_path 欄位存在（為舊資料庫升級）
    try {
      this.db.exec(`ALTER TABLE transcriptions ADD COLUMN audio_path TEXT`);
    } catch (e) {
      // 欄位已存在，忽略錯誤
    }

    // 回填 duration：舊資料因 bug 未存口述時長，用字數估算（約 180 字/分 = 3 字/秒）。
    // 只補 0/NULL 的列；修好後的新資料有真實 duration，不會被動到。
    try {
      this.db.exec(
        `UPDATE transcriptions
         SET duration = LENGTH(COALESCE(processed_text, text, raw_text, '')) / 3.0
         WHERE (duration IS NULL OR duration = 0)
           AND LENGTH(COALESCE(processed_text, text, raw_text, '')) > 0`
      );
    } catch (e) {
      // 回填失敗不影響主流程
    }

    // 创建设置表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
      ON transcriptions(created_at DESC)
    `);

    // 創建字典表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dictionary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original TEXT NOT NULL,
        replacement TEXT NOT NULL,
        category TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 創建字典索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_dictionary_original
      ON dictionary(original)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_dictionary_enabled
      ON dictionary(enabled)
    `);
  }

  // ===== 字典功能 =====

  addDictionaryEntry(original, replacement, category = '') {
    const stmt = this.db.prepare(`
      INSERT INTO dictionary (original, replacement, category)
      VALUES (?, ?, ?)
    `);
    return stmt.run(original, replacement, category);
  }

  updateDictionaryEntry(id, data) {
    const updates = [];
    const values = [];

    if (data.original !== undefined) {
      updates.push('original = ?');
      values.push(data.original);
    }
    if (data.replacement !== undefined) {
      updates.push('replacement = ?');
      values.push(data.replacement);
    }
    if (data.category !== undefined) {
      updates.push('category = ?');
      values.push(data.category);
    }
    if (data.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(data.enabled ? 1 : 0);
    }

    if (updates.length === 0) return null;

    values.push(id);
    const stmt = this.db.prepare(`
      UPDATE dictionary SET ${updates.join(', ')} WHERE id = ?
    `);
    return stmt.run(...values);
  }

  deleteDictionaryEntry(id) {
    const stmt = this.db.prepare("DELETE FROM dictionary WHERE id = ?");
    return stmt.run(id);
  }

  getDictionaryEntries(limit = 100, offset = 0) {
    const stmt = this.db.prepare(`
      SELECT * FROM dictionary
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  searchDictionary(query) {
    const stmt = this.db.prepare(`
      SELECT * FROM dictionary
      WHERE original LIKE ? OR replacement LIKE ? OR category LIKE ?
      ORDER BY created_at DESC
    `);
    const searchTerm = `%${query}%`;
    return stmt.all(searchTerm, searchTerm, searchTerm);
  }

  getEnabledDictionaryEntries() {
    const stmt = this.db.prepare(`
      SELECT * FROM dictionary WHERE enabled = 1 ORDER BY LENGTH(original) DESC
    `);
    return stmt.all();
  }

  getDictionaryCategories() {
    const stmt = this.db.prepare(`
      SELECT DISTINCT category FROM dictionary WHERE category != '' ORDER BY category
    `);
    return stmt.all().map(row => row.category);
  }

  applyDictionary(text) {
    if (!text) return text;

    const entries = this.getEnabledDictionaryEntries();
    let result = text;

    for (const entry of entries) {
      // 使用全域替換
      const regex = new RegExp(this.escapeRegExp(entry.original), 'gi');
      result = result.replace(regex, entry.replacement);
    }

    return result;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 匯出所有字典項目
  exportDictionary() {
    const stmt = this.db.prepare(`
      SELECT original, replacement, category, enabled FROM dictionary ORDER BY created_at DESC
    `);
    return stmt.all();
  }

  // 批次匯入字典項目
  importDictionary(entries, mode = 'merge') {
    if (!Array.isArray(entries) || entries.length === 0) {
      return { imported: 0, skipped: 0, errors: [] };
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    // 如果是覆蓋模式，先清空字典
    if (mode === 'replace') {
      this.db.prepare("DELETE FROM dictionary").run();
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO dictionary (original, replacement, category, enabled)
      VALUES (?, ?, ?, ?)
    `);

    const checkExistsStmt = this.db.prepare(`
      SELECT id FROM dictionary WHERE original = ?
    `);

    for (const entry of entries) {
      try {
        // 驗證必要欄位
        if (!entry.original || !entry.replacement) {
          errors.push(`缺少必要欄位: ${JSON.stringify(entry)}`);
          skipped++;
          continue;
        }

        // 檢查是否已存在
        const existing = checkExistsStmt.get(entry.original);
        if (existing && mode === 'merge') {
          skipped++;
          continue;
        }

        // 插入新項目
        insertStmt.run(
          entry.original.trim(),
          entry.replacement.trim(),
          entry.category?.trim() || '',
          entry.enabled !== undefined ? (entry.enabled ? 1 : 0) : 1
        );
        imported++;
      } catch (err) {
        errors.push(`匯入失敗 "${entry.original}": ${err.message}`);
        skipped++;
      }
    }

    return { imported, skipped, errors };
  }

  // 清空字典
  clearDictionary() {
    return this.db.prepare("DELETE FROM dictionary").run();
  }

  saveTranscription(data) {
    // 验证必需的数据
    if (!data || typeof data !== 'object') {
      throw new Error('转录数据无效');
    }

    // 确保text字段存在且不为空
    const text = data.text || data.raw_text || '';
    if (!text || text.trim().length === 0) {
      throw new Error('转录文本不能为空');
    }

    const stmt = this.db.prepare(`
      INSERT INTO transcriptions (
        text, raw_text, processed_text, confidence,
        language, duration, file_size, audio_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      text.trim(),
      data.raw_text || null,
      data.processed_text || null,
      data.confidence || 0,
      data.language || 'zh-CN',
      data.duration || 0,
      data.file_size || 0,
      data.audio_path || null
    );
  }

  getTranscriptions(limit = 50, offset = 0) {
    const stmt = this.db.prepare(`
      SELECT * FROM transcriptions 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  getTranscriptionById(id) {
    const stmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
    return stmt.get(id);
  }

  deleteTranscription(id) {
    const stmt = this.db.prepare("DELETE FROM transcriptions WHERE id = ?");
    return stmt.run(id);
  }

  // 重新辨識後更新文字
  updateTranscriptionText(id, text, processedText = null) {
    const stmt = this.db.prepare(
      `UPDATE transcriptions SET text = ?, processed_text = ? WHERE id = ?`
    );
    return stmt.run(text, processedText, id);
  }

  clearAllTranscriptions() {
    const stmt = this.db.prepare("DELETE FROM transcriptions");
    return stmt.run();
  }

  searchTranscriptions(query, limit = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM transcriptions 
      WHERE text LIKE ? OR raw_text LIKE ? OR processed_text LIKE ?
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    const searchTerm = `%${query}%`;
    return stmt.all(searchTerm, searchTerm, searchTerm, limit);
  }

  getTranscriptionStats() {
    const totalStmt = this.db.prepare("SELECT COUNT(*) as total FROM transcriptions");
    const todayStmt = this.db.prepare(`
      SELECT COUNT(*) as today FROM transcriptions
      WHERE date(created_at) = date('now')
    `);
    const weekStmt = this.db.prepare(`
      SELECT COUNT(*) as week FROM transcriptions
      WHERE created_at >= date('now', '-7 days')
    `);

    // 計算總字數和總時長（優先使用 processed_text，其次 text，最後 raw_text）
    const charsStmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(LENGTH(COALESCE(processed_text, text, raw_text, ''))), 0) as totalChars,
        COALESCE(SUM(duration), 0) as totalDuration
      FROM transcriptions
    `);
    const charsResult = charsStmt.get();

    return {
      total: Number(totalStmt.get().total) || 0,
      today: Number(todayStmt.get().today) || 0,
      week: Number(weekStmt.get().week) || 0,
      totalChars: Number(charsResult.totalChars) || 0,
      totalDuration: Number(charsResult.totalDuration) || 0
    };
  }

  // 每日字數/次數（按本地日期分組，供趨勢圖用）
  getDailyStats(days = 14) {
    const stmt = this.db.prepare(`
      SELECT
        date(created_at, 'localtime') as day,
        COUNT(*) as count,
        COALESCE(SUM(LENGTH(COALESCE(processed_text, text, raw_text, ''))), 0) as chars
      FROM transcriptions
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY day
      ORDER BY day ASC
    `);
    return stmt.all(days).map(r => ({
      day: r.day,
      count: Number(r.count) || 0,
      chars: Number(r.chars) || 0
    }));
  }

  // 使用天數：有留下辨識紀錄的不重複日期數（排行榜「使用天數」榜用）。
  // 用 localtime 而非 UTC，否則跨時區的人會覺得日期對不上。
  getActiveDays() {
    const r = this.db
      .prepare("SELECT COUNT(DISTINCT date(created_at, 'localtime')) AS days FROM transcriptions")
      .get();
    return Number(r?.days) || 0;
  }

  setSetting(key, value) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    return stmt.run(key, JSON.stringify(value));
  }

  getSetting(key, defaultValue = null) {
    const stmt = this.db.prepare("SELECT value FROM settings WHERE key = ?");
    const result = stmt.get(key);
    
    if (result) {
      try {
        return JSON.parse(result.value);
      } catch (error) {
        return result.value;
      }
    }
    
    return defaultValue;
  }

  getAllSettings() {
    const stmt = this.db.prepare("SELECT key, value FROM settings");
    const rows = stmt.all();
    
    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch (error) {
        settings[row.key] = row.value;
      }
    }
    
    return settings;
  }

  resetSettings() {
    const stmt = this.db.prepare("DELETE FROM settings");
    return stmt.run();
  }

  backup(backupPath) {
    if (!this.db) return false;
    
    try {
      this.db.backup(backupPath);
      return true;
    } catch (error) {
      if (this.logger && this.logger.error) {
        this.logger.error("数据库备份失败:", error);
      }
      return false;
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = DatabaseManager;