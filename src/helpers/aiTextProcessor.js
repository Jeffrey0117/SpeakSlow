/**
 * AI 文字處理服務 — 從 ipcHandlers 抽出。
 * 職責：呼叫 OpenAI 相容 API 做潤飾（processTextWithAI）、測試連線（checkAIStatus）。
 * Prompt 內容見 aiPrompts.js。
 */
const { buildPrompts } = require("./aiPrompts");

class AITextProcessor {
  constructor(databaseManager, logger = console) {
    this.databaseManager = databaseManager;
    this.logger = logger;
  }

  // 砍掉小模型常亂加的前言/解釋/代碼框，只留結果本身
  _stripAIPreamble(s) {
    let t = (s || '').trim();
    t = t.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    const lines = t.split('\n');
    if (lines.length > 1) {
      const first = lines[0].trim();
      if (/[：:]\s*$/.test(first) && /(修正|優化|优化|以下|文本|結果|结果|根據|根据|如下|整理|here|following|result)/i.test(first)) {
        t = lines.slice(1).join('\n').trim();
      }
    }
    t = t.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    return t;
  }

  // AI文本处理方法（customPrompt 不為空時直接用它當 user 訊息，供操作模式 freeform 用）
  async processTextWithAI(text, mode = 'optimize', customPrompt = null) {
    try {
      // 从数据库设置或環境變數获取API密钥
      let apiKey = await this.databaseManager.getSetting('ai_api_key');
      let baseUrl = await this.databaseManager.getSetting('ai_base_url');
      let model = await this.databaseManager.getSetting('ai_model');

      // 使用環境變數作為預設值（DeepSeek）
      if (!apiKey && process.env.DEEPSEEK_API_KEY) {
        apiKey = process.env.DEEPSEEK_API_KEY;
        baseUrl = baseUrl || 'https://api.deepseek.com';
        model = model || 'deepseek-chat';
      }

      if (!apiKey) {
        return {
          success: false,
          error: '请先在设置页面配置AI API密钥'
        };
      }

      const prompts = buildPrompts(text);

      // baseUrl 和 model 已在函數開頭定義（支援環境變數 fallback）

      const requestData = {
        model: model,
        messages: [
          {
            role: 'system',
            content: '你是一個文字處理引擎。你的唯一輸出就是「處理後的最終文字本身」。絕對禁止任何前言、說明、解釋、標題、引號或 markdown 代碼框（```）。不要說「以下是」「優化後的文本」「根據核心原則」這類話，直接給結果。'
          },
          {
            role: 'user',
            content: customPrompt || prompts[mode] || prompts.optimize
          }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        stream: false
      };

      // 確保 baseUrl 不會重複添加 /chat/completions
      let apiEndpoint = baseUrl;
      if (!apiEndpoint.endsWith('/chat/completions')) {
        apiEndpoint = `${apiEndpoint}/chat/completions`;
      }

      // 只記「形狀」不記內容：prompt 裡就是使用者口述／選取的那段文字，
      // 寫進 app.log 等於把聽寫內容留在磁碟上（而且使用者回報問題時會附 log）。
      // 聲聲慢對外的承諾是內容不離開本機，貼上那條路徑也是只記長度（clipboard.js）。
      this.logger.info('AI文本处理请求:', {
        baseUrl: apiEndpoint,
        model,
        mode,
        inputChars: text.length
      });

      // 60 秒逾時：AI 端點掛住時不能讓整個潤飾流程永遠卡死
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData = { error: response.statusText };
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || response.statusText };
        }
        throw new Error(errorData.error?.message || errorData.error || `API error: ${response.status}`);
      }

      const data = await response.json();

      this.logger.info('AI文本处理响应:', {
        status: response.status,
        usage: data.usage
      });

