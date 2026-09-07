import { existsSync, appendFileSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { getPortableDataDir } from '../portablePath.js'
import { getBookById, updateBook, getAllBooks, addBook } from '../database.js'
import { getNovelChapters, getChapterContent, searchNovels, getAllSourcesInfo, getEnabledSources } from './sourceManager.js'
import { buildEpub } from './epubBuilder.js'
import { toSimplified } from './utils.js'
import { applyReplaceRules } from './replaceRuleEngine.js'

/**
 * 获取指定书籍的本地章节缓存目录 (data/novel_cache/<bookId>)
 */
export function getNovelCacheDir(bookId) {
  const dir = join(getPortableDataDir(), 'novel_cache', String(bookId).replace(/[^a-zA-Z0-9_-]/g, '_'))
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }) } catch (_) {}
  }
  return dir
}

/**
 * 一键将在线连载小说加入书架追更 (免等待全本下载)
 */
export function addSerialBookToShelf(novelInfo) {
  try {
    const books = getAllBooks()
    const existing = books.find(b => {
      if (b.novelUrl && novelInfo.novelUrl && b.novelUrl === novelInfo.novelUrl) return true
      if (b.title && novelInfo.title && b.author && novelInfo.author && b.title === novelInfo.title && b.author === novelInfo.author) return true
      return false
    })

    if (existing) {
      return { success: true, alreadyExists: true, book: existing }
    }

    const newBook = {
      id: 'online_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      title: novelInfo.title,
      author: novelInfo.author || '网络作家',
      cover: novelInfo.cover || null,
      format: 'ONLINE',
      filePath: null,
      novelUrl: novelInfo.novelUrl,
      novelSourceId: novelInfo.sourceId || novelInfo.novelSourceId,
      sourceName: novelInfo.sourceName || '网络书源',
      latestChapter: novelInfo.latestChapterTitle || novelInfo.latestChapter || '',
      totalChapters: novelInfo.chapterCount || novelInfo.totalChapters || 0,
      unreadCount: 0,
      hasUpdate: false,
      addedAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString()
    }

    const res = addBook(newBook)
    if (res && res.success === false && res.book) {
      return { success: true, alreadyExists: true, book: res.book }
    }

    return { success: true, alreadyExists: false, book: newBook }
  } catch (e) {
    return { success: false, error: '加入书架追更失败: ' + e.message }
  }
}

/**
 * 统一标准化章节列表结构，鲁棒兼容纯数组、{ chapters: [...] } 以及 { list: [...] }
 */
function normalizeChapterList(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.chapters)) return data.chapters
  if (Array.isArray(data.list)) return data.list
  return []
}

/**
 * 获取书籍目录（支持本地缓存与在线拉取）
 */
export async function getOrFetchBookChapters(bookId, forceRefresh = false) {
  const book = getBookById(bookId)
  if (!book) return { success: false, error: '未找到书籍' }
  if (!book.novelUrl || !book.novelSourceId) {
    return { success: false, error: '该书籍缺少在线书源网址或书源ID' }
  }

  const cacheDir = getNovelCacheDir(bookId)
  const indexFile = join(cacheDir, 'chapters_index.json')

  // 若不强制刷新且缓存存在，直接返回本地缓存
  if (!forceRefresh && existsSync(indexFile)) {
    try {
      const cached = JSON.parse(readFileSync(indexFile, 'utf-8'))
      if (Array.isArray(cached) && cached.length > 0) {
        return { success: true, chapters: cached, fromCache: true }
      }
    } catch (_) {}
  }

  // 在线从书源拉取目录
  try {
    const rawRes = await getNovelChapters(book.novelUrl, book.novelSourceId)
    const chapters = normalizeChapterList(rawRes)
    if (!chapters || chapters.length === 0) {
      return { success: false, error: '获取远端章节列表失败或章节为空' }
    }

    // 格式化并持久化至本地索引
    const formattedChapters = chapters.map((ch, idx) => ({
      index: idx,
      title: ch.title,
      url: ch.url
    }))

    try {
      writeFileSync(indexFile, JSON.stringify(formattedChapters, null, 2), 'utf-8')
    } catch (_) {}

    // 更新书籍的章节总数和最新章节
    const latestTitle = formattedChapters[formattedChapters.length - 1]?.title || ''
    updateBook(bookId, {
      totalChapters: formattedChapters.length,
      latestChapter: latestTitle
    })

    return { success: true, chapters: formattedChapters, fromCache: false }
  } catch (e) {
    return { success: false, error: '加载章节列表异常: ' + e.message }
  }
}

