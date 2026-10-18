/**
 * 通用书源规则引擎
 * 兼容 so-novel JSON 格式的书源规则
 * 支持：CSS Selector、XPath（基础）、@js: 简单转换、filterTxt、filterTag、分页
 */

import * as cheerio from 'cheerio'
import iconv from 'iconv-lite'
import crypto from 'crypto'
import { fetchWithRetry, cleanContent, toSimplified, sanitizeSearchResult, sanitizeHeaders, cleanBookTitleAndAuthor } from './utils.js'

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
 * 执行 @js: 内联脚本（兼容 Legado 的 result、r、java 环境）
 */
function evalJsTransform(jsCode, r) {
  try {
    const javaShim = {
      toNumChapter: (s) => (s || '').replace(/第([零一二两三四五六七八九十百千\d]+)章/g, (m, p) => `第${p}章`),
      ajax: () => ''
    }
    const fn = new Function('r', 'result', 'java', `
      var res = r;
      var java = java;
      var result = (typeof r !== 'undefined') ? r : '';
      ${jsCode}
      return (typeof result !== 'undefined' ? result : res);
    `)
    return fn(r, r, javaShim)
  } catch (e) {
    return r
  }
}

/**
 * 将常见的 XPath 表达式智能转换为 Cheerio CSS 选择器，杜绝 Empty sub-selector 报错
 */
