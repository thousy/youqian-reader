import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 窗口控制
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximized: (cb) => ipcRenderer.on('window-maximized', (_, v) => cb(v)),
  openBookWindow: (bookId) => ipcRenderer.invoke('open-book-window', bookId),
  openFileReaderWindow: (filePath) => ipcRenderer.invoke('open-file-reader-window', filePath),

  // 文件关联：按文件路径查找书架中的书籍
  getBookByPath: (filePath) => ipcRenderer.invoke('get-book-by-path', filePath),
  // 文件关联：监听主进程发来的关闭询问信号（仅文件关联窗口使用）
  onCloseRequested: (cb) => ipcRenderer.on('file-reader-close-requested', () => cb()),
  // 文件关联：将用户关闭决策回传主进程
  confirmClose: (addToLibrary) => ipcRenderer.send('file-reader-close-decision', { addToLibrary }),

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

  // 备份与恢复
  exportBackup: () => ipcRenderer.invoke('export-backup'),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  resetDatabase: () => ipcRenderer.invoke('reset-database'),

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

  // ===== 在线小说搜索与下载 =====
  novelGetSources: () => ipcRenderer.invoke('novel-get-sources'),
  novelGetSourcesDetail: () => ipcRenderer.invoke('novel-get-sources-detail'),
  novelToggleSource: (id, enabled) => ipcRenderer.invoke('novel-toggle-source', id, enabled),
  novelSaveSource: (ruleObj) => ipcRenderer.invoke('novel-save-source', ruleObj),
  novelDeleteSource: (id) => ipcRenderer.invoke('novel-delete-source', id),
  novelClearAllSources: () => ipcRenderer.invoke('novel-clear-all-sources'),
  novelResetDefaultSources: () => ipcRenderer.invoke('novel-reset-default-sources'),
  novelTestSingleSource: (id, kw) => ipcRenderer.invoke('novel-test-single-source', id, kw),
  novelAutoSniffRule: (input) => ipcRenderer.invoke('novel-auto-sniff-rule', input),
  novelExportSourcesJson: (sourceIds) => ipcRenderer.invoke('novel-export-sources-json', sourceIds),
  novelImportSource: () => ipcRenderer.invoke('novel-import-source'),
  novelSearch: (keyword, sourceId) => ipcRenderer.invoke('novel-search', keyword, sourceId),
  novelCancelSearch: () => ipcRenderer.invoke('novel-cancel-search'),
  novelGetChapters: (novelUrl, sourceId) => ipcRenderer.invoke('novel-get-chapters', novelUrl, sourceId),
  novelGetContent: (chapterUrl, sourceId) => ipcRenderer.invoke('novel-get-content', chapterUrl, sourceId),
  novelStartDownload: (novelInfo, chapters, sourceId, format) => ipcRenderer.invoke('novel-start-download', novelInfo, chapters, sourceId, format),
  novelCancelDownload: (taskId) => ipcRenderer.invoke('novel-cancel-download', taskId),
  novelGetTasks: () => ipcRenderer.invoke('novel-get-tasks'),
  novelImportAfterDownload: (filePath) => ipcRenderer.invoke('novel-import-after-download', filePath),
  novelGetDownloadConfig: () => ipcRenderer.invoke('novel-get-download-config'),
  novelSaveDownloadConfig: (cfg) => ipcRenderer.invoke('novel-save-download-config', cfg),
  novelSelectDownloadDir: () => ipcRenderer.invoke('novel-select-download-dir'),
  novelOpenDownloadDir: (path) => ipcRenderer.invoke('novel-open-download-dir', path),
  // 监听下载进度推送
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, data) => cb(data)),
  offDownloadProgress: (cb) => ipcRenderer.removeListener('download-progress', cb),
  onSearchPartial: (cb) => ipcRenderer.on('novel-search-partial', (_, data) => cb(data)),
  offSearchPartial: (cb) => ipcRenderer.removeListener('novel-search-partial', cb),
}

contextBridge.exposeInMainWorld('api', api)
