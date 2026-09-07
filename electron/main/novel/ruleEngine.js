/**
 * 通用书源规则引擎
 * 兼容 so-novel JSON 格式的书源规则
 * 支持：CSS Selector、XPath（基础）、@js: 简单转换、filterTxt、filterTag、分页
 */

import * as cheerio from 'cheerio'
import iconv from 'iconv-lite'
import crypto from 'crypto'
import { fetchWithRetry, cleanContent, toSimplified, sanitizeSearchResult, sanitizeHeaders } from './utils.js'

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

          const absHref = href.startsWith('http') ? href : (baseUri ? baseUri.replace('%s', '') + href : this._absUrl(href))
          if (!seen.has(absHref)) {
            seen.add(absHref)
            chapters.push({ title: toSimplified(text), url: absHref })
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
