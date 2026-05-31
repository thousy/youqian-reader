import Store from 'electron-store'

let store = null

export function setupDatabase() {
  store = new Store({
    name: 'inkwell-data',
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
  // 清理对应的阅读进度和书签
  const progress = store.get('readingProgress', {})
  const bookmarks = store.get('bookmarks', {})
  delete progress[id]
  delete bookmarks[id]
  store.set('readingProgress', progress)
  store.set('bookmarks', bookmarks)
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
