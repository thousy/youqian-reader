import Store from 'electron-store'
import { existsSync, statSync } from 'fs'
import { getPortableDataDir, resolveBookPath } from './portablePath.js'

let store = null

export function setupDatabase() {
  store = new Store({
    name: 'youqian-data',
    cwd: getPortableDataDir(),
    defaults: {
      books: [],
      categories: [],
      readingProgress: {},
      bookmarks: {},
      annotations: {},
      settings: {
        fontSize: 18,
        fontFamily: 'Georgia',
        theme: 'dark',
        lineHeight: 1.8,
        lastOpenedBook: null
      },
      webdavConfig: {
        url: '',
        username: '',
        password: '',
        autoSync: false,
        lastSyncTime: null
      }
    }
  })
  console.log('便携数据库初始化完成:', store.path)
  autoHealTxtBooksToc()
}

/**
 * 自动纠偏与自愈存量 TXT 书籍的伪前言（将只有书名作者的空前言移除，真正第一章接管段落0）
 */
function autoHealTxtBooksToc() {
  try {
    const books = store.get('books', [])
    if (!Array.isArray(books) || books.length === 0) return
    let changed = false
    const PREFACE_REGEX = /^(前言|序|引言|序言|自序|楔子)$/
    const updated = books.map(book => {
      if (book && book.format === 'TXT' && Array.isArray(book.toc) && book.toc.length > 1) {
        const first = book.toc[0]
        const second = book.toc[1]
        if (first && PREFACE_REGEX.test(first.label?.trim()) && second && second.paraIndex <= 40) {
          console.log(`[Database] 发现书籍 [${book.title}] 存在历史残留伪前言，自动纠偏移除...`)
          const newToc = book.toc.slice(1)
          if (newToc.length > 0) {
            newToc[0] = { ...newToc[0], paraIndex: 0 }
          }
          changed = true
          return { ...book, toc: newToc }
        }
      }
      return book
    })
    if (changed) {
      store.set('books', updated)
      console.log('[Database] 存量 TXT 书籍目录智能自愈完成！')
    }
  } catch (err) {
    console.warn('[Database] 存量书籍自愈异常:', err.message)
  }
}

export function getStore() {
  return store
}

// ===== 书籍管理 =====

export function getAllBooks() {
  const list = store.get('books', [])
  return list.map(b => {
    if (b && b.filePath) {
      const resolved = resolveBookPath(b.filePath)
      if (resolved && resolved !== b.filePath) {
        return { ...b, filePath: resolved }
      }
    }
    return b
  })
}

export function addBook(book) {
  const books = store.get('books', [])
  // 检查是否已存在 (必须严谨避免 undefined === undefined 或 null === null 误判为同一本书)
  const exists = books.find(b => {
    // 1. 本地物理书籍：filePath 必须非空且完全相同
    if (book.filePath && b.filePath && b.filePath === book.filePath) return true
    // 2. 在线追更书籍：novelUrl 必须非空且相同
    if (book.novelUrl && b.novelUrl && b.novelUrl === book.novelUrl) return true
    // 3. 同名同作者判定：书名与作者必须均有明确有效值
    if (book.title && book.author && b.title === book.title && b.author === book.author) return true
    return false
  })
  if (exists) return { success: false, error: '该书籍已在书库中', book: exists }
  
  const newBook = {
    id: book.id || (Date.now().toString() + Math.random().toString(36).substr(2, 9)),
    addedAt: new Date().toISOString(),
    ...book
  }
  books.push(newBook)
  store.set('books', books)
  return { success: true, book: newBook }
}

export function updateBook(id, updates) {
  const books = store.get('books', [])
  const idx = books.findIndex(b => b.id === id)
  if (idx === -1) return false
  books[idx] = { ...books[idx], ...updates }
  store.set('books', books)
  return true
}

export function removeBook(id) {
  const books = store.get('books', []).filter(b => b.id !== id)
  store.set('books', books)
  // 清理对应的阅读进度、书签、笔记和 locations
  const progress = store.get('readingProgress', {})
  const bookmarks = store.get('bookmarks', {})
  const annotations = store.get('annotations', {})
  const epubLocations = store.get('epubLocations', {})
  delete progress[id]
  delete bookmarks[id]
  delete annotations[id]
  delete epubLocations[id]
  store.set('readingProgress', progress)
  store.set('bookmarks', bookmarks)
  store.set('annotations', annotations)
  store.set('epubLocations', epubLocations)
  return true
}

export function getBookById(id) {
  const book = store.get('books', []).find(b => b.id === id)
  if (book && book.filePath) {
    const resolved = resolveBookPath(book.filePath)
    if (resolved && resolved !== book.filePath) {
      return { ...book, filePath: resolved }
    }
  }
  return book || null
}

// ===== 阅读进度 =====

