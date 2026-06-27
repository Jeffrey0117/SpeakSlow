#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文字後處理層（純函式、無狀態）— 從 sherpa_server.py 抽出。
職責：簡轉繁、全形→半形、去口吃疊字、合併英文字母、贅詞/語氣詞清理、
語助詞標點規則、規則式列點排版。供 sherpa_server 與測試使用。
"""

import re
import logging

# 簡轉繁轉換器
logger_init = logging.getLogger(__name__)
try:
    from opencc import OpenCC
    try:
        _opencc_converter = OpenCC('s2tw')  # 簡體→繁體（台灣標準字，吃不會變喫）
    except Exception:
        _opencc_converter = OpenCC('s2t')   # 沒有 s2tw 配置時退回 s2t
except Exception as _e:
    _opencc_converter = None
    logger_init.warning(f"OpenCC 不可用，將不進行簡轉繁轉換: {_e}")

# OpenCC 的 s2tw 把「账」轉成貝部的「賬」，但台灣標準字是巾部的「帳」(帳號/帳單/記帳)。
# 台灣不用「賬」，故一律修正；如有其他類似的台標字偏差也可加進來。
_TW_CHAR_FIX = str.maketrans({"賬": "帳"})


def to_traditional(text):
    """將簡體中文轉換為繁體中文（並修成台灣標準字）"""
    if not text or _opencc_converter is None:
        return text
    try:
        return _opencc_converter.convert(text).translate(_TW_CHAR_FIX)
    except Exception:
        return text

# 繁轉簡轉換器（供「操作模式」語音指令「轉成簡體」使用）
try:
    from opencc import OpenCC as _OpenCC2
    try:
        _opencc_t2s = _OpenCC2('tw2s')  # 繁體（台灣）→簡體
    except Exception:
        _opencc_t2s = _OpenCC2('t2s')   # 退回一般繁→簡
except Exception:
    _opencc_t2s = None

def to_simplified(text):
    """將繁體中文轉換為簡體中文"""
    if not text or _opencc_t2s is None:
        return text
    try:
        return _opencc_t2s.convert(text)
    except Exception:
        return text


def normalize_ascii_width(text):
    """全形英文字母 / 數字 → 半形（不動中文與全形標點，避免破壞，。？）"""
    if not text:
        return text
    out = []
    for ch in text:
        code = ord(ch)
        if 0xFF10 <= code <= 0xFF19 or 0xFF21 <= code <= 0xFF3A or 0xFF41 <= code <= 0xFF5A:
            out.append(chr(code - 0xFEE0))  # 全形數字/字母 → 半形
        else:
            out.append(ch)
    return ''.join(out)


# 有效疊字白名單（AA 形式，含簡繁）。不在名單內的連續重複中文字 → 視為口吃收成 1 個。
_VALID_REDUP = set((
    # 家庭稱謂
    "爸爸 妈妈 媽媽 爹爹 哥哥 姐姐 弟弟 妹妹 爷爷 爺爺 奶奶 公公 婆婆 叔叔 婶婶 嬸嬸 伯伯 姑姑 舅舅 姨姨 宝宝 寶寶 乖乖 囡囡 妞妞 弟弟 哥哥 "
    # 動作（看一看）
    "看看 想想 试试 試試 走走 说说 說說 讲讲 講講 聊聊 玩玩 等等 找找 问问 問問 摸摸 抱抱 亲亲 親親 拍拍 数数 數數 闻闻 聞聞 尝尝 嚐嚐 写写 寫寫 读读 讀讀 算算 比比 量量 翻翻 查查 学学 學學 练练 練練 唱唱 跳跳 笑笑 猜猜 瞧瞧 望望 听听 聽聽 坐坐 站站 歇歇 动动 動動 转转 轉轉 晃晃 逛逛 试试 摇摇 搖搖 "
    # 副詞
    "慢慢 快快 刚刚 剛剛 常常 偏偏 渐渐 漸漸 轻轻 輕輕 重重 默默 悄悄 纷纷 紛紛 久久 早早 迟迟 遲遲 连连 連連 频频 頻頻 屡屡 屢屢 苦苦 深深 浅浅 淺淺 远远 遠遠 近近 团团 團團 牢牢 死死 紧紧 緊緊 松松 鬆鬆 稳稳 穩穩 偷偷 暗暗 明明 空空 满满 滿滿 处处 處處 时时 時時 步步 层层 層層 点点 點點 滴滴 一一 "
    # 量詞/名詞
    "个个 個個 条条 條條 件件 种种 種種 样样 樣樣 天天 年年 月月 日日 夜夜 人人 家家 户户 戶戶 村村 区区 區區 场场 場場 "
    # 形容
    "好好 多多 少少 大大 小小 长长 長長 短短 胖胖 瘦瘦 圆圆 圓圓 扁扁 红红 紅紅 绿绿 綠綠 蓝蓝 藍藍 黄黄 黃黃 黑黑 白白 亮亮 甜甜 酸酸 辣辣 咸咸 鹹鹹 香香 臭臭 暖暖 凉凉 涼涼 热热 熱熱 冷冷 软软 軟軟 硬硬 厚厚 薄薄 嫩嫩 脆脆 高高 低低 矮矮 满满 "
    # 語氣/擬聲（含語助詞疊用）
    "谢谢 謝謝 拜拜 嗯嗯 哈哈 呵呵 嘿嘿 嘻嘻 哼哼 喵喵 汪汪 咚咚 叮叮 啦啦 唉唉 哎哎 "
    "呀呀 啊啊 哇哇 哦哦 喔喔 嗚嗚 噢噢 咦咦"
).split())


def _is_cjk(ch):
    return 0x4E00 <= ord(ch) <= 0x9FFF


def collapse_repeats(text):
    """去除口吃式重複字，但保留有效疊字。
    - XX 在白名單（慢慢、謝謝、看看...）→ 保留 2 個
    - 前或後也是「不同字的疊字」→ 視為 AABB 疊詞（吃吃喝喝、開開心心）→ 保留 2 個
    - 否則視為口吃 → 收成 1 個（吃吃牛肉→吃牛肉、我我→我）
    - 非中文（英文/數字/標點）不動
    """
    if not text:
        return text
    # 先切成連續段 (字, 次數)
    runs = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        j = i
        while j < n and text[j] == ch:
            j += 1
        runs.append((ch, j - i))
        i = j

    out = []
    for k, (ch, run) in enumerate(runs):
        if run >= 2 and _is_cjk(ch):
            prev_dup = k > 0 and runs[k - 1][1] >= 2 and runs[k - 1][0] != ch and _is_cjk(runs[k - 1][0])
            next_dup = k + 1 < len(runs) and runs[k + 1][1] >= 2 and runs[k + 1][0] != ch and _is_cjk(runs[k + 1][0])
            if (ch + ch) in _VALID_REDUP or prev_dup or next_dup:
                out.append(ch * 2)   # 有效疊字 / AABB 疊詞 → 保留 2
            else:
                out.append(ch)       # 口吃 → 收成 1
        else:
            out.append(ch * run)
    return ''.join(out)


def merge_spaced_letters(text):
    """合併被空白拆開的單一英文字母（Paraformer 常把英文逐字母吐出：
    "h e n t" → "hent"），但保留正常的英文詞間空白（"hello world" 不動）。
    """
    if not text or ' ' not in text:
        return text
    import re
    # 連續的「單一字母 + 空白」序列 → 去掉中間空白（用 ASCII lookaround，
    # 不用 \b，因為中文也算 word char 會誤判，導致 開h 連在一起時抓不到 h）
    return re.sub(
        r'(?<![A-Za-z])([A-Za-z](?: [A-Za-z])+)(?![A-Za-z])',
        lambda m: m.group(1).replace(' ', ''),
        text
    )


# 常見發語詞 / 口頭禪：連續重複（即使只重複 2 次）多半是口吃，收成 1 次。
_FILLER_WORDS = ["其實", "然後", "就是", "那個", "這個", "反正", "所以",
                 "可是", "但是", "不過", "而且", "對啊", "對對", "那就", "之類"]


def collapse_phrase_repeats(text):
    """去除「詞組」層級的口吃重複：
    - 任何 2~4 字詞連續重複 3 次以上 → 收成 1 次（其實其實其實 → 其實）
    - 發語詞（_FILLER_WORDS）連續重複 2 次以上 → 收成 1 次（然後然後 → 然後）
    - 一般 2 字詞剛好重複 2 次（快樂快樂）暫不處理，避免誤刪正常疊詞（研究研究）
    """
    if not text:
        return text
    import re
    # 1) 任意 2~4 字詞重複 3+ 次 → 1 次
    text = re.sub(r'([一-鿿]{2,4})\1{2,}', r'\1', text)
    # 2) 發語詞重複 2+ 次 → 1 次
    for w in _FILLER_WORDS:
        text = re.sub(r'(?:' + re.escape(w) + r'){2,}', w, text)
    return text


def normalize_interjections(text):
    """語助詞正規化：哎/誒 → 欸；移除單獨的遲疑語助詞 呃。"""
    if not text:
        return text
    text = text.replace('哎', '欸').replace('誒', '欸')
    text = text.replace('呃', '')
    return text


# 句末片語 → 標點規則。標點模型常漏「！」，這裡用結尾片語補判 ？/！。
# 註：此時文字仍為簡體（to_traditional 在最後才做），故用簡體片語。
_PUNCT_RULES = {
    "？": ["什么啊", "怎么啊", "为什么啊", "可以吗", "好吗", "是不是", "对不对",
           "行不行", "好不好", "要不要", "有没有", "是吗", "对吗", "能不能"],
    "！": ["怎样啦", "这样啦", "干嘛啦", "什么啦", "这样啊", "欸呀呀", "太棒了",
           "好厉害", "真的假的", "不会吧", "天啊", "我的天"],
}


# 句末「單字語助詞」→ 標點（主規則，命中率高）。
# 疑問語氣 → ？；感嘆/驚嘆語氣 → ！。（含簡繁，文字此時為簡體但一併納入）
_END_PARTICLE_PUNCT = {
    '吗': '？', '嗎': '？', '呢': '？',
    '啊': '！', '呀': '！', '啦': '！', '哇': '！',
    '喔': '！', '哦': '！', '噢': '！', '耶': '！', '欸': '！',
}
_PARTICLE_CLASS = '吗嗎呢啊呀啦哇喔哦噢耶欸'


def apply_punct_rules(text):
    """修正句末標點：
    1) 句末單字語助詞（啊→！、吗→？...）—— 主規則
    2) 句末多字片語（对不对→？、真的假的→！...）—— 補充
    只在句末標點（。！？）或字串結尾前作用；句中的「啊，」等逗號不動。
    """
    if not text:
        return text
    import re

    # 1) 句末單字語助詞 + 句末標點 → 換標點
    text = re.sub(
        r'([' + _PARTICLE_CLASS + r'])([。！？])',
        lambda m: m.group(1) + _END_PARTICLE_PUNCT.get(m.group(1), m.group(2)),
        text
    )
    # 句末單字語助詞在字串結尾、沒有標點 → 補上
    text = re.sub(
        r'([' + _PARTICLE_CLASS + r'])$',
        lambda m: m.group(1) + _END_PARTICLE_PUNCT[m.group(1)],
        text
    )

    # 2) 多字片語補充（針對非語助詞結尾，如 对不对 / 是不是）
    for mark, phrases in _PUNCT_RULES.items():
        for p in phrases:
            ep = re.escape(p)
            text = re.sub(ep + r'[。，！？]', p + mark, text)
            text = re.sub(ep + r'$', p + mark, text)

    # 3) 台灣語尾「吼/齁」常被辨識成「哈」。
    # 判斷依據：吼永遠是「單獨一個 + 在句尾」（對吼、好吼），
    # 真正的哈幾乎都是疊字（哈哈）或詞組（哈囉/哈密瓜）。
    # 故：前後都不是哈、後面接標點或行尾的單獨哈 → 還原成吼。
    text = re.sub(r'(?<!哈)哈(?=[。！？，、]|$)', '吼', text, flags=re.M)

    # 4) 句尾「好」也常是「吼」——但只敢做保守子集：
    # 「動詞+好」（搞好/修好/寫好/準備好）是合法句尾的大宗，不能亂動。
    # 唯有「好」前面已經是另一個語助詞（了/啊/嘛/耶/喔/欸/吧/呢/哦/對）時，
    # 它不可能是動補結構 → 必是語尾吼。例：搞好了好 → 搞好了吼、對好 → 對吼。
    text = re.sub(r'(?<=[了啊嘛耶喔欸吧呢哦對])好(?=[。！？，、]|$)', '吼', text, flags=re.M)
    return text


# 語音表情符號：聽寫時講「X表情 / X符號」→ 直接替換成 emoji（免切操作模式）。
# 一定要帶「表情/符號」後綴才換，避免把「火焰」這種正常詞吃掉。
_EMOJI_MAP = {
    "火焰": "🔥", "火": "🔥", "燃燒": "🔥",
    "哭": "😭", "大哭": "😭", "哭哭": "😢", "想哭": "😢", "哭泣": "😭", "淚": "😢", "流淚": "😢",
    "感動": "🥹", "感人": "🥹", "委屈": "🥺", "可憐": "🥺", "拜託你": "🥺",
    "笑": "😂", "大笑": "🤣", "哈哈": "😄", "微笑": "🙂", "笑死": "🤣", "孝死": "🤣", "笑死了": "🤣",
    "無奈": "😅", "尷尬": "😅",
    "愛心": "❤️", "愛": "❤️", "紅心": "❤️",
    "愛你": "😍", "花痴": "😍", "戀愛": "😍",
    "讚": "👍", "比讚": "👍", "棒": "👍", "贊": "👍", "點讚": "👍", "點贊": "👍", "比贊": "👍", "大拇指": "👍", "拇指": "👍", "大拇哥": "👍", "倒讚": "👎", "倒贊": "👎", "噓": "👎",
    "生氣": "😡", "憤怒": "😡", "怒": "😡",
    "驚訝": "😮", "嚇到": "😱", "驚嚇": "😱",
    "思考": "🤔",
    "派對": "🎉", "慶祝": "🎉", "灑花": "🎉", "撒花": "🎉",
    "酷": "😎", "墨鏡": "😎",
    "睡覺": "😴", "想睡": "😴", "累": "😩",
    "噁心": "🤢", "嘔吐": "🤮",
    "骷髏": "💀",
    "便便": "💩", "大便": "💩",
    "錢": "💰", "金錢": "💰",
    "禮物": "🎁",
    "拜託": "🙏", "祈禱": "🙏", "感謝": "🙏",
    "鼓掌": "👏", "拍手": "👏",
    "揮手": "👋", "掰掰": "👋",
    "星星": "⭐", "閃亮": "✨", "亮晶晶": "✨",
    "問號": "？", "驚嘆號": "！", "驚歎號": "！", "感嘆號": "！", "感歎號": "！", "紅色問號": "❓", "紅色驚嘆號": "❗",
    "勾勾": "✅", "打勾": "✅", "正確": "✅",
    "叉叉": "❌", "錯誤": "❌",
    # 表情類
    "邪惡": "😈", "惡魔": "😈", "魔鬼": "😈", "壞笑": "😈",
    "天使": "😇",
    "親親": "😘", "啾咪": "😘", "飛吻": "😘",
    "親一個": "💋", "嘴唇": "💋",
    "翻白眼": "🙄", "白眼": "🙄",
    "噓": "🤫", "安靜": "🤫",
    "暈": "😵", "頭暈": "😵", "暈倒": "😵",
    "發燒": "🤒", "生病": "🤒",
    "流汗": "😓", "冷汗": "😰",
    "流口水": "🤤", "嘴饞": "🤤",
    "得意": "😏", "奸笑": "😏",
    "委屈": "🥺", "可憐": "🥺", "拜託你": "🥺",
    "傻眼": "😳", "害羞": "☺️",
    "閉嘴": "🤐",
    "錢眼": "🤑", "發財": "🤑",
    "戴口罩": "😷", "口罩": "😷",
    "肌肉": "💪", "加油": "💪",
    "比心": "🫶", "愛心手": "🫶",
    "握手": "🤝", "合作": "🤝",
    "眼睛": "👀", "看": "👀",
    "一百分": "💯", "滿分": "💯", "一百": "💯",
    "爆炸": "💥", "炸開": "💥",
    "心碎": "💔",
    "怦然心動": "💓", "心動": "💓",
    # 角色 / 動物
    "小丑": "🤡",
    "機器人": "🤖",
    "鬼": "👻", "幽靈": "👻",
    "外星人": "👽",
    "獨角獸": "🦄",
    "小狗": "🐶", "狗": "🐶",
    "小貓": "🐱", "貓": "🐱",
    "豬": "🐷",
    # 物件 / 場景
    "炸彈": "💣",
    "閃電": "⚡",
    "彩虹": "🌈",
    "太陽": "☀️",
    "月亮": "🌙",
    "下雪": "❄️", "雪花": "❄️",
    "下雨": "🌧️",
    "咖啡": "☕",
    "喝酒": "🍺", "啤酒": "🍺", "乾杯": "🍻",
    "蛋糕": "🎂", "生日": "🎂",
    "披薩": "🍕", "比薩": "🍕",
    "漢堡": "🍔",
    "音樂": "🎵", "唱歌": "🎤",
    "點子": "💡", "燈泡": "💡", "靈感": "💡",
    "鎖": "🔒",
    "鑰匙": "🔑",
    "通知": "🔔", "鈴鐺": "🔔",
    "搜尋": "🔍", "放大鏡": "🔍",
    "等待": "⏳", "沙漏": "⏳",
    "時鐘": "⏰", "鬧鐘": "⏰",
    "冠軍": "🏆", "獎盃": "🏆",
    "金牌": "🥇",
    "皇冠": "👑", "王冠": "👑",
    "鑽石": "💎",
    "玫瑰": "🌹", "花": "🌹",
    "火箭": "🚀", "起飛": "🚀",
    "地球": "🌍",
    "車": "🚗", "汽車": "🚗",
    "警告": "⚠️", "注意": "⚠️",
    "禁止": "🚫", "不准": "🚫",
    # 標點 / 括號符號（講「X符號」插入，例如「書名號符號」→《》）。
    # 成對的括號/引號直接插一對，游標移進去打字即可。
    "書名號": "《》", "雙書名號": "《》", "單書名號": "〈〉", "小書名號": "〈〉",
    "引號": "「」", "雙引號": "『』", "單引號": "「」",
    "括號": "（）", "小括號": "（）", "圓括號": "（）",
    "中括號": "【】", "方括號": "［］", "大括號": "｛｝",
    "句號": "。", "逗號": "，", "頓號": "、",
    "冒號": "：", "分號": "；",
    "破折號": "——", "刪節號": "……", "省略號": "……", "間隔號": "・",
    # 數學 / 其他符號
    "等號": "=", "等於": "=", "加號": "+", "減號": "-", "乘號": "×", "除號": "÷",
    "正負": "±", "大於": ">", "小於": "<", "大於等於": "≥", "小於等於": "≤",
    "不等於": "≠", "約等於": "≈", "百分號": "%", "百分比": "%",
    "度": "°", "攝氏": "℃", "華氏": "℉",
    "井號": "#", "井字號": "#", "小老鼠": "@", "美元": "$", "錢字號": "$",
    "向右箭頭": "→", "向左箭頭": "←", "向上箭頭": "↑", "向下箭頭": "↓", "箭頭": "→",
    "星號": "＊", "波浪號": "～", "豎線": "｜",
}
# 使用者自訂的符號（從 DB 載入，覆蓋/補充內建表）。可在執行中更新。
_CUSTOM_EMOJI = {}
_EFFECTIVE_EMOJI = dict(_EMOJI_MAP)


def _build_emoji_re(keys):
    return re.compile(
        # 名字「前面」被標點模型硬塞的逗號/頓號/空白也吃掉，否則插符號會變「，！」。
        r"[，、\s]?"
        + "(" + "|".join(sorted(map(re.escape, keys), key=len, reverse=True)) + ")"
        # 名字與「表情」之間、以及「表情」之後，標點模型常塞句點 → 一併吃掉。
        # 「表」常被聽成「錶」，一併認。
        + r"[。，、！？\s]{0,3}的?(?:[表錶]情符號|[表錶]情|符號|emoji)[。，、！？\s]?",
        re.I,
    )


_EMOJI_RE = _build_emoji_re(_EFFECTIVE_EMOJI.keys())


def set_custom_emojis(mapping):
    """設定使用者自訂符號（{觸發詞: 符號}）。立即生效，與內建表合併（自訂優先）。"""
    global _CUSTOM_EMOJI, _EFFECTIVE_EMOJI, _EMOJI_RE
    _CUSTOM_EMOJI = {str(k).strip(): str(v) for k, v in (mapping or {}).items() if str(k).strip() and str(v)}
    _EFFECTIVE_EMOJI = {**_EMOJI_MAP, **_CUSTOM_EMOJI}
    _EMOJI_RE = _build_emoji_re(_EFFECTIVE_EMOJI.keys())


def get_builtin_emojis():
    """回傳內建符號對照表（給設定頁顯示用）。"""
    return dict(_EMOJI_MAP)


def apply_emoji(text):
    """把「X表情 / X符號」換成對應 emoji（X 要在表中，否則整段保留不動）。
    容忍標點模型在中間/結尾塞的句點，並認「錶」=「表」。內建 + 使用者自訂。"""
    if not text:
        return text
    return _EMOJI_RE.sub(lambda m: _EFFECTIVE_EMOJI.get(m.group(1), m.group(0)), text)


def strip_short_trailing_period(text):
    """很短的單詞 / 短句，結尾的「。」拿掉（選字重唸換字、單詞口述時很煩）。
    只處理：單行、結尾是。、句中無其他。！？、本體 ≤5 個字元。
    「！」「？」保留 —— 那是刻意的語氣 / 疑問。"""
    if not text:
        return text
    if "\n" in text.strip():
        return text  # 多行（多句 / 列點）不動
    t = text.rstrip()
    if t.endswith("。"):
        body = t[:-1]
        if not any(p in body for p in "。！？") and len(body.strip()) <= 5:
            return body
    return text


# 自動列點（第一二三→1.2.3）預設「關閉」：誤觸率偏高，使用者多半不想被自動分點。
# 由設定 auto_format_lists 控制；渲染端每次辨識用 options 帶進來、後端據此設旗標。
_FORMAT_LISTS_ENABLED = False


def set_format_lists_enabled(enabled):
    global _FORMAT_LISTS_ENABLED
    _FORMAT_LISTS_ENABLED = bool(enabled)


def format_lists(text):
    """規則式列點排版（免 AI）：偵測「第一…第二…第三…」連續列舉，
    轉成換行的「1. 2. 3.」清單，開頭引言補上冒號。
    觸發條件：以「第一」開頭、>=2 項；排除「第一次/第二次」這種時間詞。
    預設關閉（_FORMAT_LISTS_ENABLED），需使用者在設定頁開啟才生效。"""
    if not _FORMAT_LISTS_ENABLED:
        return text
    if not text:
        return text
    import re
    markers = []
    for m in re.finditer(r'第([一二三四五六七八九十兩两])', text):
        after = text[m.end():m.end() + 1]
        if after in '次名件':  # 第一次=次數、第一名=名次、第一件=計數，都不是列點
            continue
        markers.append((m, m.group(1)))
    if len(markers) < 2 or markers[0][1] != '一':
        return text

    intro = text[:markers[0][0].start()].strip().rstrip('，,、：:；; 。　')
    items = []
    for i, (m, _ord) in enumerate(markers):
        start = m.end()
        end = markers[i + 1][0].start() if i + 1 < len(markers) else len(text)
        seg = text[start:end]
        # 去掉項目開頭的「量詞(+名詞)」與連接詞：第一「件事情，」/「個是」/「點，」/「，」…
        seg = re.sub(
            r'^(?:[個个件位種种項项條条張张份步點点] ?)?'
            r'(?:事情|事兒|事儿|事|東西|东西|原因|問題|问题|地方|方面|步驟|步骤)?'
            r'(?:是|為|为|要|就是)?[，,、：:。　\s]*',
            '', seg)
        seg = seg.strip().rstrip('。，,、；;　 ')
        if seg:
            items.append(seg)
    if len(items) < 2:
        return text

    body = '\n'.join(f'{i + 1}. {it}' for i, it in enumerate(items))
    return (intro + '：\n' + body) if intro else body


# 講英文時的 uh/um/ah 常被雙語模型聽成這些中文語氣字 — 英文為主的行裡視為 filler
_EN_FILLER_CJK = set('啊嗯呃哦喔欸唉誒呀嘛')


def smart_join(parts):
    """拼接多段辨識結果：兩段交界若都是英數字元，補一個空格
    （中文直接相連；英文不補會黏成 youtranscribe 這種字）。"""
    out = ''
    for p in parts:
        if not p:
            continue
        if out and out[-1].isascii() and out[-1].isalnum() \
                and p[0].isascii() and p[0].isalnum():
            out += ' '
        out += p
    return out


def _is_english_dominant(line):
    """判斷一行是否「英文為主」：沒有中日韓字元，或僅夾雜少量語氣 filler
    （講英文時的 uh/ah 被聽成 啊/嗯）。真正的中英混雜句回傳 False。"""
    cjk = [ch for ch in line if _is_cjk(ch)]
    ascii_letters = sum(1 for ch in line if ch.isascii() and ch.isalpha())
    if not cjk:
        return ascii_letters > 0
    return (
        ascii_letters >= 12
        and len(cjk) <= 1 + ascii_letters // 15
        and all(ch in _EN_FILLER_CJK for ch in cjk)
    )


def localize_english_punct(text):
    """英文為主的行「去中文腔」：標點模型對英文也會輸出全形標點
    （hello，how are you？），轉成英文慣例：半形標點 + 標點後空格 +
    句首大寫 + 獨立 i → I；夾雜的中文語氣 filler（啊/嗯）一併清除。
    真正的中英混雜行保留中文標點（中文句子夾英文，全形才對）。"""
    if not text:
        return text
    out_lines = []
    for line in text.split('\n'):
        if not line or not _is_english_dominant(line):
            out_lines.append(line)
            continue
        l = re.sub('[' + ''.join(_EN_FILLER_CJK) + ']+', ' ', line)  # filler → 空格
        for a, b in [('，', ', '), ('。', '. '), ('？', '? '), ('！', '! '),
                     ('：', ': '), ('；', '; '), ('、', ', ')]:
            l = l.replace(a, b)
        l = re.sub(r'\s+([,.?!:;])', r'\1', l)   # 標點前不留空格
        l = re.sub(r'\s{2,}', ' ', l).strip()     # 收斂多餘空格
        l = re.sub(r'(^|[.?!]\s+)([a-z])',
                   lambda m: m.group(1) + m.group(2).upper(), l)  # 句首大寫
        l = re.sub(r'\bi\b', 'I', l)               # i / i'm → I / I'm
        out_lines.append(l)
    return '\n'.join(out_lines)


def clean_transcript(text):
    """辨識前清理（標點之前）：全形→半形 + 合併英文 + 去口吃 + 語助詞正規化"""
    if not text:
        return text
    text = normalize_ascii_width(text)
    text = merge_spaced_letters(text)
    text = collapse_repeats(text)
    text = collapse_phrase_repeats(text)
    text = normalize_interjections(text)
    return text


