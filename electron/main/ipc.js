import { ipcMain, dialog, shell } from 'electron'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname, basename } from 'path'
import {
  getAllBooks, addBook, removeBook, updateBook, getBookById,
  getReadingProgress, saveReadingProgress,
  getBookmarks, addBookmark, removeBookmark,
  getSettings, saveSettings, getLastOpenedBook, setLastOpenedBook,
  getStore, getEpubLocations, saveEpubLocations
} from './database'
import { extractEpubMeta } from './parsers/epub'
import { extractPdfMeta } from './parsers/pdf'
import { extractMobiMeta, extractMobiContent } from './parsers/mobi'
import { extractTxtMeta, readTxtFile } from './parsers/txt'

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

  // ===== 文件内容读取 =====
  ipcMain.handle('read-file', async (_, filePath) => {
    if (!existsSync(filePath)) throw new Error('文件不存在: ' + filePath)
    return readFileSync(filePath)
  })

  ipcMain.handle('read-file-base64', async (_, filePath) => {
    if (!existsSync(filePath)) throw new Error('文件不存在: ' + filePath)
    return readFileSync(filePath).toString('base64')
  })

  ipcMain.handle('file-exists', (_, filePath) => existsSync(filePath))

  ipcMain.handle('open-external', (_, url) => shell.openExternal(url))

  // ===== TXT 读取（含编码检测）=====
  ipcMain.handle('read-txt-file', async (_, filePath) => {
    return readTxtFile(filePath)
  })

  // ===== MOBI/AZW3 内容提取 =====
  ipcMain.handle('extract-mobi-content', async (_, filePath) => {
    return extractMobiContent(filePath)
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
}
