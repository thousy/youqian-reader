import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // ===== 书库状态 =====
  books: [],
  filteredBooks: [],
  categories: [],
  selectedCategoryId: 'all',
  searchQuery: '',
  filterFormat: 'all',
  viewMode: 'grid', // 'grid' | 'list'
  isLoading: false,

  // ===== 当前阅读 =====
  currentBook: null,
  currentView: 'library', // 'library' | 'reader' | 'novelSearch'
  readingProgress: null,
  bookmarks: [],
  showToc: false,
  showBookmarks: false,
  showSettings: false,

  // ===== 阅读设置 =====
  settings: {
    fontSize: 18,
    fontFamily: 'Noto Serif SC',
    theme: 'dark',
    lineHeight: 1.8,
    globalTheme: 'dark',
    layoutMode: 'horizontal' // 'horizontal' | 'vertical'
  },

  // ===== Toast 通知 =====
  toast: null,

  // ===== 确认对话框 =====
  confirm: null,

  // ===== 书库操作 =====
  setBooks: (books) => {
    set({ books })
    get().applyFilter()
  },

  applyFilter: () => {
    const { books, searchQuery, filterFormat, selectedCategoryId } = get()
    let filtered = [...books]
    if (filterFormat !== 'all') {
      filtered = filtered.filter(b => b.format === filterFormat)
    }
    if (selectedCategoryId === 'uncategorized') {
      filtered = filtered.filter(b => !b.categoryId)
    } else if (selectedCategoryId !== 'all') {
      filtered = filtered.filter(b => b.categoryId === selectedCategoryId)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(b =>
        b.title?.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q)
      )
    }
    // 按最后阅读时间或添加时间降序
    filtered.sort((a, b) => {
      const ta = new Date(a.lastReadAt || a.addedAt).getTime()
      const tb = new Date(b.lastReadAt || b.addedAt).getTime()
      return tb - ta
    })
    set({ filteredBooks: filtered })
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q })
    get().applyFilter()
  },

  setFilterFormat: (f) => {
    set({ filterFormat: f })
    get().applyFilter()
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setIsLoading: (v) => set({ isLoading: v }),

  // ===== 阅读操作 =====
  openBook: (book) => {
    const params = new URLSearchParams(window.location.search)
    const isReaderWindow = params.get('windowType') === 'reader'
    const isFileReaderWindow = params.get('windowType') === 'file-reader'

    if (!isReaderWindow && !isFileReaderWindow) {
      window.api?.openBookWindow(book.id)
      return
    }

    set({ currentBook: book, currentView: 'reader', showToc: false, showBookmarks: false, showSettings: false })
    window.api?.setLastOpenedBook(book.id)
  },

  // ===== 文件关联：通过文件路径直接打开（临时阅读，无 bookId）=====
  openBookByPath: (filePath) => {
    const ext = filePath.split('.').pop().toUpperCase()
    const fileName = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
    const tempBook = {
      id: null,
      filePath,
      format: ext,
      title: fileName,
      author: '未知',
      cover: null,
      _isTemp: true // 标记为临时书籍（未入库）
    }
    set({ currentBook: tempBook, currentView: 'reader', showToc: false, showBookmarks: false, showSettings: false })
  },

  closeBook: () => {
    const params = new URLSearchParams(window.location.search)
    const isReaderWindow = params.get('windowType') === 'reader'
    const isFileReaderWindow = params.get('windowType') === 'file-reader'
    
    if (isReaderWindow || isFileReaderWindow) {
      window.api?.close()
      return
    }
    
    try { document.documentElement.removeAttribute('data-theme') } catch (_) {}
    set({ currentBook: null, currentView: 'library', readingProgress: null, bookmarks: [] })
  },

  setCurrentView: (view) => {
    if (view !== 'reader') {
      try { document.documentElement.removeAttribute('data-theme') } catch (_) {}
    }
    set({ currentView: view })
  },


  setReadingProgress: (progress) => set({ readingProgress: progress }),

  setBookmarks: (bookmarks) => set({ bookmarks }),

  addBookmarkToStore: (bookmark) => {
    set(s => ({ bookmarks: [...s.bookmarks, bookmark] }))
  },

  removeBookmarkFromStore: (id) => {
    set(s => ({ bookmarks: s.bookmarks.filter(b => b.id !== id) }))
  },

  // ===== UI 状态 =====
  setShowToc: (v) => set({ showToc: v }),
  setShowBookmarks: (v) => set({ showBookmarks: v }),
  setShowSettings: (v) => set({ showSettings: v }),

  updateSettings: (s) => {
    set(prev => ({ settings: { ...prev.settings, ...s } }))
    window.api?.saveSettings({ ...get().settings, ...s })
  },

  // ===== Toast =====
  showToast: (message, type = 'info') => {
    set({ toast: { message, type, id: Date.now() } })
    setTimeout(() => set({ toast: null }), 3000)
  },

  // ===== Confirm =====
  showConfirm: (title, message, options = {}) => {
    return new Promise(resolve => {
      set({ confirm: { title, message, resolve, ...options } })
    })
  },
  closeConfirm: (result) => {
    const { confirm } = get()
    if (confirm?.resolve) confirm.resolve(result)
    set({ confirm: null })
  },

  // ===== 分类管理 =====
  setCategories: (categories) => set({ categories }),
  setSelectedCategoryId: (id) => {
    set({ selectedCategoryId: id })
    get().applyFilter()
  },

  // ===== 全局书源检测与多选状态 (跨 View 切换持续驻留) =====
  batchTesting: false,
  batchProgress: { current: 0, total: 0, validCount: 0, invalidCount: 0 },
  stopBatchRef: { current: false },
  selectedSourceIds: new Set(),
  invalidSourceIds: new Set(),

  setBatchTesting: (v) => set({ batchTesting: v }),
  setBatchProgress: (p) => set(s => ({ batchProgress: { ...s.batchProgress, ...p } })),
  setSelectedSourceIds: (setOrFn) => set(s => ({
    selectedSourceIds: typeof setOrFn === 'function' ? setOrFn(s.selectedSourceIds) : setOrFn
  })),
  setInvalidSourceIds: (setOrFn) => set(s => ({
    invalidSourceIds: typeof setOrFn === 'function' ? setOrFn(s.invalidSourceIds) : setOrFn
  })),
  stopBatchTest: () => {
    const { stopBatchRef } = get()
    stopBatchRef.current = true
    set({ batchTesting: false })
  }
}))
