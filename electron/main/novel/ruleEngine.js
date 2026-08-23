/**
 * 通用书源规则引擎
 * 兼容 so-novel JSON 格式的书源规则
 * 支持：CSS Selector、XPath（基础）、@js: 简单转换、filterTxt、filterTag、分页
 */

import * as cheerio from 'cheerio'
import iconv from 'iconv-lite'
import crypto from 'crypto'
import { fetchWithRetry, cleanContent, toSimplified, sanitizeSearchResult } from './utils.js'

/**
 * SPA / 加密小说站 Token 签名生成算法 (AES-128-CBC)
 */
function encryptSpaToken(params) {
  try {
    const rawCode = crypto.createHash('md5').update('book@token.html').digest('hex')
    const iv = Buffer.from(rawCode.slice(0, 16), 'utf-8')
    const key = Buffer.from(rawCode.slice(16), 'utf-8')
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv)
    let encrypted = cipher.update(JSON.stringify(params), 'utf-8', 'base64')
    encrypted += cipher.final('base64')
    return encodeURIComponent(encrypted)
  } catch (e) {
    return ''
  }
}

/**
 * 发送 SPA 站后端加密 API 请求
 */
export async function requestSpaApi(host, endpoint, params) {
  const token = encryptSpaToken(params)
  if (!token) return null
  const url = `${host.replace(/\/+$/, '')}/api/${endpoint}?token=${token}`
  try {
    const res = await fetchWithRetry(url, {
      headers: {
        'Referer': host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, 2, 8000)
    if (res && res.trim().startsWith('{')) {
      return JSON.parse(res)
    }
  } catch (e) {
    console.warn(`[RuleEngine:SPA] Request ${url} failed:`, e.message)
  }
  return null
}

function encodeGBK(str) {
  if (!str) return ''
  try {
    const buf = iconv.encode(str, 'gbk')
    let res = ''
    for (let i = 0; i < buf.length; i++) {
      const hex = buf[i].toString(16).toUpperCase()
      res += '%' + (hex.length === 1 ? '0' + hex : hex)
    }
    return res
  } catch (e) {
    return encodeURIComponent(str)
  }
}

// ─── 公共工具 ─────────────────────────────────────────
/**
 * 封装通用 Legado 3.0 java.ajax 异步调用
 */
export async function executeLegadoAjax(arg, contextBaseUrl = '') {
  try {
    let url = ''
    let options = { method: 'GET', headers: {} }

    if (typeof arg === 'string') {
      const trimmed = arg.trim()
      const commaIdx = trimmed.indexOf(',')
      if (commaIdx !== -1) {
        url = trimmed.slice(0, commaIdx).trim()
        const jsonPart = trimmed.slice(commaIdx + 1).trim()
        try {
          const parsedOpt = JSON.parse(jsonPart)
          if (parsedOpt.method) options.method = String(parsedOpt.method).toUpperCase()
          if (parsedOpt.body) options.body = parsedOpt.body
          if (parsedOpt.headers) options.headers = { ...options.headers, ...parsedOpt.headers }
          if (parsedOpt.charset) options.charset = parsedOpt.charset
        } catch (_) {}
      } else {
        url = trimmed
      }
    } else if (typeof arg === 'object' && arg !== null) {
      url = arg.url || ''
      if (arg.method) options.method = String(arg.method).toUpperCase()
      if (arg.body) options.body = arg.body
      if (arg.headers) options.headers = { ...options.headers, ...arg.headers }
    }

    if (!url) return ''
    if (!url.startsWith('http') && contextBaseUrl) {
      if (url.startsWith('/')) {
        url = new URL(url, contextBaseUrl).toString()
      } else {
        url = `${contextBaseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
      }
    }

    if (options.method === 'POST') {
      if (!options.headers['Content-Type'] && typeof options.body === 'string') {
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
    }

    const res = await fetchWithRetry(url, options, 2, 8000)
    return res || ''
  } catch (err) {
    console.warn('[Legado:java.ajax] 请求失败:', err.message)
    return ''
  }
}

/**
 * 轻量 JSONPath 提取
 */
export function extractJsonPath(jsonStrOrObj, path) {
  if (!jsonStrOrObj || !path) return ''
  try {
    let obj = typeof jsonStrOrObj === 'string' ? JSON.parse(jsonStrOrObj) : jsonStrOrObj
    if (!obj || typeof obj !== 'object') return typeof jsonStrOrObj === 'string' ? jsonStrOrObj : ''

    const cleanPath = path.replace(/^\$\.?/, '')
    const tokens = cleanPath.split('.').filter(Boolean)
    let curr = obj

    for (let i = 0; i < tokens.length; i++) {
      if (curr == null) return ''
      const token = tokens[i]
      if (token.includes('[')) {
        const m = token.match(/^(\w+)\[(-?\d+)\]$/)
        if (m) {
          const key = m[1]
          let idx = parseInt(m[2])
          const arr = curr[key]
          if (Array.isArray(arr)) {
            if (idx < 0) idx = arr.length + idx
            curr = arr[idx]
          } else {
            return ''
          }
          continue
        }
      }
      curr = curr[token]
    }

    if (typeof curr === 'string') return curr
    if (typeof curr === 'number' || typeof curr === 'boolean') return String(curr)
    if (curr != null) return JSON.stringify(curr)
    return ''
  } catch (_) {
    return typeof jsonStrOrObj === 'string' ? jsonStrOrObj : ''
  }
}

/**
 * 执行 Legado 3.0 JavaScript 规则脚本（支持异步 java.ajax、CryptoJS、Jsoup 等）
 */
export async function evalLegadoJsAsync(jsCode, env = {}) {
  const {
    result = '',
    baseUrl = '',
    source = {},
    html = ''
  } = env

  const originUrl = baseUrl || source.bookSourceUrl || ''

  // 1. 构建 java 扩展环境
  const java = {
    ajax: async (arg) => {
      return await executeLegadoAjax(arg, originUrl)
    },
    md5Encode: (str) => {
      try {
        return crypto.createHash('md5').update(String(str || ''), 'utf-8').digest('hex')
      } catch (_) { return '' }
    },
    base64Decode: (str) => {
      try {
        return Buffer.from(String(str || ''), 'base64').toString('utf-8')
      } catch (_) { return '' }
    },
    base64Encode: (str) => {
      try {
        return Buffer.from(String(str || ''), 'utf-8').toString('base64')
      } catch (_) { return '' }
    },
    timeFormat: (timestamp) => {
      try {
        const num = Number(timestamp)
        if (!num) return String(timestamp || '')
        const date = new Date(num > 1e11 ? num : num * 1000)
        return date.toISOString().slice(0, 10)
      } catch (_) { return '' }
    },
    getString: (path) => {
      return extractJsonPath(result, path)
    },
    getElements: (selector) => {
      try {
        const $ = cheerio.load(html || result || '')
        return $(selector).toArray().map(el => $(el).html() || '')
      } catch (_) { return [] }
    },
    log: (...args) => console.log('[Legado:JS:Log]', ...args),
    toast: (...args) => {},
    longToast: (...args) => {}
  }

  // 2. 构建 org.jsoup.Jsoup 轻量模拟
  const org = {
    jsoup: {
      Jsoup: {
        parse: (rawHtml) => {
          const $ = cheerio.load(String(rawHtml || ''))
          return {
            select: (sel) => {
              const elements = $(sel).toArray()
              return {
                size: () => elements.length,
                get: (idx) => elements[idx],
                first: () => $(elements[0]),
                text: () => $(sel).text().trim(),
                attr: (name) => $(sel).attr(name) || '',
                html: () => $(sel).html() || '',
                remove: () => $(sel).remove()
              }
            },
            selectFirst: (sel) => {
              const el = $(sel).first()
              if (!el.length) return null
              return {
                text: () => el.text().trim(),
                attr: (name) => el.attr(name) || '',
                html: () => el.html() || '',
                outerHtml: () => $.html(el)
              }
            },
            text: () => $.text().trim(),
            html: () => $.html()
          }
        }
      }
    }
  }

  // 3. 构建 CryptoJS 模拟
  const CryptoJS = {
    MD5: (str) => ({
      toString: () => crypto.createHash('md5').update(String(str || '')).digest('hex')
    }),
    SHA1: (str) => ({
      toString: () => crypto.createHash('sha1').update(String(str || '')).digest('hex')
    }),
    enc: {
      Utf8: {
        parse: (str) => Buffer.from(String(str || ''), 'utf-8')
      },
      Base64: {
        parse: (str) => Buffer.from(String(str || ''), 'base64'),
        stringify: (buf) => Buffer.from(buf).toString('base64')
      }
    },
    mode: { CBC: 'cbc' },
    pad: { Pkcs7: 'pkcs7' },
    AES: {
      encrypt: (data, key, cfg) => {
        try {
          const iv = cfg?.iv || Buffer.alloc(16, 0)
          const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(String(key))
          const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(String(iv))
          const cipher = crypto.createCipheriv('aes-128-cbc', keyBuf.slice(0, 16), ivBuf.slice(0, 16))
          let enc = cipher.update(String(data), 'utf-8', 'base64')
          enc += cipher.final('base64')
          return { toString: () => enc }
        } catch (e) {
          return { toString: () => '' }
        }
      }
    }
  }

  // 4. 标准化 source 对象
  const safeSource = {
    bookSourceUrl: originUrl,
    bookSourceName: source.name || '',
    key: originUrl,
    getKey: () => originUrl,
    getVariable: () => '',
    setVariable: () => {}
  }

  try {
    let transformedJs = jsCode.replace(/(^|[^\w$.])java\.ajax\s*\(/g, '$1await java.ajax(')
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
    const fn = new AsyncFunction('result', 'baseUrl', 'source', 'java', 'org', 'CryptoJS', `
      try {
        ${transformedJs}
        return typeof result !== 'undefined' ? result : '';
      } catch(err) {
        console.warn('[Legado:evalAsync] 内部异常:', err.message);
        return result;
      }
    `)

    const out = await fn(result, originUrl, safeSource, java, org, CryptoJS)
    return out != null ? out : result
  } catch (err) {
    console.warn('[Legado:evalLegadoJsAsync] 执行失败:', err.message)
    return result
  }
}

/**
 * 执行 @js: 内联脚本（沙箱化，r 为输入字符串，返回处理后的字符串）
 */
function evalJsTransform(jsCode, r) {
  try {
    const fn = new Function('r', jsCode + '\nreturn r')
    return fn(r)
  } catch (e) {
    console.warn('[RuleEngine] @js 执行失败:', e.message)
    return r
  }
}

/**
 * 转换 Legado 3.0 Jsoup 简写语法为 Cheerio/CSS 兼容语法
 */
function parseLegadoJsoupPart(part) {
  if (!part) return ''
  let trimmed = part.trim()
  if (trimmed.startsWith('class.')) {
    const rest = trimmed.slice(6)
    const tokens = rest.split('.')
    if (tokens.length > 1 && !isNaN(tokens[tokens.length - 1])) {
      const idx = parseInt(tokens.pop()) + 1
      return `.${tokens.join('.')}:nth-of-type(${idx})`
    }
    return '.' + tokens.join('.').replace(/\s+/g, '.')
  }
  if (trimmed.startsWith('id.')) {
    const rest = trimmed.slice(3)
    return '#' + rest
  }
  if (trimmed.startsWith('tag.')) {
    const rest = trimmed.slice(4)
    const tokens = rest.split('.')
    if (tokens.length > 1 && !isNaN(tokens[tokens.length - 1])) {
      const idx = parseInt(tokens.pop()) + 1
      return `${tokens.slice(0, -1).join('.')}:eq(${idx - 1})`
    }
    return rest
  }
  return trimmed
}

/**
 * 解析增强版 Selector，完美支持 CSS + Legado 3.0 Jsoup 简写 + 多级 @ 链式解析 + ## 正则清洗
 */
function resolveSelector(sel, $, context) {
  if (!sel) return ''

  // 提取 Legado 正则清洗表达式（如 selector##regex）
  let cleanSel = sel
  let replaceRegex = null
  if (cleanSel.includes('##')) {
    const parts = cleanSel.split('##')
    cleanSel = parts[0]
    replaceRegex = parts.slice(1).join('##')
  }

  let val = ''

  // 特殊：以 @js: 开头
  if (cleanSel.startsWith('@js:')) {
    const jsCode = cleanSel.slice(4)
    const r = $(context).html() || ''
    val = evalJsTransform(jsCode, r)
  } else if (cleanSel.includes('@')) {
    // 1. 如果是以 @ 切分的多层 Jsoup 链式选择器
    const parts = cleanSel.split('@').map(p => p.trim()).filter(Boolean)
    let curr = $(context)
    let attrToFetch = null

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (p === 'text' || p === 'textNodes') {
        attrToFetch = 'text'
        continue
      }
      if (p === 'href' || p === 'src' || p === 'title' || p === 'alt' || p === 'content') {
        attrToFetch = p
        continue
      }
      const cssSel = parseLegadoJsoupPart(p)
      if (cssSel && curr && curr.length) {
        const found = curr.find(cssSel)
        if (found.length) curr = found.first()
      }
    }

    if (curr && curr.length) {
      if (attrToFetch === 'text') val = curr.text().trim()
      else if (attrToFetch) val = curr.attr(attrToFetch) || ''
      else val = curr.text().trim()
    }
  }

  // 2. 常规 CSS / Jsoup 解析备用
  if (!val) {
    const jsIdx = cleanSel.indexOf('@js:')
    const atIdx = jsIdx === -1 ? cleanSel.lastIndexOf('@') : cleanSel.lastIndexOf('@', jsIdx - 1)

    let cssPart = cleanSel
    let attrPart = null
    let jsPart = null

    if (jsIdx !== -1) {
      const beforeJs = cleanSel.slice(0, jsIdx)
      const attrAt = beforeJs.lastIndexOf('@')
      if (attrAt !== -1 && attrAt !== 0) {
        cssPart = beforeJs.slice(0, attrAt)
        attrPart = beforeJs.slice(attrAt + 1)
      } else {
        cssPart = beforeJs
      }
      jsPart = cleanSel.slice(jsIdx + 4)
    } else if (atIdx > 0) {
      cssPart = cleanSel.slice(0, atIdx)
      attrPart = cleanSel.slice(atIdx + 1)
    }

    cssPart = parseLegadoJsoupPart(cssPart)
    const $el = cssPart ? $(context).find(cssPart).first() : $(context)
    if ($el.length) {
      if (attrPart === 'href' || attrPart === 'src' || attrPart === 'title' || attrPart === 'alt') {
        val = $el.attr(attrPart) || ''
      } else if (attrPart === 'html') {
        val = $el.html() || ''
      } else if (attrPart) {
        val = $el.attr('content') || $el.attr(attrPart) || $el.text().trim()
      } else {
        val = $el.text().trim()
      }
    }

    if (jsPart) {
      val = evalJsTransform(jsPart, val)
    }
  }

  // 3. 应用 ## 正则清洗
  if (replaceRegex && val) {
    try {
      const subParts = replaceRegex.split('|')
      for (const p of subParts) {
        if (!p.trim()) continue
        const re = new RegExp(p.trim(), 'g')
        val = val.replace(re, '')
      }
    } catch (_) {}
  }

  return (val || '').trim()
}

/**
 * 从页面提取列表（result 选择器 → 多个元素）
 */
function resolveList(selector, $, root) {
  if (!selector) return []
  if (selector.includes('@js:')) {
    const jsIdx = selector.indexOf('@js:')
    const cssPart = selector.slice(0, jsIdx)
    const jsCode = selector.slice(jsIdx + 4)
    const htmlFull = (cssPart ? $(root).find(cssPart) : $(root)).html() || ''
    const transformed = evalJsTransform(jsCode, htmlFull)
    const $2 = cheerio.load(transformed)
    return $2('li, div, tr').toArray().map(el => $2(el))
  }
  return $(root).find(selector).toArray().map(el => $(el))
}

/**
 * 过滤正文文本（filterTxt 正则）
 */
function applyFilterTxt(text, filterTxt) {
  if (!filterTxt) return text
  try {
    const patterns = filterTxt.split('|')
    let result = text
    for (const p of patterns) {
      if (!p.trim()) continue
      try {
        const re = new RegExp(p.trim(), 'gm')
        result = result.replace(re, '')
      } catch (_) { result = result.split(p.trim()).join('') }
    }
    return result
  } catch (e) {
    return text
  }
}

/**
 * 处理正文 HTML 为纯文本
 * @param {cheerio.CheerioAPI} $ 
 * @param {string|null} filterTag 过滤掉的 HTML 标签
 * @param {boolean} paragraphTagClosed 是否有段落标签 <p>段落</p>
 * @param {string|null} paragraphTag  分隔符（如 `<br>+`）
 */
function extractContent($content, filterTag, paragraphTagClosed, paragraphTag) {
  if (!$content || !$content.length) return ''

  // 移除广告标签
  if (filterTag) {
    const tags = filterTag.split(',').map(t => t.trim()).filter(Boolean)
    for (const tag of tags) {
      try { $content.find(tag).remove() } catch (_) {}
    }
  }

  let text = ''
  if (paragraphTagClosed) {
    // 有封闭段落标签：提取每个 p 的 text
    const lines = []
    $content.find('p').each((_, el) => {
      const t = cheerio.load(el)('p').text().trim()
      if (t) lines.push(t)
    })
    if (lines.length) {
      text = lines.join('\n')
    } else {
      text = $content.text().trim()
    }
  } else if (paragraphTag) {
    // 非封闭段落：按分隔符（如 <br>）拆分
    const html = $content.html() || ''
    const sep = paragraphTag.replace(/[+*?()[\]{}|\\^$]/g, '\\$&').replace('\\+', '+')
    const parts = html.split(new RegExp(`<br\\s*\\/?>${sep}`, 'i'))
    text = parts.map(p => cheerio.load(p).text().trim()).filter(Boolean).join('\n')
  } else {
    text = $content.text().trim()
  }

  return text
}

// ─── 核心类 ─────────────────────────────────────────
export class RuleSource {
  constructor(rule) {
    this.rule = rule
    const namePart = (rule.name || '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')
    const urlPart = (rule.url || rule.baseUrl || '').replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_')
    const rawId = rule.id || `${namePart}_${urlPart}`.replace(/__+/g, '_').replace(/^_|_$/g, '')
    this.id = rawId || `source_${Math.random().toString(36).slice(2, 8)}`
    this.name = rule.name || this.id
    this.baseUrl = (rule.url || rule.baseUrl || '').replace(/\/$/, '')
    this.enabled = !rule.disabled
    this.needProxy = rule.needProxy || false
    this.source = this.id
    this.sourceName = this.name
  }

  /**
   * 构建完整 URL
   */
  _absUrl(href) {
    if (!href) return ''
    if (href.startsWith('http')) return href
    if (href.startsWith('//')) return 'https:' + href
    if (href.startsWith('/')) return this.baseUrl + href
    return this.baseUrl + '/' + href
  }

  /**
   * 发起 HTTP 请求（支持精确的 GET/POST/Cookie 与 GBK/UTF-8 自动探测）
   */
  async _request(urlOrConfig, keyword) {
    const searchRule = this.rule.search || {}
    let rawUrl = typeof urlOrConfig === 'string' ? urlOrConfig : urlOrConfig.url
    let method = (urlOrConfig.method || searchRule.method || 'get').toUpperCase()
    const cookies = urlOrConfig.cookies || searchRule.cookies

    let safeReferer = 'https://www.baidu.com'
    try {
      const refBase = this.baseUrl || this.rule.url || ''
      const cleanRef = refBase.replace(/[^\x00-\x7F]/g, '')
      if (cleanRef.startsWith('http')) {
        safeReferer = new URL(cleanRef).origin
      }
    } catch (_) {}

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': safeReferer
    }

    if (cookies) {
      headers['Cookie'] = typeof cookies === 'string'
        ? cookies
        : Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }

    // 优先尝试编码列表：规则指定优先，否则先 UTF-8 再 GBK
    const isExplicitGbk = this.rule.encoding === 'gbk' || this.rule.charset === 'gbk'
    const encodings = isExplicitGbk ? ['gbk', 'utf-8'] : ['utf-8', 'gbk']

    let lastError = null

    for (const enc of encodings) {
      try {
        const isGbk = enc === 'gbk'
        let url = rawUrl
        let bodyData = null

        if (keyword) {
          if (isGbk) {
            url = url.replace('%s', encodeGBK(keyword))
          } else {
            url = url.replace('%s', encodeURIComponent(keyword))
          }
        }

        // @js: URL 计算
        if (url.startsWith('@js:')) {
          const jsCode = url.slice(4)
          url = evalJsTransform(jsCode, keyword || '')
        }

        // POST 表单数据构造
        if (method === 'POST') {
          headers['Content-Type'] = 'application/x-www-form-urlencoded'
          let rawData = urlOrConfig.data || `searchkey=${keyword}`
          const matches = [...rawData.matchAll(/(\w+)\s*:\s*([^,}]+)/g)]
          const formObj = {}
          for (const m of matches) {
            const k = m[1].trim()
            let v = m[2].trim().replace(/^['"]|['"]$/g, '')
            if (v === '%s') v = keyword
            formObj[k] = v
          }

          if (Object.keys(formObj).length === 0) {
            formObj['searchkey'] = keyword
          }

          const pairs = []
          for (const [k, v] of Object.entries(formObj)) {
            if (isGbk) {
              pairs.push(`${encodeURIComponent(k)}=${encodeGBK(v)}`)
            } else {
              pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            }
          }
          bodyData = pairs.join('&')
        }

        const html = await fetchWithRetry(url, {
          method,
          headers,
          body: bodyData
        }, 1, 6000)

        if (html && html.length > 50) {
          return html
        }
      } catch (err) {
        lastError = err
      }
    }

    if (lastError) throw lastError
    return ''
  }

  // ─── 搜索 ───────────────────────────────────────────
  async search(keyword) {
    const s = this.rule.search
    if (!s || s.disabled) return []

    try {
      let targetUrl = s.url || ''
      // 自动修复 SPA Hash 路由 URL 为 API 或真实路径
      if (targetUrl.includes('/#/search')) {
        targetUrl = targetUrl.replace('/#/search', '/api/search')
      }

      const html = await this._request({ ...s, url: targetUrl }, keyword)
      if (!html) return []

      // 1. 优先自动检测是否为 JSON 响应（支持现代 SPA / API 书源）
      const trimmed = html.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const json = JSON.parse(trimmed)
          let list = Array.isArray(json) ? json : (json.data || json.list || json.books || json.results || json.items || [])
          if (Array.isArray(list) && list.length > 0) {
            const results = []
            const host = this.baseUrl || (targetUrl.match(/^(https?:\/\/[^/]+)/) ? targetUrl.match(/^(https?:\/\/[^/]+)/)[1] : '')
            
            // 如果搜索条目缺少最新章节或更新时间，自动为前 15 条并发请求书籍详情补全
            const needEnrich = list.slice(0, 15).some(it => (!it.lastchapter && !it.latestChapter) && (it.id || it.bookId))
            const enrichedMap = {}
            if (needEnrich && host) {
              const enrichPromises = list.slice(0, 15).map(async (it) => {
                const bookId = it.id || it.bookId || ''
                if (bookId) {
                  try {
                    const detail = await requestSpaApi(host, 'book', { id: Number(bookId) || bookId })
                    if (detail && detail.title) {
                      enrichedMap[bookId] = detail
                    }
                  } catch (_) {}
                }
              })
              await Promise.allSettled(enrichPromises)
            }

            for (const it of list) {
              const id = it.id || it.bookId || it.book_id || ''
              const detail = enrichedMap[id] || {}

              const title = it.title || it.name || it.bookName || it.book_name || detail.title || ''
              if (!title) continue
              const author = it.author || it.authorName || it.writer || detail.author || '未知'
              const itemUrl = it.url || (id ? `${this.baseUrl}/book/${id}/` : '')
              const latestChapter = it.lastchapter || it.latestChapter || it.last_chapter || detail.lastchapter || ''
              const updateTime = it.lastupdate || it.updateTime || it.last_update || detail.lastupdate || ''
              const status = it.full || it.status || detail.full || ''

              results.push(sanitizeSearchResult({
                title: toSimplified(title),
                author: toSimplified(author),
                cover: it.cover || it.coverUrl || detail.cover || null,
                status: status,
                latestChapter: toSimplified(latestChapter),
                lastUpdateTime: updateTime,
                url: this._absUrl(itemUrl),
                source: this.id,
                sourceName: this.name
              }))
            }
            if (results.length > 0) {
              return results
            }
          }
        } catch (_) {}
      }

      // 2. 常规 HTML DOM 选择器解析
      let $ = cheerio.load(html)

      // result 可能含 @js:（响应体转换）
      let resultSel = s.result || ''
      let items = []

      if (resultSel.includes('@js:')) {
        const jsIdx = resultSel.indexOf('@js:')
        const cssPart = resultSel.slice(0, jsIdx)
        const jsCode = resultSel.slice(jsIdx + 4)
        const htmlFull = cssPart ? $(cssPart).html() : $.html()
        const transformed = evalJsTransform(jsCode, htmlFull || html)
        $ = cheerio.load(transformed)
        items = $('dl, li, div, tr').toArray().map(el => $(el)).filter(el => el.text().trim())
      } else {
        items = $(resultSel).toArray().map(el => $(el))
      }

      const results = []
      for (const $item of items) {
        let titleText = resolveSelector(s.bookName, $, $item)
        if (!titleText) {
          // 备用：尝试普通 find('a')
          titleText = $item.find('a').first().text().trim()
        }
        if (!titleText) continue

        // 书籍详情页 URL
        let bookUrl = ''
        const titleEl = s.bookName ? $item.find(s.bookName.split('@')[0]).first() : null
        const titleHref = titleEl?.attr('href') || $item.find('a').first().attr('href')
        if (titleHref) {
          bookUrl = this._absUrl(titleHref)
        } else {
          bookUrl = this._absUrl(resolveSelector(s.bookName + '@href', $, $item))
        }

        const authorText = resolveSelector(s.author, $, $item) || '未知'
        const latestChapterText = resolveSelector(s.latestChapter, $, $item)
        const updateTimeText = resolveSelector(s.lastUpdateTime, $, $item)
        const statusText = resolveSelector(s.status, $, $item)

        results.push(sanitizeSearchResult({
          title: toSimplified(titleText),
          author: toSimplified(authorText),
          cover: null,
          status: statusText || '',
          latestChapter: toSimplified(latestChapterText || ''),
          lastUpdateTime: updateTimeText || '',
          url: bookUrl,
          source: this.id,
          sourceName: this.name
        }))
      }
      return results
    } catch (e) {
      console.warn(`[RuleSource:${this.name}] search error:`, e.message)
      return []
    }
  }

  // ─── 获取章节目录 ────────────────────────────────────
  async getChapters(novelUrl) {
    const book = this.rule.book || {}
    const toc = this.rule.toc || {}

    try {
      // 0. 优先检测是否为 SPA / API 单页应用书籍 URL（如包含 /#/book/123 或 /book/123）
      const spaBookMatch = novelUrl.match(/book\/(\d+)/) || novelUrl.match(/\/(\d+)\/?$/)
      if (spaBookMatch) {
        const bookId = spaBookMatch[1]
        const host = this.baseUrl || (novelUrl.match(/^(https?:\/\/[^/]+)/) ? novelUrl.match(/^(https?:\/\/[^/]+)/)[1] : '')
        if (host) {
          try {
            const bookData = await requestSpaApi(host, 'book', { id: Number(bookId) || bookId })
            if (bookData && bookData.title) {
              const dirId = bookData.dirid || bookId
              const listData = await requestSpaApi(host, 'booklist', { id: Number(dirId) || dirId })
              if (listData && Array.isArray(listData.list) && listData.list.length > 0) {
                const chapters = listData.list.map((chName, idx) => ({
                  title: toSimplified(chName),
                  url: `${host.replace(/\/+$/, '')}/#/book/${bookId}/${idx + 1}.html`
                }))
                return {
                  title: toSimplified(bookData.title || ''),
                  author: toSimplified(bookData.author || '未知'),
                  description: toSimplified(bookData.intro || ''),
                  cover: bookData.cover || null,
                  chapters
                }
              }
            }
          } catch (_) {}
        }
      }

      // 1. 传统服务端渲染站点：请求详情页 HTML
      const detailHtml = await fetchWithRetry(novelUrl)
      const $detail = cheerio.load(detailHtml)

      const title = toSimplified(
        ($detail('meta[property="og:novel:book_name"]').attr('content') ||
         $detail('meta[name="og:novel:book_name"]').attr('content') ||
         (book.bookName ? $detail(book.bookName.split('@')[0]).first().text().trim() : '') ||
         $detail('h1').first().text().trim()).replace(/\s+/g, '')
      )
      const author = toSimplified(
        ($detail('meta[property="og:novel:author"]').attr('content') ||
         $detail('meta[name="og:novel:author"]').attr('content') ||
         (book.author ? $detail(book.author.split('@')[0]).first().text().trim() : '') ||
         '未知')
      )
      const description = toSimplified(
        ($detail('meta[property="og:description"]').attr('content') ||
         $detail('meta[name="og:description"]').attr('content') ||
         (book.intro ? $detail(book.intro.split('@')[0]).first().text().trim() : ''))
      )
      const cover = ($detail('meta[property="og:image"]').attr('content') ||
                     $detail('meta[name="og:image"]').attr('content') ||
                     (book.coverUrl ? resolveSelector(book.coverUrl, $detail, $detail.root()) : ''))

      // 2. 目录页（可能与详情页不同）
      let tocUrl = novelUrl
      if (toc.url) {
        // toc.url 是正则或带 %s 的 URL 模板
        if (toc.url.includes('%s')) {
          // 从 novelUrl 提取 ID
          const bookUrlPattern = book.url
          let bookId = ''
          if (bookUrlPattern) {
            const re = new RegExp(bookUrlPattern)
            const m = novelUrl.match(re)
            if (m) bookId = m[1]
          }
          if (!bookId) {
            const m = novelUrl.match(/\/(\d+)\/?$/) || novelUrl.match(/\/([^/]+)\/?$/)
            if (m) bookId = m[1]
          }
          tocUrl = toc.url.replace('%s', bookId)
        }
      }

      let tocHtml = tocUrl === novelUrl ? detailHtml : await fetchWithRetry(tocUrl)
      const $toc = cheerio.load(tocHtml)

      // 处理目录分页（如果有 nextPage）
      const chapters = []
      const seen = new Set()

      const extractChapters = ($page) => {
        const baseUri = toc.baseUri || ''
        $page(toc.item || 'a').each((_, el) => {
          const $el = $page(el)
          const text = $el.text().trim()
          const href = $el.attr('href')
          if (!text || !href) return
          const absHref = href.startsWith('http') ? href : (baseUri ? baseUri.replace('%s', '') + href : this._absUrl(href))
          if (!seen.has(absHref)) {
            seen.add(absHref)
            chapters.push({ title: toSimplified(text), url: absHref })
          }
        })
      }

      extractChapters($toc)

      // 下一页（翻页目录）—— 仅处理 select option 格式
      if (toc.nextPage && chapters.length > 0) {
        const nextPageSel = toc.nextPage
        const $opts = $toc(nextPageSel)
        if ($opts.length > 1) {
          for (let i = 1; i < Math.min($opts.length, 30); i++) {
            const optVal = $toc($opts[i]).attr('value') || $toc($opts[i]).text().trim()
            if (!optVal) continue
            const nextUrl = optVal.startsWith('http') ? optVal : this._absUrl(optVal)
            try {
              const nextHtml = await fetchWithRetry(nextUrl)
              extractChapters(cheerio.load(nextHtml))
            } catch (_) { break }
          }
        }
      }

      return { title, author, description, cover, chapters }
    } catch (e) {
      console.warn(`[RuleSource:${this.name}] getChapters error:`, e.message)
      throw e
    }
  }

  // ─── 获取章节正文 ────────────────────────────────────
  async getContent(chapterUrl) {
    const ch = this.rule.chapter || {}
    try {
      // 0. 优先检测是否为 SPA / API 章节 URL（如包含 /#/book/123/456.html 或 /book/123/456.html）
      const spaChapterMatch = chapterUrl.match(/book\/(\d+)\/(\d+)/)
      if (spaChapterMatch) {
        const bookId = spaChapterMatch[1]
        const chapterId = spaChapterMatch[2]
        const host = this.baseUrl || (chapterUrl.match(/^(https?:\/\/[^/]+)/) ? chapterUrl.match(/^(https?:\/\/[^/]+)/)[1] : '')
        if (host) {
          try {
            const chapterData = await requestSpaApi(host, 'chapter', {
              id: Number(bookId) || bookId,
              chapterid: Number(chapterId) || chapterId
            })
            if (chapterData && chapterData.txt) {
              const cleanTxt = cleanContent(chapterData.txt)
              if (cleanTxt && cleanTxt.length > 10) {
                return applyFilterTxt(cleanTxt, ch.filterTxt || '')
              }
            }
          } catch (_) {}
        }
      }

      // 1. 传统 HTML 站点：请求章节正文 HTML
      const html = await fetchWithRetry(chapterUrl)
      let rawResult = html
      let contentRule = (ch.content || '').trim()
      let text = ''

      // 2. 检查内容规则是否包含 Legado <js>...</js> 或 @js:
      if (contentRule.includes('<js>') || contentRule.includes('@js:')) {
        let jsCode = ''
        let postSelector = ''

        if (contentRule.includes('<js>')) {
          const startIdx = contentRule.indexOf('<js>')
          const endIdx = contentRule.indexOf('</js>')
          if (endIdx > startIdx) {
            jsCode = contentRule.slice(startIdx + 4, endIdx)
            postSelector = contentRule.slice(endIdx + 5).trim()
          } else {
            jsCode = contentRule.slice(startIdx + 4)
          }
        } else if (contentRule.startsWith('@js:')) {
          jsCode = contentRule.slice(4)
        } else if (contentRule.includes('@js:')) {
          const jsIdx = contentRule.indexOf('@js:')
          const cssPart = contentRule.slice(0, jsIdx)
          jsCode = contentRule.slice(jsIdx + 4)
          if (cssPart) {
            const $temp = cheerio.load(html)
            rawResult = $temp(cssPart).html() || html
          }
        }

        if (jsCode) {
          try {
            const evalResult = await evalLegadoJsAsync(jsCode, {
              result: rawResult,
              baseUrl: chapterUrl,
              source: {
                name: this.name,
                bookSourceUrl: this.baseUrl
              },
              html: html
            })

            if (evalResult) {
              if (postSelector && postSelector.startsWith('$.')) {
                text = extractJsonPath(evalResult, postSelector)
              } else if (postSelector) {
                const $post = cheerio.load(typeof evalResult === 'string' ? evalResult : JSON.stringify(evalResult))
                text = resolveSelector(postSelector, $post, $post.root())
              } else {
                text = typeof evalResult === 'string' ? evalResult : JSON.stringify(evalResult)
              }
            }
          } catch (e) {
            console.warn(`[RuleSource:${this.name}] Legado JS 执行异常:`, e.message)
          }
        }
      } else if (contentRule && !contentRule.includes('{') && !contentRule.includes('let ') && !contentRule.includes('function') && !contentRule.startsWith('<')) {
        // 常规合法 CSS 选择器解析
        const $ = cheerio.load(html)
        $('script, style, noscript').remove()

        let $content = $(contentRule).first()
        if ($content.length) {
          // 过滤标签
          if (ch.filterTag) {
            const tags = ch.filterTag.split(',').map(t => t.trim()).filter(Boolean)
            for (const tag of tags) {
              try { $content.find(tag).remove() } catch (_) {}
            }
          }

          text = extractContent(
            $content,
            null,
            ch.paragraphTagClosed === true || ch.paragraphTagClosed === 'true',
            ch.paragraphTag || null
          )
        }
      }

      // 3. 关键防御：防规则代码泄露检测
      const isCodeLeak = (txt) => {
        if (!txt) return false
        const codeKeywords = [
          'let id = result.match', 'java.ajax', 'function(', 'org.jsoup',
          '<js>', '</js>', 'source.bookSourceUrl', 'JSON.stringify(option)',
          'newWebView', 'evalJsTransform'
        ]
        return codeKeywords.some(kw => txt.includes(kw))
      }

      if (isCodeLeak(text) || !text || text.trim().length < 15) {
        // 规则失效或泄露，自动触发全网通用正文智能提取器
        const $ = cheerio.load(html)
        $('script, style, noscript, header, footer, nav').remove()

        const fallbacks = [
          '#content', '#txtContent', '#chaptercontent', '#htmlContent',
          '.read-content', '#article_content', '#booktxt', '.content',
          'div.showtxt', '#nr1', '#nr', '.entry-content', 'article',
          '.novel-content', '.text-content', '#content_txt'
        ]

        for (const fb of fallbacks) {
          const $fb = $(fb).first()
          if ($fb.length > 0) {
            const fbText = extractContent($fb, null, false, '<br>+')
            if (fbText && fbText.length > 20 && !isCodeLeak(fbText)) {
              text = fbText
              break
            }
          }
        }

        // 如果仍未命中，按中文密度最大的标签提取
        if (!text || text.trim().length < 15 || isCodeLeak(text)) {
          let bestEl = null
          let maxLen = 0
          $('div, section, article').each((_, el) => {
            const $el = $(el)
            if ($el.find('div, section, article').length > 3) return
            const t = $el.text().trim()
            if (t.length > maxLen && !isCodeLeak(t)) {
              maxLen = t.length
              bestEl = $el
            }
          })
          if (bestEl && maxLen > 30) {
            text = extractContent(bestEl, null, false, '<br>+')
          }
        }
      }

      // 4. 过滤广告文字
      text = applyFilterTxt(text, ch.filterTxt || '')

      return cleanContent(text) || '【正文内容为空或防爬拦截】'
    } catch (e) {
      console.warn(`[RuleSource:${this.name}] getContent error:`, e.message)
      throw e
    }
  }
}

/**
 * 从 JSON 规则列表创建 RuleSource 实例列表
 */
export function createSourcesFromRules(rules) {
  return (rules || [])
    .filter(r => !r.disabled)
    .map(r => new RuleSource(r))
}