/**
 * 获取单章正文（优先本地缓存，若无则在线请求并存盘）
 */
export async function getOrFetchChapterContent(bookId, chapterIndex, forceFetch = false) {
  const book = getBookById(bookId)
  if (!book) return { success: false, error: '未找到书籍' }

  const cacheDir = getNovelCacheDir(bookId)
  const chapterFile = join(cacheDir, `ch_${chapterIndex}.json`)

  // 1. 优先检查本地缓存
  if (!forceFetch && existsSync(chapterFile)) {
    try {
      const data = JSON.parse(readFileSync(chapterFile, 'utf-8'))
      if (data && data.content && data.content.length > 10) {
        const cleaned = applyReplaceRules(data.content, { bookTitle: book.title, sourceName: book.sourceName })
        return {
          success: true,
          title: data.title,
          content: cleaned,
          fromCache: true
        }
      }
    } catch (_) {}
  }

  // 2. 本地无缓存，从章节列表中找到对应 URL
  const chaptersRes = await getOrFetchBookChapters(bookId, false)
  if (!chaptersRes.success || !chaptersRes.chapters[chapterIndex]) {
    return { success: false, error: '未找到该章节的信息' }
  }

  const chapterMeta = chaptersRes.chapters[chapterIndex]

  try {
    const rawContent = await getChapterContent(chapterMeta.url, book.novelSourceId, chapterMeta.title)
    if (!rawContent || rawContent.trim().length === 0) {
      return { success: false, error: '获取到的章节正文为空' }
    }

    const cleanedContent = applyReplaceRules(rawContent, { bookTitle: book.title, sourceName: book.sourceName })

    const resultData = {
      index: chapterIndex,
      title: chapterMeta.title,
      content: cleanedContent,
      fetchedAt: new Date().toISOString()
    }

    // 存入本地缓存
    try {
      writeFileSync(chapterFile, JSON.stringify(resultData, null, 2), 'utf-8')
    } catch (_) {}

    return {
      success: true,
      title: chapterMeta.title,
      content: cleanedContent,
      fromCache: false
    }
  } catch (e) {
    return { success: false, error: '章节加载失败: ' + e.message }
  }
}

/**
 * 静默预加载后 N 章（后台异步执行，不阻塞当前阅读）
 */
export async function preloadNextChapters(bookId, currentIndex, count = 2) {
  setTimeout(async () => {
    for (let i = 1; i <= count; i++) {
      const targetIndex = currentIndex + i
      try {
        const cacheDir = getNovelCacheDir(bookId)
        const chapterFile = join(cacheDir, `ch_${targetIndex}.json`)
        if (!existsSync(chapterFile)) {
          await getOrFetchChapterContent(bookId, targetIndex, false)
        }
      } catch (_) {}
    }
  }, 100)
}

/**
 * 获取书籍本地离线缓存状态
 */
export function getBookCacheStatus(bookId) {
  const cacheDir = getNovelCacheDir(bookId)
  if (!existsSync(cacheDir)) {
    return { cachedCount: 0, cachedIndices: [], totalBytes: 0 }
  }

  try {
    const files = readdirSync(cacheDir)
    const cachedIndices = []
    let totalBytes = 0

    for (const file of files) {
      const match = file.match(/^ch_(\d+)\.json$/)
      if (match) {
        cachedIndices.push(parseInt(match[1], 10))
        try {
          const st = statSync(join(cacheDir, file))
          totalBytes += st.size
        } catch (_) {}
      }
    }

    return {
      cachedCount: cachedIndices.length,
      cachedIndices: cachedIndices.sort((a, b) => a - b),
      totalBytes
    }
  } catch (_) {
    return { cachedCount: 0, cachedIndices: [], totalBytes: 0 }
  }
}

