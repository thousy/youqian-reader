import Store from 'electron-store'
import { existsSync, statSync } from 'fs'


let store = null

export function setupDatabase() {
  store = new Store({
    name: 'youqian-data',
    defaults: {
      books: [],
      categories: [],
      readingProgress: {},
      bookmarks: {},
      settings: {
        fontSize: 18,
        fontFamily: 'Georgia',
        theme: 'dark',
        lineHeight: 1.8,
        lastOpenedBook: null
      }
    }
  })
  console.log('数据库初始化完成:', store.path)
}

export function getStore() {
  return store
}

// ===== 书籍管理 =====

export function getAllBooks() {
  return store.get('books', [])
}

export function addBook(book) {
  const books = getAllBooks()
  // 检查是否已存在
  const exists = books.find(b => b.filePath === book.filePath)
  if (exists) return { success: false, error: '该书籍已在书库中', book: exists }
  
  const newBook = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    addedAt: new Date().toISOString(),
    ...book
  }
  books.push(newBook)
  store.set('books', books)
  return { success: true, book: newBook }
}

export function updateBook(id, updates) {
  const books = getAllBooks()
  const idx = books.findIndex(b => b.id === id)
  if (idx === -1) return false
  books[idx] = { ...books[idx], ...updates }
  store.set('books', books)
  return true
}

export function removeBook(id) {
  const books = getAllBooks().filter(b => b.id !== id)
  store.set('books', books)
  // 清理对应的阅读进度、书签和 locations
  const progress = store.get('readingProgress', {})
  const bookmarks = store.get('bookmarks', {})
  const epubLocations = store.get('epubLocations', {})
  delete progress[id]
  delete bookmarks[id]
  delete epubLocations[id]
  store.set('readingProgress', progress)
  store.set('bookmarks', bookmarks)
  store.set('epubLocations', epubLocations)
  return true
}

export function getBookById(id) {
  return getAllBooks().find(b => b.id === id) || null
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

export function removeBookmark(bookId, bookmarkId) {
  const bookmarks = getBookmarks(bookId).filter(b => b.id !== bookmarkId)
  store.set(`bookmarks.${bookId}`, bookmarks)
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

// ===== 数据备份与恢复 =====

export function exportBackupData() {
  const books = store.get('books', [])
  const categories = store.get('categories', [])
  const readingProgress = store.get('readingProgress', {})
  const bookmarks = store.get('bookmarks', {})
  const settings = store.get('settings', {})

  return {
    version: '1.4.4',
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
    bookmarks
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

  return { success: true, restoredBookIds }
}

export function resetDatabase() {
  store.set('books', [])
  store.set('categories', [])
  store.set('readingProgress', {})
  store.set('bookmarks', {})
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