function convertXPathToCss(xpath) {
  if (!xpath || typeof xpath !== 'string') return ''
  let s = xpath.trim()
  if (!s.startsWith('/') && !s.startsWith('.//') && !s.includes('following-sibling::')) {
    return s
  }

  // 1. 匹配类似 //*[@id="list"]//dt[2]/following-sibling::dd/a
  const idMatch = s.match(/\[@id=["']([^"']+)["']\]/)
  const classMatch = s.match(/\[@class=["']([^"']+)["']\]/)
  
  // 提取末尾的目标标签链
  let targetTail = ''
  if (s.includes('following-sibling::')) {
    const parts = s.split('following-sibling::')
    targetTail = parts[parts.length - 1].replace(/\[\d+\]/g, '').replace(/\/\//g, ' ').replace(/\//g, ' ').trim()
  } else {
    const slashTokens = s.split('/').filter(Boolean).map(t => t.replace(/\[\d+\]/g, '').replace(/\[[^\]]+\]/g, '').trim()).filter(Boolean)
    if (slashTokens.length > 0) {
      targetTail = slashTokens.join(' ')
    }
  }

  if (idMatch) {
    const id = idMatch[1]
    return targetTail ? `#${id} ${targetTail}` : `#${id}`
  }
  if (classMatch) {
    const cls = classMatch[1].split(' ').filter(Boolean).join('.')
    return targetTail ? `.${cls} ${targetTail}` : `.${cls}`
  }

  // 通用清理 // 与 /，将 [@...] 转为 CSS
  let cleaned = s
    .replace(/^\.?\/\//, '')
    .replace(/^\.?\//, '')
    .replace(/\[@id=["']([^"']+)["']\]/g, '#$1')
    .replace(/\[@class=["']([^"']+)["']\]/g, '.$1')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\/\//g, ' ')
    .replace(/\//g, ' ')
    .trim()

  return cleaned || 'a'
}

/**
 * 转换 Legado 3.0 Jsoup 简写语法为 Cheerio/CSS 兼容语法
 */
function parseLegadoJsoupPart(part) {
  if (!part) return ''
  let trimmed = part.trim()
    .replace(/:tbody/gi, ' tbody')
    .replace(/:thead/gi, ' thead')
    .replace(/:tfoot/gi, ' tfoot')
    .replace(/!(\d+|\*|[\d:]+)/g, '')
    .trim()

  // 若是以 / 或 // 开头的 XPath，先尝试转换为 CSS
  if (trimmed.startsWith('/') || trimmed.startsWith('.//') || trimmed.includes('following-sibling::')) {
    trimmed = convertXPathToCss(trimmed)
  }

  // text.下页 -> :contains("下页")
  if (trimmed.startsWith('text.')) {
    const kw = trimmed.slice(5).replace(/["']/g, '')
    return `:contains("${kw}")`
  }

  // class.xxx 或 class.item.0
  if (trimmed.startsWith('class.')) {
    const rest = trimmed.slice(6)
    const tokens = rest.split('.')
    if (tokens.length > 1 && !isNaN(tokens[tokens.length - 1])) {
      const idx = parseInt(tokens.pop())
      return `.${tokens.join('.')}:eq(${idx})`
    }
    return '.' + tokens.join('.').replace(/\s+/g, '.')
  }

  // id.xxx
  if (trimmed.startsWith('id.')) {
    const rest = trimmed.slice(3)
    return '#' + rest
  }

  // tag.a.0 或 tag.div 或 tag.li.-1
  if (trimmed.startsWith('tag.')) {
    const rest = trimmed.slice(4)
    const tokens = rest.split('.')
    if (tokens.length > 1 && !isNaN(tokens[tokens.length - 1])) {
      const idx = parseInt(tokens.pop())
      return `${tokens.join('.')}:eq(${idx})`
    }
    return rest
  }

  // a.0, p.1, span.0, div.2, li.-1 等纯 tag.index 简写
  const tagIndexMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\.(-?\d+)$/)
  if (tagIndexMatch) {
    const tagName = tagIndexMatch[1]
    const idx = parseInt(tagIndexMatch[2])
    return `${tagName}:eq(${idx})`
  }

  return trimmed
}

/**
 * 解析增强版 Selector，完美支持 CSS + Legado 3.0 Jsoup 简写 + 多级 @ 链式解析 + ## 正则清洗 + && 与 || 逻辑
 */
function resolveSelector(sel, $, context) {
  if (!sel) return ''

  try {
    // 0. 优先支持 Legado || 候选选择器（前一个提取不到时回退到下一个）
    if (sel.includes('||')) {
      const candidates = sel.split('||').map(s => s.trim()).filter(Boolean)
      for (const cand of candidates) {
        const res = resolveSelector(cand, $, context)
        if (res) return res
      }
      return ''
    }

    // 1. 优先支持 Legado && 复合字段选择器（提取多个字段值用空格拼接）
    if (sel.includes('&&')) {
      const subSels = sel.split('&&').map(s => s.trim()).filter(Boolean)
      const parts = subSels.map(s => resolveSelector(s, $, context)).filter(Boolean)
      return parts.join(' ').trim()
    }

    // 2. 提取 Legado 正则清洗表达式（如 selector##regex）
    let cleanSel = sel.trim()
    let replaceRegex = null
    if (cleanSel.includes('##')) {
      const parts = cleanSel.split('##')
      cleanSel = parts[0].trim()
      replaceRegex = parts.slice(1).join('##')
    }

    // 3. 处理 {{...}} 模板包裹
    if (cleanSel.startsWith('{{@@') && cleanSel.endsWith('}}')) {
      cleanSel = cleanSel.slice(4, -2).trim()
    } else if (cleanSel.startsWith('{{') && cleanSel.endsWith('}}') && !cleanSel.includes('function') && !cleanSel.includes('let ')) {
      cleanSel = cleanSel.slice(2, -2).trim()
    }

    // 4. 处理 <js> ... </js> 内联脚本
    if (cleanSel.includes('<js>')) {
      const jsMatch = cleanSel.match(/<js>([\s\S]*?)<\/js>/)
      if (jsMatch) {
        const jsCode = jsMatch[1]
        let r = ''
        try {
          r = typeof context === 'string' ? context : (context ? ($(context).html() || $(context).text() || '') : ($.html ? $.html() : ''))
        } catch (_) {}
        const transformed = evalJsTransform(jsCode, r)
        const rest = cleanSel.slice(cleanSel.indexOf('</js>') + 5).trim()
        if (rest) {
          try {
            const $sub = cheerio.load(transformed)
            return resolveSelector(rest, $sub, $sub.root())
          } catch (_) {
            return String(transformed || '').trim()
          }
        }
        return String(transformed || '').trim()
      }
    }

    let val = ''

    // 特殊：以 @js: 开头
    if (cleanSel.startsWith('@js:')) {
      const jsCode = cleanSel.slice(4)
      let r = ''
      try {
        r = $(context).html() || $(context).text() || ''
      } catch (_) {}
      val = evalJsTransform(jsCode, r)
    } else if (cleanSel.startsWith('$') || cleanSel.startsWith('{$.')) {
      // 5. JSONPath 轻量提取
      const path = cleanSel.replace(/^\{(\$\.[^}]+)\}$/, '$1')
      let ctxStr = ''
      if (typeof context === 'string') ctxStr = context
      else {
        try { ctxStr = $(context).text() || $(context).html() || '' } catch (_) {}
      }
      val = extractJsonPath(ctxStr, path)
    } else if (cleanSel.includes('@')) {
      // 6. 如果是以 @ 切分的多层 Jsoup 链式选择器
      const parts = cleanSel.split('@').map(p => p.trim()).filter(Boolean)
      let curr = $(context)
      let attrToFetch = null

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        if (p === 'text' || p === 'textNodes') {
          attrToFetch = 'text'
          continue
        }
        if (p === 'href' || p === 'src' || p === 'title' || p === 'alt' || p === 'content' || p === 'html') {
          attrToFetch = p
          continue
        }

        // 识别负数索引语法，如 li.-1 或 a.-2
        const negMatch = p.match(/^([a-zA-Z0-9_-]+)\.(-?\d+)$/)
        if (negMatch && curr && curr.length) {
          const tagName = negMatch[1]
          const idx = parseInt(negMatch[2])
          try {
            const found = curr.find(tagName)
            if (found.length) {
              curr = found.eq(idx)
              continue
            }
          } catch (_) {}
        }

        const cssSel = parseLegadoJsoupPart(p)
        if (cssSel && curr && curr.length) {
          try {
            const found = curr.find(cssSel)
            if (found.length) curr = found.first()
          } catch (_) {}
        }
      }

      if (curr && curr.length) {
        if (attrToFetch === 'text') val = curr.text().trim()
        else if (attrToFetch === 'html') val = curr.html() || ''
        else if (attrToFetch) val = curr.attr(attrToFetch) || ''
        else val = curr.text().trim()
      }
    }

    // 7. 常规 CSS / Jsoup 解析备用
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
      let $el = null
      try {
        $el = cssPart ? $(context).find(cssPart).first() : $(context)
      } catch (_) {
        $el = $(context)
      }

      if ($el && $el.length) {
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

    // 8. 应用 ## 正则清洗
    if (replaceRegex && val) {
      try {
        const subParts = replaceRegex.split('|')
        for (const p of subParts) {
          if (!p.trim()) continue
          try {
            const re = new RegExp(p.trim(), 'g')
            val = val.replace(re, '')
          } catch (_) {
            val = val.split(p.trim()).join('')
          }
        }
      } catch (_) {}
    }

    return (val || '').trim()
  } catch (err) {
    return ''
  }
}

/**
 * 解析增强版元素列表（支持 || 分隔候选、XPath 兼容、Legado Jsoup 链式 @ 与排除下标 !0:1:2）
 */
function queryElements($, selector, context) {
  if (!selector) return []
  const $root = context ? $(context) : ($.root ? $.root() : $('body'))

  // 1. 支持 Legado || 候选选择器
  if (selector.includes('||')) {
    const candidates = selector.split('||').map(s => s.trim()).filter(Boolean)
    for (const cand of candidates) {
      const res = queryElements($, cand, context)
      if (res && res.length > 0) return res
    }
    return []
  }

  // 2. 如果是 XPath
  let sel = selector.trim()
  if (sel.startsWith('/') || sel.startsWith('.//') || sel.includes('following-sibling::')) {
    sel = convertXPathToCss(sel)
  }

  // 3. 处理 Legado 多级 @ 链式结构 (例如 class.mulu_list@tag.li@tag.a 或 id.list@tag.dd)
  if (sel.includes('@') && !sel.includes('<js>') && !sel.startsWith('@js:')) {
    const parts = sel.split('@').map(p => p.trim()).filter(Boolean)
    // 检查末尾是否是纯属性提取词 (如 text, href 等)，如果是则去掉末尾属性词，只保留元素选择器链
    const attrWords = new Set(['text', 'textnodes', 'href', 'src', 'title', 'alt', 'content', 'html'])
    const lastPart = parts[parts.length - 1].toLowerCase()
    const cleanParts = attrWords.has(lastPart) ? parts.slice(0, -1) : parts

    let currentSet = [$root]
    for (const p of cleanParts) {
      // 提取排除下标 !0:1:2 或 !0
      let excludeIndices = new Set()
      let rawPart = p
      const exclMatch = rawPart.match(/!([\d:]+)/)
      if (exclMatch) {
        exclMatch[1].split(':').forEach(num => {
          const n = parseInt(num, 10)
          if (!isNaN(n)) excludeIndices.add(n)
        })
        rawPart = rawPart.replace(/![\d:]+/, '')
      }

      const cssPart = parseLegadoJsoupPart(rawPart)
      if (!cssPart) continue

      const nextSet = []
      for (const $curr of currentSet) {
        try {
          const found = $curr.find(cssPart).toArray()
          found.forEach((el, idx) => {
            if (!excludeIndices.has(idx)) {
              nextSet.push($(el))
            }
          })
        } catch (_) {}
      }
      currentSet = nextSet
      if (currentSet.length === 0) break
    }

    if (currentSet.length > 0) {
      return currentSet
    }
  }

  // 4. 单层或普通 CSS 选择器安全解析
  try {
    let cleanCss = parseLegadoJsoupPart(sel)
    cleanCss = cleanCss
      .replace(/:tbody/gi, ' tbody')
      .replace(/:thead/gi, ' thead')
      .replace(/:tfoot/gi, ' tfoot')
      .replace(/!(\d+|\*|[\d:]+)/g, '')
      .trim()
    
    cleanCss = cleanCss.replace(/^,+|,+$/g, '').trim()

    if (cleanCss) {
      return $root.find(cleanCss).toArray().map(el => $(el))
    }
  } catch (_) {
    // 拦截任何 Cheerio/CSS 语法解析异常（如 Empty sub-selector），由调用方安全降级
  }

  return []
}

/**
 * 通用小说目录智能启发式容器提取器（当书源规则失效或未命中时自动保底救火）
 */
function findHeuristicTocElements($page) {
  const commonSelectors = [
    '#list dd a', '#list a', '#chapters a', '.catalog a',
    '.chapter-list a', '.list-charts a', '.read-section a',
    'dl.chapterlist dd a', 'dl dd a', 'ul.dirs li a', 'ul.dirs a',
    '.dirtree a', '.book-list a', '.section-box a', '.mulu_list li a',
    '#chapterlist a', '.chapterlist a', '#dir a', '.dir a',
    '.content-list a', '.book_last a', '#defaulthtml4 a',
    'div.box_con div#list a', 'div.mulu a'
  ]

  for (const s of commonSelectors) {
    try {
      const items = $page(s).toArray()
      if (items.length >= 5) {
        return items.map(el => $page(el))
      }
    } catch (_) {}
  }

  // 深度保底：全页面链接特征扫描
  try {
    const chapterRegex = /第\s*[0-9零一二两三四五六七八九十百千]+\s*[章节回卷]|Chapter|\b\d{1,5}\b|楔子|序言|尾声|后记|番外|终章|感言/i
    const candidateLinks = []
    $page('a').each((_, el) => {
      const $el = $page(el)
      const text = $el.text().trim()
      const href = $el.attr('href')
      if (!href || href.startsWith('javascript:') || href === '#' || href.startsWith('void(')) return
      if (text.length >= 2 && text.length <= 50 && chapterRegex.test(text)) {
        candidateLinks.push($el)
      }
    })
    if (candidateLinks.length >= 5) {
      return candidateLinks
    }
  } catch (_) {}

  return []
}

/**
 * 保持兼容的 resolveList 导出
 */
function resolveList(selector, $, root) {
  return queryElements($, selector, root)
}

/**
 * 过滤正文文本（filterTxt 正则）
 */
function applyFilterTxt(text, filterTxt) {
  if (!filterTxt) return text
  try {
    let raw = filterTxt.trim()
    let result = text

    // 兼容 Legado 的 ##pattern##replace 或 ##pattern 语法
    if (raw.startsWith('##')) {
      const parts = raw.split('##').filter(Boolean)
      const pat = parts[0]
      const rep = parts[1] || ''
      try {
        const re = new RegExp(pat, 'gim')
        result = result.replace(re, rep)
        return result
      } catch (_) {}
    }

    const patterns = filterTxt.split('|')
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
    // 关键修复：绝对不能直接 $content.text()，因为 cheerio 会吃掉所有 <br>、<p>、<div>！
    // 必须先将 html 中的块级和换行标签转换为 \n，保留正常的段落分割
    let html = $content.html() || ''
    if (html) {
      html = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<p[^>]*>/gi, '\n')
      text = cheerio.load(html).text()
    } else {
      text = $content.text().trim()
    }
  }

  return text
}

/**
 * 全角转半角（标准化全角数字、全角英文字母、全角标点符号）
 */
export function toDBC(str) {
  if (!str) return ''
  return str
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

/**
 * 智能提炼纯净小说主书名（剥离题材标签、副标题、分部、分卷数字、作者等一切噪音）
 */
export function extractCleanBookName(rawTitle, fallbackAuthor = '') {
  if (!rawTitle) return ''
  let title = toDBC(rawTitle).trim()

  // 1. 若以【书名】或[书名]或《书名》开头，且括号内不全为数字/章节标记
  const bracketMatch = title.match(/^[【\[《]([^】\]》]+)[】\]》]/)
  if (bracketMatch) {
    const candidate = bracketMatch[1].trim()
    const isOnlyChapter = /^(?:第\s*)?[一二三四五六七八九十百千万\d]+(?:\.\d+)?(?:[－\-~～、至到]+[一二三四五六七八九十百千万\d]+(?:\.\d+)?)?(?:\s*章)?$/.test(candidate)
    if (!isOnlyChapter && candidate.length >= 2) {
      // 剥离分部等标签
      let bName = candidate.replace(/(?:上部|下部|第一部|第二部|前传|外传|后传|全本|精校|连载|续|番外)/g, '').trim()
      bName = bName.replace(/\s*\d+.*$/, '').trim()
      if (bName.length >= 2) return bName
    }
  }

  // 1.1 若标题包含无括号包围的明确单章标记（例如 "女神代行者 第194章 姐妹情深"），截断章节号及之后的所有小标题
  const chapterCutMatch = title.match(/^(.*?)(?:\s+第\s*[一二三四五六七八九十百千万\d]+\s*[章节卷]|\s*【第\s*[一二三四五六七八九十百千万\d]+\s*[章节卷]】)/)
  if (chapterCutMatch && chapterCutMatch[1].trim().length >= 2) {
    title = chapterCutMatch[1].trim()
  }

  // 2. 剥离所有圆括号内容（通常为分卷号、逆ntr、未删节、高H等副标题或标签）
  let clean = title.replace(/[（\(][^）\)]*[）\)]/g, ' ')

  // 3. 剥离所有方括号与书名号
  clean = clean.replace(/[【】\[\]《》]/g, ' ')

  // 4. 剥离作者标记与已知作者名
  clean = clean.replace(/[作|原][者|著][：:]\s*[^\s\[【<]+/g, ' ')
  if (fallbackAuthor && fallbackAuthor !== '未知' && fallbackAuthor !== '网络作家') {
    clean = clean.replace(new RegExp(fallbackAuthor, 'g'), ' ')
  }

  // 5. 剥离分部、章节字眼与中文/阿拉伯数字
  clean = clean.replace(/(?:上部|下部|第一部|第二部|第三部|续集|续篇|前传|后传|番外|第[一二三四五六七八九十\d]+[部卷季]|续)/g, ' ')
  clean = clean.replace(/(?:第\s*)?[一二三四五六七八九十百千万\d]+(?:\.\d+)?(?:[－\-~～、至到]+[一二三四五六七八九十百千万\d]+(?:\.\d+)?)?\s*(?:章|节|卷)?/g, ' ')

  // 6. 剥离副标题连接符
  if (clean.includes('——')) clean = clean.split('——')[0].trim()
  if (clean.includes('—')) clean = clean.split('—')[0].trim()
  if (clean.includes(' - ')) clean = clean.split(' - ')[0].trim()
  clean = clean.replace(/\s*[0-9一二三四五六七八九十百千万].*$/, '').trim()

  // 7. 剥离尾部空格隔开的疑似作者名（如 "新婚 东风瘦" 剥离为 "新婚"）
  const spaceParts = clean.trim().split(/\s+/)
  if (spaceParts.length === 2 && spaceParts[0].length >= 2 && spaceParts[1].length >= 2 && spaceParts[1].length <= 8) {
    if (!/^(?:第?[一二三四五六七八九十\d]+[部卷季章节]|完结|全本|上部|下部|番外|精校|连载)$/.test(spaceParts[1])) {
      clean = spaceParts[0]
    }
  }

  return clean.replace(/\s+/g, '').trim()
}

/**
/**
 * 中文数字快速换算为半角阿拉伯数字整数
 */
export function cnToInt(str) {
  if (!str) return 0
  const s = String(str).trim()
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    return parseFloat(s)
  }
  const cnDigits = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
  let total = 0
  let current = 0
  let hasCn = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (cnDigits[ch] !== undefined) {
      current = cnDigits[ch]
      hasCn = true
    } else if (ch === '十') {
      hasCn = true
      if (current === 0) current = 1
      total += current * 10
      current = 0
    } else if (ch === '百') {
      hasCn = true
      total += (current || 1) * 100
      current = 0
    } else if (ch === '千') {
      hasCn = true
      total += (current || 1) * 1000
      current = 0
    } else if (ch === '万') {
      hasCn = true
      total = (total + current) * 10000
      current = 0
    }
  }
  if (hasCn) {
    total += current
    return total
  }
  return parseInt(s, 10) || 0
}

