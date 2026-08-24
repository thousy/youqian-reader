import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import * as electron from 'electron'
import * as cheerio from 'cheerio'
import iconv from 'iconv-lite'
import { getPortableDataDir } from '../portablePath.js'
import { fetchWithRetry, stripDuplicateTitle } from './utils.js'
import { biqugeSource } from './sources/biquge.js'
import { dingdianSource } from './sources/dingdian.js'
import { qimaoSource } from './sources/qimao.js'
import { fastSearchSource } from './sources/fastSearch.js'
import { superSource } from './sources/superSource.js'
import { createSourcesFromRules, RuleSource, requestSpaApi } from './ruleEngine.js'

import defaultRules from './rules/rulesData.js'

const app = electron.app || electron.default?.app

// 软件原始没有默认/内置书源，完全由用户导入或新建
const HARDCODED_SOURCES = []
let RULE_SOURCES = []
let CUSTOM_SOURCES = []
let disabledSourceIds = new Set()

// 用户自定义书源目录 (软件本体/data/custom_rules)
function getCustomRulesDir() {
  const dir = join(getPortableDataDir(), 'custom_rules')
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }) } catch (_) {}
  }
  return dir
}

export function loadCustomSources() {
  CUSTOM_SOURCES = []
  const dir = getCustomRulesDir()
  if (!existsSync(dir)) return CUSTOM_SOURCES
  try {
    const files = readdirSync(dir)
    for (const file of files) {
      const fullPath = join(dir, file)
      if (file.startsWith('custom_github_')) {
        try { unlinkSync(fullPath) } catch (_) {}
        continue
      }
      if (file.endsWith('.json') || file.endsWith('.json5')) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          const parsed = JSON.parse(content)
          const rules = Array.isArray(parsed) ? parsed : [parsed]
          const created = createSourcesFromRules(rules).map(s => {
            s._customFileName = file
            return s
          })
          CUSTOM_SOURCES.push(...created)
        } catch (e) {
          console.warn(`[SourceManager] 解析自定义书源失败 ${file}:`, e.message)
        }
      }
    }
  } catch (e) {
    console.warn('[SourceManager] 读取自定义书源目录失败:', e.message)
  }
  return CUSTOM_SOURCES
}

// 初始加载自定义书源
loadCustomSources()

function getAllSources() {
  const map = new Map()

  // 1. 先加入原生核心源与预置规则源
  for (const src of [...HARDCODED_SOURCES, ...RULE_SOURCES]) {
    const key = src.id || (src.name || '').trim().toLowerCase()
    if (key) map.set(key, src)
  }

  // 2. 自定义/导入书源：以独立 id 全量保存，防止带 Emoji 或特殊字符的书源被错误覆盖
  for (const src of CUSTOM_SOURCES) {
    const key = src.id || (src.name || '').trim().toLowerCase()
    if (key) map.set(key, src)
  }

  return Array.from(map.values())
}

export function getEnabledSources() {
  return getAllSources().filter(s => s.enabled && !disabledSourceIds.has(s.id))
}

export function getSourceById(id) {
  if (!id) return null
  const all = getAllSources()
  return all.find(s => s.id === id) ||
    all.find(s => s.name === id) ||
    all.find(s => s.name && id.includes(s.name)) ||
    all.find(s => s.baseUrl && (id.includes(s.baseUrl) || s.baseUrl.includes(id))) ||
    all.find(s => s.rule?.url && (id.includes(s.rule.url) || s.rule.url.includes(id))) ||
    null
}

let activeSearchToken = 0

/**
 * 取消当前搜索
 */
export function cancelSearch() {
  activeSearchToken++
}

/**
 * 专门用于【连通性诊断与一键测试】的独立书源测试方法（绝对不受 activeSearchToken 打断与覆盖）
 */
// 常见反爬/风险拦截/赌博广告/木马恶意重定向特征识别库
const RISK_KEYWORDS = [
  'just a moment', 'cloudflare', 'ray id', 'challenge-platform', 'cf-browser-verification',
  '403 forbidden', '404 not found', '502 bad gateway', '503 service', 'access denied',
  '安全拦截', '反欺诈', '风险提示', '阻断访问', '违规内容', '反诈中心', '涉诈网站', '拦截提示',
  '域名正在出售', 'domain is for sale', 'buy this domain', 'parked domain', '出售域名', '买卖域名',
  '澳门威尼斯人', '开云体育', '太阳城', '博彩', '百家乐', '新葡京', '六合彩', '时时彩', '快三', '大发', '真人视讯', '皇冠现金', '棋牌', '永利高',
  'eval(function(p,a,c,k,e,r', 'unescape(\'%u', 'document.write(unescape'
]

function isRiskOrBlocked(text) {
  if (!text) return false
  const lower = String(text).toLowerCase()
  return RISK_KEYWORDS.some(kw => lower.includes(kw))
}

/**
 * 严格检测是否为真实、健康、无木马挂马的小说站点
 */
function isHealthyNovelHtml(html) {
  if (!html || typeof html !== 'string') return false
  const lower = html.toLowerCase()

  // 1. 命中任何已知的风险、博彩、反爬或挂马特征
  if (isRiskOrBlocked(html)) return false

  // 2. 检查是否有恶意的 meta 刷新跳转或 window.location 重定向 (Trojan/HTML.Redirector)
  if (lower.includes('http-equiv="refresh"') || lower.includes("http-equiv='refresh'")) {
    return false
  }
  if (lower.includes('window.location') || lower.includes('location.href') || lower.includes('location.replace') || lower.includes('top.location')) {
    // 很多挂马/重定向木马站整页基本就只有一段 JS 跳转
    if (html.length < 1500) return false
  }

  // 3. 必须具备正向小说站元数据特征（绝不能是假冒空壳/挂马壳）
  const NOVEL_KEYWORDS = ['小说', '章节', '书架', '书库', '阅读', '全本', '最新章节', '作者', '排行', '书名', '目录', 'txt下载', '笔趣阁']
  const hasNovelFeature = NOVEL_KEYWORDS.some(kw => html.includes(kw))
  if (!hasNovelFeature) return false

  return true
}

/**
 * 专门用于【连通性诊断与多维度校验】的独立书源测试方法（对齐阅读 3.0 校验规范）
 * @param {string} sourceId 书源ID
 * @param {string|object} optionsOrKeyword 关键词或配置对象 { keyword, timeoutSeconds, checkItems: { search, explore, detail, toc, content } }
 */
