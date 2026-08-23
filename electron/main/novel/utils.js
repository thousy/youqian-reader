/**
 * 网络请求与文本处理工具函数
 * - 双层容错网络客户端 (原生 fetch + https/http 自动 fallback，完美兼容 TLS1.3 / 旧版 TLS / GBK 编码 / 自动跟随重定向)
 * - HTML 正文清洗与广告净化
 * - 简繁体转换
 */

import https from 'https'
import http from 'http'
import { URL } from 'url'
import iconv from 'iconv-lite'

// 禁用严格证书验证，保证老旧小说网站能够正常连接
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
]

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

/**
 * 强容错 HTTP 请求核心方法
 */
async function doFetch(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let parsedUrl = new URL(url)
    const headers = {
      'User-Agent': randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': parsedUrl.origin + '/',
      ...options.headers
    }

    const fetchOptions = {
      method: (options.method || 'GET').toUpperCase(),
      headers,
      signal: controller.signal,
      redirect: 'follow'
    }

    if (options.body && fetchOptions.method !== 'GET') {
      fetchOptions.body = options.body
    }

    const res = await fetch(url, fetchOptions)
    clearTimeout(timer)

    const buf = Buffer.from(await res.arrayBuffer())
    return {
      statusCode: res.status,
      buffer: buf
    }
  } catch (err) {
    clearTimeout(timer)
    try {
      return await rawHttpsRequest(url, options, timeoutMs)
    } catch (fallbackErr) {
      throw fallbackErr
    }
  }
}

/**
 * Node 原生 https 请求作为第二重 Fallback
 */
function rawHttpsRequest(targetUrl, options = {}, timeoutMs = 6000, redirectCount = 0) {
  if (redirectCount > 4) {
    return Promise.reject(new Error('重定向次数过多'))
  }

  return new Promise((resolve, reject) => {
    let parsedUrl
    try {
      parsedUrl = new URL(targetUrl)
    } catch (err) {
      return reject(new Error(`无效的 URL: ${targetUrl}`))
    }

    const isHttps = parsedUrl.protocol === 'https:'
    const client = isHttps ? https : http

    const headers = {
      'User-Agent': randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': parsedUrl.origin + '/',
      ...options.headers
    }

    const reqOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: (options.method || 'GET').toUpperCase(),
      headers,
      rejectUnauthorized: false,
      ciphers: 'DEFAULT:@SECLEVEL=0',
      minVersion: 'TLSv1',
      timeout: timeoutMs
    }

    let timer = null
    const req = client.request(reqOptions, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (timer) clearTimeout(timer)
        let nextUrl = res.headers.location
        if (!nextUrl.startsWith('http')) {
          nextUrl = new URL(nextUrl, targetUrl).toString()
        }
        return rawHttpsRequest(nextUrl, options, timeoutMs, redirectCount + 1).then(resolve).catch(reject)
      }

      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        if (timer) clearTimeout(timer)
        resolve({ statusCode: res.statusCode, buffer: Buffer.concat(chunks) })
      })
      res.on('error', err => {
        if (timer) clearTimeout(timer)
        reject(err)
      })
    })

    req.on('error', err => {
      if (timer) clearTimeout(timer)
      reject(err)
    })

    req.on('timeout', () => {
      req.destroy()
      if (timer) clearTimeout(timer)
      reject(new Error(`请求超时 (${timeoutMs}ms)`))
    })

    timer = setTimeout(() => {
      req.destroy()
      reject(new Error(`请求超时 (${timeoutMs}ms)`))
    }, timeoutMs)

    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

/**
 * 带重试与自动 GBK/UTF-8 解码的网络请求
 */
export async function fetchWithRetry(url, options = {}, retries = 2, timeoutMs = 6000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await doFetch(url, options, timeoutMs)

      if (res.statusCode >= 400 && res.statusCode !== 404) {
        throw new Error(`HTTP 状态码异常: ${res.statusCode}`)
      }

      const buf = res.buffer
      const isGBK = isLikelyGBK(buf)
      if (isGBK) {
        return iconv.decode(buf, 'gbk')
      }
      return buf.toString('utf-8')

    } catch (err) {
      if (i === retries - 1) throw err
      await sleep(300 * (i + 1))
    }
  }
}

