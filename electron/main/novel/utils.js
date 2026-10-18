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
 * 净化并标准化请求头，消除多余空白与非法换行符，防止 Parse Error
 */
export function sanitizeHeaders(rawHeaders = {}) {
  const safe = {}
  if (!rawHeaders || typeof rawHeaders !== 'object') return safe
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (!k || typeof k !== 'string') continue
    const cleanKey = k.trim().replace(/[\r\n]+/g, '')
    if (!cleanKey) continue
    const cleanVal = String(v ?? '').trim().replace(/[\r\n]+/g, ' ')
    safe[cleanKey] = cleanVal
  }
  return safe
}

/**
 * 强容错 HTTP 请求核心方法
 */
async function doFetch(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let parsedUrl = new URL(url)
    const baseHeaders = {
      'User-Agent': randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': parsedUrl.origin + '/'
    }
    const headers = sanitizeHeaders({
      ...baseHeaders,
      ...options.headers
    })

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

    const baseHeaders = {
      'User-Agent': randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': parsedUrl.origin + '/'
    }
    const headers = sanitizeHeaders({
      ...baseHeaders,
      ...options.headers
    })

    const reqOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: (options.method || 'GET').toUpperCase(),
      headers,
      rejectUnauthorized: false,
      insecureHTTPParser: true,
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
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/天才一秒记住.*?(\n|$)/gi, '')
    .replace(/笔趣阁.*?最快更新/gi, '')
    .replace(/请记住本书首发域名.*?(\n|$)/gi, '')
    .replace(/如果喜欢这本书.*?(\n|$)/gi, '')
    .replace(/最新网址[：:]\s*/gi, '')
    .replace(/https?:\/\/[^\n]*(\n|$)/gi, '')
    .replace(/www\.[a-z0-9]+\.[a-z]+/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  // 全面智能断行：逐行扫描，对任何包含段落合并特征的长段落彻底断行
  const rawLines = text.split(/\n+/)
  const cleanLines = []

  for (let line of rawLines) {
    let l = line.trim()
    if (!l) continue
    // 如果该行字数较长且包含段落缩进/标点特征，执行自动断行
    if (l.length > 50) {
      // 1. 中文句末标点（。！？…”」』）后跟 2 个及以上空格或全角空格，后接中文、英文或引号
      l = l.replace(/([。！？…”」』])(\u3000+| {2,})(?=[“「『\u4e00-\u9fa5a-zA-Z0-9])/g, '$1\n')
      // 2. 句尾标点后接连续空格
      l = l.replace(/([。！？…”」』])\s{2,}/g, '$1\n')
      // 3. 连续 4 个以上空格或双全角空格作为段首缩进
      l = l.replace(/(^|[^。！？…”」』\s])\s*(\u3000{2}| {4,})(?=[“「『\u4e00-\u9fa5])/g, '$1\n')
    }
    const splitted = l.split(/\n+/).map(s => s.trim()).filter(Boolean)
    cleanLines.push(...splitted)
  }

  return cleanLines.join('\n\n')
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
 * 智能清洗提纯小说书名与真实作者，并结合章节列表生成规范完整范围标题
 * 例如:
 *   rawTitle: "【我这系统不正经】 (29.22--29.30) 作者：棺材里的笑声"
 *   rawAuthor: "未知"
 *   chapters: Array(217)
 * 输出:
 *   cleanTitle: "我这系统不正经"
 *   author: "棺材里的笑声"
 *   rangeStr: "（第1-217章）"
 *   titleWithRange: "我这系统不正经（第1-217章）"
 */
export function cleanBookTitleAndAuthor(rawTitle = '', rawAuthor = '', chapters = []) {
  // 0. 全角转半角预处理（防止全角数字、全角括号与破折号击穿正则）
  const toDbc = (str) => {
    if (!str) return ''
    return String(str)
      .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/\u3000/g, ' ')
  }

  let title = toDbc(rawTitle || '').trim()
  let author = (rawAuthor || '').trim()

  // 1. 尝试从标题中提取真实作者 (支持: 作者：xxx, 作者:xxx, 原著:xxx, 文/xxx, by xxx 等)
  const authorMatch = title.match(/(?:作\s*者|原\s*著|文\s*[:：]|by)[:：\s]+([^\s,，;；)）\]】]+)|(?:文\s*\/)\s*([^\s,，;；)）\]】]+)/i)
  if (authorMatch) {
    const extractedAuthor = (authorMatch[1] || authorMatch[2] || '').trim()
    if (extractedAuthor && (!author || author === '未知' || author === 'unknown' || author === 'None' || author === '网络作家' || author.length > 20)) {
      author = extractedAuthor
    }
  }

  // 1.1 论坛无显式前缀作者识别（例如 "新婚 东风瘦"，拆解为书名 "新婚" 与作者 "东风瘦"）
  if (!author || author === '未知' || author === '网络作家') {
    const spaceParts = title.split(/\s+/)
    if (spaceParts.length === 2) {
      const p1 = spaceParts[0].trim()
      const p2 = spaceParts[1].trim()
      if (p1.length >= 2 && p1.length <= 15 && p2.length >= 2 && p2.length <= 10) {
        if (!/^(?:第?[一二三四五六七八九十\d]+[部卷季章节]|完结|全本|上部|下部|番外|精校|连载)$/.test(p2)) {
          title = p1
          author = p2
        }
      }
    }
  }

  // 2. 从标题中剥离作者信息声明
  title = title.replace(/(?:作\s*者|原\s*著|文\s*[:：]|by)[:：\s]+[^\s,，;；)）\]】]+/gi, '').trim()
  title = title.replace(/(?:文\s*\/)\s*[^\s,，;；)）\]】]+/gi, '').trim()

  // 3. 剥离标题中旧的局部章节分卷范围（如 (29.22--29.30)、(1-30)、（第1-20章）、[1-50章]、(32-33)、(00-10) 等）
  title = title.replace(/[（\(]\s*\d+(?:\.\d+)?\s*(?:[－\-~～、—/]+|\s+至\s+|\s+到\s+)\s*\d+(?:\.\d+)?\s*(?:章|节|卷)?(?:\s*完)?\s*[）\)]/g, '')
  title = title.replace(/[\[【]\s*\d+(?:\.\d+)?\s*(?:[－\-~～、—/]+|\s+至\s+|\s+到\s+)\s*\d+(?:\.\d+)?\s*(?:章|节|卷)?(?:\s*完)?\s*[\]】]/g, '')
  title = title.replace(/[（\(]\s*(?:第\s*\d+\s*[-~至到]\s*\d+\s*[章节卷]|最新\s*\d+\s*章)\s*[）\)]/g, '')

  // 3.1 剥离无括号包围的独立单章小标题后缀（例如 "女神代行者 第194章 姐妹情深" 提炼为 "女神代行者"）
  title = title.replace(/\s+(?:第\s*)?[0-9一二三四五六七八九十百千万\d]+(?:\.\d+)?\s*[章节卷].*$/, '').trim()

  // 4. 剥离常见的标签修饰符，如 [精校]、[校对全本]、[完结]、[全本]、[连载]、[都市]、[原创] 等
  title = title.replace(/[\[【](?:精校|精校全本|全本校对|完结|全本|全集|连载|最新|热门|TXT|txt|ZIP|原创|转帖|都市|玄幻|仙侠|奇幻|科幻|武侠|历史|同人)[】\]]/gi, '')

  // 5. 剥离外层成对的修饰符号：【书名】 -> 书名，《书名》 -> 书名，[书名] -> 书名
  for (let i = 0; i < 3; i++) {
    title = title.trim()
    const prev = title
    title = title.replace(/^《\s*(.*?)\s*》$/, '$1')
    title = title.replace(/^【\s*(.*?)\s*】$/, '$1')
    title = title.replace(/^\[\s*(.*?)\s*\]$/, '$1')
    title = title.replace(/^“\s*(.*?)\s*”$/, '$1')
    title = title.replace(/^"\s*(.*?)\s*"$/, '$1')
    if (title === prev) break
  }

  // 6. 清理首尾多余标点与空格
  title = title.replace(/^[、，,。\.\-_—\s]+|[、，,。\.\-_—\s]+$/g, '').trim()
  if (!title) {
    title = (rawTitle || '未知书籍').replace(/^《|》$/g, '').trim()
  }

  // 7. 计算本次下载的完整章节范围
  let rangeStr = ''
  if (chapters && chapters.length > 0) {
    const firstCh = chapters[0]
    const lastCh = chapters[chapters.length - 1]
    let startNum = 1
    let endNum = chapters.length

    if (firstCh?.originalIndex !== undefined && lastCh?.originalIndex !== undefined) {
      startNum = firstCh.originalIndex + 1
      endNum = lastCh.originalIndex + 1
    } else if (firstCh?.index !== undefined && lastCh?.index !== undefined) {
      startNum = firstCh.index + 1
      endNum = lastCh.index + 1
    }

    if (startNum === endNum) {
      rangeStr = `（第${startNum}章）`
    } else {
      rangeStr = `（第${startNum}-${endNum}章）`
    }
  }

  const cleanTitle = title
  const finalAuthor = author || '未知'
  const titleWithRange = rangeStr ? `${cleanTitle}${rangeStr}` : cleanTitle

  return {
    cleanTitle,
    author: finalAuthor,
    rangeStr,
    titleWithRange
  }
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

  const rawTitle = rawItem.rawTitle || (rawItem.title || '').trim()
  const rawTextForBackup = rawTitle.length > author.length ? rawTitle : author

  // 0. 优先对包含作者/分卷的复合标题执行真实作者提取，同时剥离作者声明，完整保留分卷信息
  const authorMatch = title.match(/(?:作\s*者|原\s*著|文\s*[:：]|by)[:：\s]+([^\s,，;；)）\]】]+)|(?:文\s*\/)\s*([^\s,，;；)）\]】]+)/i)
  if (authorMatch) {
    const extractedAuthor = (authorMatch[1] || authorMatch[2] || '').trim()
    if (extractedAuthor && (!author || author === '未知' || author === 'None' || author === '网络作家')) {
      author = extractedAuthor
    }
    title = title.replace(/(?:作\s*者|原\s*著|文\s*[:：]|by)[:：\s]+[^\s,，;；)）\]】]+/gi, '').replace(/(?:文\s*\/)\s*[^\s,，;；)）\]】]+/gi, '').trim()
  }

  // 1. 如果 title 中包含了目录、类别等冗余长文本
  if (title.includes('目录') || title.includes('类别') || title.includes('字数') || title.includes('状态') || title.length > 50) {
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
    rawTitle,
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