/**
 * 清除某本书的离线缓存
 */
export function clearBookOfflineCache(bookId) {
  try {
    const cacheDir = getNovelCacheDir(bookId)
    if (existsSync(cacheDir)) {
      const files = readdirSync(cacheDir)
      for (const file of files) {
        if (file.startsWith('ch_')) {
          try { rmSync(join(cacheDir, file)) } catch (_) {}
        }
      }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 记录当前活跃的批量缓存任务控制器 (用于取消)
const activeBatchCacheControllers = new Map()

/**
 * 启动类似阅读 3.0 的离线批量预缓存任务
 * @param {string} bookId 书籍 ID
 * @param {number} startIndex 起始章节索引
 * @param {number} count 需缓存的章节数量 (-1 代表全部未下载)
 * @param {function} onProgress 进度回调通知
 */
export async function startOfflineBatchCache(bookId, startIndex, count, onProgress) {
  const chaptersRes = await getOrFetchBookChapters(bookId, false)
  if (!chaptersRes.success) {
    return { success: false, error: chaptersRes.error }
  }

  const allChapters = chaptersRes.chapters
  const total = allChapters.length

  // 计算要下载的章节索引列表
  let endIndex = count === -1 ? total : Math.min(total, startIndex + count)
  const targetIndices = []
  const cacheStatus = getBookCacheStatus(bookId)
  const cachedSet = new Set(cacheStatus.cachedIndices)

  for (let idx = startIndex; idx < endIndex; idx++) {
    if (!cachedSet.has(idx)) {
      targetIndices.push(idx)
    }
  }

  if (targetIndices.length === 0) {
    onProgress?.({
      bookId,
      done: 0,
      total: 0,
      finished: true,
      message: '所选范围已全部离线缓存就绪'
    })
    return { success: true, downloadedCount: 0, message: '无需重复下载' }
  }

  const taskKey = `cache_${bookId}`
  const cancelToken = { isCancelled: false }
  activeBatchCacheControllers.set(taskKey, cancelToken)

  const CONCURRENCY = 3
  let doneCount = 0

  // 异步在后台并发队列执行，不阻塞调用端
  ;(async () => {
    for (let i = 0; i < targetIndices.length; i += CONCURRENCY) {
      if (cancelToken.isCancelled) {
        onProgress?.({ bookId, done: doneCount, total: targetIndices.length, cancelled: true })
        break
      }

      const chunk = targetIndices.slice(i, i + CONCURRENCY)
      await Promise.all(
        chunk.map(async (chIdx) => {
          try {
            await getOrFetchChapterContent(bookId, chIdx, false)
          } catch (_) {}
          doneCount++
          onProgress?.({
            bookId,
            done: doneCount,
            total: targetIndices.length,
            currentTitle: allChapters[chIdx]?.title,
            finished: doneCount === targetIndices.length
          })
        })
      )
    }
    activeBatchCacheControllers.delete(taskKey)
  })()

  return {
    success: true,
    totalToDownload: targetIndices.length,
    message: '离线缓存任务已在后台启动'
  }
}

/**
 * 取消离线批量缓存任务
 */
export function cancelOfflineBatchCache(bookId) {
  const taskKey = `cache_${bookId}`
  const controller = activeBatchCacheControllers.get(taskKey)
  if (controller) {
    controller.isCancelled = true
    activeBatchCacheControllers.delete(taskKey)
    return { success: true, message: '已取消离线缓存任务' }
  }
  return { success: false, message: '未找到正在进行的离线缓存任务' }
}

/**
/**
 * 快速搜索可用替代书源（专用于换源弹窗）
 * 具备：严格书名匹配（杜绝假源）、核心源优先、30并发池防拥堵、实时目录探活预检、流式推送真实可用源
 */
export async function searchAlternativeSources(title, author, currentChapterTitle = null, currentChapterIndex = null, blockedSources = [], onSourceFound = null) {
  // 向下兼容参数顺序
  if (typeof currentChapterTitle === 'function') {
    onSourceFound = currentChapterTitle
    currentChapterTitle = null
    currentChapterIndex = null
    blockedSources = []
  } else if (typeof currentChapterIndex === 'function') {
    onSourceFound = currentChapterIndex
    currentChapterIndex = null
    blockedSources = []
  } else if (typeof blockedSources === 'function') {
    onSourceFound = blockedSources
    blockedSources = []
  }

  try {
    const sources = getEnabledSources()
    if (!sources || sources.length === 0) {
      return { success: true, sources: [] }
    }

    // 构建该书籍已屏蔽书源标识集合（支持 sourceId、novelUrl 或两者组合匹配）
    const blockedSet = new Set()
    if (Array.isArray(blockedSources)) {
      blockedSources.forEach(b => {
        if (typeof b === 'string') {
          blockedSet.add(b)
        } else if (b && typeof b === 'object') {
          if (b.sourceId) blockedSet.add(b.sourceId)
          if (b.novelUrl) blockedSet.add(b.novelUrl)
          if (b.sourceId && b.novelUrl) blockedSet.add(`${b.sourceId}_${b.novelUrl}`)
        }
      })
    }

    const isSourceBlocked = (sourceId, novelUrl) => {
      if (blockedSet.size === 0) return false
      if (sourceId && blockedSet.has(sourceId)) return true
      if (novelUrl && blockedSet.has(novelUrl)) return true
      if (sourceId && novelUrl && blockedSet.has(`${sourceId}_${novelUrl}`)) return true
      return false
    }

    // 智能清洗书名符号与修饰词，统一转为简体小写对比
    const pureTitle = toSimplified((title || '').replace(/[《》\s【】()（）[\]]/g, '')).trim().toLowerCase()
    const cleanAuthor = toSimplified((author || '').replace(/[《》\s【】()（）[\]]/g, '')).trim().toLowerCase()
    const foundSources = []
    const seen = new Set()

    // 1. 条件 1：书名一致校验
    const isValidCandidateTitle = (candTitle) => {
      if (!candTitle) return false
      const candPure = toSimplified(candTitle.replace(/[《》\s【】()（）[\]]/g, '')).trim().toLowerCase()
      if (!candPure || candPure.length < 2) return false
      
      const junkWords = ['首页', '排行榜', '书架', '分类', '搜索', '全本', '完本', '书库', '个人中心', '登录', '注册', '书单', '电脑版', '手机版', '更新列表', '最新更新']
      if (junkWords.some(j => candPure === j)) return false

      // 完全相同
      if (candPure === pureTitle) return true

      // 仅允许剥除通用非核心后缀后完全相同 (如 "新官路商途(全本)", "新官路商途全文阅读")
      const stripped = candPure.replace(/(全文阅读|最新章节|笔趣阁|txt下载|全本|完结|连载|精校版|无弹窗|无广告)/g, '').trim()
      if (stripped === pureTitle) return true

      return false
    }

    // 2. 条件 2：作者一致校验（若源作者缺失，书名和章节名一致亦可保留；若作者明确冲突则排除）
    const isAuthorMismatched = (candAuthor) => {
      if (!cleanAuthor || cleanAuthor === '未知') return false
      // 若候选源作者缺失、为空、或为通用占位词（如未知、佚名、网络作家），放行进入章节名一致性校验
      if (!candAuthor) return false
      const c = toSimplified(candAuthor.replace(/[《》\s【】()（）[\]]/g, '')).trim().toLowerCase()
      if (!c || c === '未知' || c === '佚名' || c === '网络作家' || c === '无') {
        return false
      }
      // 若候选源有具体作者名，且双方均有内容，检查是否相符
      if (cleanAuthor.length >= 1 && c.length >= 1) {
        if (cleanAuthor === c || cleanAuthor.includes(c) || c.includes(cleanAuthor)) {
          return false // 作者相符
        }
      }
      // 作者明确存在且与原作者冲突（如原作者是更俗，候选源写着辰东），判定为不同作品予以过滤
      return true
    }

    // 3. 条件 3：章节名一致校验 (确保该书源目录中能找到当前正在阅读的章节)
    const hasMatchingChapter = (chapterList, targetTitle) => {
      if (!targetTitle) return true
      const cleanCurrent = targetTitle.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
      const currNum = extractChapterNumber(targetTitle)
      const currentSubTitle = targetTitle.replace(/[第\s0-9零一二两三四五六七八九十百千章节回卷.、:：_-]/g, '').trim()

      for (let i = 0; i < chapterList.length; i++) {
        const ch = chapterList[i]
        const cleanTarget = (ch.title || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
        // 完全匹配
        if (cleanTarget === cleanCurrent && cleanTarget.length > 0) return true

        // 章节序号完全一致
        const targetNum = extractChapterNumber(ch.title)
        if (currNum !== null && targetNum !== null && currNum === targetNum) {
          return true
        }

        // 副标题关键词匹配
        const targetSubTitle = (ch.title || '').replace(/[第\s0-9零一二两三四五六七八九十百千章节回卷.、:：_-]/g, '').trim()
        if (currentSubTitle.length >= 2 && targetSubTitle.includes(currentSubTitle)) {
          return true
        }
      }
      return false
    }

    // 优先将核心原生源排在前面，确保秒级召回高质量源
    const prioritySourceIds = new Set(['fast_search', 'fastSearch', 'super_source', 'superSource', 'biquge', 'dingdian'])
    const sortedSources = [...sources].sort((a, b) => {
      const aP = prioritySourceIds.has(a.id) ? 1 : 0
      const bP = prioritySourceIds.has(b.id) ? 1 : 0
      return bP - aP
    })

    // 单源快速搜索 + 实时目录探活预检
    const searchOne = async (src) => {
      try {
        const promise = src.search(title)
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4500))
        const res = await Promise.race([promise, timeout])
        if (Array.isArray(res) && res.length > 0) {
          for (const item of res) {
            if (!item) continue
            // 校验条件 1：书名一致
            if (!isValidCandidateTitle(item.title)) continue
            // 校验条件 2：检测作者是否明确冲突
            const isAuthorConflict = isAuthorMismatched(item.author)

            const novelUrl = item.novelUrl || item.url
            if (!novelUrl || !novelUrl.startsWith('http')) continue
            const sourceId = item.source || src.id

            // 过滤已被当前书籍屏蔽的书源（标记为采集有问题）
            if (isSourceBlocked(sourceId, novelUrl)) continue

            const key = `${sourceId}_${novelUrl}`
            if (seen.has(key)) continue
            seen.add(key)

            // 关键：实时探活预检，验证真实目录是否可用以及最新章节信息
            try {
              const verifyTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('verify timeout')), 3500))
              const rawChapters = await Promise.race([
                getNovelChapters(novelUrl, item.source || src.id),
                verifyTimeout
              ])
              const norm = normalizeChapterList(rawChapters)
              if (norm && norm.length > 0) {
                // 校验条件 3：章节名一致（核心指标，若目录不包含当前章节则坚决过滤）
                if (currentChapterTitle && !hasMatchingChapter(norm, currentChapterTitle)) {
                  continue
                }

                // 如果未传章节名进行核验，且作者明确冲突，为安全起见跳过
                if (!currentChapterTitle && isAuthorConflict) {
                  continue
                }

                const sourceItem = {
                  sourceId: item.source || src.id,
                  sourceName: item.sourceName || src.name || item.source || src.id,
                  novelUrl: novelUrl,
                  title: item.title,
                  author: item.author || '',
                  authorConflict: Boolean(isAuthorConflict), // 标记作者有冲突/偏差
                  latestChapter: norm[norm.length - 1]?.title || item.latestChapterTitle || item.latestChapter || '',
                  chapterCount: norm.length
                }
                foundSources.push(sourceItem)
                if (typeof onSourceFound === 'function') {
                  try { onSourceFound(sourceItem) } catch (_) {}
                }
              }
            } catch (_) {
              // 探活失败说明是死链、假源或无法解析章节的无效源，坚决不向前端展示
            }
          }
        }
      } catch (_) {
        // 静默跳过失败源
      }
    }

    // 3. 采用并发池（25 并发控制），大幅提升检索速度
    const poolLimit = 25
    const running = []
    let isStopped = false

    const maxWaitPromise = new Promise(resolve => setTimeout(() => {
      isStopped = true
      resolve()
    }, 25000))

    const processPool = async () => {
      for (const src of sortedSources) {
        if (isStopped || foundSources.length >= 30) break
        const p = searchOne(src).then(() => {
          const idx = running.indexOf(p)
          if (idx !== -1) running.splice(idx, 1)
        })
        running.push(p)
        if (running.length >= poolLimit) {
          await Promise.race(running)
        }
      }
      await Promise.allSettled(running)
    }

    await Promise.race([processPool(), maxWaitPromise])

    // 按作者一致性（无冲突优先）、作者完全匹配度与章节数降序排序
    foundSources.sort((a, b) => {
      // 1. 无作者冲突的源排在前面
      const aConflict = a.authorConflict ? 1 : 0
      const bConflict = b.authorConflict ? 1 : 0
      if (aConflict !== bConflict) return aConflict - bConflict

      // 2. 作者完全一致的排在作者缺省的前面
      const aAuthor = toSimplified((a.author || '').toLowerCase())
      const bAuthor = toSimplified((b.author || '').toLowerCase())
      const aAuthorMatch = cleanAuthor && aAuthor && (aAuthor.includes(cleanAuthor) || cleanAuthor.includes(aAuthor)) ? 1 : 0
      const bAuthorMatch = cleanAuthor && bAuthor && (bAuthor.includes(cleanAuthor) || cleanAuthor.includes(bAuthor)) ? 1 : 0
      if (aAuthorMatch !== bAuthorMatch) return bAuthorMatch - aAuthorMatch

      // 3. 章节总数多的排在前面
      return (b.chapterCount || 0) - (a.chapterCount || 0)
    })

    return {
      success: true,
      sources: foundSources
    }
  } catch (e) {
    return { success: false, error: '换源搜索失败: ' + e.message }
  }
}

