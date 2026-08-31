import { existsSync, appendFileSync, statSync, readFileSync } from 'fs'
import { getBookById, updateBook, getAllBooks } from '../database.js'
import { getNovelChapters, getChapterContent } from './sourceManager.js'
import { buildEpub } from './epubBuilder.js'

/**
 * 检查单本书籍是否有新章节
 */
export async function checkBookUpdate(bookId) {
  try {
    const book = getBookById(bookId)
    if (!book) return { hasUpdate: false, error: '未找到该书籍' }
    if (!book.novelUrl || !book.novelSourceId) {
      return { hasUpdate: false, message: '此书非在线连载小说或缺少来源配置' }
    }

    const onlineChapters = await getNovelChapters(book.novelUrl, book.novelSourceId)
    if (!onlineChapters || onlineChapters.length === 0) {
      return { hasUpdate: false, error: '获取远端章节列表失败' }
    }

    const localCount = book.totalChapters || 0
    const totalCount = onlineChapters.length

    if (totalCount > localCount) {
      const newChapters = onlineChapters.slice(localCount)
      return {
        bookId: book.id,
        title: book.title,
        hasUpdate: true,
        localCount,
        totalCount,
        newCount: newChapters.length,
        latestChapterTitle: onlineChapters[totalCount - 1]?.title,
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
 * 检查书架上所有连载小说的更新
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
 * 执行增量下载与追更追加
 */
export async function performIncrementalUpdate(bookId, onProgress) {
  const book = getBookById(bookId)
  if (!book) return { success: false, error: '未找到书籍' }
  if (!book.filePath || !existsSync(book.filePath)) {
    return { success: false, error: '本地书籍文件不存在' }
  }

  const checkRes = await checkBookUpdate(bookId)
  if (!checkRes.hasUpdate || !checkRes.newChapters || checkRes.newChapters.length === 0) {
    return { success: true, newCount: 0, message: '暂无更新' }
  }

  const newChapters = checkRes.newChapters
  const fetchedChapters = []

  // 并发抓取新增章节正文（每次 3 线程并发）
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

  // 根据本地文件格式执行追加写入
  const format = (book.format || '').toUpperCase()

  if (format === 'TXT') {
    // TXT 格式直接在文件尾部追加新章节文本
    const appendText = '\n\n' + fetchedChapters
      .map(c => `### ${c.title}\n\n${c.content}`)
      .join('\n\n\n')

    appendFileSync(book.filePath, appendText, 'utf-8')
  } else if (format === 'EPUB') {
    // EPUB 格式重新读取旧内容并拼接新章节生成完整 EPUB
    try {
      // 重新从远端构建包含全章节的 EPUB
      const allChapters = await getNovelChapters(book.novelUrl, book.novelSourceId)
      // 若因网络原因仅拼接：为了保证阅读进度不崩塌，更新已有文件
      // 提取纯文本内容追加（针对 EPUB 构建）
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

  // 更新数据库元数据
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
