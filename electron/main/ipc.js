import { ipcMain, dialog, shell } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { extname, basename } from 'path'
import { getPortableDownloadsDir, resolveBookPath } from './portablePath.js'
import {
  getAllBooks, addBook, removeBook, updateBook, getBookById,
  getReadingProgress, saveReadingProgress,
  getBookmarks, addBookmark, removeBookmark,
  getSettings, saveSettings, getLastOpenedBook, setLastOpenedBook,
  getStore, getEpubLocations, saveEpubLocations,
  exportBackupData, importBackupData, resetDatabase
} from './database'
import { extractEpubMeta } from './parsers/epub'
import { extractPdfMeta } from './parsers/pdf'
import { extractMobiMeta, extractMobiContent } from './parsers/mobi'
import { extractTxtMeta, readTxtFile } from './parsers/txt'
import {
  searchNovels, getNovelChapters, getChapterContent, getAllSourcesInfo, getAllSourcesDetail,
  saveOrUpdateSource, deleteSource, clearAllSources, resetDefaultSources, testSingleSource, toggleSourceEnabled, exportSourcesJson,
  importCustomSource, cancelSearch, autoSniffNovelSource
} from './novel/sourceManager'
import {
  startDownload, cancelDownload, getTaskStatus, getAllTasks,
  getDownloadConfig, saveDownloadConfig
} from './novel/downloader'
import { randomUUID } from 'crypto'