/**
 * 中文数字转阿拉伯数字辅助
 */
function chineseToArabic(cn) {
  const map = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '百': 100, '千': 1000 }
  if (!cn) return null
  if (/^\d+$/.test(cn)) return parseInt(cn, 10)
  
  let total = 0
  let r = 0
  for (let i = 0; i < cn.length; i++) {
    const val = map[cn[i]]
    if (val === undefined) continue
    if (val >= 10) {
      if (r === 0) r = 1
      total += r * val
      r = 0
    } else {
      r = val
    }
  }
  total += r
  return total > 0 ? total : null
}

/**
 * 从章节标题中提取章节序号 (如 "第十七章 龙虎斗" -> 17, "第17章" -> 17, "17. 龙虎斗" -> 17)
 */
function extractChapterNumber(title) {
  if (!title) return null
  const m1 = title.match(/第\s*([0-9零一二两三四五六七八九十百千]+)\s*[章节回卷]/)
  if (m1) {
    const num = chineseToArabic(m1[1])
    if (num !== null) return num
  }
  const m2 = title.match(/(?:^|\s)([0-9]+)[\s.、_-]/)
  if (m2) return parseInt(m2[1], 10)
  
  return null
}

/**
 * 切换书源并智能对齐当前章节
 */
export async function switchBookSource(bookId, newSourceId, newNovelUrl, currentChapterTitle, currentChapterIndex = 0) {
  const book = getBookById(bookId)
  if (!book) return { success: false, error: '未找到书籍' }

  try {
    // 1. 拉取新源的完整目录
    const rawNewChapters = await getNovelChapters(newNovelUrl, newSourceId)
    const newChapters = normalizeChapterList(rawNewChapters)
    if (!newChapters || newChapters.length === 0) {
      return { success: false, error: '新书源无法解析出章节目录' }
    }

    const formattedChapters = newChapters.map((ch, idx) => ({
      index: idx,
      title: ch.title,
      url: ch.url
    }))

    // 2. 彻底清理旧书源章节正文缓存并保存新目录
    clearBookOfflineCache(bookId)
    const cacheDir = getNovelCacheDir(bookId)
    const indexFile = join(cacheDir, 'chapters_index.json')
    try {
      writeFileSync(indexFile, JSON.stringify(formattedChapters, null, 2), 'utf-8')
    } catch (_) {}

    // 3. 智能多级对齐当前章节（标题对齐 > 章节号对齐 > 换源前位置保底）
    const safeFallbackIdx = Math.min(
      Math.max(0, parseInt(currentChapterIndex, 10) || 0),
      formattedChapters.length - 1
    )
    let alignedIndex = safeFallbackIdx

    if (currentChapterTitle) {
      const cleanCurrent = currentChapterTitle.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
      const currNum = extractChapterNumber(currentChapterTitle)
      const currentSubTitle = currentChapterTitle.replace(/[第\s0-9零一二两三四五六七八九十百千章节回卷.、:：_-]/g, '').trim()

      let bestMatchIdx = -1
      let bestScore = 0

      formattedChapters.forEach((ch, idx) => {
        const cleanTarget = ch.title.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
        const targetNum = extractChapterNumber(ch.title)
        const targetSubTitle = ch.title.replace(/[第\s0-9零一二两三四五六七八九十百千章节回卷.、:：_-]/g, '').trim()

        let score = 0
        // 规则 1：完全一致（100 分）
        if (cleanTarget === cleanCurrent && cleanTarget.length > 0) {
          score = 100
        }
        // 规则 2：章节号一致且副标题核心词匹配（95 分）
        else if (currNum !== null && targetNum !== null && currNum === targetNum && currentSubTitle && targetSubTitle.includes(currentSubTitle)) {
          score = 95
        }
        // 规则 3：章节号一致（90 分）
        else if (currNum !== null && targetNum !== null && currNum === targetNum) {
          score = 90
        }
        // 规则 4：副标题核心词完全重合（80 分）
        else if (currentSubTitle.length >= 2 && targetSubTitle.includes(currentSubTitle)) {
          score = 80
        }
        // 规则 5：相互包含（60 分）
        else if (cleanTarget.includes(cleanCurrent) || cleanCurrent.includes(cleanTarget)) {
          score = 60
        }

        if (score > bestScore) {
          bestScore = score
          bestMatchIdx = idx
        }
      })

      if (bestMatchIdx !== -1 && bestScore >= 60) {
        alignedIndex = bestMatchIdx
      }
    }

    // 4. 更新数据库配置
    const allSources = getAllSourcesInfo()
    const foundSource = allSources.find(s => s.id === newSourceId)
    updateBook(bookId, {
      novelSourceId: newSourceId,
      sourceName: foundSource?.name || newSourceId,
      novelUrl: newNovelUrl,
      totalChapters: formattedChapters.length,
      latestChapter: formattedChapters[formattedChapters.length - 1]?.title || ''
    })

    return {
      success: true,
      alignedIndex,
      alignedTitle: formattedChapters[alignedIndex]?.title,
      totalChapters: formattedChapters.length
    }
  } catch (e) {
    return { success: false, error: '切换书源异常: ' + e.message }
  }
}