      if (data.choices && data.choices.length > 0) {
        const result = {
          success: true,
          text: this._stripAIPreamble(data.choices[0].message.content),
          usage: data.usage,
          model: model
        };
        
        this.logger.info('AI文本处理结果:', {
          originalChars: text.length,
          resultChars: result.text.length,
          usage: result.usage
        });
        
        return result;
      } else {
        this.logger.error('AI API返回数据格式错误:', response.data);
        return {
          success: false,
          error: 'AI API返回数据格式错误'
        };
      }
    } catch (error) {
      this.logger.error('AI文本处理失败:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });

      // 注意：這裡用的是原生 fetch，沒有 axios 的 error.response/error.code
      let errorMessage;
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        errorMessage = 'AI 請求逾時，請檢查網路或服務狀態';
      } else if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(error.message || '')) {
        errorMessage = '無法連線到 AI 服務，請檢查網路與 API 端點';
      } else {
        errorMessage = error.message || '文字處理失敗';
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  // 检查AI状态
  async checkAIStatus(testConfig = null) {
    try {
      this.logger.info('开始测试AI配置...', testConfig ? '使用临时配置' : '使用已保存配置');
      
      // 如果提供了测试配置，使用测试配置；否则使用已保存的配置
      let apiKey, baseUrl, model;
      
      if (testConfig) {
        apiKey = testConfig.ai_api_key;
        baseUrl = testConfig.ai_base_url || 'https://api.openai.com/v1';
        model = testConfig.ai_model || 'gpt-3.5-turbo';
        this.logger.info('使用临时测试配置:', { baseUrl, model, apiKeyLength: apiKey?.length || 0 });
      } else {
        apiKey = await this.databaseManager.getSetting('ai_api_key');
        baseUrl = await this.databaseManager.getSetting('ai_base_url') || 'https://api.openai.com/v1';
        model = await this.databaseManager.getSetting('ai_model') || 'gpt-3.5-turbo';

        // 使用環境變數作為預設值（DeepSeek）
        if (!apiKey && process.env.DEEPSEEK_API_KEY) {
          apiKey = process.env.DEEPSEEK_API_KEY;
          baseUrl = 'https://api.deepseek.com';
          model = 'deepseek-chat';
          this.logger.info('使用環境變數 DEEPSEEK_API_KEY');
        }

        this.logger.info('使用已保存配置:', { baseUrl, model, apiKeyLength: apiKey?.length || 0 });
      }

      if (!apiKey) {
        this.logger.warn('AI测试失败: 未配置API密钥');
        return {
          available: false,
          error: '未配置API密钥',
          details: '请输入AI API密钥'
        };
      }
      
      this.logger.info('AI配置信息:', {
        baseUrl: baseUrl,
        model: model,
        apiKeyLength: apiKey.length
      });
      
      // 发送一个更有意义的测试请求
      const testMessage = '请回复"测试成功"来确认AI服务正常工作';
      const requestData = {
        model: model,
        messages: [
          {
            role: 'user',
            content: testMessage
          }
        ],
        max_tokens: 50,
        temperature: 0.1
      };

      this.logger.info('发送AI测试请求:', requestData);

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
        signal: AbortSignal.timeout(20000) // 連線測試 20 秒逾時
      });

      this.logger.info('AI API响应状态:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('AI API错误响应:', errorText);
        
        let errorData = { error: response.statusText };
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || response.statusText };
        }
        
        let errorMessage = errorData.error?.message || errorData.error || `HTTP ${response.status}`;
        if (response.status === 401) {
          errorMessage = 'API密钥无效或已过期';
        } else if (response.status === 403) {
          errorMessage = 'API密钥权限不足';
        } else if (response.status === 429) {
          errorMessage = 'API调用频率超限';
        } else if (response.status === 500) {
          errorMessage = 'AI服务器内部错误';
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      this.logger.info('AI API成功响应:', data);

      if (!data.choices || data.choices.length === 0) {
        throw new Error('AI API返回格式异常：缺少choices字段');
      }

      const aiResponse = data.choices[0].message?.content || '';
      this.logger.info('AI回复内容:', aiResponse);

      return {
        available: true,
        model: model,
        status: 'connected',
        response: aiResponse,
        usage: data.usage,
        details: `成功连接到 ${model}，响应时间正常`
      };
    } catch (error) {
      this.logger.error('AI配置测试失败:', error);
      
      let errorMessage = '连接失败';
      if (error.message.includes('401')) {
        errorMessage = 'API密钥无效';
      } else if (error.message.includes('403')) {
        errorMessage = 'API密钥权限不足';
      } else if (error.message.includes('429')) {
        errorMessage = 'API调用频率超限';
      } else if (error.message.includes('ENOTFOUND')) {
        errorMessage = '无法连接到AI服务器，请检查网络和Base URL';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = '连接被拒绝，请检查Base URL是否正确';
      } else if (error.message.includes('timeout')) {
        errorMessage = '请求超时，请检查网络连接';
      } else {
        errorMessage = error.message || '未知错误';
      }

      return {
        available: false,
        error: errorMessage,
        details: `测试失败原因: ${error.message}`
      };
    }
  }
}

module.exports = AITextProcessor;