/**
 * 智能解析 BBS 论坛作品标题与章节范围（支持 【10-14】, 1-7, 32-33, 1.1-1.13, 28.32--29.8, 中文数字章节, 复合分部模式）
 */
export function parseBbsChapterInfo(rawTitle, fallbackAuthor = '') {
  if (!rawTitle) return null
  const normTitle = toDBC(rawTitle).trim()

  // 1. 优先提取明确的章节区间或单章节（支持中文数字）
  // 模式1: 括号包围的分卷 (【10-14】, [1-7], (46-55), （1.1-1.13）, 【第36章】, （第二部１７－２３）, (第三十章-第三十一章))
  let rangeMatch = normTitle.match(/[【\[（\(]\s*(?:(?:第?[一二三四五六七八九十\d]+[部卷季]|上部|下部|续|番外)\s*)?(?:第\s*)?([一二三四五六七八九十百千\d]+(?:\.\d+)?)\s*(?:[－\-~～、至到]+(?:第\s*)?([一二三四五六七八九十百千\d]+(?:\.\d+)?))?\s*(?:章|节|卷)?(?:\s*完)?(?:\s*本卷终)?\s*[】\]）\)]/)

  // 模式2: 明确的 "第X-Y章" 或 "第X章"
  if (!rangeMatch) {
    rangeMatch = normTitle.match(/(?:第\s*)([一二三四五六七八九十百千\d]+(?:\.\d+)?)\s*(?:章|节|卷)?\s*(?:[－\-~～、至到]+)\s*(?:第\s*)?([一二三四五六七八九十百千\d]+(?:\.\d+)?)\s*(?:章|节|卷)/) ||
                 normTitle.match(/(?:第\s*)([一二三四五六七八九十百千\d]+(?:\.\d+)?)\s*(?:章|节|卷)/)
  }

  // 模式3: 开头或空白后的区间 (10-14, 1-7, 1.1-1.13, 28.32--29.8, 第十三章-第十六章)
  if (!rangeMatch) {
    rangeMatch = normTitle.match(/(?:^|[\s【\[（\(])(?:第\s*)?([一二三四五六七八九十百千\d]+(?:\.\d+)?)\s*(?:[－\-~～、至到]+)\s*(?:第\s*)?([一二三四五六七八九十百千\d]+(?:\.\d+)?)\s*(?:章|节|卷)?(?:\s*完)?(?:\s*\[|\s*$|\s*作|\s*译|\s*】|\s*\]|\s*）|\s*\)|\s+)/)
  }

  // 模式4: 纯数字或独立章节标号
  if (!rangeMatch) {
    rangeMatch = normTitle.match(/(?:^|[\s【\[（\(])(?:第\s*)?([一二三四五六七八九十百千\d]+(?:\.\d+)?)\s*(?:章|节|卷)?(?:\s*完)?(?:\s*\[|\s*$|\s*作|\s*】|\s*\]|\s*）|\s*\))/)
  }

  if (!rangeMatch) return null

  const rawStart = rangeMatch[1]
  const rawEnd = rangeMatch[2]

  // 2. 识别分部/分卷特征 (上部/下部/第一部/第二部/续等)
  let partNumber = 1
  const partMatch = normTitle.match(/(?:第([一二三四五六七八九十\d]+)[部|卷|季])|(上部|下部|前部|后部|续集|续篇|前传|后传|番外|续)/)
  if (partMatch) {
    const pStr = partMatch[0]
    if (pStr.includes('下') || pStr.includes('后') || pStr.includes('续') || pStr.includes('二')) {
      partNumber = 2
    } else if (pStr.includes('上') || pStr.includes('前') || pStr.includes('一')) {
      partNumber = 1
    } else {
      const numChar = partMatch[1]
      const cnMap = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 }
      partNumber = parseInt(numChar, 10) || cnMap[numChar] || 1
    }
  }

  // 3. 权重换算（兼容中文数字与浮点数字）：
  const normalizeWeight = (str) => {
    if (!str) return 0
    const s = String(str).trim()
    if (s.includes('.')) {
      const parts = s.split('.')
      const major = cnToInt(parts[0]) || 0
      const minor = cnToInt(parts[1]) || 0
      return major * 1000 + minor
    }
    return cnToInt(s) * 1000
  }

  let start = normalizeWeight(rawStart)
  let end = rawEnd ? normalizeWeight(rawEnd) : start
  if (isNaN(start) || isNaN(end)) return null
  // 兼容前导零区间，如 00-10、0-10，将 0 修正为 1 (1000)
  if (start <= 0 && end > 0) {
    start = 1000
  }
  if (start <= 0 && end <= 0) return null

  // 4. 叠加分部偏移 (每个分部偏移 100,000,000 亿级偏移，绝不影响千万章以内单部大长篇的真实章节序号)
  // 如果是普通章节 (未含小数点)，按识别出的 partNumber 叠加偏移，彻底消除上部与下部交错错乱
  const PART_OFFSET = 100000000
  const partOffset = (partNumber - 1) * PART_OFFSET
  if (!String(rawStart).includes('.')) {
    start += partOffset
    end += partOffset
  }

  // 5. 纯净主书名提取 (通过 extractCleanBookName 剥离标签、分卷、括号、副标题、作者等)
  let mainName = extractCleanBookName(normTitle, fallbackAuthor)

  return { mainName, start, end, partNumber, rawStart, rawEnd: rawEnd || rawStart, rawTitle }
}

/**
 * 统一规范化论坛分卷标题，强制对齐为 【XXX-XXX】 风格，显式保留分部标记
 */
export function formatUnifiedChapterTitle(title, fallbackAuthor = '', partNumber = 1) {
  if (!title) return ''
  const t = toDBC(title).trim()

  // 1. 识别并保留分部特征 (第二部/下部等)
  let partPrefix = ''
  const partMatch = t.match(/(?:第([一二三四五六七八九十\d]+)[部|卷|季])|(上部|下部|前部|后部|续集|续篇|前传|后传|番外|续)/)
  if (partMatch) {
    const pStr = partMatch[0]
    if (pStr.includes('下') || pStr.includes('后') || pStr.includes('续') || pStr.includes('二')) {
      partPrefix = '第二部 '
    } else if (pStr.includes('上') || pStr.includes('前') || pStr.includes('一')) {
      partPrefix = ''
    } else {
      partPrefix = `${pStr} `
    }
  } else if (partNumber > 1) {
    partPrefix = `第${partNumber}部 `
  }

  const info = parseBbsChapterInfo(t, fallbackAuthor)
  const authorMatch = t.match(/[作|原][者|著][：:]\s*([^\s\[【<]+)/)
  const authorName = authorMatch ? authorMatch[1].trim() : (fallbackAuthor && fallbackAuthor !== '未知' && fallbackAuthor !== '网络作家' ? fallbackAuthor : '')
  const authorSuffix = authorName ? ` 作者: ${authorName}` : ''

  if (info) {
    const numPart = (val, pNum = 1) => {
      // 仅当显式标记为多部 (pNum > 1) 且叠加了亿级偏移时才扣除偏移，绝不修改超千章普通小说的真实章号
      const pure = (pNum > 1 && val >= 100000000) ? val - (pNum - 1) * 100000000 : val
      if (pure % 1000 === 0) return (pure / 1000).toString()
      const major = Math.floor(pure / 1000)
      const minor = pure % 1000
      return `${major}.${minor}`
    }
    const effPartNum = info.partNumber || partNumber
    const sStr = numPart(info.start, effPartNum)
    const eStr = numPart(info.end, effPartNum)
    if (sStr !== eStr) {
      return `【${partPrefix}${sStr}-${eStr}】${authorSuffix}`
    } else {
      return `【${partPrefix}第${sStr}章】${authorSuffix}`
    }
  }

  return t
}

/**
 * 论坛连载分卷区间智能去重与主链优选 (Interval Greedy Overlap Deduplication)
 * 1. 过滤完全没有分卷章节编号的幽灵主书名项
 * 2. 单项真子集剔除 (Strict Subset Elimination)：当项 B 的章节范围完全被项 A 包含且 A 的跨度更大，剔除 B
 * 3. 连续无缝合集主链识别与横跨重叠剔除 (Union Overlap Suppression)：
 *    若合集构成无缝相接的连续链（如 [10, 25] 与 [26, 39]），任何横跨并完全落在该联合体内部的散帖（如 21-30）予以剔除
 * 4. 统一对齐格式为 【XXX-XXX】
 */
export function filterOverlappingBbsChapters(chapters, bbsInfo = null) {
  if (!Array.isArray(chapters) || chapters.length <= 1) return chapters

  // 1. 检查是否存在带有具体章节数字的正式分卷
  const hasValidNumberedChapters = chapters.some(c => parseBbsChapterInfo(c.title) !== null)

  // 过滤掉完全没有章节数字的纯主书名冗余项（幽灵首项）
  const validChapters = chapters.filter(c => {
    if (hasValidNumberedChapters && !parseBbsChapterInfo(c.title)) {
      return false
    }
    return true
  })

  // 2. 补齐并提取统一 start 和 end，并标准化标题
  const fallbackAuthor = bbsInfo?.author || ''
  const items = validChapters.map(c => {
    const info = parseBbsChapterInfo(c.title)
    let start = c.start !== undefined && c.start > 0 ? c.start : (info ? info.start : 0)
    let end = c.end !== undefined && c.end > 0 ? c.end : (info ? info.end : start)
    const partNum = c.partNumber || info?.partNumber || (start >= 100000000 ? 2 : 1)
    return {
      ...c,
      title: formatUnifiedChapterTitle(c.title, fallbackAuthor, partNum),
      start,
      end,
      partNumber: partNum
    }
  })

  // 按 start 升序排序，若 start 相同则跨度大（end 靠后）的排在前面
  items.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return (b.end - b.start) - (a.end - a.start)
  })

  // 3. 第一轮：汇总帖智能裁剪与单项真子集剔除 (Directory Post Head Truncation & Subset Elimination)
  // 首先检测是否存在跨度巨大的目录汇总帖（如 1-55、1-100 跨度 >= 20000），而内部包含 >= 3 个连续/独立细分卷
  const directoryPostIndices = new Set()
  for (let j = 0; j < items.length; j++) {
    const parent = items[j]
    const parentSpan = parent.end - parent.start
    if (parentSpan >= 4000) {
      const children = items.filter((it, idx) => idx !== j && it.start >= parent.start && it.end <= parent.end)
      if (children.length >= 3) {
        // 检查子分卷的最小起始点
        const minChildStart = Math.min(...children.map(c => c.start))
        if (minChildStart > parent.start) {
          // 该汇总帖自身实际承载了子分卷未覆盖的头部章节（如 1-3、1-12 或第 1 章）
          // 将其智能裁剪为头部章节，赋予对应标题，绝不剔除！
          const rawHeadStart = Math.floor(parent.start / 1000) || 1
          const rawHeadEnd = Math.floor(minChildStart / 1000) - 1
          if (rawHeadEnd >= rawHeadStart) {
            parent.end = rawHeadEnd * 1000
            parent.title = rawHeadEnd > rawHeadStart ? `【${rawHeadStart}-${rawHeadEnd}】` : `【第${rawHeadStart}章】`
            if (fallbackAuthor) parent.title += ` 作者: ${fallbackAuthor}`
            continue // 成功裁剪为头部独立分卷，保留！
          }
        }
        // 若头部已被其他分卷完全覆盖，则确认作为冗余汇总帖容器剔除
        directoryPostIndices.add(j)
      }
    }
  }

  const nonSubset = []
  for (let i = 0; i < items.length; i++) {
    if (directoryPostIndices.has(i)) continue
    const cur = items[i]
    let isSubset = false
    for (let j = 0; j < items.length; j++) {
      if (i === j || directoryPostIndices.has(j)) continue
      const other = items[j]
      const otherSpan = other.end - other.start
      const curSpan = cur.end - cur.start
      if (other.start <= cur.start && other.end >= cur.end && otherSpan > curSpan) {
        isSubset = true
        break
      }
    }
    if (!isSubset) {
      nonSubset.push(cur)
    }
  }

  // 4. 第二轮：跨界冗余与多卷连续联合覆盖剔除 (Union Overlap Suppression)
  const finalChapters = []
  for (let i = 0; i < nonSubset.length; i++) {
    const cand = nonSubset[i]
    let isCoveredByContinuousNeighbors = false

    const prevItem = nonSubset[i - 1]
    const nextItem = nonSubset[i + 1]
    if (prevItem && nextItem) {
      const prevSpan = prevItem.end - prevItem.start
      const nextSpan = nextItem.end - nextItem.start
      // 必须前后两项都是合集分卷（跨度>0），且前后无缝相接，落入其中的次级重叠项才予以剔除
      const isPrevNextSeamless = prevSpan > 0 && nextSpan > 0 && nextItem.start <= prevItem.end + 1000
      const isCandInsideUnion = cand.start >= prevItem.start && cand.end <= nextItem.end

      if (isPrevNextSeamless && isCandInsideUnion) {
        isCoveredByContinuousNeighbors = true
      }
    }

    if (!isCoveredByContinuousNeighbors) {
      finalChapters.push(cand)
    }
  }

  // 重新按 start 升序排序
  finalChapters.sort((a, b) => a.start - b.start)

  // 5. 第三轮：绝对完全相同区间的冗余重复帖消除（如作者重发帖或补发帖）
  const uniqueSpanChapters = []
  for (const c of finalChapters) {
    if (uniqueSpanChapters.length > 0) {
      const last = uniqueSpanChapters[uniqueSpanChapters.length - 1]
      if (last.start === c.start && last.end === c.end) {
        continue
      }
    }
    uniqueSpanChapters.push(c)
  }

  return uniqueSpanChapters.map((c, idx) => ({
    ...c,
    index: idx
  }))
}

