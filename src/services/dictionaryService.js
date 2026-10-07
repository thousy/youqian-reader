// 会话级查词高速缓存
const wordCache = new Map()
// 会话级长句翻译高速缓存
const sentenceCache = new Map()

/**
 * 智能检测选中文本的优势语言
 * @param {string} text 
 * @returns {'zh' | 'en' | null}
 */
export function detectTextLanguage(text) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null
  const zhCount = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length
  const enCount = (trimmed.match(/[a-zA-Z]/g) || []).length
  if (zhCount > 0 && zhCount >= enCount) return 'zh'
  if (enCount > 0) return 'en'
  return null
}

/**
 * 判断是否为单个纯英文单词（适合展示微词典、音标与生词本）
 * @param {string} text 
 * @returns {boolean}
 */
export function isSingleEnglishWord(text) {
  if (!text || typeof text !== 'string') return false
  const clean = text.trim().replace(/^[^\w]+|[^\w]+$/g, '')
  if (!clean || clean.length > 35) return false
  // 必须是单个连续单词（允许带连字符或缩写撇号，如 well-known, o'clock, don't）
  return /^[a-zA-Z]+(?:['-][a-zA-Z]+)*$/.test(clean)
}

/**
 * 兼容旧接口：判断划选文本是否为单个英文单词
 * @param {string} text 
 * @returns {boolean}
 */
export function isEnglishQuery(text) {
  return isSingleEnglishWord(text)
}

/**
 * 判断划选文本是否适合翻译（只要包含有效内容均可翻译）
 * @param {string} text 
 * @returns {boolean}
 */
export function canTranslateText(text) {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed.length < 1 || trimmed.length > 2000) return false
  return /[a-zA-Z\u4e00-\u9fa5]/.test(trimmed)
}

// 经典少儿/高频英美用词与拼写差异知识库
const UK_US_DIFFERENCES = {
  // 经典用词差异 (英国 ↔ 美国)
  'flat': { text: '英式 flat ↔ 美式 apartment (公寓)' },
  'apartment': { text: '美式 apartment ↔ 英式 flat (公寓)' },
  'autumn': { text: '英式 autumn ↔ 美式 fall (秋天)' },
  'fall': { text: '美式 fall ↔ 英式 autumn (秋天)' },
  'holiday': { text: '英式 holiday ↔ 美式 vacation (假期)' },
  'vacation': { text: '美式 vacation ↔ 英式 holiday (假期)' },
  'sweets': { text: '英式 sweets ↔ 美式 candy (糖果)' },
  'candy': { text: '美式 candy ↔ 英式 sweets (糖果)' },
  'biscuit': { text: '英式 biscuit ↔ 美式 cookie (饼干)' },
  'cookie': { text: '美式 cookie ↔ 英式 biscuit (饼干)' },
  'film': { text: '英式 film ↔ 美式 movie (电影)' },
  'movie': { text: '美式 movie ↔ 英式 film (电影)' },
  'football': { text: '英式 football ↔ 美式 soccer (足球)' },
  'soccer': { text: '美式 soccer ↔ 英式 football (足球)' },
  'rubber': { text: '英式 rubber ↔ 美式 eraser (橡皮)' },
  'eraser': { text: '美式 eraser ↔ 英式 rubber (橡皮)' },
  'underground': { text: '英式 underground/tube ↔ 美式 subway (地铁)' },
  'subway': { text: '美式 subway ↔ 英式 underground/tube (地铁)' },
  'lift': { text: '英式 lift ↔ 美式 elevator (电梯)' },
  'elevator': { text: '美式 elevator ↔ 英式 lift (电梯)' },
  'lorry': { text: '英式 lorry ↔ 美式 truck (卡车)' },
  'truck': { text: '美式 truck ↔ 英式 lorry (卡车)' },
  'trousers': { text: '英式 trousers ↔ 美式 pants (长裤)' },
  'pants': { text: '美式 pants (裤子) ↔ 英式 trousers (注: 英式指内裤)' },
  'rubbish': { text: '英式 rubbish ↔ 美式 garbage/trash (垃圾)' },
  'garbage': { text: '美式 garbage ↔ 英式 rubbish (垃圾)' },
  'trash': { text: '美式 trash ↔ 英式 rubbish (垃圾)' },
  'petrol': { text: '英式 petrol ↔ 美式 gas/gasoline (汽油)' },
  'gas': { text: '美式 gas ↔ 英式 petrol (汽油)' },
  'torch': { text: '英式 torch ↔ 美式 flashlight (手电筒)' },
  'flashlight': { text: '美式 flashlight ↔ 英式 torch (手电筒)' },
  'post': { text: '英式 post ↔ 美式 mail (邮递/邮件)' },
  'mail': { text: '美式 mail ↔ 英式 post (邮递/邮件)' },
  'queue': { text: '英式 queue ↔ 美式 line (排队)' },
  'chips': { text: '英式 chips (炸薯条) ↔ 美式 french fries (注: 美式chips为薯片)' },
  'crisps': { text: '英式 crisps ↔ 美式 potato chips (薯片)' },

  // 经典拼写差异
  'colour': { text: '英式拼写 colour ↔ 美式 color (颜色)' },
  'color': { text: '美式拼写 color ↔ 英式 colour (颜色)' },
  'favourite': { text: '英式拼写 favourite ↔ 美式 favorite (最喜爱的)' },
  'favorite': { text: '美式拼写 favorite ↔ 英式 favourite (最喜爱的)' },
  'centre': { text: '英式拼写 centre ↔ 美式 center (中心)' },
  'center': { text: '美式拼写 center ↔ 英式 centre (中心)' },
  'theatre': { text: '英式拼写 theatre ↔ 美式 theater (剧场)' },
  'theater': { text: '美式拼写 theater ↔ 英式 theatre (剧场)' },
  'neighbour': { text: '英式拼写 neighbour ↔ 美式 neighbor (邻居)' },
  'neighbor': { text: '美式拼写 neighbor ↔ 英式 neighbour (邻居)' },
  'metre': { text: '英式拼写 metre ↔ 美式 meter (米/公尺)' },
  'meter': { text: '美式拼写 meter ↔ 英式 metre (米/公尺)' },
  'programme': { text: '英式拼写 programme ↔ 美式 program (节目/程序)' },
  'program': { text: '美式拼写 program ↔ 英式 programme (程序/节目)' },
  'traveller': { text: '英式拼写 traveller ↔ 美式 traveler (旅行者)' },
  'traveler': { text: '美式拼写 traveler ↔ 英式 traveller (旅行者)' }
}

/**
 * 获取单词对应的经典英美差异提示
 * @param {string} word 
 * @returns {{ text: string } | null}
 */
export function getUkUsDiff(word) {
  if (!word || typeof word !== 'string') return null
  const key = word.trim().toLowerCase()
  return UK_US_DIFFERENCES[key] || null
}

/**
 * 播放英文标准发音（优先采用 W3C 原生本地离线发音，零版权风险、无需网络）
 * @param {string} word 待发音文本
 * @param {string} lang 语言 ('en-US' 或 'en-GB')
 */
export function speakWord(word, lang = 'en-US') {
  if (!word || typeof window === 'undefined') return

  const cleanWord = word.trim().replace(/^[^\w]+|[^\w]+$/g, '')
  if (!cleanWord) return

  const isUk = lang === 'en-GB' || lang.toLowerCase().includes('gb')

  try {
    // 1. 优先使用浏览器标准开放 Web Speech API（纯本地离线）
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel() // 停止之前的发音
      const utterance = new SpeechSynthesisUtterance(cleanWord)
      utterance.lang = isUk ? 'en-GB' : 'en-US'
      utterance.rate = 0.9 // 稍放慢语速，更适合少儿辨音

      // 智能选取系统匹配的英语语音包（区分英音与美音）
      const voices = window.speechSynthesis.getVoices()
      const targetVoice = voices.find(v => isUk ? (v.lang.includes('GB') || v.lang.includes('UK')) : (v.lang.includes('US')))
        || voices.find(v => v.lang.startsWith('en'))
      if (targetVoice) {
        utterance.voice = targetVoice
      }

      window.speechSynthesis.speak(utterance)
      return
    }
  } catch (err) {
    console.warn('本地语音合成失败，尝试备用音频播放:', err)
  }

  // 2. 备用兜底音频 (type=1 为英音，type=2 为美音)
  try {
    const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanWord)}&type=${isUk ? 1 : 2}`
    const audio = new Audio(audioUrl)
    audio.play().catch(e => console.warn('音频播放受限:', e))
  } catch (_) {}
}

/**
 * 智能解析一行释义中的词性标签与具体释义
 * @param {string} line 如 "n. 花园，菜园" 或 "【名】 加登"
 * @returns {{ pos: string, meaning: string }}
 */
export function parsePosLine(line) {
  if (!line || typeof line !== 'string') return { pos: '', meaning: '' }
  const trimmed = line.trim()
  
  // 匹配常见英文词性缩写 (如 n., v., adj., adv., prep., pron., conj., vi., vt.) 或中文标签 【名】
  const match = trimmed.match(/^(?:([a-zA-Z]{1,5}\.)|【([^】]+)】)\s*(.*)$/)
  if (match) {
    const pos = match[1] || (match[2] ? `【${match[2]}】` : '')
    const meaning = match[3] || ''
    return { pos, meaning }
  }
  return { pos: '', meaning: trimmed }
}

/**
 * 查询单词/短语释义与音标
 * @param {string} query 
 * @returns {Promise<{ success: boolean, word: string, phonetic: string, ukPhonetic?: string, usPhonetic?: string, ukUsDiff?: { text: string } | null, definitions: string[], definition: string }>}
 */
export async function lookupWord(query) {
  const cleanWord = (query || '').trim().replace(/^[^\w]+|[^\w]+$/g, '')
  if (!cleanWord) return { success: false, word: '', phonetic: '', definitions: [], definition: '' }

  const cacheKey = cleanWord.toLowerCase()
  if (wordCache.has(cacheKey)) {
    return wordCache.get(cacheKey)
  }

  try {
    let result = null
    if (window.api?.lookupWord) {
      result = await window.api.lookupWord(cleanWord)
    }

    if (!result || !result.success) {
      // 前端直连备用查询
      const res = await fetch(`https://dict.youdao.com/suggest?num=1&doctype=json&q=${encodeURIComponent(cleanWord)}`)
      if (res.ok) {
        const data = await res.json()
        const entry = data?.data?.entries?.[0]
        if (entry) {
          const rawExplain = entry.explain || ''
          const parts = rawExplain.split(/;\s*(?=(?:n|v|adj|adv|prep|conj|pron|num|art|vi|vt|abbr)\.|\【)/i).map(s => s.replace(/[\s.·…]+$/g, '').trim()).filter(Boolean)
          result = {
            success: true,
            word: entry.entry || cleanWord,
            phonetic: '',
            definitions: parts.length > 0 ? parts : [rawExplain],
            definition: rawExplain || '暂无详细释义'
          }
        }
      }
    }

    const defs = Array.isArray(result?.definitions) && result.definitions.length > 0
      ? result.definitions
      : (result?.definition ? [result.definition] : ['点击小喇叭收听标准发音'])

    const finalRes = {
      success: !!(result && result.success),
      word: result?.word || cleanWord,
      phonetic: result?.phonetic || '',
      ukPhonetic: result?.ukPhonetic || '',
      usPhonetic: result?.usPhonetic || '',
      ukUsDiff: getUkUsDiff(result?.word || cleanWord),
      definitions: defs,
      definition: defs.join('; ')
    }

    wordCache.set(cacheKey, finalRes)
    return finalRes
  } catch (err) {
    console.warn('查词服务异常:', err)
    return {
      success: false,
      word: cleanWord,
      phonetic: '',
      definitions: ['查词网络稍有延迟，点击小喇叭可离线发音'],
      definition: '查词网络稍有延迟，点击小喇叭可离线发音'
    }
  }
}