export function getReadingProgress(bookId) {
  return store.get(`readingProgress.${bookId}`, null)
}

export function saveReadingProgress(bookId, progress) {
  store.set(`readingProgress.${bookId}`, {
    ...progress,
    updatedAt: new Date().toISOString()
  })
  // 同步更新书籍的最后阅读时间
  updateBook(bookId, { lastReadAt: new Date().toISOString() })
}

// ===== 书签 =====

export function getBookmarks(bookId) {
  return store.get(`bookmarks.${bookId}`, [])
}

export function addBookmark(bookId, bookmark) {
  const bookmarks = getBookmarks(bookId)
  const newBookmark = {
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    ...bookmark
  }
  bookmarks.push(newBookmark)
  store.set(`bookmarks.${bookId}`, bookmarks)
  return newBookmark
}

export function saveBookmarks(bookId, bookmarks) {
  store.set(`bookmarks.${bookId}`, bookmarks)
  return bookmarks
}

export function removeBookmark(bookId, bookmarkId) {
  const bookmarks = getBookmarks(bookId).filter(b => b.id !== bookmarkId)
  store.set(`bookmarks.${bookId}`, bookmarks)
}

// ===== 划线高亮与笔记 (Annotations) =====

export function getAnnotations(bookId) {
  return store.get(`annotations.${bookId}`, [])
}

export function addAnnotation(bookId, annotation) {
  const list = getAnnotations(bookId)
  const newAnnotation = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 6),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    color: '#ffe066', // 默认高亮黄色
    note: '',
    ...annotation
  }
  list.push(newAnnotation)
  store.set(`annotations.${bookId}`, list)
  return newAnnotation
}

export function updateAnnotation(bookId, annotationId, updates) {
  const list = getAnnotations(bookId)
  const idx = list.findIndex(a => a.id === annotationId)
  if (idx === -1) return null
  list[idx] = {
    ...list[idx],
    ...updates,
    updatedAt: new Date().toISOString()
  }
  store.set(`annotations.${bookId}`, list)
  return list[idx]
}

export function removeAnnotation(bookId, annotationId) {
  const list = getAnnotations(bookId).filter(a => a.id !== annotationId)
  store.set(`annotations.${bookId}`, list)
  return true
}

export function clearAnnotations(bookId) {
  store.set(`annotations.${bookId}`, [])
  return true
}

// ===== 设置 =====

export function getSettings() {
  return store.get('settings', {})
}

export function saveSettings(settings) {
  const current = getSettings()
  store.set('settings', { ...current, ...settings })
}

export function getLastOpenedBook() {
  return store.get('settings.lastOpenedBook', null)
}

export function setLastOpenedBook(bookId) {
  store.set('settings.lastOpenedBook', bookId)
}

// ===== EPUB locations 独立存储 =====

export function getEpubLocations(bookId) {
  return store.get(`epubLocations.${bookId}`, null)
}

export function saveEpubLocations(bookId, locations) {
  store.set(`epubLocations.${bookId}`, locations)
}

// ===== WebDAV 云同步配置 =====

export function getWebdavConfig() {
  return store.get('webdavConfig', {
    url: '',
    username: '',
    password: '',
    autoSync: false,
    lastSyncTime: null
  })
}

export function saveWebdavConfig(config) {
  const current = getWebdavConfig()
  store.set('webdavConfig', { ...current, ...config })
  return true
}

// ===== 数据备份与恢复 =====

export function exportBackupData() {
  const books = store.get('books', [])
  const categories = store.get('categories', [])
  const readingProgress = store.get('readingProgress', {})
  const bookmarks = store.get('bookmarks', {})
  const annotations = store.get('annotations', {})
  const settings = store.get('settings', {})

  return {
    version: '2.1.0',
    exportedAt: new Date().toISOString(),
    settings,
    categories,
    books: books.map(b => ({
      id: b.id,
      title: b.title,
      format: b.format,
      filePath: b.filePath
    })),
    readingProgress,
    bookmarks,
    annotations
  }
}