/**
 * 严格校验候选分卷帖子是否真正属于当前小说 (防止短书名如"狩猎"导致"魔女狩猎"、"狩猎人妻"等不同作者/不同小说混入)
 * @param {string} candidateTitle 候选分卷标题
 * @param {string} baseMainName 当前小说主名
 * @param {string} baseAuthor 当前小说作者
 * @param {boolean} allowPureRange 是否允许帖内纯分卷标号 (如 1-12, 13-15, 【16-25】)
 */
function isMatchingBbsChapter(candidateTitle, baseMainName, baseAuthor = '', allowPureRange = false) {
  if (!candidateTitle || !baseMainName) return false

  // 排除形如 "第104章【新婚】"、"第55章 新婚" 这种以章节号开头且未明确注明作者的非本书外帖
  if (/^第\s*[一二三四五六七八九十百千\d]+\s*[章节卷]/.test(candidateTitle)) {
    const authorMatch = candidateTitle.match(/[作|原][者|著][：:]\s*([^\s\[【<]+)/)
    if (!authorMatch) return false
  }

  const cleanBookName = (name) => {
    return (name || '').replace(/[【】\[\]（）\(\)\s《》“”"']/g, '')
      .replace(/(?:上部|下部|第一部|第二部|前传|外传|后传|全本|精校|连载|续|番外)/g, '')
      .trim()
  }

  const baseNorm = cleanBookName(baseMainName)
  const candInfo = parseBbsChapterInfo(candidateTitle)
  if (!candInfo) return false

  const candNorm = cleanBookName(candInfo.mainName)

  // 1. 若允许帖内纯分卷，且提取到的书名为空字符串，只要具有有效起始章节编号且作者未冲突，即判定匹配
  if (allowPureRange && candNorm === '' && candInfo.start > 0) {
    if (baseAuthor && baseAuthor !== '未知' && baseAuthor !== '网络作家') {
      const authorMatch = candidateTitle.match(/[作|原][者|著][：:]\s*([^\s\[【<]+)/)
      const candAuthor = authorMatch ? authorMatch[1].trim() : ''
      if (candAuthor && !candAuthor.includes(baseAuthor) && !baseAuthor.includes(candAuthor)) {
        return false
      }
    }
    return true
  }

  // 2. 书名精准核对: 规范化后必须完全一致（短书名<=4字符绝不允许包含混入）
  if (baseNorm.length <= 4) {
    if (candNorm !== baseNorm) return false
  } else {
    if (candNorm !== baseNorm && !candNorm.includes(baseNorm) && !baseNorm.includes(candNorm)) {
      return false
    }
  }

  // 3. 作者严格对齐 (如果基准作者明确已知且非未知/网络作家)
  if (baseAuthor && baseAuthor !== '未知' && baseAuthor !== '网络作家') {
    const authorMatch = candidateTitle.match(/[作|原][者|著][：:]\s*([^\s\[【<]+)/)
    const candAuthor = authorMatch ? authorMatch[1].trim() : ''
    // 若候选帖子自身明确标注了作者，且与原作者不一致：
    if (candAuthor && !candAuthor.includes(baseAuthor) && !baseAuthor.includes(candAuthor)) {
      // 论坛长篇连载中常由不同坛友接力转帖（如《超级房东》前部为风过留痕转帖，后部为俗人续发）
      // 当主书名完全一致且书名长度 >= 3（非极短同名短篇）时，绝不因发帖人/转帖人不同而误杀合法分卷！
      if (baseNorm.length <= 2 || candNorm !== baseNorm) {
        return false
      }
    }
  }

  return true
}


// ─── 核心类 ─────────────────────────────────────────
export class RuleSource {
  constructor(rule) {
    this.rule = rule
    this.rawLegadoRule = rule.rawLegadoRule || (rule.bookSourceUrl ? rule : null)
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
    let rawUrl = typeof urlOrConfig === 'string' ? urlOrConfig : (urlOrConfig.url || '')
    let method = (urlOrConfig.method || searchRule.method || 'get').toUpperCase()
    const cookies = urlOrConfig.cookies || searchRule.cookies

    // 自动补全相对 URL
    if (rawUrl && !rawUrl.startsWith('http') && !rawUrl.startsWith('@js:')) {
      rawUrl = this._absUrl(rawUrl)
    }

    let safeReferer = 'https://www.baidu.com'
    try {
      const refBase = this.baseUrl || this.rule.url || ''
      const cleanRef = refBase.replace(/[^\x00-\x7F]/g, '')
      if (cleanRef.startsWith('http')) {
        safeReferer = new URL(cleanRef).origin
      }
    } catch (_) {}

    const baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': safeReferer
    }

    const headers = sanitizeHeaders(baseHeaders)

    // 提取书源自带的自定义 Header（如移动端 UA、自定义 Cookie 等）
    const rawHeader = this.rule.rawLegadoRule?.header || this.rule.header
    if (rawHeader) {
      if (typeof rawHeader === 'object' && rawHeader !== null) {
        Object.assign(headers, sanitizeHeaders(rawHeader))
      } else if (typeof rawHeader === 'string' && rawHeader.trim().startsWith('{')) {
        try {
          const parsedH = JSON.parse(rawHeader)
          if (parsedH && typeof parsedH === 'object') Object.assign(headers, sanitizeHeaders(parsedH))
        } catch (_) {}
      }
    }

    // 请求配置特定 header 覆盖
    if (urlOrConfig && typeof urlOrConfig === 'object' && urlOrConfig.headers) {
      Object.assign(headers, sanitizeHeaders(urlOrConfig.headers))
    }

    if (cookies) {
      headers['Cookie'] = typeof cookies === 'string'
        ? cookies.replace(/[\r\n]+/g, '')
        : Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }

    // 优先尝试编码列表：规则指定优先，否则先 UTF-8 再 GBK
    const explicitEnc = (urlOrConfig.charset || this.rule.encoding || this.rule.charset || '').toLowerCase()
    const isExplicitGbk = explicitEnc === 'gbk'
    const encodings = isExplicitGbk ? ['gbk', 'utf-8'] : ['utf-8', 'gbk']

    let lastError = null

    for (const enc of encodings) {
      try {
        const isGbk = enc === 'gbk'
        let url = rawUrl
        let bodyData = null

        if (keyword) {
          const encodedKw = isGbk ? encodeGBK(keyword) : encodeURIComponent(keyword)
          url = url.replace(/\{\{key\}\}|\{\{keyword\}\}|%s|\{key\}|\{keyword\}/gi, encodedKw)
        }

        // @js: URL 计算
        if (url.startsWith('@js:')) {
          const jsCode = url.slice(4)
          url = evalJsTransform(jsCode, keyword || '')
        }

        // 再次确保 url 格式合法
        if (!url.startsWith('http')) {
          url = this._absUrl(url)
        }

        // POST 表单数据构造
        if (method === 'POST') {
          headers['Content-Type'] = 'application/x-www-form-urlencoded'
          let rawData = urlOrConfig.body || urlOrConfig.data || `searchkey=${keyword}`
          
          if (typeof rawData === 'string') {
            if (rawData.startsWith('{') && rawData.endsWith('}')) {
              try {
                // 如果 body 是 JSON 字符串
                headers['Content-Type'] = 'application/json'
                const replacedJson = rawData.replace(/\{\{key\}\}|\{\{keyword\}\}|%s|\{key\}|\{keyword\}/gi, keyword)
                bodyData = replacedJson
              } catch (_) {
                bodyData = rawData
              }
            } else if (rawData.includes('=')) {
              // 键值对形式：key=val&searchkey={{key}}
              const encodedKw = isGbk ? encodeGBK(keyword) : encodeURIComponent(keyword)
              bodyData = rawData.replace(/\{\{key\}\}|\{\{keyword\}\}|%s|\{key\}|\{keyword\}/gi, encodedKw)
            } else {
              const matches = [...rawData.matchAll(/(\w+)\s*:\s*([^,}]+)/g)]
              const formObj = {}
              for (const m of matches) {
                const k = m[1].trim()
                let v = m[2].trim().replace(/^['"]|['"]$/g, '')
                if (v === '%s' || v === '{{key}}' || v === '{{keyword}}') v = keyword
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
          } else if (typeof rawData === 'object' && rawData !== null) {
            headers['Content-Type'] = 'application/json'
            bodyData = JSON.stringify(rawData).replace(/\{\{key\}\}|\{\{keyword\}\}|%s|\{key\}|\{keyword\}/gi, keyword)
          }
        }

        const html = await fetchWithRetry(url, {
          method,
          headers,
          body: bodyData
        }, 1, 6000)

        if (html && html.length > 30) {
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
      const rawLegadoSearchUrl = this.rule.rawLegadoRule?.searchUrl || ''

      // 修复损坏的 targetUrl（如被逗号截断或缺少模板），优先参考 rawLegadoRule.searchUrl
      if (!targetUrl || targetUrl.includes('{{String(source') || !targetUrl.includes('http') || (rawLegadoSearchUrl && rawLegadoSearchUrl.length > targetUrl.length)) {
        if (rawLegadoSearchUrl) {
          targetUrl = rawLegadoSearchUrl
        }
      }

      let reqConfig = { ...s }

      // 解析 Legado 3.0 的复杂 searchUrl 格式：url,{"method":"POST","body":"...","charset":"gbk"}
      if (targetUrl.includes(',') && targetUrl.includes('{')) {
        const lastCommaIdx = targetUrl.lastIndexOf(',{')
        if (lastCommaIdx !== -1) {
          const urlPart = targetUrl.slice(0, lastCommaIdx).trim()
          const optPart = targetUrl.slice(lastCommaIdx + 1).trim()
          try {
            const parsedOpt = JSON.parse(optPart)
            targetUrl = urlPart
            if (parsedOpt.method) reqConfig.method = parsedOpt.method
            if (parsedOpt.body) reqConfig.body = parsedOpt.body
            if (parsedOpt.charset) reqConfig.charset = parsedOpt.charset
            if (parsedOpt.headers) reqConfig.headers = parsedOpt.headers
          } catch (_) {}
        }
      }

      // 智能求值 Legado 模板变量（如 source.getKey(), source.getVariable(), page 等）
      targetUrl = targetUrl.replace(/\{\{([\s\S]*?)\}\}/g, (match, expr) => {
        const trimmed = expr.trim()
        if (trimmed === 'key' || trimmed === 'keyword' || trimmed === 'searchkey') return '{{key}}'
        if (trimmed === 'page') return '1'
        if (trimmed.includes('source.') || trimmed.includes('baseUrl')) {
          try {
            const fn = new Function('source', 'baseUrl', `return (${trimmed})`)
            const res = fn({
              getKey: () => this.baseUrl,
              getVariable: () => this.baseUrl,
              bookSourceUrl: this.baseUrl
            }, this.baseUrl)
            return res != null ? String(res) : this.baseUrl
          } catch (_) {
            return this.baseUrl
          }
        }
        return match
      })

      // 自动修复 SPA Hash 路由 URL 为 API 或真实路径
      if (targetUrl.includes('/#/search')) {
        targetUrl = targetUrl.replace('/#/search', '/api/search')
      }

      // 确保 targetUrl 为合法绝对路径
      if (!targetUrl.startsWith('http') && !targetUrl.startsWith('@js:')) {
        targetUrl = this._absUrl(targetUrl)
      }

      const html = await this._request({ ...reqConfig, url: targetUrl }, keyword)
      if (!html) return []

      // 1. 优先自动检测是否为 JSON 响应（支持现代 SPA / API 书源）
      const trimmed = html.trim()
      let isJson = false
      let json = null

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          json = JSON.parse(trimmed)
          isJson = true
        } catch (_) {}
      } else {
        // 尝试检测 JSONP 包装
        const jsonpMatch = trimmed.match(/^[\w$]+\s*\(([\s\S]*)\)\s*;?$/)
        if (jsonpMatch) {
          try {
            json = JSON.parse(jsonpMatch[1].trim())
            isJson = true
          } catch (_) {}
        }
      }

      if (isJson && json) {
        try {
          let list = []
          // 优先根据 s.result 中的 JSONPath 提取
          if (s.result && s.result.trim().startsWith('$')) {
            const custom = extractJsonPath(json, s.result.trim())
            if (Array.isArray(custom)) list = custom
          }

          if (!list.length) {
            if (Array.isArray(json)) {
              list = json
            } else if (json.data && Array.isArray(json.data.list)) {
              list = json.data.list
            } else if (json.data && Array.isArray(json.data.books)) {
              list = json.data.books
            } else if (json.data && Array.isArray(json.data.items)) {
              list = json.data.items
            } else if (json.data && Array.isArray(json.data.data)) {
              list = json.data.data
            } else if (Array.isArray(json.data)) {
              list = json.data
            } else if (Array.isArray(json.list)) {
              list = json.list
            } else if (Array.isArray(json.books)) {
              list = json.books
            } else if (Array.isArray(json.results)) {
              list = json.results
            } else if (Array.isArray(json.items)) {
              list = json.items
            } else if (Array.isArray(json.dataList)) {
              list = json.dataList
            }
          }

          if (Array.isArray(list) && list.length > 0) {
            const results = []
            for (const it of list) {
              if (!it || typeof it !== 'object') continue

              let title = ''
              if (s.bookName && s.bookName.startsWith('$')) {
                title = extractJsonPath(it, s.bookName)
              }
              if (!title) {
                title = it.title || it.name || it.bookName || it.book_name || it.newBookName || ''
              }
              if (!title) continue

              let author = ''
              if (s.author && s.author.startsWith('$')) {
                author = extractJsonPath(it, s.author)
              }
              if (!author) {
                author = it.author || it.authorName || it.writer || '未知'
              }

              let itemUrl = ''
              if (s.bookUrl) {
                let rawItemUrl = s.bookUrl
                rawItemUrl = rawItemUrl.replace(/\{\{\s*\$?\??\.?(\w+)\s*\}\}/g, (_, field) => {
                  return it[field] != null ? it[field] : ''
                })
                if (rawItemUrl.startsWith('http')) {
                  itemUrl = rawItemUrl
                } else if (rawItemUrl) {
                  itemUrl = this._absUrl(rawItemUrl)
                }
              }
              if (!itemUrl) {
                const id = it.id || it.bookId || it.book_id || ''
                itemUrl = it.url || (id ? `${this.baseUrl}/book/${id}/` : '')
              }

              let latestChapter = ''
              if (s.latestChapter && s.latestChapter.startsWith('$')) {
                latestChapter = extractJsonPath(it, s.latestChapter)
              }
              if (!latestChapter) {
                latestChapter = it.lastchapter || it.latestChapter || it.last_chapter || it.lastChapter || ''
              }

              let updateTime = ''
              if (s.lastUpdateTime && s.lastUpdateTime.startsWith('$')) {
                updateTime = extractJsonPath(it, s.lastUpdateTime)
              }
              if (!updateTime) {
                updateTime = it.lastupdate || it.updateTime || it.last_update || ''
              }

              let cover = ''
              if (s.coverUrl && s.coverUrl.startsWith('$')) {
                cover = extractJsonPath(it, s.coverUrl)
              }
              if (!cover) {
                cover = it.cover || it.coverUrl || it.bookImg || null
              }

              results.push(sanitizeSearchResult({
                title: toSimplified(title),
                author: toSimplified(author),
                cover: cover,
                status: it.status || (it.full ? '完结' : '连载'),
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
        // 关键防御：如果是 JSON 响应，绝不回退至 Cheerio DOM 选择器，避免 Empty sub-selector
        return []
      }

      // 2. 常规 HTML DOM 选择器解析
      let $ = cheerio.load(html)
      $('script, style, noscript, header, nav, footer').remove()

      let resultSel = s.result || ''
      let items = []

      // 若 resultSel 为纯 JSONPath，不适用 HTML 解析
      if (resultSel.trim().startsWith('$')) {
        return []
      }

      if (resultSel.includes('@js:')) {
        const jsIdx = resultSel.indexOf('@js:')
        const cssPart = resultSel.slice(0, jsIdx)
        const jsCode = resultSel.slice(jsIdx + 4)
        const htmlFull = cssPart ? $(cssPart).html() : $.html()
        const transformed = evalJsTransform(jsCode, htmlFull || html)
        $ = cheerio.load(transformed)
        $('script, style, noscript, header, nav, footer').remove()
        items = queryElements($, 'dl, .item, .bookbox, article, tr, li', $.root())
      } else if (resultSel) {
        try {
          items = queryElements($, resultSel, $.root())
        } catch (_) {
          items = []
        }
      }

      if (!items || items.length === 0) {
        // 降级使用特征明确的通用列表项选择器（避免误抓页面普通列表）
        items = queryElements($, 'div.item, .bookbox, .book-item, .search-item, table.grid tr, dl.item', $.root())
      }

      const results = []
      for (const itemEl of items) {
        const $item = typeof itemEl.find === 'function' ? itemEl : $(itemEl)
        let titleText = ''
        try {
          titleText = resolveSelector(s.bookName, $, $item)
        } catch (_) {}
        if (!titleText) {
          titleText = $item.find('h3 a, h4 a, .title a, a').first().text().trim()
        }
        if (!titleText) continue

        // 过滤导航噪音和无意义文本
        const junkTitles = ['首页', '排行榜', '书架', '分类', '搜索', '全本', '完本', '登录', '注册', '书库', '更多', '下一页', '上一页']
        if (junkTitles.includes(titleText)) continue

        // 书籍详情页 URL
        let bookUrl = ''
        if (s.bookUrl) {
          try {
            bookUrl = this._absUrl(resolveSelector(s.bookUrl, $, $item))
          } catch (_) {}
        }
        if (!bookUrl) {
          try {
            const aTag = $item.is('a') ? $item : $item.find('a').first()
            const titleHref = aTag.attr('href')
            if (titleHref) bookUrl = this._absUrl(titleHref)
          } catch (_) {}
        }
        if (!bookUrl) continue

        let authorText = ''
        try {
          authorText = resolveSelector(s.author, $, $item)
        } catch (_) {}
        if (!authorText) authorText = '未知'

        let latestChapterText = ''
        try {
          latestChapterText = resolveSelector(s.latestChapter, $, $item)
        } catch (_) {}

        let updateTimeText = ''
        try {
          updateTimeText = resolveSelector(s.lastUpdateTime, $, $item)
        } catch (_) {}

        let statusText = ''
        try {
          statusText = resolveSelector(s.status, $, $item)
        } catch (_) {}

        let coverUrl = ''
        if (s.coverUrl) {
          try {
            coverUrl = resolveSelector(s.coverUrl, $, $item)
          } catch (_) {}
        }
        if (!coverUrl) {
          coverUrl = $item.find('img').first().attr('src') || null
        }
        if (coverUrl && !coverUrl.startsWith('http')) {
          coverUrl = this._absUrl(coverUrl)
        }

        results.push(sanitizeSearchResult({
          title: toSimplified(titleText),
          rawTitle: toSimplified(titleText),
          author: toSimplified(authorText),
          cover: coverUrl || null,
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

      const rawDetailTitle = (
        $detail('meta[property="og:novel:book_name"]').attr('content') ||
        $detail('meta[name="og:novel:book_name"]').attr('content') ||
        (book.bookName ? $detail(book.bookName.split('@')[0]).first().text().trim() : '') ||
        $detail('h1').first().text().trim()
      )
      const rawDetailAuthor = (
        $detail('meta[property="og:novel:author"]').attr('content') ||
        $detail('meta[name="og:novel:author"]').attr('content') ||
        (book.author ? $detail(book.author.split('@')[0]).first().text().trim() : '') ||
        '未知'
      )

      const cleanedMeta = cleanBookTitleAndAuthor(rawDetailTitle, rawDetailAuthor)
      const title = toSimplified(cleanedMeta.cleanTitle || rawDetailTitle.replace(/\s+/g, ''))
      const author = toSimplified(cleanedMeta.author || rawDetailAuthor)
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
      } else {
        // 支持从详情页中提取完整目录入口 (如 Legado 的 ruleBookInfo.tocUrl)
        const tocSel = this.rule.bookInfo?.tocUrl || this.rule.search?.tocUrl || this.rule.ruleBookInfo?.tocUrl
        if (tocSel) {
          const extractedToc = resolveSelector(tocSel, $detail, $detail.root())
          if (extractedToc) {
            tocUrl = this._absUrl(extractedToc)
          }
        }
      }

      let tocHtml = tocUrl === novelUrl ? detailHtml : await fetchWithRetry(tocUrl)
      const $toc = cheerio.load(tocHtml)

      // 处理目录分页（如果有 nextPage）
      const chapters = []
      const seen = new Set()

      const extractChapters = ($page) => {
        const baseUri = toc.baseUri || ''
        const itemSel = toc.item || this.rule.ruleToc?.chapterList || ''
        let elements = []
        if (itemSel) {
          try {
            elements = queryElements($page, itemSel, $page.root())
          } catch (_) {}
        }

        // 如果按规则未命中任何元素，自动触发小说通用目录启发式提取
        if (!elements || elements.length === 0) {
          elements = findHeuristicTocElements($page)
        }

        elements.forEach(el => {
          const $el = typeof el.find === 'function' ? el : $page(el)
          let text = ''
          let href = ''

          if (toc.chapterName) {
            try { text = resolveSelector(toc.chapterName, $page, $el) } catch (_) {}
          }
          if (!text) {
            text = $el.is('a') ? $el.text().trim() : ($el.find('a').first().text().trim() || $el.text().trim())
          }

          if (toc.chapterUrl) {
            try { href = resolveSelector(toc.chapterUrl, $page, $el) } catch (_) {}
          }
          if (!href) {
            href = $el.is('a') ? $el.attr('href') : $el.find('a').first().attr('href')
          }

          if (!text || !href) return
          if (href.startsWith('javascript:') || href === '#' || href.startsWith('void(')) return

          const junkTexts = ['用户前期主贴', '返回禁忌书屋首页', '我们联系', 'contact us', '点“赞”', '无内容']
          if (junkTexts.some(j => text.includes(j))) return

          const absHref = href.startsWith('http') ? href : (baseUri ? baseUri.replace('%s', '') + href : this._absUrl(href))
          let finalTitle = toSimplified(text)
          if (finalTitle === '返回主帖' || finalTitle === '返回主贴') {
            finalTitle = title || '正文'
          }
          if (!seen.has(absHref)) {
            seen.add(absHref)
            chapters.push({ title: finalTitle, url: absHref })
          }
        })
      }

      extractChapters($toc)

      // 如果当前页面依然解析不出章节，尝试在页面寻找“全部章节 / 目录”直达链接二次探测
      if (chapters.length === 0) {
        let secondaryTocUrl = ''
        $toc('a').each((_, aEl) => {
          if (secondaryTocUrl) return
          const linkText = $toc(aEl).text().trim()
          const linkHref = $toc(aEl).attr('href')
          if (!linkHref || linkHref.startsWith('javascript:') || linkHref === '#') return
          if (linkText.includes('全部章节') || linkText.includes('查看目录') || linkText.includes('完整目录') || linkText.includes('章节列表')) {
            secondaryTocUrl = this._absUrl(linkHref)
          }
        })
        if (secondaryTocUrl && secondaryTocUrl !== tocUrl && secondaryTocUrl !== novelUrl) {
          try {
            const secHtml = await fetchWithRetry(secondaryTocUrl)
            extractChapters(cheerio.load(secHtml))
          } catch (_) {}
        }
      }

      // 论坛型单帖/短篇文学容错兜底：若页面未提取到子章节列表，自动将当前详情页识别为第一章
      if (chapters.length === 0) {
        chapters.push({
          title: title || '正文',
          url: novelUrl
        })
      }

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

      // 🛡️ BBS 论坛多帖连载小说全本自动聚合 (Novel Multi-Thread Aggregation)
      const cleanMainName = extractCleanBookName(rawDetailTitle, author) || extractCleanBookName(title, author) || cleanedMeta?.cleanTitle || ''
      let bbsInfo = parseBbsChapterInfo(rawDetailTitle, author) || parseBbsChapterInfo(title, author)
      if (bbsInfo && cleanMainName && cleanMainName.length >= 2) {
        bbsInfo.mainName = cleanMainName
      }
      if (!bbsInfo && cleanMainName && cleanMainName.length >= 2) {
        // 如果是论坛书源（如 cool18 / bbs / 论坛板块等），即便单帖标题未带分卷数字，也以纯净主书名尝试聚合召回
        const isBbsSource = this.name?.includes('cool18') || this.baseUrl?.includes('bbs') || this.baseUrl?.includes('cool18') || (this.rule.comment && this.rule.comment.includes('论坛'))
        if (isBbsSource) {
          bbsInfo = {
            mainName: cleanMainName,
            start: 1000,
            end: 1000,
            rawStart: '1',
            rawEnd: '1',
            rawTitle: rawDetailTitle || title
          }
        }
      }
      if (bbsInfo && bbsInfo.mainName) {
        try {
          // 无论帖内包含多少个分卷超链接，只要匹配均全量作为真实分卷纳入
          const intraVolumeLinks = []
          for (const ch of chapters) {
            if (isMatchingBbsChapter(ch.title, bbsInfo.mainName, author, true)) {
              const cInfo = parseBbsChapterInfo(ch.title)
              intraVolumeLinks.push({
                title: ch.title,
                url: ch.url,
                start: cInfo ? cInfo.start : 0,
                end: cInfo ? cInfo.end : 0
              })
            }
          }

          let parsedList = []

          // 1. 将当前单帖自身先作为一个分卷纳入
          if (novelUrl) {
            let selfTitle = rawDetailTitle || title
            // 若正文首部前 500 字内明确带有精准细粒度分卷标记（如 【新婚】(1-3)），优先识别为当前帖真实正文范围
            try {
              const sampleText = $toc('.post-content, pre, #post-content').text().slice(0, 1000)
              const firstLineMatch = sampleText.match(/[【\[]([^】\]]+)[】\]][\s\S]{0,30}?[（\(](\d+(?:\.\d+)?)(?:[－\-~～、]+(\d+(?:\.\d+)?))?[^）\)]*[）\)]/)
              if (firstLineMatch) {
                const headInfo = parseBbsChapterInfo(firstLineMatch[0])
                if (headInfo && (headInfo.end - headInfo.start <= 10000) && headInfo.start <= 2000) {
                  selfTitle = firstLineMatch[0].trim()
                }
              }
            } catch (_) {}

            let selfInfo = parseBbsChapterInfo(selfTitle) || bbsInfo
            let selfStart = selfInfo.start || bbsInfo.start
            let selfEnd = selfInfo.end || bbsInfo.end

            // 智能识别首序章节承载 (Head Range Auto-Convergence)：
            // 若当前主帖标题涵盖大跨度（如 1-55 或 1.1-2.59），而帖内提取到的分卷超链接最小起始序号明显大于主帖开头
            if (intraVolumeLinks.length > 0) {
              const minSubStart = Math.min(...intraVolumeLinks.map(l => l.start).filter(s => s > 0))
              if (minSubStart > 1000 && selfStart < minSubStart) {
                // 计算主帖自身承载的未外链首序分卷范围（例如 1 到 12，或 1 到 3）
                const rawHeadStart = Math.floor(selfStart / 1000) || 1
                const rawHeadEnd = Math.floor(minSubStart / 1000) - 1
                if (rawHeadEnd >= rawHeadStart) {
                  selfEnd = rawHeadEnd * 1000
                  const authorSuffix = bbsInfo.author && bbsInfo.author !== '未知' && bbsInfo.author !== '网络作家' ? ` 作者: ${bbsInfo.author}` : ''
                  selfTitle = rawHeadEnd > rawHeadStart ? `【${rawHeadStart}-${rawHeadEnd}】${authorSuffix}` : `【第${rawHeadStart}章】${authorSuffix}`
                }
              }
            }

            parsedList.push({
              title: selfTitle || `【${bbsInfo.mainName}】（当前卷）`,
              url: novelUrl,
              start: selfStart,
              end: selfEnd
            })
          }

          // 2. 将帖内提取到的所有历史/后续分卷超链接无条件纳入（解除先前>=5的阈值硬编码限制）
          if (intraVolumeLinks.length > 0) {
            parsedList.push(...intraVolumeLinks)
          }

          // 无论是汇总帖还是单帖连载，均检索分帖以实现连载补齐与前文递归（深度跨页召回全部历史分帖）
          const relatedPosts = []
          try {
            let activeQuery = bbsInfo.mainName
            let firstPage = await this.search(activeQuery)

            // 通用长书名自动降级回退机制：若全名检索结果为空，且书名较长（>3字符），使用逐字连续自适应滑动探测
            if ((!firstPage || firstPage.length === 0) && bbsInfo.mainName.length > 3) {
              const fallbackCandidates = []
              // 1. 若书名包含标点或空格，提取主标题段
              const segMatch = bbsInfo.mainName.split(/[\s,，:：\-——_]/)[0]
              if (segMatch && segMatch.length >= 3 && segMatch !== bbsInfo.mainName) {
                fallbackCandidates.push(segMatch)
              }
              // 2. 自适应连续前缀探测（从 min(书名长-1, 10) 逐步递减至 3）
              const maxL = Math.min(bbsInfo.mainName.length - 1, 10)
              for (let len = maxL; len >= 3; len--) {
                const sub = bbsInfo.mainName.slice(0, len)
                if (!fallbackCandidates.includes(sub)) {
                  fallbackCandidates.push(sub)
                }
              }

              for (const fbQuery of fallbackCandidates) {
                try {
                  const fbRes = await this.search(fbQuery)
                  if (Array.isArray(fbRes) && fbRes.length > 0) {
                    firstPage = fbRes
                    activeQuery = fbQuery
                    break
                  }
                } catch (_) {}
              }
            }

            if (Array.isArray(firstPage)) {
              relatedPosts.push(...firstPage)
              if (firstPage.length >= 20 && this.rule.search?.url) {
                for (let page = 2; page <= 10; page++) {
                  try {
                    const nextUrl = this.rule.search.url
                      .replace('%s', encodeURIComponent(activeQuery))
                      .replace(/([?&]p=)\d+/, `$1${page}`)
                    const html = await fetchWithRetry(nextUrl)
                    const $p = cheerio.load(html)
                    const pageItems = []
                    $p('li.l-m1 a, td.gold_td a, .search-result a').each((_, a) => {
                      const t = $p(a).text().trim()
                      const h = $p(a).attr('href')
                      if (h && !h.startsWith('javascript:')) {
                        pageItems.push({
                          title: t,
                          url: h.startsWith('http') ? h : this._absUrl(h)
                        })
                      }
                    })
                    if (pageItems.length === 0) break
                    relatedPosts.push(...pageItems)
                    if (pageItems.length < 15) break
                  } catch (_) { break }
                }
              }
            }

            // 🛡️ 通道二（作者维度召回补偿）：若有清晰作者名，且目前召回分卷未包含第一卷或数量不足，使用作者名检索补充
            // 🛡️ 通道二（作者维度召回补偿）：若有清晰作者名，且目前召回分卷未包含第一卷或数量不足，使用作者名深度检索补充
            let cleanAuthor = (author && author !== '未知' && author !== '网络作家') ? author : ''
            if (!cleanAuthor) {
              const m = (rawDetailTitle || title).match(/[作|原][者|著][：:]\s*([^\s\[【<]+)/)
              if (m && m[1]) cleanAuthor = m[1].trim()
            }
            if (cleanAuthor && cleanAuthor.length >= 2) {
              try {
                const authorPosts = await this.search(cleanAuthor)
                const allAuthorPosts = Array.isArray(authorPosts) ? [...authorPosts] : []
                // 若首页结果丰富且书源支持翻页，继续翻至第 2~4 页以深度召回历史老帖与总目录帖
                if (allAuthorPosts.length >= 40 && this.rule.search?.url) {
                  for (let page = 2; page <= 4; page++) {
                    try {
                      const nextUrl = this.rule.search.url
                        .replace('%s', encodeURIComponent(cleanAuthor))
                        .replace(/([?&]p=)\d+/, `$1${page}`)
                      const html = await fetchWithRetry(nextUrl)
                      const $p = cheerio.load(html)
                      const pageItems = []
                      $p('li.l-m1 a, td.gold_td a, .search-result a').each((_, a) => {
                        const t = $p(a).text().trim()
                        const h = $p(a).attr('href')
                        if (h && !h.startsWith('javascript:')) {
                          pageItems.push({
                            title: t,
                            url: h.startsWith('http') ? h : this._absUrl(h)
                          })
                        }
                      })
                      if (pageItems.length === 0) break
                      allAuthorPosts.push(...pageItems)
                      if (pageItems.length < 30) break
                    } catch (_) { break }
                  }
                }

                if (allAuthorPosts.length > 0) {
                  for (const ap of allAuthorPosts) {
                    const apTitle = ap.rawTitle || ap.title
                    if (isMatchingBbsChapter(apTitle, bbsInfo.mainName, cleanAuthor)) {
                      if (!relatedPosts.some(rp => rp.url === ap.url)) {
                        relatedPosts.push(ap)
                      }
                    }
                  }
                }
              } catch (_) {}
            }
          } catch (_) {}

          if (relatedPosts.length > 0) {
            let summaryPostToExpand = null

            for (const p of relatedPosts) {
              const candTitle = p.rawTitle || p.title
              if (isMatchingBbsChapter(candTitle, bbsInfo.mainName, author)) {
                const pInfo = parseBbsChapterInfo(candTitle, author)
                if (pInfo) {
                  // 检查是否为跨度极大的历史汇总帖（浮点跨卷/跨度>=200，或普通章节跨度>=20章）
                  const isHugeSpan = pInfo.rawStart && String(pInfo.rawStart).includes('.')
                    ? (pInfo.end - pInfo.start >= 200 || Math.floor(pInfo.end / 1000) > Math.floor(pInfo.start / 1000))
                    : (pInfo.end - pInfo.start >= 20000)
                  if (isHugeSpan && !summaryPostToExpand) {
                    summaryPostToExpand = p
                  }
                  parsedList.push({
                    title: candTitle,
                    url: p.url,
                    start: pInfo.start,
                    end: pInfo.end,
                    partNumber: pInfo.partNumber
                  })
                }
              }
            }

            // 若单帖入口且搜索到了历史汇总帖，递归拉取汇总帖补全历史前文
            if (summaryPostToExpand && summaryPostToExpand.url !== novelUrl) {
              try {
                const sumHtml = await fetchWithRetry(summaryPostToExpand.url)
                const $sum = cheerio.load(sumHtml)
                const contentHtml = $sum('.post-content, pre, #post-content').html() || ''
                const part2MarkerIndex = contentHtml.search(/(?:第二部|下部|后部)/)

                $sum('.post-content a, pre a, td.tal a').each((_, a) => {
                  const origText = $sum(a).text().trim()
                  let t = toSimplified(origText)
                  const h = $sum(a).attr('href')
                  if (!h || h.startsWith('javascript:')) return
                  const absH = h.startsWith('http') ? h : this._absUrl(h)

                  // 优先关联已检索到的真实分卷帖子标题（其通常带有准确的部数与章节信息）
                  const realPost = relatedPosts.find(rp => rp.url === absH)
                  const linkIndex = contentHtml.indexOf(origText)
                  const isPart2 = part2MarkerIndex !== -1 && linkIndex !== -1 && linkIndex < part2MarkerIndex

                  if (realPost) {
                    t = realPost.rawTitle || realPost.title
                    if (isPart2 && !t.includes('第二部') && !t.includes('下部')) {
                      t = `第二部 ${t}`
                    }
                  } else if (isPart2 && !t.includes('部') && !t.includes('卷')) {
                    t = `第二部 ${t}`
                  }

                  if (isMatchingBbsChapter(t, bbsInfo.mainName, author, true)) {
                    const sInfo = parseBbsChapterInfo(t, author)
                    if (sInfo) {
                      parsedList.push({
                        title: t,
                        url: absH,
                        start: sInfo.start,
                        end: sInfo.end,
                        partNumber: sInfo.partNumber
                      })
                    }
                  }
                })

                // 汇总帖自身所承载的真实起始章节也加入
                let sumSelfTitle = summaryPostToExpand.title
                try {
                  const sampleText = $sum('.post-content, pre, #post-content').text().slice(0, 1000)
                  const firstLineMatch = sampleText.match(/[【\[]([^】\]]+)[】\]][\s\S]{0,30}?[（\(]([一二三四五六七八九十百千\d]+(?:\.\d+)?)(?:[－\-~～、至到]+([一二三四五六七八九十百千\d]+(?:\.\d+)?))?[^）\)]*[）\)]/)
                  if (firstLineMatch) {
                    const headInfo = parseBbsChapterInfo(firstLineMatch[0], author)
                    if (headInfo && (headInfo.end - headInfo.start <= 10000) && headInfo.start <= 3000) {
                      sumSelfTitle = firstLineMatch[0].trim()
                    }
                  }
                } catch (_) {}

                const sumSelfInfo = parseBbsChapterInfo(sumSelfTitle, author)
                parsedList.push({
                  title: sumSelfTitle,
                  url: summaryPostToExpand.url,
                  start: sumSelfInfo ? sumSelfInfo.start : 1000,
                  end: sumSelfInfo ? sumSelfInfo.end : 3000,
                  partNumber: sumSelfInfo ? sumSelfInfo.partNumber : 1
                })
              } catch (_) {}
            }
          }

          if (parsedList.length > 1) {
            // 严格按 start 序号正序升序排序
            parsedList.sort((a, b) => a.start - b.start)

            // 去重（按 url 保真，若同一 url 优先保留精准分卷标题）
            const aggChapters = []
            const seenMap = new Map()
            parsedList.forEach((p) => {
              if (!seenMap.has(p.url)) {
                seenMap.set(p.url, p)
              } else {
                const existing = seenMap.get(p.url)
                const existingHasRange = /[【\[（\(][^0-9【\[（\(]*?\d+/.test(existing.title)
                const pHasRange = /[【\[（\(][^0-9【\[（\(]*?\d+/.test(p.title)
                const existingHasPart = /(?:第二部|第2部|下部|后传|续)/.test(existing.title)
                const pHasPart = /(?:第二部|第2部|下部|后传|续)/.test(p.title)
                if (!existingHasPart && pHasPart) {
                  // 优先保留显式含有分部标记（如第二部）的项
                  seenMap.set(p.url, p)
                } else if ((existing.end - existing.start > 20000) && (p.end - p.start <= 20000)) {
                  // 优先保留细分卷而非大跨度汇总帖
                  seenMap.set(p.url, p)
                } else if ((existing.end - existing.start > 2000) && (p.end - p.start <= 2000)) {
                  seenMap.set(p.url, p)
                } else if (/\d+\.\d+\s*[-－~～至到]+\s*\d+\.\d+/.test(existing.title) && !/\d+\.\d+\s*[-－~～至到]+\s*\d+\.\d+/.test(p.title)) {
                  // 优先保留从帖内提炼的纯整数细分卷标题，替换掉大跨度浮点汇总标题
                  seenMap.set(p.url, p)
                } else if (!existingHasRange && pHasRange) {
                  // 若已有项标题模糊（无章节数字），而当前项带有清晰章节数字，优先替换为清晰标题
                  seenMap.set(p.url, p)
                }
              }
            })

            seenMap.forEach((p) => {
              aggChapters.push({
                title: p.title,
                url: p.url,
                start: p.start,
                end: p.end,
                index: aggChapters.length
              })
            })

            // 严格重新按 start 升序排序
            aggChapters.sort((a, b) => {
              if (a.start !== b.start) return a.start - b.start
              return (b.end - b.start) - (a.end - a.start)
            })

            // 🛡️ 首帖大跨度自愈修正 (Initial Post Span Self-Healing)
            // 若首帖标为全本/大跨度范围（如 1-55、1-100、1.1-2.59），但紧随其后的第二项为细分卷（如 4-5、10-12），
            // 说明首帖真实承载的是从第1章到第二项起始前一章的正文（作者连载后期修改了首帖标题），
            // 自动将其动态修正为衔接范围，例如 1-3，杜绝首帖正文被误杀或发生区间冲突
            if (aggChapters.length > 1) {
              const first = aggChapters[0]
              const second = aggChapters[1]
              const firstSpan = first.end - first.start
              const isFirstHuge = firstSpan >= 20000 || /\d+\.\d+\s*[-－~～至到]+\s*\d+\.\d+/.test(first.title) || (firstSpan >= 1000 && String(first.start).includes('.'))
              if (first.start <= 1001 && isFirstHuge && second.start > 1000) {
                const realEndNum = Math.floor(second.start / 1000) - 1
                if (realEndNum >= 1) {
                  first.start = 1000
                  first.end = realEndNum * 1000
                  const authorSuffix = author && author !== '未知' && author !== '网络作家' ? ` 作者: ${author}` : ''
                  first.title = realEndNum > 1 ? `【1-${realEndNum}】${authorSuffix}` : `【第1章】${authorSuffix}`
                }
              }
            }

            // 检查是否已有细粒度起始卷（跨度 <= 20000 且 start <= 1001）
            const hasFineGrainedFirstVol = aggChapters.some(c => {
              const cInfo = parseBbsChapterInfo(c.title)
              return cInfo && (cInfo.end - cInfo.start <= 20000) && cInfo.start <= 1001
            })

            // 若已有独立细粒度起始分卷，自动过滤掉跨度极大的纯合集索引帖
            let filteredChapters = aggChapters
            if (hasFineGrainedFirstVol) {
              filteredChapters = aggChapters.filter(c => {
                const cInfo = parseBbsChapterInfo(c.title)
                if (cInfo && (cInfo.end - cInfo.start >= 20000)) {
                  return false
                }
                return true
              })
            }

            // 🛡️ 智能区间覆盖与冗余重叠分卷消除 (Interval Greedy Overlap Deduplication)
            filteredChapters = filterOverlappingBbsChapters(filteredChapters, { ...bbsInfo, author })

            // 重新按 start 升序排序
            filteredChapters.sort((a, b) => a.start - b.start)

            // 重设连续 index
            aggChapters.length = 0
            filteredChapters.forEach((c, idx) => {
              c.index = idx
              aggChapters.push(c)
            })

            // 🛡️ 智能倒序守护：检测首尾章节是否有明显的倒序特征（例如首卷start大于末卷start）
            if (aggChapters.length > 1) {
              const firstStart = aggChapters[0].start
              const lastStart = aggChapters[aggChapters.length - 1].start
              if (firstStart > 0 && lastStart > 0 && firstStart > lastStart) {
                aggChapters.reverse()
                aggChapters.forEach((c, idx) => { c.index = idx })
              }
            }

            if (aggChapters.length > 1) {
              // 若首项标题为跨度极大的浮点汇总帖名称（如 1.1-28.01），且第二项为 1.14，微调首项为第一卷真实范围
              const firstCh = aggChapters[0]
              const secondCh = aggChapters[1]
              const fInfo = parseBbsChapterInfo(firstCh.title)
              const sInfo = parseBbsChapterInfo(secondCh.title)
              const isHugeFloatingSpan = fInfo?.rawStart && fInfo.rawStart.includes('.') && (fInfo.end - fInfo.start > 2000)
              if (fInfo && sInfo && isHugeFloatingSpan && sInfo.start > fInfo.start) {
                const minor = sInfo.start % 1000
                const endMinor = minor > 1 ? minor - 1 : 13
                const rawStart = fInfo.rawStart || '1.1'
                const major = Math.floor(fInfo.start / 1000)
                firstCh.title = `【${bbsInfo.mainName}】（${rawStart}-${major}.${endMinor}）`
              }

              let finalAuthor = (author && author !== '未知' && author !== '网络作家') ? author : ''
              if (!finalAuthor) {
                const authorMatch = (rawDetailTitle || title).match(/[作|原][者|著][：:]\s*([^\s\[【<]+)/)
                if (authorMatch && authorMatch[1]) {
                  finalAuthor = authorMatch[1].trim()
                } else {
                  for (const p of parsedList) {
                    const m = (p.title || '').match(/[作|原][者|著][：:]\s*([^\s\[【<]+)/)
                    if (m && m[1]) {
                      finalAuthor = m[1].trim()
                      break
                    }
                  }
                }
              }
              if (!finalAuthor) finalAuthor = '网络作家'
              return {
                title: toSimplified(bbsInfo.mainName),
                author: toSimplified(finalAuthor),
                description: description || '',
                cover: cover || null,
                chapters: aggChapters
              }
            }
          }
        } catch (aggErr) {
          console.warn(`[RuleSource:${this.name}] BBS 全本聚合异常:`, aggErr.message)
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
        // 常规合法 CSS / Jsoup 选择器解析
        const $ = cheerio.load(html)
        $('script, style, noscript').remove()

        let $content = null
        try {
          const els = queryElements($, contentRule, $.root())
          if (els && els.length > 0) {
            $content = typeof els[0].find === 'function' ? els[0] : $(els[0])
          }
        } catch (_) {}

        if ($content && $content.length) {
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