/**
 * 判断是否为 GBK 编码
 */
function isLikelyGBK(buf) {
  const str = buf.slice(0, 3000).toString('utf-8')
  if (/charset=["']?(gbk|gb2312|gb18030)["']?/i.test(str)) return true
  if (/charset=["']?(utf-8|utf8)["']?/i.test(str)) return false
  const replacement = (str.match(/\ufffd/g) || []).length
  return replacement > 12
}

/**
 * 清洗 HTML 正文，转为纯文本段落
 */
export function cleanContent(html) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/天才一秒记住.*?手机版网址：.*?(\n|$)/g, '')
    .replace(/笔趣阁.*?最快更新/g, '')
    .replace(/请记住本书首发域名.*?(\n|$)/g, '')
    .replace(/如果喜欢这本书.*?(\n|$)/g, '')
    .replace(/www\.[a-z0-9]+\.[a-z]+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 简繁体转换
 */
export function toSimplified(str) {
  if (!str) return str
  const map = {
    '書': '书', '來': '来', '時': '时', '國': '国', '這': '这', '說': '说',
    '對': '对', '會': '会', '動': '动', '發': '发', '問': '问', '開': '开',
    '為': '为', '還': '还', '過': '过', '關': '关', '長': '长', '將': '将',
    '無': '无', '們': '们', '與': '与', '從': '从', '於': '于', '後': '后',
    '見': '见', '裡': '里', '話': '话', '電': '电', '讓': '让', '實': '实',
    '頭': '头', '雖': '虽', '兩': '两', '點': '点', '臉': '脸', '著': '着',
    '聽': '听', '邊': '边', '體': '体', '達': '达', '個': '个', '種': '种',
    '覺': '觉', '萬': '万', '氣': '气', '緊': '紧', '讀': '读', '歡': '欢',
    '識': '识', '跡': '迹', '愛': '爱', '變': '变', '題': '题', '驚': '惊'
  }
  return str.split('').map(c => map[c] || c).join('')
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 智能清洗和提纯书源搜索结果字段 (修复第三方书源选择器抓取整块 HTML/长字符串的异常)
 */
export function sanitizeSearchResult(rawItem) {
  if (!rawItem) return rawItem
  let title = (rawItem.title || '').trim()
  let author = (rawItem.author || '').trim()
  let latestChapter = (rawItem.latestChapter || '').trim()
  let lastUpdateTime = (rawItem.lastUpdateTime || '').trim()
  let status = (rawItem.status || '').trim()

  const rawTextForBackup = title.length > author.length ? title : author

  // 1. 如果 title 中包含了目录、作者、类别等冗余长文本
  if (title.includes('目录') || title.includes('作者') || title.includes('类别') || title.includes('字数') || title.includes('状态') || title.length > 40) {
    const m = title.match(/^([^\/\\|\n\r\t]+?)(?=\s*[\/\|]|\s*目录|\s*作者|\s*类别|\s*字数|\s*状态|\s*$)/)
    if (m && m[1].trim()) {
      title = m[1].trim()
    }
  }

  // 2. 如果 author 中包含了大串文本或者与 title 完全相同
  if (author === rawItem.title || author.includes('作者') || author.includes('目录') || author.includes('类别') || author.length > 25) {
    const m = rawTextForBackup.match(/(?:作者[：:\s]*|writer[：:\s]*)([\u4e00-\u9fa5a-zA-Z0-9_\-·\s]{2,20})(?=\s*类别|\s*字数|\s*状态|\s*更新|\s*最新|\s*[\/\|]|\s*$)/)
    if (m && m[1].trim()) {
      author = m[1].trim()
    } else if (author === rawItem.title && author.length > 20) {
      author = '未知'
    }
  }

  // 3. 从冗余长文本中自动挽救/补全最新章节
  if (!latestChapter || latestChapter === '—') {
    const mCh = rawTextForBackup.match(/(?:最新章节[：:\s]*|最新[：:\s]*)(.+?)(?=\s*更新|\s*[\/\|]|\s*$)/)
    if (mCh && mCh[1].trim()) {
      latestChapter = mCh[1].trim()
    }
  }

  // 3.1 净化最新章节多余前缀
  if (latestChapter) {
    latestChapter = latestChapter.replace(/^(最新章节|最新|更新到|最新更新|正文卷|VIP卷)[：:\s]*/, '').trim()
  }

  // 4. 从冗余长文本中自动挽救/补全更新时间
  if (!lastUpdateTime || lastUpdateTime === '—') {
    const mTime = rawTextForBackup.match(/(?:更新[：:\s]*|时间[：:\s]*)([\d]{2,4}[-.\/][\d]{1,2}[-.\/][\d]{1,2})/)
    if (mTime && mTime[1].trim()) {
      lastUpdateTime = mTime[1].trim()
    }
  }

  // 4.1 处理 Unix 时间戳格式（毫秒/秒级数字字符串）
  if (lastUpdateTime && /^\d{10,13}$/.test(lastUpdateTime)) {
    try {
      const num = Number(lastUpdateTime)
      const date = new Date(num > 1e11 ? num : num * 1000)
      if (!isNaN(date.getTime())) {
        lastUpdateTime = date.toISOString().slice(0, 10)
      }
    } catch (_) {}
  }

  return {
    ...rawItem,
    title,
    author: author || '未知',
    latestChapter,
    lastUpdateTime,
    status
  }
}

/**
 * 智能剔除章节正文开头与章节标题重复的文本行
 * @param {string} content 章节正文文本
 * @param {string} title 章节标题
 * @returns {string} 过滤掉重复标题后的正文文本
 */
export function stripDuplicateTitle(content, title) {
  if (!content || !title) return content || ''

  const lines = content.split('\n')
  // 查找正文前 5 行非空行
  const nonIndexList = []
  for (let i = 0; i < lines.length && nonIndexList.length < 5; i++) {
    if (lines[i].trim().length > 0) {
      nonIndexList.push(i)
    }
  }

  if (nonIndexList.length === 0) return content

  // 规范化比对基准
  const normalize = (str) => (str || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
  const normTitle = normalize(title)

  // 提取标题中的章节序号（如：第一章、第1章、第20回、Chapter 5）
  const extractNum = (str) => {
    const m = (str || '').match(/(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕]|chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万零\d]+)/i)
    return m ? normalize(m[1]) : null
  }
  const titleNum = extractNum(title)

  // 记录需要从 lines 中移除的行索引 Set
  const toRemoveIndices = new Set()

  for (const lineIdx of nonIndexList) {
    const lineText = lines[lineIdx].trim()
    const normLine = normalize(lineText)

    if (!normLine) continue

    let isDuplicate = false

    // 条件 1: 完全一致
    if (normTitle === normLine) {
      isDuplicate = true
    }
    // 条件 2: 互相包含且长度相差不大，或者正文行包含完整的标题
    else if (normTitle && (normLine.includes(normTitle) || (normTitle.includes(normLine) && normLine.length >= 4))) {
      isDuplicate = true
    }
    // 条件 3: 正文行提取出的章节序号与标题提取出的章节序号一致，且该正文行较短（< 60字，显然是标题行）
    else if (titleNum && lineText.length < 60) {
      const lineNum = extractNum(lineText)
      if (lineNum && lineNum === titleNum) {
        isDuplicate = true
      }
    }

    if (isDuplicate) {
      toRemoveIndices.add(lineIdx)
    }
  }

  if (toRemoveIndices.size > 0) {
    const newLines = lines.filter((_, idx) => !toRemoveIndices.has(idx))
    return newLines.join('\n').trim()
  }

  return content
}