export async function testSingleSource(sourceId, optionsOrKeyword = '我的') {
  const source = getSourceById(sourceId)
  if (!source) return { success: false, error: '未找到该书源' }

  const options = typeof optionsOrKeyword === 'object' && optionsOrKeyword !== null
    ? optionsOrKeyword
    : { keyword: typeof optionsOrKeyword === 'string' ? optionsOrKeyword : '我的' }

  const timeoutSeconds = Math.max(3, Math.min(300, Number(options.timeoutSeconds) || 60))
  const checkItems = options.checkItems || { search: true, explore: false, detail: true, toc: true, content: true }

  // 1. 智能提取搜书关键词：优先使用书源自带的 checkKeyWord，否则使用广谱轮询词
  const configuredCheckWord = source.rule?.search?.checkKeyWord ||
                              source.rule?.rawLegadoRule?.ruleSearch?.checkKeyWord ||
                              source.rule?.checkKeyWord ||
                              (options.keyword && options.keyword !== '修仙' && options.keyword !== '我的' ? options.keyword : null)

  const candidateKeywords = configuredCheckWord
    ? [configuredCheckWord]
    : [options.keyword || '我的', '我的', '系统', '我', '修仙']

  const resultDetails = {
    sourceId: source.id,
    sourceName: source.name,
    passedStages: [],
    failedStage: null,
    searchCount: 0,
    exploreCount: 0,
    chapterCount: 0,
    contentLength: 0,
    durationMs: 0
  }

  const startTime = Date.now()
  const stageTimeoutSec = Math.min(10, Math.max(3, Math.round(timeoutSeconds / 4)))

  // 包装超时执行函数（阶段快探超时 + 总超时保护）
  const runWithTimeout = (promise, sec, stageName) => {
    const actualSec = Math.min(sec, Math.max(3, Math.round(timeoutSeconds - (Date.now() - startTime) / 1000)))
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${stageName}阶段请求超时 (${actualSec}秒)`)), Math.max(1000, actualSec * 1000)))
    ])
  }

  try {
    let validBooks = []
    let firstBook = null

    // 1. 【搜索】校验
    if (checkItems.search !== false) {
      let searchRes = null
      let networkDead = false

      for (const kw of candidateKeywords) {
        if (!kw) continue
        try {
          const res = await runWithTimeout(source.search(kw), stageTimeoutSec, '搜索')
          if (Array.isArray(res) && res.length > 0) {
            const filtered = res.filter(b => {
              const title = (b.title || '').trim()
              const author = (b.author || '').trim()
              const url = (b.url || '').trim()
              if (!title || !url) return false
              if (isRiskOrBlocked(title) || isRiskOrBlocked(author) || isRiskOrBlocked(url)) return false
              return true
            })
            if (filtered.length > 0) {
              searchRes = filtered
              break
            }
          }
        } catch (err) {
          const errMsg = (err.message || '').toLowerCase()
          // 🚀 网络级硬性失败（DNS解析失败/连接拒绝/超时）直接快速熔断，不再浪费时间轮询其他词！
          if (errMsg.includes('enotfound') || errMsg.includes('econnrefused') || errMsg.includes('timeout') || errMsg.includes('超时') || errMsg.includes('fetch failed')) {
            networkDead = true
            break
          }
        }
      }

      if (searchRes && searchRes.length > 0) {
        validBooks = searchRes
        resultDetails.searchCount = validBooks.length
        resultDetails.passedStages.push('search')
        firstBook = validBooks[0]
      } else if (!networkDead) {
        // 🛡️ 双通道连通性严格判定：未搜到书时，必须通过【健康小说站点特征认证】且绝无木马恶意跳转！
        let isAlive = false
        let pingErr = null
        try {
          const testPingUrl = source.baseUrl || source.rule?.url || ''
          if (testPingUrl && testPingUrl.startsWith('http')) {
            const pingHtml = await runWithTimeout(source._request(testPingUrl), 4, '连通性')
            if (isHealthyNovelHtml(pingHtml)) {
              isAlive = true
            }
          }
        } catch (err) {
          pingErr = err
        }

        if (isAlive) {
          resultDetails.passedStages.push('search')
          resultDetails.isConnectedAlive = true
          resultDetails.statusMessage = '站点在线且响应正常（站内暂无该关键词藏书）'
        } else {
          return { success: false, failedStage: 'search', error: pingErr ? `站点无法连接: ${pingErr.message}` : '未搜到图书且目标站点无法连通或涉嫌恶意挂马劫持' }
        }
      } else {
        return { success: false, failedStage: 'search', error: '站点网络无法连接或请求超时' }
      }
    }

    // 2. 【发现】校验
    if (checkItems.explore) {
      const exploreUrl = source.rule?.exploreUrl || source.rule?.rawLegadoRule?.exploreUrl || source.rule?.explore?.url
      if (exploreUrl) {
        try {
          let targetExplore = String(exploreUrl).split('\n')[0].split('&&')[0].trim()
          if (targetExplore.includes('::')) targetExplore = targetExplore.split('::')[1].trim()
          if (targetExplore.includes(',')) targetExplore = targetExplore.split(',')[0].trim()
          if (!targetExplore.startsWith('http') && source.baseUrl) {
            targetExplore = `${source.baseUrl.replace(/\/+$/, '')}/${targetExplore.replace(/^\/+/, '')}`
          }
          if (targetExplore.startsWith('http')) {
            const expHtml = await runWithTimeout(source._request(targetExplore), timeoutSeconds, '发现')
            if (!expHtml || expHtml.length < 50 || isRiskOrBlocked(expHtml)) {
              return { success: false, failedStage: 'explore', error: '发现页响应无效或被拦截' }
            }
            resultDetails.passedStages.push('explore')
          } else {
            resultDetails.passedStages.push('explore')
          }
        } catch (expErr) {
          return { success: false, failedStage: 'explore', error: `发现页测试失败: ${expErr.message}` }
        }
      } else {
        resultDetails.passedStages.push('explore')
      }
    }

    // 3. 【详情】校验
    if (!firstBook && (checkItems.detail || checkItems.toc || checkItems.content)) {
      const sampleUrl = source.rule?.sampleNovelUrl || source.baseUrl
      if (sampleUrl && sampleUrl.startsWith('http')) {
        firstBook = { title: '测试图书', url: sampleUrl }
      }
    }

    if (checkItems.detail) {
      if (firstBook && firstBook.url) {
        try {
          const detailHtml = await runWithTimeout(source._request(firstBook.url), timeoutSeconds, '详情')
          if (!detailHtml || detailHtml.length < 30 || isRiskOrBlocked(detailHtml)) {
            if (!resultDetails.isConnectedAlive) {
              return { success: false, failedStage: 'detail', error: '书籍详情页被拦截或无法访问' }
            }
          } else {
            resultDetails.passedStages.push('detail')
          }
        } catch (detErr) {
          if (!resultDetails.isConnectedAlive) {
            return { success: false, failedStage: 'detail', error: `书籍详情页请求失败: ${detErr.message}` }
          }
        }
      } else if (resultDetails.isConnectedAlive) {
        resultDetails.passedStages.push('detail')
      } else {
        return { success: false, failedStage: 'detail', error: '无有效书籍可供详情测试' }
      }
    }

    // 4. 【目录】校验（带多书籍容错，避免单本书偶然下架误杀全源）
    let tocResult = null
    if (checkItems.toc) {
      if (validBooks.length > 0 || (firstBook && firstBook.url)) {
        const candidateBooks = validBooks.length > 0 ? validBooks.slice(0, 3) : [firstBook]
        let lastTocErr = null

        for (const book of candidateBooks) {
          try {
            const res = await runWithTimeout(source.getChapters(book.url), timeoutSeconds, '目录')
            if (res && Array.isArray(res.chapters) && res.chapters.length > 0) {
              const firstCh = res.chapters[0]
              if (firstCh && firstCh.title && !isRiskOrBlocked(firstCh.title)) {
                tocResult = res
                firstBook = book
                break
              }
            }
          } catch (err) {
            lastTocErr = err
          }
        }

        if (tocResult && Array.isArray(tocResult.chapters) && tocResult.chapters.length > 0) {
          resultDetails.chapterCount = tocResult.chapters.length
          resultDetails.passedStages.push('toc')
        } else if (!resultDetails.isConnectedAlive) {
          return { success: false, failedStage: 'toc', error: lastTocErr ? `目录解析失败: ${lastTocErr.message}` : '提取到的目录章节列表为空' }
        } else {
          resultDetails.passedStages.push('toc')
        }
      } else if (resultDetails.isConnectedAlive) {
        resultDetails.passedStages.push('toc')
      } else {
        return { success: false, failedStage: 'toc', error: '无有效书籍可供目录测试' }
      }
    }

    // 5. 【正文】校验（带多章节容错）
    if (checkItems.content) {
      let testChapters = []
      if (tocResult && Array.isArray(tocResult.chapters) && tocResult.chapters.length > 0) {
        testChapters = tocResult.chapters.slice(0, 3)
      } else if (firstBook && firstBook.url) {
        try {
          const tempToc = await runWithTimeout(source.getChapters(firstBook.url), timeoutSeconds, '获取章节')
          if (tempToc && Array.isArray(tempToc.chapters) && tempToc.chapters.length > 0) {
            testChapters = tempToc.chapters.slice(0, 3)
          }
        } catch (_) {}
      }

      if (testChapters.length > 0) {
        let contentSuccess = false
        let lastContentErr = null

        for (const ch of testChapters) {
          if (!ch.url) continue
          try {
            const content = await runWithTimeout(source.getContent(ch.url), timeoutSeconds, '正文')
            if (content && content.length > 20 && !isRiskOrBlocked(content) && !content.includes('【获取') && !content.includes('【正文内容为空')) {
              resultDetails.contentLength = content.length
              resultDetails.passedStages.push('content')
              contentSuccess = true
              break
            }
          } catch (err) {
            lastContentErr = err
          }
        }

        if (contentSuccess) {
          resultDetails.passedStages.push('content')
        } else if (!resultDetails.isConnectedAlive) {
          return { success: false, failedStage: 'content', error: lastContentErr ? `正文抓取失败: ${lastContentErr.message}` : '正文内容为空、字数过短或被反爬拦截' }
        } else {
          resultDetails.passedStages.push('content')
        }
      } else if (resultDetails.isConnectedAlive) {
        resultDetails.passedStages.push('content')
      } else {
        return { success: false, failedStage: 'content', error: '无法获取有效章节链接以测试正文' }
      }
    }

    resultDetails.durationMs = Date.now() - startTime
    return {
      success: true,
      results: validBooks,
      ...resultDetails
    }
  } catch (err) {
    const msg = err.message || ''
    const failedStage = err.failedStage || 'unknown'
    if (isRiskOrBlocked(msg)) {
      return { success: false, failedStage, error: `被反爬/安全拦截: ${msg}` }
    }
    return { success: false, failedStage, error: `测试失败: ${msg}` }
  }
}

/**
 * 聚合多源并发搜索
 */
export async function searchNovels(keyword, sourceId = null, onPartialResult = null) {
  const isDirectSingleSearch = typeof sourceId === 'string' && sourceId.trim().length > 0
  let currentToken = 0

  if (!isDirectSingleSearch) {
    activeSearchToken++
    currentToken = activeSearchToken
  }

  const isCustomList = Array.isArray(sourceId) && sourceId.length > 0
  const sources = isCustomList
    ? getAllSources().filter(s => sourceId.includes(s.id) && s.enabled !== false && !deletedSourceIds.has(s.id))
    : (isDirectSingleSearch
        ? getAllSources().filter(s => s.id === sourceId)
        : getEnabledSources())

  if (sources.length === 0) return []

  const merged = []
  const seen = new Set()

  await Promise.allSettled(
    sources.map(async src => {
      if (!isDirectSingleSearch && activeSearchToken !== currentToken) return
      try {
        const res = await src.search(keyword)
        if (isDirectSingleSearch || activeSearchToken === currentToken) {
          if (Array.isArray(res) && res.length > 0) {
            const fresh = []
            for (const book of res) {
              const key = `${book.source}_${book.url || book.title}`
              if (!seen.has(key)) {
                seen.add(key)
                fresh.push(book)
              }
            }
            if (fresh.length > 0) {
              merged.push(...fresh)
              if (onPartialResult) onPartialResult(fresh)
            }
          }
        }
      } catch (err) {
        console.warn(`[书源 ${src.name}] 搜索超时或失败:`, err.message)
      }
    })
  )

  return merged
}

/**
 * 获取小说章节目录
 */
export async function getNovelChapters(novelUrl, sourceId) {
  const source = getSourceById(sourceId)
  if (!source) throw new Error(`未找到书源: ${sourceId}`)
  return source.getChapters(novelUrl)
}

/**
 * 抓取单章正文
 */
export async function getChapterContent(chapterUrl, sourceId, chapterTitle = null) {
  const source = getSourceById(sourceId)
  if (!source) throw new Error(`未找到书源: ${sourceId}`)
  let content = await source.getContent(chapterUrl)
  if (content && chapterTitle) {
    content = stripDuplicateTitle(content, chapterTitle)
  }
  return content
}

export function getAllSourcesInfo() {
  let list = getAllSources().filter(s => !deletedSourceIds.has(s.id))
  return list.map(s => ({
    id: s.id,
    name: s.name || s.id || '未命名书源',
    enabled: s.enabled !== false && !disabledSourceIds.has(s.id)
  }))
}

/**
 * 获取所有书源的完整详细配置与规则
 */
let deletedSourceIds = new Set()

/**
 * 获取全量有效的书源详情列表（已被删除/清空的书源彻底在列表中擦除，不予展示）
 */
export function getAllSourcesDetail() {
  const customIdSet = new Set(CUSTOM_SOURCES.map(c => c.id))
  const hardcodedIdSet = new Set(HARDCODED_SOURCES.map(h => h.id))

  let list = getAllSources().filter(s => !deletedSourceIds.has(s.id))
  return list.map(s => {
    const isCustom = customIdSet.has(s.id)
    const isHardcoded = hardcodedIdSet.has(s.id)
    return {
      id: s.id,
      name: s.name,
      baseUrl: s.baseUrl || s.rule?.url || '',
      enabled: s.enabled !== false,
      type: isHardcoded ? 'builtin' : (isCustom ? 'custom' : 'rule'),
      rule: s.rule || {
        name: s.name,
        url: s.baseUrl,
        search: { url: s.baseUrl }
      },
      rawLegadoRule: s.rawLegadoRule || s.rule?.rawLegadoRule || null,
      isCustom,
      isBuiltin: isHardcoded
    }
  })
}

/**
 * 切换书源启用状态
 */
export function toggleSourceEnabled(id, enabled) {
  const target = getSourceById(id)
  if (target) target.enabled = enabled
  return true
}

/**
 * 保存或修改书源
 */
export function saveOrUpdateSource(ruleObj) {
  try {
    if (!ruleObj.name || !ruleObj.url) {
      return { success: false, error: '书源名称和主站网址不能为空' }
    }
    const dir = getCustomRulesDir()
    const safeId = ruleObj.id || ruleObj.url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_')
    const fileName = `custom_rule_${safeId}.json`
    writeFileSync(join(dir, fileName), JSON.stringify(ruleObj, null, 2), 'utf-8')
    loadCustomSources()
    return { success: true, id: safeId }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * 删除书源（支持单个 ID 或批量 ID 数组，彻底在列表中剔除擦除，物理删除磁盘规则文件）
 */
export function deleteSource(idOrIds) {
  try {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds]
    const dir = getCustomRulesDir()
    let hasCustomDeleted = false

    for (const id of ids) {
      if (!id) continue

      // 1. 记入已删除集合（彻底在列表及搜索中擦除）
      deletedSourceIds.add(id)

      // 2. 找到 CUSTOM_SOURCES 中的对应书源并删除物理文件
      const customSrc = CUSTOM_SOURCES.find(s => s.id === id || s.name === id)
      if (customSrc && customSrc._customFileName) {
        const p = join(dir, customSrc._customFileName)
        if (existsSync(p)) {
          try {
            unlinkSync(p)
            hasCustomDeleted = true
          } catch (_) {}
        }
      }

      // 3. 兜底删除 custom_rule_${id}.json
      const directPath = join(dir, `custom_rule_${id}.json`)
      if (existsSync(directPath)) {
        try {
          unlinkSync(directPath)
          hasCustomDeleted = true
        } catch (_) {}
      }
    }

    // 4. 彻底刷新内存中的书源
    loadCustomSources()
    CUSTOM_SOURCES = CUSTOM_SOURCES.filter(s => !deletedSourceIds.has(s.id))
    RULE_SOURCES = RULE_SOURCES.filter(s => !deletedSourceIds.has(s.id))

    return { success: true, count: ids.length }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * 清空所有书源（彻底删空归零，返回 0 个书源）
 */
export function clearAllSources() {
  try {
    // 1. 删除所有自定义书源文件
    const dir = getCustomRulesDir()
    if (existsSync(dir)) {
      const files = readdirSync(dir)
      for (const f of files) {
        if (f.endsWith('.json') || f.endsWith('.json5')) {
          try { unlinkSync(join(dir, f)) } catch (_) {}
        }
      }
    }
    loadCustomSources()

    // 2. 将所有内置与硬编码书源彻底放进 deletedSourceIds，真正实现 0 书源列表
    const all = getAllSources()
    for (const src of all) {
      deletedSourceIds.add(src.id)
    }
    CUSTOM_SOURCES = []
    RULE_SOURCES = []

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * 重置/清空所有书源
 */
export function resetDefaultSources() {
  return clearAllSources()
}

/**
 * 转换有钱阅读器内部书源/规则为标准的【开源阅读 3.0 (Legado)】格式 JSON
 */
export function convertToLegado3Format(sourceDetail) {
  if (!sourceDetail) return null

  // 1. 核心无损还原：若原本就是从阅读 3.0 导入的原生书源，进行 100% 规则无损输出！
  const rawLegado = sourceDetail.rawLegadoRule || sourceDetail.rule?.rawLegadoRule
  if (rawLegado && typeof rawLegado === 'object' && (rawLegado.bookSourceUrl || rawLegado.ruleSearch || rawLegado.ruleToc)) {
    const cloned = JSON.parse(JSON.stringify(rawLegado))
    cloned.enabled = sourceDetail.enabled !== false
    cloned.lastUpdateTime = Date.now()
    if (sourceDetail.name && sourceDetail.name !== cloned.bookSourceName) {
      cloned.bookSourceName = sourceDetail.name
    }
    return cloned
  }

  const rule = sourceDetail.rule || sourceDetail
  const name = sourceDetail.name || rule.name || '未命名书源'
  const baseUrl = (sourceDetail.baseUrl || rule.url || '').replace(/\/+$/, '')

  // 1. 构建 searchUrl (处理 Legado 3.0 {{key}} 占位符与 POST 语法)
  let rawSearchUrl = rule.search?.url || (baseUrl ? `${baseUrl}/search?key=%s` : '')
  rawSearchUrl = rawSearchUrl.replace(/%s/g, '{{key}}')

  let searchUrl = rawSearchUrl
  const method = (rule.search?.method || 'GET').toUpperCase()

  const encoding = (rule.encoding || rule.search?.encoding || '').toLowerCase()
  const isGbk = encoding === 'gbk' || encoding === 'gb2312'

  if (method === 'POST') {
    let postBody = rule.search?.data || ''
    if (typeof postBody === 'object') {
      postBody = JSON.stringify(postBody)
    }
    postBody = postBody.replace(/%s/g, '{{key}}')

    if (postBody.trim().startsWith('{') && postBody.trim().endsWith('}')) {
      const inner = postBody.trim().slice(1, -1)
      const parts = inner.split(',').map(part => {
        const kv = part.split(':')
        if (kv.length >= 2) {
          const k = kv[0].trim().replace(/^['"]|['"]$/g, '')
          const v = kv.slice(1).join(':').trim().replace(/^['"]|['"]$/g, '')
          return `${k}=${v}`
        }
        return part.trim()
      })
      postBody = parts.join('&')
    }

    const option = { method: "POST" }
    if (postBody) option.body = postBody
    if (isGbk) option.charset = "gbk"
    if (rule.search?.cookies) {
      option.headers = { Cookie: rule.search.cookies }
    }
    searchUrl = `${rawSearchUrl},${JSON.stringify(option)}`
  } else {
    if (isGbk) {
      searchUrl = `${rawSearchUrl},${JSON.stringify({ charset: "gbk" })}`
    }
  }

  // 针对 SPA 单页 / 加密 API 站（如笔趣阁 902 等）修正 searchUrl
  const isSpaApiSource = rawSearchUrl.includes('/api/search') || rawSearchUrl.includes('#/search') || (baseUrl && (baseUrl.includes('bqg902') || baseUrl.includes('bqg78') || baseUrl.includes('apibi')))
  if (isSpaApiSource && searchUrl.includes('#/search')) {
    searchUrl = `${baseUrl}/api/search?q={{key}}`
  }

  const setRuleSuffix = (selector, suffix) => {
    if (!selector) return ''
    const trimmed = selector.trim()
    if (!trimmed) return ''
    // 支持逗号分隔的多个选择器分别附加/替换后缀
    if (trimmed.includes(',')) {
      return trimmed.split(',').map(s => setRuleSuffix(s.trim(), suffix)).filter(Boolean).join(', ')
    }
    // 如果选择器本身已带有 @xxx（如 @text），必须将其替换为目标属性 @suffix（如 @href）
    if (trimmed.includes('@')) {
      return trimmed.replace(/@[a-zA-Z0-9_-]+$/, `@${suffix}`)
    }
    return `${trimmed}@${suffix}`
  }

  let ruleSearch = {}
  let ruleToc = {}
  let ruleContent = {}
  let ruleBookInfo = {}

  if (isSpaApiSource) {
    // 针对 SPA / JSON API 站自动生成阅读 3.0 高级 @js: 动态解密规则（双引擎兼容：内置 CryptoJS + Java 原生扩展）
    ruleSearch = {
      bookList: '$.data[*]',
      name: '$.title',
      author: '$.author',
      intro: '$.intro',
      bookUrl: `${baseUrl}/book/{{$.id}}/`
    }

    const tocJs = `@js:
(() => {
  try {
    let urlStr = String(baseUrl || result || "");
    let m = urlStr.match(/book\\/(\\d+)/);
    if (!m) return [];
    let bookId = m[1];

    function getEncToken(obj) {
      let salt = "book@token.html";
      let jsonStr = JSON.stringify(obj);
      if (typeof CryptoJS !== 'undefined' && CryptoJS.AES && CryptoJS.MD5) {
        let code = CryptoJS.MD5(salt).toString();
        let iv = CryptoJS.enc.Utf8.parse(code.substring(0, 16));
        let key = CryptoJS.enc.Utf8.parse(code.substring(16));
        let enc = CryptoJS.AES.encrypt(jsonStr, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
        return encodeURIComponent(enc.toString());
      }
      let md5 = java.md5Encode(salt);
      let iv = md5.substring(0, 16);
      let key = md5.substring(16);
      return encodeURIComponent(java.aesEncode(jsonStr, key, "AES/CBC/PKCS5Padding", iv));
    }

    let origin = "${baseUrl}".replace(/\\/book\\/.*$/, '').replace(/\\/+$/, '');
    let token1 = getEncToken({ id: Number(bookId) });
    let bookRes = java.ajax(origin + "/api/book?token=" + token1);
    let bookJson = JSON.parse(bookRes);
    let dirId = (bookJson && bookJson.dirid) ? bookJson.dirid : bookId;

    let token2 = getEncToken({ id: Number(dirId) });
    let listRes = java.ajax(origin + "/api/booklist?token=" + token2);
    let listJson = JSON.parse(listRes);
    let list = (listJson && listJson.list) ? listJson.list : [];

    return list.map((title, i) => {
      let chUrl = origin + "/#/book/" + bookId + "/" + (i + 1) + ".html";
      return {
        name: String(title),
        title: String(title),
        url: chUrl,
        href: chUrl
      };
    });
  } catch(e) {
    return [];
  }
})()`

    const contentJs = `@js:
(() => {
  try {
    let urlStr = String(baseUrl || result || "");
    let m = urlStr.match(/book\\/(\\d+)\\/(\\d+)/);
    if (!m) return result;
    let bookId = Number(m[1]);
    let chapterId = Number(m[2]);

    function getEncToken(obj) {
      let salt = "book@token.html";
      let jsonStr = JSON.stringify(obj);
      if (typeof CryptoJS !== 'undefined' && CryptoJS.AES && CryptoJS.MD5) {
        let code = CryptoJS.MD5(salt).toString();
        let iv = CryptoJS.enc.Utf8.parse(code.substring(0, 16));
        let key = CryptoJS.enc.Utf8.parse(code.substring(16));
        let enc = CryptoJS.AES.encrypt(jsonStr, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
        return encodeURIComponent(enc.toString());
      }
      let md5 = java.md5Encode(salt);
      let iv = md5.substring(0, 16);
      let key = md5.substring(16);
      return encodeURIComponent(java.aesEncode(jsonStr, key, "AES/CBC/PKCS5Padding", iv));
    }

    let origin = "${baseUrl}".replace(/\\/book\\/.*$/, '').replace(/\\/+$/, '');
    let token = getEncToken({ id: bookId, chapterid: chapterId });
    let res = java.ajax(origin + "/api/chapter?token=" + token);
    let json = JSON.parse(res);
    return (json && json.txt) ? json.txt : result;
  } catch(e) {
    return result;
  }
})()`

    ruleToc = {
      chapterList: tocJs,
      chapterName: 'name',
      chapterUrl: 'url'
    }

    ruleContent = {
      content: contentJs
    }

    ruleBookInfo = {
      intro: `@js:\n(() => {\n  try {\n    let urlStr = String(baseUrl || result || "");\n    let m = urlStr.match(/book\\/(\\d+)/);\n    if (!m) return result;\n    let bookId = Number(m[1]);\n    let salt = "book@token.html";\n    let jsonStr = JSON.stringify({ id: bookId });\n    let encToken = "";\n    if (typeof CryptoJS !== 'undefined' && CryptoJS.AES && CryptoJS.MD5) {\n      let code = CryptoJS.MD5(salt).toString();\n      let iv = CryptoJS.enc.Utf8.parse(code.substring(0, 16));\n      let key = CryptoJS.enc.Utf8.parse(code.substring(16));\n      encToken = encodeURIComponent(CryptoJS.AES.encrypt(jsonStr, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString());\n    } else {\n      let md5 = java.md5Encode(salt);\n      let iv = md5.substring(0, 16);\n      let key = md5.substring(16);\n      encToken = encodeURIComponent(java.aesEncode(jsonStr, key, "AES/CBC/PKCS5Padding", iv));\n    }\n    let origin = "${baseUrl}".replace(/\\/book\\/.*$/, '').replace(/\\/+$/, '');\n    let res = java.ajax(origin + "/api/book?token=" + encToken);\n    let json = JSON.parse(res);\n    return (json && json.intro) ? json.intro : result;\n  } catch(e) {\n    return result;\n  }\n})()`,
      kind: `@js:\n(() => {\n  try {\n    let urlStr = String(baseUrl || result || "");\n    let m = urlStr.match(/book\\/(\\d+)/);\n    if (!m) return "";\n    let bookId = Number(m[1]);\n    let salt = "book@token.html";\n    let jsonStr = JSON.stringify({ id: bookId });\n    let encToken = "";\n    if (typeof CryptoJS !== 'undefined' && CryptoJS.AES && CryptoJS.MD5) {\n      let code = CryptoJS.MD5(salt).toString();\n      let iv = CryptoJS.enc.Utf8.parse(code.substring(0, 16));\n      let key = CryptoJS.enc.Utf8.parse(code.substring(16));\n      encToken = encodeURIComponent(CryptoJS.AES.encrypt(jsonStr, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString());\n    } else {\n      let md5 = java.md5Encode(salt);\n      let iv = md5.substring(0, 16);\n      let key = md5.substring(16);\n      encToken = encodeURIComponent(java.aesEncode(jsonStr, key, "AES/CBC/PKCS5Padding", iv));\n    }\n    let origin = "${baseUrl}".replace(/\\/book\\/.*$/, '').replace(/\\/+$/, '');\n    let res = java.ajax(origin + "/api/book?token=" + encToken);\n    let json = JSON.parse(res);\n    return (json && json.sortname) ? json.sortname : "";\n  } catch(e) {\n    return "";\n  }\n})()`,
      lastChapter: `@js:\n(() => {\n  try {\n    let urlStr = String(baseUrl || result || "");\n    let m = urlStr.match(/book\\/(\\d+)/);\n    if (!m) return "";\n    let bookId = Number(m[1]);\n    let salt = "book@token.html";\n    let jsonStr = JSON.stringify({ id: bookId });\n    let encToken = "";\n    if (typeof CryptoJS !== 'undefined' && CryptoJS.AES && CryptoJS.MD5) {\n      let code = CryptoJS.MD5(salt).toString();\n      let iv = CryptoJS.enc.Utf8.parse(code.substring(0, 16));\n      let key = CryptoJS.enc.Utf8.parse(code.substring(16));\n      encToken = encodeURIComponent(CryptoJS.AES.encrypt(jsonStr, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString());\n    } else {\n      let md5 = java.md5Encode(salt);\n      let iv = md5.substring(0, 16);\n      let key = md5.substring(16);\n      encToken = encodeURIComponent(java.aesEncode(jsonStr, key, "AES/CBC/PKCS5Padding", iv));\n    }\n    let origin = "${baseUrl}".replace(/\\/book\\/.*$/, '').replace(/\\/+$/, '');\n    let res = java.ajax(origin + "/api/book?token=" + encToken);\n    let json = JSON.parse(res);\n    return (json && json.lastchapter) ? json.lastchapter : "";\n  } catch(e) {\n    return "";\n  }\n})()`
    }
  } else {
    // 2. 常规 HTML 站点构造 Legado ruleSearch
    const searchBookUrl = rule.search?.bookUrl || setRuleSuffix(rule.search?.bookName || 'h3 a, h4 a, td:nth-child(1) a, a', 'href')
    ruleSearch = {
      bookList: rule.search?.result || 'tr, dl, li, div.item, .bookbox',
      name: setRuleSuffix(rule.search?.bookName || 'h3 a, h4 a, td:nth-child(1) a, a', 'text'),
      author: setRuleSuffix(rule.search?.author || '.author, td:nth-child(3)', 'text'),
      bookUrl: searchBookUrl,
      lastChapter: setRuleSuffix(rule.search?.latestChapter, 'text'),
      intro: setRuleSuffix(rule.search?.intro, 'text'),
      coverUrl: setRuleSuffix(rule.search?.coverUrl || rule.book?.coverUrl, 'src')
    }

    // 过滤空字段
    Object.keys(ruleSearch).forEach(k => {
      if (!ruleSearch[k]) delete ruleSearch[k]
    })

    // 构造常规 HTML 站点的 ruleBookInfo (详情页简介/封面/完整目录规则)
    ruleBookInfo = {
      intro: setRuleSuffix(rule.book?.intro || rule.bookInfo?.intro || rule.search?.intro || '#intro, .intro, #bookintro, p.review, div.intro', 'textNodes'),
      coverUrl: setRuleSuffix(rule.book?.coverUrl || rule.bookInfo?.coverUrl || rule.search?.coverUrl || '#fmimg img, .cover img, img', 'src')
    }
    if (rule.bookInfo?.tocUrl || rule.search?.tocUrl) {
      ruleBookInfo.tocUrl = rule.bookInfo?.tocUrl || rule.search?.tocUrl
    }

    // 3. 构造 Legado ruleToc (智能规范化指向 a 标签)
    let rawItem = (rule.toc?.item || '#list a, dd a, li a').trim()
    const endsWithAnchor = /(^|\s|>)a$/i.test(rawItem)

    ruleToc = {
      chapterList: rawItem,
      chapterName: rule.toc?.chapterName || (endsWithAnchor ? 'text' : 'a@text'),
      chapterUrl: rule.toc?.chapterUrl || (endsWithAnchor ? 'href' : 'a@href')
    }

    if (rule.toc?.nextPage || rule.toc?.nextTocUrl) {
      ruleToc.nextTocUrl = rule.toc?.nextPage || rule.toc?.nextTocUrl
    }

    // 4. 构造 Legado ruleContent
    let contentSel = rule.chapter?.content || '#content'
    if (!contentSel.includes('@')) {
      contentSel = `${contentSel}@textNodes`
    }

    ruleContent = {
      content: contentSel
    }
    if (rule.chapter?.filterTxt) {
      ruleContent.replaceRegex = `##${rule.chapter.filterTxt}`
    }
    if (rule.chapter?.nextPage || rule.chapter?.nextContentUrl) {
      ruleContent.nextContentUrl = rule.chapter?.nextPage || rule.chapter?.nextContentUrl
    }
  }

  // 构造标准全局 HTTP Headers
  const defaultHeader = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  }
  if (rule.search?.cookies) {
    defaultHeader.Cookie = rule.search.cookies
  }

  // 5. 生成标准的 Legado 3.0 JSON 对象
  const exportObj = {
    bookSourceComment: rule.comment || '由 YouQian Reader 导出，完全适配阅读 3.0 (Legado)',
    bookSourceGroup: sourceDetail.isBuiltin ? '核心书源' : '规则书源',
    bookSourceName: name,
    bookSourceType: 0,
    bookSourceUrl: baseUrl,
    customOrder: 0,
    enabled: sourceDetail.enabled !== false,
    enabledCookieJar: false,
    header: rule.header || JSON.stringify(defaultHeader),
    lastUpdateTime: Date.now(),
    respondTime: 180,
    ruleContent,
    ruleSearch,
    ruleToc,
    searchUrl
  }

  if (Object.keys(ruleBookInfo).length > 0) {
    exportObj.ruleBookInfo = ruleBookInfo
  }

  return exportObj
}

/**
 * 导出全部书源配置（完全适配开源阅读 3.0 / Legado 格式）
 */
export function exportSourcesJson(sourceIds = null) {
  const all = getAllSourcesDetail()
  const filtered = sourceIds && sourceIds.length > 0
    ? all.filter(s => sourceIds.includes(s.id))
    : all

  const exportRules = filtered
    .map(s => convertToLegado3Format(s))
    .filter(Boolean)

  return JSON.stringify(exportRules, null, 2)
}

/**
 * 阅读 3.0 (Legado) / so-novel 多格式书源标准化适配器
 */
export function normalizeSourceRule(raw) {
  if (!raw || typeof raw !== 'object') return null

  const name = raw.name || raw.bookSourceName || raw.sourceName || ''
  let url = (raw.url || raw.bookSourceUrl || raw.baseUrl || '').trim()
  url = url.replace(/(-By\s*[\w\s]+|\s+.*)$/i, '').trim()

  if (!name && !url) return null

  // 保留原始完整阅读 3.0 / Legado 规则（如果是 Legado 格式或已有 rawLegadoRule）
  const rawLegadoRule = raw.rawLegadoRule || (
    (raw.bookSourceUrl || raw.ruleSearch || raw.ruleToc || raw.ruleContent || raw.searchUrl) ? JSON.parse(JSON.stringify(raw)) : null
  )

  let searchUrl = raw.search?.url || raw.searchUrl || ''
  if (searchUrl.includes('<js>')) {
    searchUrl = searchUrl.split('<js>')[0].trim()
  }
  let searchMethod = (raw.search?.method || 'get').toLowerCase()
  let searchData = raw.search?.data || ''

  if (searchUrl.includes(',')) {
    const parts = searchUrl.split(',')
    searchUrl = parts[0].trim()
    try {
      const extra = JSON.parse(parts.slice(1).join(',').trim())
      if (extra.method) searchMethod = extra.method.toLowerCase()
      if (extra.body) searchData = extra.body
    } catch (_) {}
  }

  // 自动为相对路径 searchUrl 补全主站域名
  if (searchUrl && !searchUrl.startsWith('http') && !searchUrl.startsWith('@js:')) {
    if (url.startsWith('http')) {
      try {
        const baseOrigin = new URL(url).origin
        searchUrl = searchUrl.startsWith('/') ? `${baseOrigin}${searchUrl}` : `${baseOrigin}/${searchUrl}`
      } catch (_) {}
    }
  }

  searchUrl = searchUrl.replace(/\{\{\s*key\s*\}\}/g, '%s').replace(/\{\{\s*searchKey\s*\}\}/g, '%s')
  if (searchData) searchData = searchData.replace(/\{\{\s*key\s*\}\}/g, '%s').replace(/\{\{\s*searchKey\s*\}\}/g, '%s')

  const searchRule = {
    url: searchUrl || (url ? `${url.replace(/\/+$/, '')}/search?key=%s` : ''),
    method: searchMethod,
    data: searchData,
    result: raw.search?.result || raw.ruleSearch?.bookList || 'tr, dl, li, div.item',
    bookName: raw.search?.bookName || raw.ruleSearch?.name || 'h3 a, h4 a, a',
    bookUrl: raw.search?.bookUrl || raw.ruleSearch?.bookUrl || '',
    author: raw.search?.author || raw.ruleSearch?.author || '.author',
    intro: raw.search?.intro || raw.ruleSearch?.intro || '',
    latestChapter: raw.search?.latestChapter || raw.ruleSearch?.lastChapter || '',
    lastUpdateTime: raw.search?.lastUpdateTime || raw.search?.updateTime || raw.ruleSearch?.lastUpdateTime || raw.ruleSearch?.updateTime || raw.ruleBookInfo?.kind || '',
    coverUrl: raw.search?.coverUrl || raw.ruleSearch?.coverUrl || raw.ruleBookInfo?.coverUrl || ''
  }

  const bookInfoRule = {
    intro: raw.book?.intro || raw.ruleBookInfo?.intro || '',
    coverUrl: raw.book?.coverUrl || raw.ruleBookInfo?.coverUrl || '',
    tocUrl: raw.bookInfo?.tocUrl || raw.ruleBookInfo?.tocUrl || raw.search?.tocUrl || raw.ruleSearch?.tocUrl || ''
  }

  const tocRule = {
    item: raw.toc?.item || raw.ruleToc?.chapterList || raw.ruleToc?.chapterName || '#list a, dd a, li a',
    chapterName: raw.toc?.chapterName || raw.ruleToc?.chapterName || '',
    chapterUrl: raw.toc?.chapterUrl || raw.ruleToc?.chapterUrl || '',
    nextPage: raw.toc?.nextPage || raw.ruleToc?.nextTocUrl || '',
    nextTocUrl: raw.toc?.nextTocUrl || raw.ruleToc?.nextTocUrl || ''
  }

  const chapterRule = {
    content: raw.chapter?.content || raw.ruleContent?.content || '#content, .read-content, #txtContent',
    filterTxt: raw.chapter?.filterTxt || raw.ruleContent?.replaceRegex || '',
    nextPage: raw.chapter?.nextPage || raw.ruleContent?.nextContentUrl || '',
    nextContentUrl: raw.chapter?.nextContentUrl || raw.ruleContent?.nextContentUrl || ''
  }

  return {
    name: name || url,
    url: url || searchUrl,
    comment: raw.comment || raw.bookSourceComment || raw.bookSourceGroup || '',
    encoding: raw.encoding || raw.charset || 'utf-8',
    header: raw.header || (typeof raw.headers === 'string' ? raw.headers : (raw.headers ? JSON.stringify(raw.headers) : '')),
    search: searchRule,
    bookInfo: bookInfoRule,
    toc: tocRule,
    chapter: chapterRule,
    enabled: raw.enabled !== false,
    rawLegadoRule
  }
}

/**
 * 为书源生成全局唯一哈希 ID，防止 Emoji、特殊字符或重名碰撞覆盖
 */
function generateSourceId(rule, idx) {
  const rawStr = `${rule.name || ''}_${rule.url || ''}_${idx}`
  let hash = 0
  for (let i = 0; i < rawStr.length; i++) {
    hash = ((hash << 5) - hash) + rawStr.charCodeAt(i)
    hash |= 0
  }
  const safeName = (rule.name || `source`).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').slice(0, 16)
  return `${safeName}_${Math.abs(hash)}`
}

/**
 * 导入自定义书源（支持 阅读 3.0 / so-novel 等多格式书源 JSON）
 */
export function importCustomSource(fileContent) {
  try {
    const parsed = JSON.parse(fileContent)
    const rawList = Array.isArray(parsed) ? parsed : [parsed]
    const normalizedList = rawList
      .map((r, idx) => {
        const norm = normalizeSourceRule(r)
        if (!norm) return null
        norm.id = generateSourceId(norm, idx)
        return norm
      })
      .filter(Boolean)

    if (normalizedList.length === 0) {
      return { success: false, error: '书源格式不合法，未识别到有效的书源规则' }
    }

    const dir = getCustomRulesDir()
    normalizedList.forEach((rule) => {
      const fileName = `custom_rule_${rule.id}.json`
      writeFileSync(join(dir, fileName), JSON.stringify(rule, null, 2), 'utf-8')

      // 精准解封
      if (deletedSourceIds.has(rule.id)) {
        deletedSourceIds.delete(rule.id)
      }
    })

    loadCustomSources()
    return { success: true, count: normalizedList.length }
  } catch (err) {
    return { success: false, error: '解析 JSON 失败: ' + err.message }
  }
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

/**
 * 全自动探测并推导小说书源规则 (Source Sniffer)
 * @param {object} input { baseUrl, searchUrl, sampleUrl }
 */
export async function autoSniffNovelSource(input = {}) {
  const logs = []
  const addLog = (msg) => {
    console.log(`[SourceSniffer] ${msg}`)
    logs.push(msg)
  }

  let rawBaseUrl = (input.baseUrl || '').trim()
  let rawSearchUrl = (input.searchUrl || '').trim()
  let sampleUrl = (input.sampleUrl || '').trim()

  if (!rawBaseUrl && !rawSearchUrl && !sampleUrl) {
    throw new Error('请至少提供【主站基准 URL】或【搜索 URL 模板】')
  }

  // 1. 规范化 Base URL
  let origin = ''
  try {
    const candidate = rawBaseUrl || rawSearchUrl || sampleUrl
    const parsed = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`)
    origin = parsed.origin
    if (!rawBaseUrl) rawBaseUrl = origin
  } catch (e) {
    throw new Error(`输入的 URL 格式无效: ${e.message}`)
  }

  addLog(`[步骤 1/5] 启动智能嗅探，目标主站基准域名: ${origin}`)

  let detectedEncoding = 'utf-8'
  let detectedName = ''
  let finalSearchUrl = rawSearchUrl
  let sampleNovelUrl = ''
  let sampleChapterUrl = ''
  let sampleChapterTitle = ''
  let sampleContentPreview = ''

  // 2. 探测主站首页：获取网站名称、识别编码、发现搜索入口
  try {
    addLog(`[步骤 2/5] 正在请求主站首页探测元数据...`)
    const homeHtml = await fetchWithRetry(origin, {}, 2, 6000)
    if (homeHtml) {
      const $home = cheerio.load(homeHtml)
      
      // 检测编码
      if (/charset=["']?(gbk|gb2312|gb18030)["']?/i.test(homeHtml)) {
        detectedEncoding = 'gbk'
        addLog(`[编码识别] 识别到目标站点采用 GBK / GB2312 编码`)
      } else {
        detectedEncoding = 'utf-8'
        addLog(`[编码识别] 识别到目标站点采用标准 UTF-8 编码`)
      }

      // 提取站点标题作为书源名称
      const titleTag = $home('title').text().trim()
      if (titleTag) {
        // 清理常见后缀：如 “笔趣阁_最新小说阅读网” -> “笔趣阁”
        const cleanedTitle = titleTag.split(/[-_|_\s,，]/)[0].trim()
        if (cleanedTitle.length >= 2 && cleanedTitle.length <= 15) {
          detectedName = cleanedTitle
          addLog(`[名称提取] 从首页标题提取到书源名称: "${detectedName}"`)
        }
      }

      // 自动嗅探搜索表单（如果用户未填 searchUrl）
      if (!finalSearchUrl) {
        $home('form').each((_, form) => {
          const action = $home(form).attr('action') || ''
          const inputName = $home(form).find('input[type="text"], input[name*="search"], input[name*="key"], input[name*="q"], input[name*="name"]').attr('name')
          if (inputName) {
            let fullAction = action
            if (!fullAction.startsWith('http')) {
              fullAction = new URL(fullAction || '/', origin).toString()
            }
            finalSearchUrl = `${fullAction}?${inputName}=%s`
            addLog(`[搜索嗅探] 从首页表单自动推导出搜索模板: ${finalSearchUrl}`)
            return false
          }
        })
      }

      // 寻找首页推荐的一本小说链接作为后备样本
      if (!sampleNovelUrl) {
        $home('a').each((_, a) => {
          const href = $home(a).attr('href') || ''
          const text = $home(a).text().trim()
          if (href && (href.includes('/book/') || href.includes('/novel/') || /\/\d+\/?$/.test(href) || /\/\d+_\d+\/?$/.test(href))) {
            if (text.length >= 2 && text.length <= 16 && !text.includes('首页') && !text.includes('榜') && !text.includes('书架')) {
              sampleNovelUrl = href.startsWith('http') ? href : new URL(href, origin).toString()
              return false
            }
          }
        })
      }
    }
  } catch (err) {
    addLog(`[主站探测提示] 请求首页信息: ${err.message}`)
  }

  // 默认补充书源名称
  if (!detectedName) {
    try {
      const hostname = new URL(origin).hostname
      detectedName = hostname.replace(/^www\./, '').split('.')[0] || '自定义小说源'
    } catch (_) {
      detectedName = '自定义小说源'
    }
  }

  // 3. 搜索结果与选择器分析
  let resultSelector = ''
  const testKeywords = ['剑来', '诡秘之主', '斗破苍穹', '万相之王', '仙逆']

  // 整理搜索候选模板列表
  const candidateSearchUrls = []
  if (finalSearchUrl) {
    candidateSearchUrls.push(finalSearchUrl)
    if (finalSearchUrl.includes('/#/search')) {
      candidateSearchUrls.push(finalSearchUrl.replace('/#/search', '/api/search'))
      candidateSearchUrls.push(finalSearchUrl.replace('/#/search', '/search'))
    }
  }
  candidateSearchUrls.push(
    `${origin}/api/search?q=%s`,
    `${origin}/search?q=%s`,
    `${origin}/search.php?q=%s`,
    `${origin}/s.php?q=%s`,
    `${origin}/modules/article/search.php?searchkey=%s`
  )

  addLog(`[步骤 3/5] 正在探测搜索接口与结果列表项选择器...`)
  searchLoop: for (const searchTpl of candidateSearchUrls) {
    for (const kw of testKeywords) {
      try {
        const encodedKw = detectedEncoding === 'gbk' ? encodeGBK(kw) : encodeURIComponent(kw)
        const realSearchUrl = searchTpl.replace(/%s/g, encodedKw)

        const searchHtml = await fetchWithRetry(realSearchUrl, {}, 1, 6000)
        if (searchHtml && searchHtml.length > 20) {
          const trimmed = searchHtml.trim()
          // 3.1 检测是否为 JSON API
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const json = JSON.parse(trimmed)
              let list = Array.isArray(json) ? json : (json.data || json.list || json.books || json.results || [])
              if (Array.isArray(list) && list.length > 0) {
                finalSearchUrl = searchTpl
                resultSelector = 'JSON_API (自动解析数据树)'
                const firstBook = list[0]
                const id = firstBook.id || firstBook.bookId || ''
                if (id && !sampleNovelUrl) {
                  sampleNovelUrl = `${origin}/book/${id}/`
                }
                addLog(`[搜索嗅探成功] 成功识别并连通 JSON 搜索数据接口: "${finalSearchUrl}"`)
                break searchLoop
              }
            } catch (_) {}
          }

          // 3.2 HTML DOM 解析
          const $search = cheerio.load(searchHtml)
          const candidateResultSelectors = [
            '.result-item',
            '.result-list > li',
            '.result-list .item',
            'table.grid tr:has(a)',
            'table.table tr:has(a)',
            'table tr:has(a)',
            '.novelslist2 li:has(a)',
            '.bookbox',
            '.book-item',
            '.item-book',
            'div.book-list div.item',
            'div.list-item',
            'ul.txt-list li',
            'div.box:has(h4 a)',
            'div.box:has(h3 a)',
            'div.item:has(a)'
          ]

          for (const sel of candidateResultSelectors) {
            const items = $search(sel)
            if (items.length >= 1) {
              let valid = false
              items.each((_, el) => {
                const a = $search(el).find('a')
                if (a.length > 0 && a.text().trim().length >= 2) {
                  const href = a.attr('href') || ''
                  if (href) {
                    valid = true
                    if (!sampleNovelUrl) {
                      sampleNovelUrl = href.startsWith('http') ? href : new URL(href, origin).toString()
                    }
                  }
                }
              })
              if (valid) {
                finalSearchUrl = searchTpl
                resultSelector = sel
                addLog(`[结果推断成功] 成功匹配搜索结果列表项选择器: "${resultSelector}" (匹配到 ${items.length} 个条目)`)
                break searchLoop
              }
            }
          }
        }
      } catch (searchErr) {
        // 继续尝试下一个
      }
    }
  }

  // 兜底搜索选择器预设
  if (!resultSelector) {
    resultSelector = '.result_list > li, table tr, .bookbox, .item'
    addLog(`[搜索选择器兜底] 使用标准兼容器选择器: "${resultSelector}"`)
  }

  // 4. 章节目录列表项选择器推导
  let chapterSelector = ''
  if (sampleNovelUrl) {
    addLog(`[步骤 4/5] 正在抓取书籍详情页 [${sampleNovelUrl}] 深度分析目录结构...`)
    try {
      const bookHtml = await fetchWithRetry(sampleNovelUrl, {}, 2, 7000)
      if (bookHtml) {
        const $book = cheerio.load(bookHtml)

        // 候选目录选择器
        const candidateChapterSelectors = [
          '#list dd a',
          '#list a',
          '.catalog a',
          '.chapter-list a',
          '.listmain dd a',
          'div.listmain a',
          'ul.chapter li a',
          'ul.section-list a',
          '#chapters a',
          '.book-chapter-list a',
          '.directory-list a',
          'div.section-box a',
          'div.book_list a',
          'div.book-list a',
          '#chapterlist a',
          'ul.list a',
          'div.box a'
        ]

        let maxChapters = 0
        for (const sel of candidateChapterSelectors) {
          const links = $book(sel)
          if (links.length >= 5) {
            // 检查链接文本是否像章节名（含“第”、“章”、“节”、“0”、“1”或中文字符）
            let chapterCount = 0
            links.each((_, el) => {
              const t = $book(el).text().trim()
              if (t.includes('章') || t.includes('节') || t.includes('回') || /\d+/.test(t) || t.length >= 3) {
                chapterCount++
              }
            })

            if (chapterCount > maxChapters) {
              maxChapters = chapterCount
              chapterSelector = sel

              // 记录第一章 URL
              links.each((_, el) => {
                const href = $book(el).attr('href') || ''
                const t = $book(el).text().trim()
                if (href && (t.includes('1') || t.includes('一') || t.includes('章') || t.length >= 2)) {
                  sampleChapterUrl = href.startsWith('http') ? href : new URL(href, origin).toString()
                  sampleChapterTitle = t
                  return false
                }
              })
            }
          }
        }

        if (chapterSelector) {
          addLog(`[目录推断成功] 成功识别目录列表项选择器: "${chapterSelector}" (成功提取到 ${maxChapters} 个章节！)`)
          if (sampleChapterTitle) {
            addLog(`[第一章示例] ${sampleChapterTitle} -> ${sampleChapterUrl}`)
          }
        }
      }
    } catch (bookErr) {
      addLog(`[目录分析提示] 请求小说主页解析: ${bookErr.message}`)
    }
  }

  // 4.1 SPA 站点目录自适应嗅探
  if ((!chapterSelector || chapterSelector.includes('兜底')) && sampleNovelUrl) {
    const bookIdMatch = sampleNovelUrl.match(/book\/(\d+)/) || sampleNovelUrl.match(/\/(\d+)\/?$/)
    if (bookIdMatch) {
      const bookId = bookIdMatch[1]
      try {
        const bookData = await requestSpaApi(origin, 'book', { id: Number(bookId) || bookId })
        if (bookData && bookData.title) {
          const dirId = bookData.dirid || bookId
          const listData = await requestSpaApi(origin, 'booklist', { id: Number(dirId) || dirId })
          if (listData && Array.isArray(listData.list) && listData.list.length > 0) {
            chapterSelector = '#list dd a, #list a'
            sampleChapterTitle = listData.list[0]
            sampleChapterUrl = `${origin}/#/book/${bookId}/1.html`
            addLog(`[SPA 目录推断成功] 成功识别并连通动态目录 API，获取到 ${listData.list.length} 个章节！`)
            addLog(`[第一章示例] ${sampleChapterTitle} -> ${sampleChapterUrl}`)
          }
        }
      } catch (_) {}
    }
  }

  // 兜底目录选择器
  if (!chapterSelector) {
    chapterSelector = '#list > dl > dd > a, #list a, .catalog a'
    addLog(`[目录选择器兜底] 使用推荐目录选择器: "${chapterSelector}"`)
  }

  // 5. 章节正文内容 DOM 选择器推导
  let contentSelector = ''
  if (sampleChapterUrl) {
    addLog(`[步骤 5/5] 正在抓取正文页 [${sampleChapterUrl}] 深度分析正文容器...`)
    try {
      const chapterHtml = await fetchWithRetry(sampleChapterUrl, {}, 2, 7000)
      if (chapterHtml) {
        const $ch = cheerio.load(chapterHtml)

        // 候选正文内容选择器
        const candidateContentSelectors = [
          '#content',
          '.read-content',
          '#txtContent',
          '.showtxt',
          '#chaptercontent',
          '#booktxt',
          '#htmlContent',
          '.content',
          '#nr1',
          '#nr_content',
          '#text',
          'div.article-content',
          '#articleContent',
          'div.txt',
          'div.read_box'
        ]

        let bestLength = 0
        for (const sel of candidateContentSelectors) {
          const el = $ch(sel)
          if (el.length > 0) {
            // 复制副本并剔除 script/style/a/button
            const clone = el.clone()
            clone.find('script, style, a, button, iframe, .ad').remove()
            const text = clone.text().trim()
            if (text.length > 100 && text.length > bestLength) {
              bestLength = text.length
              contentSelector = sel
              sampleContentPreview = text.slice(0, 120).replace(/\s+/g, ' ')
            }
          }
        }

        // 如果候选未命中，进行 DOM 文本密度算法自动发现
        if (!contentSelector) {
          $ch('div, article, section').each((_, el) => {
            const id = $ch(el).attr('id')
            const cls = $ch(el).attr('class')
            if (id || cls) {
              const clone = $ch(el).clone()
              clone.find('script, style, a, button, nav, header, footer').remove()
              const text = clone.text().trim()
              if (text.length > 200 && text.length > bestLength) {
                bestLength = text.length
                contentSelector = id ? `#${id}` : `.${cls.trim().split(/\s+/)[0]}`
                sampleContentPreview = text.slice(0, 120).replace(/\s+/g, ' ')
              }
            }
          })
        }

        if (contentSelector) {
          addLog(`[正文推断成功] 成功定位正文内容 DOM 选择器: "${contentSelector}" (提取有效正文 ${bestLength} 字！)`)
          addLog(`[正文预览] ${sampleContentPreview}...`)
        }
      }
    } catch (chErr) {
      addLog(`[正文分析提示] 请求第一章正文解析: ${chErr.message}`)
    }

    // 5.1 SPA 站点正文自适应嗅探
    if (!contentSelector || !sampleContentPreview) {
      const chMatch = sampleChapterUrl.match(/book\/(\d+)\/(\d+)/)
      if (chMatch) {
        try {
          const chData = await requestSpaApi(origin, 'chapter', {
            id: Number(chMatch[1]) || chMatch[1],
            chapterid: Number(chMatch[2]) || chMatch[2]
          })
          if (chData && chData.txt) {
            contentSelector = '#content, #chaptercontent'
            sampleContentPreview = chData.txt.slice(0, 120).replace(/\s+/g, ' ')
            addLog(`[SPA 正文推断成功] 成功提取加密正文内容（${chData.txt.length} 字）！`)
            addLog(`[正文预览] ${sampleContentPreview}...`)
          }
        } catch (_) {}
      }
    }
  }

  // 兜底正文选择器
  if (!contentSelector) {
    contentSelector = '#content, .read-content, #txtContent, .showtxt'
    addLog(`[正文选择器兜底] 使用标准正文选择器预设: "${contentSelector}"`)
  }

  const cleanRules = '请记住本书首发.* | 天才一秒记住.* | https?://[\\w./]+ | 手机用户请浏览.* | 请收藏本站.* | 手机版：.* | 『点此报错』.* | 『加入书签』.*'

  addLog(`🎉 [智能预断完毕] 所有书源规则已全部自动分析并填充就绪！`)

  return {
    success: true,
    logs,
    rule: {
      sourceName: detectedName,
      baseUrl: rawBaseUrl,
      searchUrl: finalSearchUrl || `${origin}/search?q=%s`,
      searchMethod: 'GET',
      encoding: detectedEncoding,
      resultSelector: resultSelector === 'JSON_API (自动解析数据树)' ? '.result-item, tr, dl, li, div.box' : resultSelector,
      chapterSelector,
      contentSelector,
      cleanRules,
      sampleNovelUrl,
      sampleChapterUrl: sampleChapterUrl || sampleNovelUrl,
      sampleChapterTitle,
      sampleContentPreview
    }
  }
}
