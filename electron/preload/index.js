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
  applyReplaceRules: (content, context) => ipcRenderer.invoke('apply-replace-rules', content, context),

  // MOBI/AZW3 内容提取
  extractMobiContent: (path) => ipcRenderer.invoke('extract-mobi-content', path),

  // 阅读进度
  getReadingProgress: (bookId) => ipcRenderer.invoke('get-reading-progress', bookId),
  saveReadingProgress: (bookId, progress) => ipcRenderer.invoke('save-reading-progress', bookId, progress),

  // 书签
  getBookmarks: (bookId) => ipcRenderer.invoke('get-bookmarks', bookId),
  addBookmark: (bookId, bookmark) => ipcRenderer.invoke('add-bookmark', bookId, bookmark),
  removeBookmark: (bookId, bookmarkId) => ipcRenderer.invoke('remove-bookmark', bookId, bookmarkId),

  // 划线高亮与笔记 (Annotations)
  getAnnotations: (bookId) => ipcRenderer.invoke('get-annotations', bookId),
  addAnnotation: (bookId, annotation) => ipcRenderer.invoke('add-annotation', bookId, annotation),
  updateAnnotation: (bookId, annotationId, updates) => ipcRenderer.invoke('update-annotation', bookId, annotationId, updates),
  removeAnnotation: (bookId, annotationId) => ipcRenderer.invoke('remove-annotation', bookId, annotationId),
  clearAnnotations: (bookId) => ipcRenderer.invoke('clear-annotations', bookId),
  exportAnnotationsMarkdown: (data) => ipcRenderer.invoke('export-annotations-markdown', data),

  // 设置
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  getLastOpenedBook: () => ipcRenderer.invoke('get-last-opened-book'),
  setLastOpenedBook: (id) => ipcRenderer.invoke('set-last-opened-book', id),

  // 备份与恢复
  exportBackup: () => ipcRenderer.invoke('export-backup'),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  resetDatabase: () => ipcRenderer.invoke('reset-database'),

  // WebDAV 云端同步
  webdavGetConfig: () => ipcRenderer.invoke('webdav-get-config'),
  webdavSaveConfig: (cfg) => ipcRenderer.invoke('webdav-save-config', cfg),
  webdavTestConnection: (cfg) => ipcRenderer.invoke('webdav-test-connection', cfg),
  webdavSyncUpload: (cfg) => ipcRenderer.invoke('webdav-sync-upload', cfg),
  webdavSyncDownload: (cfg) => ipcRenderer.invoke('webdav-sync-download', cfg),

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
  novelImportCustomSource: (content) => ipcRenderer.invoke('novel-import-custom-source', content),
  novelImportSourceFromUrl: (url) => ipcRenderer.invoke('novel-import-source-from-url', url),
  novelSearch: (keyword, sourceId) => ipcRenderer.invoke('novel-search', keyword, sourceId),
  novelCancelSearch: () => ipcRenderer.invoke('novel-cancel-search'),
  novelGetChapters: (novelUrl, sourceId) => ipcRenderer.invoke('novel-get-chapters', novelUrl, sourceId),
  novelGetContent: (chapterUrl, sourceId) => ipcRenderer.invoke('novel-get-content', chapterUrl, sourceId),
  novelStartDownload: (novelInfo, chapters, sourceId, format, concurrency) => ipcRenderer.invoke('novel-start-download', novelInfo, chapters, sourceId, format, concurrency),
  novelCancelDownload: (taskId) => ipcRenderer.invoke('novel-cancel-download', taskId),
  novelGetTasks: () => ipcRenderer.invoke('novel-get-tasks'),
  novelImportAfterDownload: (filePath) => ipcRenderer.invoke('novel-import-after-download', filePath),
  novelGetDownloadConfig: () => ipcRenderer.invoke('novel-get-download-config'),
  novelSaveDownloadConfig: (cfg) => ipcRenderer.invoke('novel-save-download-config', cfg),
  novelSelectDownloadDir: () => ipcRenderer.invoke('novel-select-download-dir'),
  novelOpenDownloadDir: (path) => ipcRenderer.invoke('novel-open-download-dir', path),
  novelCheckBookUpdate: (bookId) => ipcRenderer.invoke('novel-check-book-update', bookId),
  novelCheckAllUpdates: () => ipcRenderer.invoke('novel-check-all-updates'),
  novelPerformUpdate: (bookId) => ipcRenderer.invoke('novel-perform-update', bookId),
  novelMarkUpdateRead: (bookId) => ipcRenderer.invoke('novel-mark-update-read', bookId),
  // 在线流式追更与离线缓存 (阅读 3.0)
  novelAddToShelf: (novelInfo) => ipcRenderer.invoke('novel-add-to-shelf', novelInfo),
  novelGetStreamChapters: (bookId, forceRefresh) => ipcRenderer.invoke('novel-get-stream-chapters', bookId, forceRefresh),
  novelGetStreamContent: (bookId, chapterIndex, forceFetch) => ipcRenderer.invoke('novel-get-stream-content', bookId, chapterIndex, forceFetch),
  novelPreloadChapters: (bookId, currentIndex, count) => ipcRenderer.invoke('novel-preload-chapters', bookId, currentIndex, count),
  novelCacheStatus: (bookId) => ipcRenderer.invoke('novel-cache-status', bookId),
  novelClearCache: (bookId) => ipcRenderer.invoke('novel-clear-cache', bookId),
  novelStartBatchCache: (bookId, startIndex, count) => ipcRenderer.invoke('novel-start-batch-cache', bookId, startIndex, count),
  novelCancelBatchCache: (bookId) => ipcRenderer.invoke('novel-cancel-batch-cache', bookId),
  novelSearchAlternativeSources: (title, author, currentChapterTitle, currentChapterIndex, blockedSources) => ipcRenderer.invoke('novel-search-alternative-sources', title, author, currentChapterTitle, currentChapterIndex, blockedSources),
  onNovelAlternativeSourceFound: (cb) => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on('novel:onAlternativeSourceFound', listener)
    return () => ipcRenderer.removeListener('novel:onAlternativeSourceFound', listener)
  },
  novelSwitchSource: (bookId, newSourceId, newNovelUrl, currentChapterTitle, currentChapterIndex) => ipcRenderer.invoke('novel-switch-source', bookId, newSourceId, newNovelUrl, currentChapterTitle, currentChapterIndex),
  onBatchCacheProgress: (bookId, cb) => {
    const channel = `novel-batch-cache-progress-${bookId}`
    const listener = (_, data) => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  // 阅读 3.0 (Legado) 替换净化规则管理
  novelGetReplaceRules: () => ipcRenderer.invoke('novel-get-replace-rules'),
  novelSaveReplaceRules: (rules) => ipcRenderer.invoke('novel-save-replace-rules', rules),
  novelAddReplaceRule: (rule) => ipcRenderer.invoke('novel-add-replace-rule', rule),
  novelUpdateReplaceRule: (id, updates) => ipcRenderer.invoke('novel-update-replace-rule', id, updates),
  novelDeleteReplaceRule: (id) => ipcRenderer.invoke('novel-delete-replace-rule', id),
  novelToggleReplaceRule: (id, enabled) => ipcRenderer.invoke('novel-toggle-replace-rule', id, enabled),
  novelImportReplaceRules: (rawData) => ipcRenderer.invoke('novel-import-replace-rules', rawData),
  // 阅读 3.0 (Legado) TXT 目录分章识别规则
  novelGetTxtTocRules: () => ipcRenderer.invoke('novel-get-txt-toc-rules'),
  novelSaveTxtTocRules: (rules) => ipcRenderer.invoke('novel-save-txt-toc-rules', rules),
  novelParseTxtToc: (paragraphs) => ipcRenderer.invoke('novel-parse-txt-toc', paragraphs),
  // 监听下载进度推送
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, data) => cb(data)),
  onSearchPartial: (cb) => ipcRenderer.on('novel-search-partial', (_, data) => cb(data)),
  offSearchPartial: (cb) => ipcRenderer.removeListener('novel-search-partial', cb),
  // 自定义本地字体管理 (Custom Font Management)
  customFontGetList: () => ipcRenderer.invoke('custom-font-get-list'),
  customFontImport: () => ipcRenderer.invoke('custom-font-import'),
  customFontDelete: (fileName) => ipcRenderer.invoke('custom-font-delete', fileName),
  customFontBatchDelete: (fileNames) => ipcRenderer.invoke('custom-font-batch-delete', fileNames),
  customFontReadData: (fileName) => ipcRenderer.invoke('custom-font-read-data', fileName),
  customFontReadBuffer: (fileName) => ipcRenderer.invoke('custom-font-read-buffer', fileName),

  // 应用版本信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
}

contextBridge.exposeInMainWorld('api', api)