export function setupIpcHandlers() {

  // ===== 文件选择 =====
  ipcMain.handle('select-books', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择电子书',
      filters: [
        { name: '电子书', extensions: ['epub', 'pdf', 'azw3', 'mobi', 'txt'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择包含电子书的文件夹',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ===== 书籍导入 =====
  ipcMain.handle('import-books', async (_, filePaths) => {
    const results = []
    for (const filePath of filePaths) {
      try {
        if (!existsSync(filePath)) {
          results.push({ filePath, success: false, error: '文件不存在' })
          continue
        }
        const ext = extname(filePath).toLowerCase().slice(1)
        const stat = statSync(filePath)
        let meta = { title: basename(filePath, extname(filePath)), author: '未知', cover: null }

        if (ext === 'epub') meta = await extractEpubMeta(filePath)
        else if (ext === 'pdf') meta = await extractPdfMeta(filePath)
        else if (ext === 'mobi' || ext === 'azw3') meta = await extractMobiMeta(filePath)
        else if (ext === 'txt') meta = await extractTxtMeta(filePath)

        const result = addBook({
          filePath,
          format: ext.toUpperCase(),
          fileSize: stat.size,
          title: meta.title || basename(filePath, extname(filePath)),
          author: meta.author || '未知',
          cover: meta.cover || null,
          description: meta.description || '',
          publisher: meta.publisher || '',
          language: meta.language || ''
        })
        results.push({ filePath, ...result })
      } catch (err) {
        results.push({ filePath, success: false, error: err.message })
      }
    }
    return results
  })

  // ===== 书库操作 =====
  ipcMain.handle('get-all-books', () => getAllBooks())
  ipcMain.handle('remove-book', (_, id) => removeBook(id))
  ipcMain.handle('update-book', (_, id, updates) => updateBook(id, updates))

  // ===== 文件关联：按文件路径查找书籍 =====
  ipcMain.handle('get-book-by-path', (_, filePath) => {
    const realPath = resolveBookPath(filePath)
    const books = getAllBooks()
    return books.find(b => b.filePath === realPath || b.filePath === filePath) || null
  })

  // ===== 文件内容读取 =====
  ipcMain.handle('read-file', async (_, filePath) => {
    const realPath = resolveBookPath(filePath)
    if (!existsSync(realPath)) throw new Error('文件不存在: ' + realPath)
    return readFileSync(realPath)
  })

  ipcMain.handle('read-file-base64', async (_, filePath) => {
    const realPath = resolveBookPath(filePath)
    if (!existsSync(realPath)) throw new Error('文件不存在: ' + realPath)
    return readFileSync(realPath).toString('base64')
  })

  ipcMain.handle('file-exists', (_, filePath) => existsSync(resolveBookPath(filePath)))

  ipcMain.handle('open-external', (_, url) => shell.openExternal(url))

  // ===== TXT 读取（含编码检测）=====
  ipcMain.handle('read-txt-file', async (_, filePath) => {
    return readTxtFile(resolveBookPath(filePath))
  })

  // ===== MOBI/AZW3 内容提取 =====
  ipcMain.handle('extract-mobi-content', async (_, filePath) => {
    return extractMobiContent(resolveBookPath(filePath))
  })

  // ===== 阅读进度 =====
  ipcMain.handle('get-reading-progress', (_, bookId) => getReadingProgress(bookId))
  ipcMain.handle('save-reading-progress', (_, bookId, progress) => {
    saveReadingProgress(bookId, progress)
    return true
  })

  // ===== 书签 =====
  ipcMain.handle('get-bookmarks', (_, bookId) => getBookmarks(bookId))
  ipcMain.handle('add-bookmark', (_, bookId, bookmark) => addBookmark(bookId, bookmark))
  ipcMain.handle('remove-bookmark', (_, bookId, bookmarkId) => removeBookmark(bookId, bookmarkId))

  // ===== 设置 =====
  ipcMain.handle('get-settings', () => getSettings())
  ipcMain.handle('save-settings', (_, settings) => { saveSettings(settings); return true })
  ipcMain.handle('get-last-opened-book', () => getLastOpenedBook())
  ipcMain.handle('set-last-opened-book', (_, bookId) => { setLastOpenedBook(bookId); return true })

  // ===== 分类管理 =====
  ipcMain.handle('get-categories', () => getStore().get('categories', []))
  ipcMain.handle('save-categories', (_, categories) => { getStore().set('categories', categories); return true })

  // ===== EPUB locations 独立存储 =====
  ipcMain.handle('get-epub-locations', (_, bookId) => getEpubLocations(bookId))
  ipcMain.handle('save-epub-locations', (_, bookId, locations) => {
    saveEpubLocations(bookId, locations)
    return true
  })

  // ===== 调试日志输出 =====
  ipcMain.handle('log-to-server', (_, type, ...args) => {
    if (type === 'error') {
      console.error('[RENDERER ERROR]', ...args)
    } else {
      console.log('[RENDERER LOG]', ...args)
    }
    return true
  })

  // ===== 封面刷新 =====
  ipcMain.handle('refresh-book-cover', async (_, bookId) => {
    const book = getBookById(bookId)
    if (!book) return { success: false, error: '书籍不存在' }
    const ext = extname(book.filePath).toLowerCase().slice(1)
    let cover = null
    try {
      if (ext === 'epub') {
        const meta = await extractEpubMeta(book.filePath)
        cover = meta.cover
      } else if (ext === 'mobi' || ext === 'azw3') {
        const meta = await extractMobiMeta(book.filePath)
        cover = meta.cover
      } else if (ext === 'pdf') {
        const meta = await extractPdfMeta(book.filePath)
        cover = meta.cover
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
    if (cover) {
      updateBook(bookId, { cover })
      return { success: true, cover }
    }
    return { success: false, error: '未找到封面图片' }
  })

  // ===== 备份与恢复 =====
  ipcMain.handle('export-backup', async () => {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const result = await dialog.showSaveDialog({
      title: '导出备份数据',
      defaultPath: `youqian_backup_${dateStr}.json`,
      filters: [
        { name: 'Backup Files', extensions: ['json'] }
      ]
    })
    
    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消了导出' }
    }

    try {
      const backupData = exportBackupData()
      writeFileSync(result.filePath, JSON.stringify(backupData, null, 2), 'utf-8')
      return { success: true, filePath: result.filePath }
    } catch (err) {
      return { success: false, error: `写入备份文件失败: ${err.message}` }
    }
  })

  ipcMain.handle('import-backup', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入备份数据',
      filters: [
        { name: 'Backup Files', extensions: ['json'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, error: '用户取消了导入' }
    }

    try {
      const content = readFileSync(result.filePaths[0], 'utf-8')
      const backupData = JSON.parse(content)
      
      const importResult = importBackupData(backupData)
      if (importResult.success) {
        if (importResult.restoredBookIds && importResult.restoredBookIds.length > 0) {
          for (const bookId of importResult.restoredBookIds) {
            try {
              const book = getBookById(bookId)
              if (book && existsSync(book.filePath)) {
                const ext = extname(book.filePath).toLowerCase().slice(1)
                let meta = {}
                if (ext === 'epub') meta = await extractEpubMeta(book.filePath)
                else if (ext === 'pdf') meta = await extractPdfMeta(book.filePath)
                else if (ext === 'mobi' || ext === 'azw3') meta = await extractMobiMeta(book.filePath)
                else if (ext === 'txt') meta = await extractTxtMeta(book.filePath)

                updateBook(bookId, {
                  author: meta.author || '未知',
                  cover: meta.cover || null,
                  description: meta.description || '',
                  publisher: meta.publisher || '',
                  language: meta.language || ''
                })
              }
            } catch (e) {
              console.error(`恢复书籍元数据失败 ${bookId}:`, e)
            }
          }
        }
        return {
          success: true,
          settings: getSettings(),
          categories: getStore().get('categories', [])
        }
      } else {
        return { success: false, error: importResult.error }
      }
    } catch (err) {
      return { success: false, error: `导入失败: ${err.message}` }
    }
  })

  ipcMain.handle('reset-database', () => resetDatabase())

  // ===== 在线小说：书源管理 =====
  ipcMain.handle('novel-get-sources', () => getAllSourcesInfo())
  ipcMain.handle('novel-get-sources-detail', () => getAllSourcesDetail())
  ipcMain.handle('novel-toggle-source', (_, id, enabled) => toggleSourceEnabled(id, enabled))
  ipcMain.handle('novel-save-source', (_, ruleObj) => saveOrUpdateSource(ruleObj))
  ipcMain.handle('novel-delete-source', (_, id) => deleteSource(id))
  ipcMain.handle('novel-clear-all-sources', () => clearAllSources())
  ipcMain.handle('novel-reset-default-sources', () => resetDefaultSources())
  ipcMain.handle('novel-test-single-source', (_, id, kw) => testSingleSource(id, kw))
  ipcMain.handle('novel-auto-sniff-rule', async (_, input) => {
    try {
      const res = await autoSniffNovelSource(input)
      return res
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
  ipcMain.handle('novel-export-sources-json', async (_, sourceIds) => {
    const jsonStr = exportSourcesJson(sourceIds)
    const now = new Date()
    const dateStr = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0')
    const timeStr = String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0')
    const timeStamp = `${dateStr}_${timeStr}`

    const countText = sourceIds && sourceIds.length > 0 ? `${sourceIds.length}个_` : ''
    const result = await dialog.showSaveDialog({
      title: '导出书源文件 (完全适配开源阅读 3.0 / Legado)',
      defaultPath: `legado_sources_${countText}${timeStamp}.json`,
      filters: [
        { name: '阅读 3.0 书源规则 (*.json)', extensions: ['json'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try {
      writeFileSync(result.filePath, jsonStr, 'utf-8')
      return { success: true, filePath: result.filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ===== 在线小说：导入自定义 JSON 书源 =====
  ipcMain.handle('novel-import-source', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入自定义书源 (JSON / JSON5)',
      filters: [{ name: '书源配置文件', extensions: ['json', 'json5'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true }
    }
    try {
      const content = readFileSync(result.filePaths[0], 'utf-8')
      const res = importCustomSource(content)
      return res
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ===== 在线小说：聚合搜索 (带流式实时推送) =====
  ipcMain.handle('novel-search', async (event, keyword, sourceId) => {
    try {
      const results = await searchNovels(keyword, sourceId || null, (partialResults) => {
        try {
          event.sender.send('novel-search-partial', partialResults)
        } catch (_) {}
      })
      return { success: true, results }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ===== 在线小说：取消/停止搜索 =====
  ipcMain.handle('novel-cancel-search', () => {
    cancelSearch()
    return true
  })

  // ===== 在线小说：获取章节目录 =====
  ipcMain.handle('novel-get-chapters', async (_, novelUrl, sourceId) => {
    try {
      const data = await getNovelChapters(novelUrl, sourceId)
      return { success: true, ...data }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ===== 在线小说：抓取单章内容（供在线预览试读） =====
  ipcMain.handle('novel-get-content', async (_, chapterUrl, sourceId) => {
    try {
      const content = await getChapterContent(chapterUrl, sourceId)
      return { success: true, content }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ===== 在线小说：开始下载 =====
  ipcMain.handle('novel-start-download', async (_, novelInfo, chapters, sourceId, format, concurrency) => {
    const taskId = randomUUID()
    // 异步执行，立即返回 taskId
    startDownload(taskId, novelInfo, chapters, sourceId, format, concurrency).catch(err => {
      console.error('[下载] 任务失败:', err)
    })
    return { taskId }
  })

  // ===== 在线小说：取消下载 =====
  ipcMain.handle('novel-cancel-download', (_, taskId) => {
    cancelDownload(taskId)
    return true
  })

  // ===== 在线小说：查询所有任务状态 =====
  ipcMain.handle('novel-get-tasks', () => getAllTasks())

  // ===== 在线小说：下载配置管理 (对齐原 config.ini) =====
  ipcMain.handle('novel-get-download-config', () => getDownloadConfig())
  ipcMain.handle('novel-save-download-config', (_, cfg) => saveDownloadConfig(cfg))
  ipcMain.handle('novel-select-download-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择小说下载存放目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })
  ipcMain.handle('novel-open-download-dir', async (_, customPath) => {
    const dir = customPath && existsSync(customPath)
      ? customPath
      : getPortableDownloadsDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    shell.openPath(dir)
    return true
  })

  // ===== 在线小说：下载完成后导入书库 =====
  ipcMain.handle('novel-import-after-download', async (_, filePath) => {
    try {
      if (!existsSync(filePath)) return { success: false, error: '文件不存在' }
      const ext = extname(filePath).toLowerCase()
      const stat = statSync(filePath)
      let meta = { title: basename(filePath, ext), author: '未知', cover: null, description: '' }

      if (ext === '.pdf') {
        try { meta = { ...meta, ...(await extractPdfMeta(filePath)) } } catch (_) {}
      } else if (ext === '.txt') {
        try { meta = { ...meta, ...(await extractTxtMeta(filePath)) } } catch (_) {}
      } else {
        try { meta = { ...meta, ...(await extractEpubMeta(filePath)) } } catch (_) {}
      }

      const format = ext === '.pdf' ? 'PDF' : ext === '.txt' ? 'TXT' : 'EPUB'
      const result = addBook({
        filePath,
        format,
        fileSize: stat.size,
        title: meta.title || basename(filePath, ext),
        author: meta.author || '未知',
        cover: meta.cover || null,
        description: meta.description || '',
        publisher: meta.publisher || '',
        language: meta.language || ''
      })
      return result
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