/**
 * 翻译文本（支持英译中与反向中译英）
 * @param {string} sentence 待翻译文本
 * @param {string} [fromLang] 源语言 ('en' 或 'zh-CN')
 * @param {string} [toLang] 目标语言 ('zh-CN' 或 'en')
 * @returns {Promise<{ success: boolean, original: string, translation: string, direction: string }>}
 */
export async function translateSentence(sentence, fromLang, toLang) {
  const cleanText = (sentence || '').trim()
  if (!cleanText) return { success: false, original: '', translation: '', direction: '' }

  // 智能推断翻译语向
  let src = fromLang
  let tgt = toLang
  if (!src || !tgt) {
    const lang = detectTextLanguage(cleanText)
    if (lang === 'zh') {
      src = 'zh-CN'
      tgt = 'en'
    } else {
      src = 'en'
      tgt = 'zh-CN'
    }
  }

  const cacheKey = `${src}_${tgt}_${cleanText}`
  if (sentenceCache.has(cacheKey)) {
    return sentenceCache.get(cacheKey)
  }

  try {
    let result = null
    if (window.api?.translateSentence) {
      result = await window.api.translateSentence(cleanText, src, tgt)
    }

    if (!result || !result.success) {
      // 剥离小说对话中首尾孤立单双引号与破折号
      const cleaned = cleanText.replace(/^['"‘“’”—\s]+|['"‘“’”—\s]+$/g, '')
      const queryText = cleaned || cleanText

      // 前端直连公开备用翻译服务
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(queryText)}&langpair=${src}|${tgt}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        let trans = (data?.responseData?.translatedText || '').trim()

        if (!trans && Array.isArray(data?.matches)) {
          for (const m of data.matches) {
            if (m?.translation && typeof m.translation === 'string' && m.translation.trim()) {
              trans = m.translation.trim()
              break
            }
          }
        }

        if (trans) {
          trans = trans
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ')
          result = { success: true, original: cleanText, translation: trans, direction: `${src}->${tgt}` }
        }
      }
    }

    const finalRes = {
      success: !!(result && result.success),
      original: cleanText,
      translation: result?.translation || '暂无译文',
      direction: result?.direction || `${src}->${tgt}`
    }

    sentenceCache.set(cacheKey, finalRes)
    return finalRes
  } catch (err) {
    console.warn('长句翻译失败:', err)
    return {
      success: false,
      original: cleanText,
      translation: '翻译请求超时，点击小喇叭可收听发音',
      direction: `${src}->${tgt}`
    }
  }
}

/**
 * 朗读长句或文本（W3C 标准原生离线发音，支持中英文最佳语音匹配）
 * @param {string} text 
 * @param {string} lang 
 */
export function speakSentence(text, lang = 'en-US') {
  if (!text || typeof window === 'undefined') return
  const clean = text.trim()
  if (!clean) return

  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(clean)
      utterance.lang = lang
      utterance.rate = lang.startsWith('en') ? 0.9 : 1.0 // 英文稍放慢语速磨耳朵，中文标准语速

      const voices = window.speechSynthesis.getVoices()
      const targetPrefix = lang.slice(0, 2)
      const matchedVoice = voices.find(v => v.lang.startsWith(targetPrefix) && !v.localService)
        || voices.find(v => v.lang.startsWith(targetPrefix))
      if (matchedVoice) {
        utterance.voice = matchedVoice
      }
      window.speechSynthesis.speak(utterance)
    }
  } catch (err) {
    console.warn('语音朗读失败:', err)
  }
}