export function importBackupData(backup) {
  if (!backup || typeof backup !== 'object') {
    return { success: false, error: '备份数据格式不正确' }
  }
  if (!backup.settings || !Array.isArray(backup.books)) {
    return { success: false, error: '备份文件缺少必要字段' }
  }

  // 恢复全局设置
  const currentSettings = store.get('settings', {})
  const { lastOpenedBook, ...importedSettings } = backup.settings
  store.set('settings', {
    ...currentSettings,
    ...importedSettings
  })

  // 恢复书籍分类
  if (Array.isArray(backup.categories)) {
    store.set('categories', backup.categories)
  }

  // 智能书籍配对与合并（书签 & 进度）
  const currentBooks = getAllBooks()
  const currentProgress = store.get('readingProgress', {})
  const currentBookmarks = store.get('bookmarks', {})

  const idMap = {}
  let booksUpdated = false
  const restoredBookIds = []

  for (const backupBook of backup.books) {
    if (!backupBook.id || !backupBook.title || !backupBook.format) continue
    
    const matched = currentBooks.find(b => 
      b.title === backupBook.title && 
      b.format === backupBook.format
    )

    if (matched) {
      idMap[backupBook.id] = matched.id
    } else {
      // 备份中有，但当前书库中没有。检查物理文件是否存在，如果存在则恢复该书籍
      if (backupBook.filePath && existsSync(backupBook.filePath)) {
        try {
          const stat = statSync(backupBook.filePath)
          const restoredBook = {
            id: backupBook.id, // 保持原 id 以匹配进度和书签
            title: backupBook.title,
            format: backupBook.format,
            filePath: backupBook.filePath,
            fileSize: stat.size,
            addedAt: new Date().toISOString(),
            author: '未知',
            cover: null,
            description: '',
            publisher: '',
            language: ''
          }
          currentBooks.push(restoredBook)
          idMap[backupBook.id] = backupBook.id
          restoredBookIds.push(backupBook.id)
          booksUpdated = true
        } catch (e) {
          console.error(`恢复书籍失败 ${backupBook.title}:`, e)
        }
      }
    }
  }

  if (booksUpdated) {
    store.set('books', currentBooks)
  }

  // 合并阅读进度
  if (backup.readingProgress && typeof backup.readingProgress === 'object') {
    for (const [oldId, progress] of Object.entries(backup.readingProgress)) {
      const newId = idMap[oldId]
      if (newId) {
        const currentProg = currentProgress[newId]
        if (!currentProg || (progress.updatedAt && (!currentProg.updatedAt || new Date(progress.updatedAt) > new Date(currentProg.updatedAt)))) {
          currentProgress[newId] = progress
        }
      }
    }
    store.set('readingProgress', currentProgress)
  }

  // 合并书签
  if (backup.bookmarks && typeof backup.bookmarks === 'object') {
    for (const [oldId, oldBookmarks] of Object.entries(backup.bookmarks)) {
      const newId = idMap[oldId]
      if (newId && Array.isArray(oldBookmarks)) {
        if (!currentBookmarks[newId]) {
          currentBookmarks[newId] = []
        }
        
        const existingBookmarks = currentBookmarks[newId]

        for (const ob of oldBookmarks) {
          const isDuplicate = existingBookmarks.some(eb => {
            if (ob.cfi && eb.cfi) return ob.cfi === eb.cfi
            if (ob.page !== undefined && eb.page !== undefined) return ob.page === eb.page
            if (ob.index !== undefined && eb.index !== undefined) return ob.index === eb.index
            return ob.text === eb.text && ob.label === eb.label
          })

          if (!isDuplicate) {
            const newBookmarkId = Date.now().toString() + Math.random().toString(36).substr(2, 5)
            existingBookmarks.push({
              ...ob,
              id: newBookmarkId
            })
          }
        }
      }
    }
    store.set('bookmarks', currentBookmarks)
  }

  // 合并划线高亮与笔记 (Annotations)
  const currentAnnotations = store.get('annotations', {})
  if (backup.annotations && typeof backup.annotations === 'object') {
    for (const [oldId, oldAnnotations] of Object.entries(backup.annotations)) {
      const newId = idMap[oldId]
      if (newId && Array.isArray(oldAnnotations)) {
        if (!currentAnnotations[newId]) {
          currentAnnotations[newId] = []
        }
        const existingAnnotations = currentAnnotations[newId]
        for (const oa of oldAnnotations) {
          const isDuplicate = existingAnnotations.some(ea => {
            if (oa.cfi && ea.cfi) return oa.cfi === ea.cfi
            if (oa.page !== undefined && ea.page !== undefined) return oa.page === ea.page && oa.selectedText === ea.selectedText
            if (oa.index !== undefined && ea.index !== undefined) return oa.index === ea.index && oa.selectedText === ea.selectedText
            return oa.selectedText === ea.selectedText && oa.chapterTitle === ea.chapterTitle
          })

          if (!isDuplicate) {
            const newAnnotationId = Date.now().toString() + Math.random().toString(36).substr(2, 6)
            existingAnnotations.push({
              ...oa,
              id: newAnnotationId
            })
          }
        }
      }
    }
    store.set('annotations', currentAnnotations)
  }

  return { success: true, restoredBookIds }
}

export function resetDatabase() {
  store.set('books', [])
  store.set('categories', [])
  store.set('readingProgress', {})
  store.set('bookmarks', {})
  store.set('annotations', {})
  store.set('epubLocations', {})
  store.set('settings', {
    fontSize: 18,
    fontFamily: 'Georgia',
    theme: 'dark',
    lineHeight: 1.8,
    lastOpenedBook: null
  })
  return { success: true }
}


