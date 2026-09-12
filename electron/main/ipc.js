import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { extname, basename } from 'path'
import { getPortableDownloadsDir, resolveBookPath } from './portablePath.js'
import {
  getAllBooks, addBook, removeBook, updateBook, getBookById,
  getReadingProgress, saveReadingProgress,
  getBookmarks, addBookmark, removeBookmark,
  getAnnotations, addAnnotation, updateAnnotation, removeAnnotation, clearAnnotations,
  getSettings, saveSettings, getLastOpenedBook, setLastOpenedBook,
  getStore, getEpubLocations, saveEpubLocations,
  getWebdavConfig, saveWebdavConfig,
  exportBackupData, importBackupData, resetDatabase
} from './database'
import { testWebdavConnection, uploadBackupToWebdav, downloadBackupFromWebdav } from './webdavClient.js'
import { extractEpubMeta } from './parsers/epub'
import { extractPdfMeta } from './parsers/pdf'
import { extractMobiMeta, extractMobiContent } from './parsers/mobi'
import { extractTxtMeta, readTxtFile } from './parsers/txt'
import {
  searchNovels, getNovelChapters, getChapterContent, getAllSourcesInfo, getAllSourcesDetail,
  saveOrUpdateSource, deleteSource, clearAllSources, resetDefaultSources, testSingleSource, toggleSourceEnabled, exportSourcesJson,
  importCustomSource, importSourceFromUrl, cancelSearch, autoSniffNovelSource
} from './novel/sourceManager'
import {
  startDownload, cancelDownload, getTaskStatus, getAllTasks,
  getDownloadConfig, saveDownloadConfig
} from './novel/downloader'
import {
  checkBookUpdate, checkAllBooksUpdate, performIncrementalUpdate,
  addSerialBookToShelf, getOrFetchBookChapters, getOrFetchChapterContent,
  preloadNextChapters, getBookCacheStatus, clearBookOfflineCache,
  startOfflineBatchCache, cancelOfflineBatchCache,
  searchAlternativeSources, switchBookSource, markBookUpdateRead
} from './novel/novelUpdater.js'
import {
  getReplaceRules, saveReplaceRules, addReplaceRule, updateReplaceRule, deleteReplaceRule, toggleReplaceRule, importLegadoReplaceRules,
  applyReplaceRules
} from './novel/replaceRuleEngine.js'
import {
  getTxtTocRules, saveTxtTocRules, parseTxtChaptersWithRules
} from './novel/txtTocEngine.js'
import {
  getCustomFonts, openAndImportFontFiles, deleteCustomFont, deleteCustomFonts, readCustomFontDataUrl, readCustomFontBuffer
} from './fontManager.js'
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

  // ===== TXT 读取（含编码检测，毫秒级秒开）=====
  ipcMain.handle('read-txt-file', async (_, filePath) => {
    return await readTxtFile(resolveBookPath(filePath))
  })

  // ===== 单章节/片段替换净化规则处理 =====
  ipcMain.handle('apply-replace-rules', (_, content, context) => {
    return applyReplaceRules(content, context)
  })

  // ===== MOBI/AZW3 内容提取（含阅读 3.0 全局替换净化）=====
  ipcMain.handle('extract-mobi-content', async (_, filePath) => {
    const raw = await extractMobiContent(resolveBookPath(filePath))
    if (!raw) return null
    if (typeof raw === 'object' && raw.html) {
      return {
        ...raw,
        html: applyReplaceRules(raw.html, { bookTitle: basename(filePath) })
      }
    }
    return raw
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

  // ===== 划线高亮与笔记 (Annotations) =====
  ipcMain.handle('get-annotations', (_, bookId) => getAnnotations(bookId))
  ipcMain.handle('add-annotation', (_, bookId, annotation) => addAnnotation(bookId, annotation))
  ipcMain.handle('update-annotation', (_, bookId, annotationId, updates) => updateAnnotation(bookId, annotationId, updates))
  ipcMain.handle('remove-annotation', (_, bookId, annotationId) => removeAnnotation(bookId, annotationId))
  ipcMain.handle('clear-annotations', (_, bookId) => clearAnnotations(bookId))

  // 导出划线笔记为 Markdown 文件
  ipcMain.handle('export-annotations-markdown', async (_, { bookTitle, bookAuthor, annotations }) => {
    try {
      const defaultFileName = `${(bookTitle || '阅读笔记').replace(/[\\/:*?"<>|]/g, '_')}_笔记.md`
      const result = await dialog.showSaveDialog({
        title: '导出划线与读书笔记',
        defaultPath: defaultFileName,
        filters: [{ name: 'Markdown 文档', extensions: ['md'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, error: '用户取消了导出' }

      let content = `# 📖 《${bookTitle || '未命名书籍'}》读书笔记\n\n`
      if (bookAuthor) content += `> **作者**：${bookAuthor}\n`
      content += `> **导出时间**：${new Date().toLocaleString()}\n`
      content += `> **划线与笔记总数**：${annotations.length} 条\n\n---\n\n`

      // 按章节名称/索引聚合
      const grouped = {}
      for (const ann of annotations) {
        const key = ann.chapterTitle || '正文摘录'
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(ann)
      }

      for (const [chapter, items] of Object.entries(grouped)) {
        content += `## 📌 ${chapter}\n\n`
        for (const item of items) {
          content += `> ${item.selectedText.trim().replace(/\n+/g, '\n> ')}\n\n`
          if (item.note && item.note.trim()) {
            content += `💭 **想法**：${item.note.trim()}\n\n`
          }
          const time = item.createdAt ? new Date(item.createdAt).toLocaleString() : ''
          if (time) {
            content += `*⏱ 记录于 ${time}*\n\n`
          }
          content += `---\n\n`
        }
      }

      writeFileSync(result.filePath, content, 'utf-8')
      return { success: true, filePath: result.filePath }
    } catch (e) {
      console.error('导出笔记失败:', e)
      return { success: false, error: e.message }
    }
  })

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

  // ===== WebDAV 云端同步 =====
  ipcMain.handle('webdav-get-config', () => getWebdavConfig())
  ipcMain.handle('webdav-save-config', (_, config) => { saveWebdavConfig(config); return true })
  ipcMain.handle('webdav-test-connection', async (_, config) => testWebdavConnection(config))
  ipcMain.handle('webdav-sync-upload', async (_, config) => {
    try {
      const cfg = config || getWebdavConfig()
      if (!cfg || !cfg.url) return { success: false, error: '未配置 WebDAV 服务器地址' }
      const backupData = exportBackupData()
      const uploadRes = await uploadBackupToWebdav(cfg, backupData)
      if (uploadRes.success) {
        saveWebdavConfig({ lastSyncTime: uploadRes.uploadedAt })
      }
      return uploadRes
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('webdav-sync-download', async (_, config) => {
    try {
      const cfg = config || getWebdavConfig()
      if (!cfg || !cfg.url) return { success: false, error: '未配置 WebDAV 服务器地址' }
      const downloadRes = await downloadBackupFromWebdav(cfg)
      if (!downloadRes.success) return downloadRes

      const importRes = importBackupData(downloadRes.backup)
      if (importRes.success) {
        saveWebdavConfig({ lastSyncTime: new Date().toISOString() })
      }
      return importRes
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

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

  ipcMain.handle('novel-import-custom-source', async (_, content) => {
    try {
      if (!content || typeof content !== 'string') return { success: false, error: '书源内容为空' }
      return importCustomSource(content)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('novel-import-source-from-url', async (_, url) => {
    try {
      if (!url || typeof url !== 'string') return { success: false, error: '书源网络链接不能为空' }
      return await importSourceFromUrl(url.trim())
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

  // ===== 连载小说：一键追更与增量更新 =====
  ipcMain.handle('novel-check-book-update', (_, bookId) => checkBookUpdate(bookId))
  ipcMain.handle('novel-check-all-updates', () => checkAllBooksUpdate())
  ipcMain.handle('novel-perform-update', (_, bookId) => performIncrementalUpdate(bookId))
  ipcMain.handle('novel-mark-update-read', (_, bookId) => markBookUpdateRead(bookId))

  // ===== 在线流式追书与离线缓存系统 (类似阅读 3.0) =====
  ipcMain.handle('novel-add-to-shelf', (_, novelInfo) => addSerialBookToShelf(novelInfo))
  ipcMain.handle('novel-get-stream-chapters', (_, bookId, forceRefresh) => getOrFetchBookChapters(bookId, forceRefresh))
  ipcMain.handle('novel-get-stream-content', (_, bookId, chapterIndex, forceFetch) => getOrFetchChapterContent(bookId, chapterIndex, forceFetch))
  ipcMain.handle('novel-preload-chapters', (_, bookId, currentIndex, count) => preloadNextChapters(bookId, currentIndex, count))
  ipcMain.handle('novel-cache-status', (_, bookId) => getBookCacheStatus(bookId))
  ipcMain.handle('novel-clear-cache', (_, bookId) => clearBookOfflineCache(bookId))
  ipcMain.handle('novel-start-batch-cache', (event, bookId, startIndex, count) => {
    return startOfflineBatchCache(bookId, startIndex, count, (progress) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send(`novel-batch-cache-progress-${bookId}`, progress)
        }
      } catch (_) {}
    })
  })
  ipcMain.handle('novel-cancel-batch-cache', (_, bookId) => cancelOfflineBatchCache(bookId))
  ipcMain.handle('novel-search-alternative-sources', (event, title, author, currentChapterTitle, currentChapterIndex, blockedSources) => {
    return searchAlternativeSources(title, author, currentChapterTitle, currentChapterIndex, blockedSources, (item) => {
      try {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('novel:onAlternativeSourceFound', item)
        }
      } catch (_) {}
    })
  })
  ipcMain.handle('novel-switch-source', (_, bookId, newSourceId, newNovelUrl, currentChapterTitle, currentChapterIndex) => switchBookSource(bookId, newSourceId, newNovelUrl, currentChapterTitle, currentChapterIndex))

  // ===== 阅读 3.0 (Legado) 标准替换净化规则 =====
  ipcMain.handle('novel-get-replace-rules', () => getReplaceRules())
  ipcMain.handle('novel-save-replace-rules', (_, rules) => saveReplaceRules(rules))
  ipcMain.handle('novel-add-replace-rule', (_, rule) => addReplaceRule(rule))
  ipcMain.handle('novel-update-replace-rule', (_, id, updates) => updateReplaceRule(id, updates))
  ipcMain.handle('novel-delete-replace-rule', (_, id) => deleteReplaceRule(id))
  ipcMain.handle('novel-toggle-replace-rule', (_, id, enabled) => toggleReplaceRule(id, enabled))
  ipcMain.handle('novel-import-replace-rules', (_, rawData) => importLegadoReplaceRules(rawData))

  // ===== 阅读 3.0 (Legado) TXT 目录分章识别规则 =====
  ipcMain.handle('novel-get-txt-toc-rules', () => getTxtTocRules())
  ipcMain.handle('novel-save-txt-toc-rules', (_, rules) => saveTxtTocRules(rules))
  ipcMain.handle('novel-parse-txt-toc', (_, paragraphs) => parseTxtChaptersWithRules(paragraphs))

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

  // ===== 系统与版本信息 =====
  ipcMain.handle('get-app-version', () => {
    return app.getVersion() || '2.1.0'
  })

  // ===== 用户自定义字体管理 (Custom Font Management) =====
  ipcMain.handle('custom-font-get-list', async () => {
    return getCustomFonts()
  })

  ipcMain.handle('custom-font-import', async () => {
    return await openAndImportFontFiles()
  })

  ipcMain.handle('custom-font-delete', async (_, fileName) => {
    return deleteCustomFont(fileName)
  })

  ipcMain.handle('custom-font-batch-delete', async (_, fileNames) => {
    return deleteCustomFonts(fileNames)
  })

  ipcMain.handle('custom-font-read-data', async (_, fileName) => {
    return readCustomFontDataUrl(fileName)
  })

  ipcMain.handle('custom-font-read-buffer', async (_, fileName) => {
    return readCustomFontBuffer(fileName)
  })
}