/**
 * 检查单本书籍是否有新章节并同步未读红点
 */
export async function checkBookUpdate(bookId) {
  try {
    const book = getBookById(bookId)
    if (!book) return { hasUpdate: false, error: '未找到该书籍' }
    if (!book.novelUrl || !book.novelSourceId) {
      return { hasUpdate: false, message: '此书非在线连载小说或缺少来源配置' }
    }

    const rawOnline = await getNovelChapters(book.novelUrl, book.novelSourceId)
    const onlineChapters = normalizeChapterList(rawOnline)
    if (!onlineChapters || onlineChapters.length === 0) {
      return { hasUpdate: false, error: '获取远端章节列表失败' }
    }

    const localCount = book.totalChapters || 0
    const totalCount = onlineChapters.length

    if (totalCount > localCount) {
      const newChapters = onlineChapters.slice(localCount)
      const latestTitle = onlineChapters[totalCount - 1]?.title || ''

      // 更新数据库红点未读数与最新章节
      updateBook(book.id, {
        hasUpdate: true,
        unreadCount: newChapters.length,
        totalChapters: totalCount,
        latestChapter: latestTitle
      })

      return {
        bookId: book.id,
        title: book.title,
        hasUpdate: true,
        localCount,
        totalCount,
        newCount: newChapters.length,
        latestChapterTitle: latestTitle,
        newChapters
      }
    }

    return {
      bookId: book.id,
      title: book.title,
      hasUpdate: false,
      localCount,
      totalCount,
      message: '已是最新章节'
    }
  } catch (e) {
    return { hasUpdate: false, error: e.message }
  }
}

