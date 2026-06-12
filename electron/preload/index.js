import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 窗口控制
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximized: (cb) => ipcRenderer.on('window-maximized', (_, v) => cb(v)),
  openBookWindow: (bookId) => ipcRenderer.invoke('open-book-window', bookId),

  // 文件选择
  selectBooks: () => ipcRenderer.invoke('select-books'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // 书籍导入
  importBooks: (paths) => ipcRenderer.invoke('import-books', paths),

  // 书库
  getAllBooks: () => ipcRenderer.invoke('get-all-books'),
  removeBook: (id) => ipcRenderer.invoke('remove-book', id),
  updateBook: (id, updates) => ipcRenderer.invoke('update-book', id, updates),

  // 文件读取
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  readFileBase64: (path) => ipcRenderer.invoke('read-file-base64', path),
  fileExists: (path) => ipcRenderer.invoke('file-exists', path),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // TXT 读取
  readTxtFile: (path) => ipcRenderer.invoke('read-txt-file', path),

  // MOBI/AZW3 内容提取
  extractMobiContent: (path) => ipcRenderer.invoke('extract-mobi-content', path),

  // 阅读进度
  getReadingProgress: (bookId) => ipcRenderer.invoke('get-reading-progress', bookId),
  saveReadingProgress: (bookId, progress) => ipcRenderer.invoke('save-reading-progress', bookId, progress),

  // 书签
  getBookmarks: (bookId) => ipcRenderer.invoke('get-bookmarks', bookId),
  addBookmark: (bookId, bookmark) => ipcRenderer.invoke('add-bookmark', bookId, bookmark),
  removeBookmark: (bookId, bookmarkId) => ipcRenderer.invoke('remove-bookmark', bookId, bookmarkId),

  // 设置
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  getLastOpenedBook: () => ipcRenderer.invoke('get-last-opened-book'),
  setLastOpenedBook: (id) => ipcRenderer.invoke('set-last-opened-book', id),

  // 分类管理
  getCategories: () => ipcRenderer.invoke('get-categories'),
  saveCategories: (cats) => ipcRenderer.invoke('save-categories', cats),

  // EPUB locations 独立存储
  getEpubLocations: (bookId) => ipcRenderer.invoke('get-epub-locations', bookId),
  saveEpubLocations: (bookId, locations) => ipcRenderer.invoke('save-epub-locations', bookId, locations),

  // 封面刷新
  refreshBookCover: (bookId) => ipcRenderer.invoke('refresh-book-cover', bookId),

  // 调试日志
  logToServer: (type, ...args) => ipcRenderer.invoke('log-to-server', type, ...args),
}

contextBridge.exposeInMainWorld('api', api)
