import React, { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import { TitleBar } from './components/UI/TitleBar'
import { Sidebar } from './components/UI/Sidebar'
import { LibraryView } from './components/Library/LibraryView'
import { ReaderView } from './components/Reader/ReaderView'
import { NovelSearchView } from './components/Novel/NovelSearchView'
import { DownloadManagerView } from './components/Novel/DownloadManagerView'
import { SourceEditorView } from './components/Novel/SourceEditorView'
import { Toast } from './components/UI/Toast'
import { ConfirmModal } from './components/UI/ConfirmModal'
import { DropOverlay } from './components/UI/DropOverlay'
import { initCustomFonts } from './utils/fontLoader'

export default function App() {
  const { currentView, currentBook, toast, confirm, setBooks, openBook, showToast, settings, updateSettings, setCategories, showConfirm } = useStore()
  const [dragging, setDragging] = useState(false)

  const params = new URLSearchParams(window.location.search)
  const isReaderWindow = params.get('windowType') === 'reader'
  // ===== 文件关联：检测是否为文件路径打开模式 =====
  const isFileReaderWindow = params.get('windowType') === 'file-reader'
  const filePathParam = params.get('filePath')

  // 启动时加载数据
  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        // 并行加载设置、书库、分类与自定义字体（无依赖关系，无需串行等待）
        const [savedSettings, books, categories] = await Promise.all([
          window.api.getSettings(),
          window.api.getAllBooks(),
          window.api.getCategories(),
          initCustomFonts()
        ])
        if (!mounted) return

        if (savedSettings) updateSettings(savedSettings)
        setBooks(books)
        if (categories) setCategories(categories)

        if (isReaderWindow) {
          // 如果是阅读窗口，自动定位并打开特定图书
          const bookIdParam = params.get('bookId')
          if (bookIdParam) {
            const targetBook = books.find(b => String(b.id) === String(bookIdParam))
            if (targetBook) {
              const exists = await window.api.fileExists(targetBook.filePath)
              if (exists) openBook(targetBook)
            }
          }
        } else if (isFileReaderWindow && filePathParam) {
          // ===== 文件关联：通过文件路径直接打开书籍 =====
          await initFileReader(filePathParam, books)
        }
      } catch (e) {
        console.error('初始化失败:', e)
      }
    }
    init()

    return () => {
      mounted = false
    }
  }, [])

  // ===== 文件关联：注册关闭前询问监听 =====
  useEffect(() => {
    if (!isFileReaderWindow) return

    window.api.onCloseRequested(async () => {
      await handleFileReaderClose()
    })
  }, [isFileReaderWindow])

  // ===== 文件关联：通过文件路径初始化阅读器 =====
  async function initFileReader(filePath, books) {
    try {
      const exists = await window.api.fileExists(filePath)
      if (!exists) {
        showToast('文件不存在或已被移动', 'error')
        return
      }

      // 检查书架中是否已有此书
      const existingBook = books.find(b => b.filePath === filePath)
      if (existingBook) {
        // 已在书架中，直接打开
        const { openBook } = useStore.getState()
        openBook(existingBook)
      } else {
        // 不在书架中，创建临时书籍对象打开
        const { openBookByPath } = useStore.getState()
        openBookByPath(filePath)
      }
    } catch (e) {
      console.error('文件关联打开失败:', e)
      showToast('打开文件失败：' + e.message, 'error')
    }
  }

  // ===== 文件关联：关闭前询问逻辑 =====
  async function handleFileReaderClose() {
    if (!filePathParam) {
      window.api.confirmClose(false)
      return
    }

    try {
      // 再次检查书架（可能阅读过程中通过其他方式添加了）
      const existingBook = await window.api.getBookByPath(filePathParam)
      if (existingBook) {
        // 已在书架，直接关闭
        window.api.confirmClose(false)
        return
      }

      // 未在书架，询问是否添加
      const result = await showConfirm(
        '添加到书架',
        '这本书还没有添加到书架，是否现在添加？',
        {
          buttons: [
            { label: '不添加', value: 'no', className: 'btn btn-secondary' },
            { label: '添加到书架', value: 'yes', className: 'btn btn-primary' }
          ]
        }
      )

      if (result === 'yes') {
        // 导入书籍
        try {
          await window.api.importBooks([filePathParam])
          // 通知主窗口刷新书架（如果主窗口存在）
          window.api.confirmClose(true)
        } catch (e) {
          console.error('添加书籍失败:', e)
          window.api.confirmClose(false)
        }
      } else {
        window.api.confirmClose(false)
      }
    } catch (e) {
      console.error('关闭询问失败:', e)
      window.api.confirmClose(false)
    }
  }

  // 拖拽导入
  useEffect(() => {
    const handleDragOver = (e) => { e.preventDefault(); setDragging(true) }
    const handleDragLeave = () => setDragging(false)
    const handleDrop = async (e) => {
      e.preventDefault()
      setDragging(false)
      const files = Array.from(e.dataTransfer.files)
        .filter(f => /\.(epub|pdf|azw3|mobi|txt)$/i.test(f.name))
        .map(f => f.path)
      if (files.length === 0) { showToast('请拖入支持的书籍格式（EPUB/PDF/AZW3/MOBI/TXT）', 'error'); return }
      await importFiles(files)
    }
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])

  async function importFiles(paths) {
    const { setIsLoading, setBooks, showToast } = useStore.getState()
    setIsLoading(true)
    try {
      const results = await window.api.importBooks(paths)
      const books = await window.api.getAllBooks()
      setBooks(books)
      const success = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      if (success > 0) showToast(`成功导入 ${success} 本书籍${failed > 0 ? `，${failed} 个文件已存在或导入失败` : ''}`, 'success')
      else showToast(`导入失败：${results[0]?.error || '未知错误'}`, 'error')
    } catch (e) {
      showToast('导入失败：' + e.message, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  if (isReaderWindow || isFileReaderWindow) {
    return (
      <div className="app" data-theme={settings.theme} data-global-theme={settings.globalTheme || 'dark'}>
        <TitleBar windowTitle={currentBook ? currentBook.title : '阅读器'} />
        <div className="main-layout" style={{ height: 'calc(100vh - var(--titlebar-height))' }}>
          <div className="main-content" style={{ width: '100%', height: '100%' }}>
            <ReaderView />
          </div>
        </div>
        {toast && <Toast {...toast} />}
        {confirm && <ConfirmModal {...confirm} />}
      </div>
    )
  }
  // 书库主窗口：data-theme 使用 globalTheme 基础值，不受阅读器主题（word/sepia 等）影响
  const libraryTheme = currentView === 'library' ? (settings.globalTheme || 'dark') : settings.theme

  return (
    <div className="app" data-theme={libraryTheme} data-global-theme={settings.globalTheme || 'dark'}>
      <TitleBar />
      <div className="main-layout">
        <Sidebar />
        <div className="main-content">
          {currentView === 'reader'
            ? <ReaderView />
            : currentView === 'novelSearch'
            ? <NovelSearchView />
            : currentView === 'downloadManager'
            ? <DownloadManagerView />
            : currentView === 'sourceEditor'
            ? <SourceEditorView />
            : <LibraryView onImport={importFiles} />
          }
        </div>
      </div>
      {toast && <Toast {...toast} />}
      {confirm && <ConfirmModal {...confirm} />}
      {dragging && <DropOverlay />}
    </div>
  )
}