/**
 * 检查书架上所有连载小说的更新（全量批量巡检）
 */
export async function checkAllBooksUpdate() {
  const books = getAllBooks()
  const serialBooks = books.filter(b => b.novelUrl && b.novelSourceId)
  const results = []

  for (const book of serialBooks) {
    try {
      const res = await checkBookUpdate(book.id)
      if (res.hasUpdate) {
        results.push(res)
      }
    } catch (_) {}
  }

  return results
}

/**
 * 读者读完最新章节，消除红点未读标记
 */
export function markBookUpdateRead(bookId) {
  try {
    updateBook(bookId, {
      hasUpdate: false,
      unreadCount: 0
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 增量下载追更（保留旧功能兼容）
 */
export async function performIncrementalUpdate(bookId, onProgress) {
  const book = getBookById(bookId)
  if (!book) return { success: false, error: '未找到书籍' }
  if (book.format === 'ONLINE') {
    // 在线格式只需要同步目录即可
    const chRes = await getOrFetchBookChapters(bookId, true)
    markBookUpdateRead(bookId)
    return { success: true, newCount: chRes.chapters?.length || 0 }
  }

  // 离线 TXT / EPUB 的追加逻辑
  if (!book.filePath || !existsSync(book.filePath)) {
    return { success: false, error: '本地书籍文件不存在' }
  }

  const checkRes = await checkBookUpdate(bookId)
  if (!checkRes.hasUpdate || !checkRes.newChapters || checkRes.newChapters.length === 0) {
    return { success: true, newCount: 0, message: '暂无更新' }
  }

  const newChapters = checkRes.newChapters
  const fetchedChapters = []

  const CONCURRENCY = 3
  for (let i = 0; i < newChapters.length; i += CONCURRENCY) {
    const chunk = newChapters.slice(i, i + CONCURRENCY)
    const chunkResults = await Promise.all(
      chunk.map(async (ch) => {
        try {
          const content = await getChapterContent(ch.url, book.novelSourceId, ch.title)
          return {
            title: ch.title,
            content: content || '本章内容获取失败，请稍后刷新。'
          }
        } catch (e) {
          return {
            title: ch.title,
            content: '本章加载异常: ' + e.message
          }
        }
      })
    )

    fetchedChapters.push(...chunkResults)
    onProgress?.({
      done: fetchedChapters.length,
      total: newChapters.length,
      currentTitle: chunk[chunk.length - 1]?.title
    })
  }

  const format = (book.format || '').toUpperCase()
  if (format === 'TXT') {
    const appendText = '\n\n' + fetchedChapters
      .map(c => `### ${c.title}\n\n${c.content}`)
      .join('\n\n\n')
    appendFileSync(book.filePath, appendText, 'utf-8')
  } else if (format === 'EPUB') {
    try {
      await buildEpub({
        title: book.title,
        author: book.author || '网络作家',
        coverUrl: book.cover,
        description: book.description || '',
        chapters: fetchedChapters,
        outputPath: book.filePath
      })
    } catch (epubErr) {
      console.warn('EPUB 追更合成警告:', epubErr.message)
    }
  }

  const newSize = existsSync(book.filePath) ? statSync(book.filePath).size : book.fileSize
  updateBook(bookId, {
    totalChapters: checkRes.totalCount,
    latestChapterTitle: checkRes.latestChapterTitle,
    fileSize: newSize,
    lastUpdatedAt: new Date().toISOString()
  })

  return {
    success: true,
    newCount: fetchedChapters.length,
    totalChapters: checkRes.totalCount,
    latestChapterTitle: checkRes.latestChapterTitle
  }
}
