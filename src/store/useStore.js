import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // ===== 书库状态 =====
  books: [],
  filteredBooks: [],
  searchQuery: '',
  filterFormat: 'all',
  viewMode: 'grid', // 'grid' | 'list'
  isLoading: false,

  // ===== 当前阅读 =====
  currentBook: null,
  currentView: 'library', // 'library' | 'reader'
  readingProgress: null,
  bookmarks: [],
  showToc: false,
  showBookmarks: false,
  showSettings: false,

  // ===== 阅读设置 =====
  settings: {
    fontSize: 18,
    fontFamily: 'Georgia',
    theme: 'dark',
    lineHeight: 1.8
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
    const { books, searchQuery, filterFormat } = get()
    let filtered = [...books]
    if (filterFormat !== 'all') {
      filtered = filtered.filter(b => b.format === filterFormat)
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
    set({ currentBook: book, currentView: 'reader', showToc: false, showBookmarks: false, showSettings: false })
    window.api?.setLastOpenedBook(book.id)
  },

  closeBook: () => {
    set({ currentBook: null, currentView: 'library', readingProgress: null, bookmarks: [] })
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
  showConfirm: (title, message) => {
    return new Promise(resolve => {
      set({ confirm: { title, message, resolve } })
    })
  },
  closeConfirm: (result) => {
    const { confirm } = get()
    if (confirm?.resolve) confirm.resolve(result)
    set({ confirm: null })
  }
}))
