import React, { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import { TitleBar } from './components/UI/TitleBar'
import { Sidebar } from './components/UI/Sidebar'
import { LibraryView } from './components/Library/LibraryView'
import { ReaderView } from './components/Reader/ReaderView'
import { Toast } from './components/UI/Toast'
import { ConfirmModal } from './components/UI/ConfirmModal'
import { DropOverlay } from './components/UI/DropOverlay'

export default function App() {
  const { currentView, toast, confirm, setBooks, openBook, showToast, settings, updateSettings, setCategories } = useStore()
  const [dragging, setDragging] = useState(false)

  // 启动时加载数据
  useEffect(() => {
    async function init() {
      try {
        // 加载设置
        const savedSettings = await window.api.getSettings()
        if (savedSettings) updateSettings(savedSettings)

        // 加载书库
        const books = await window.api.getAllBooks()
        setBooks(books)

        // 自动刷新缺失封面的 MOBI/AZW3 书籍
        const booksNeedingCover = books.filter(b => !b.cover && ['MOBI', 'AZW3'].includes(b.format))
        if (booksNeedingCover.length > 0) {
          Promise.all(booksNeedingCover.map(async (b) => {
            try {
              const result = await window.api.refreshBookCover(b.id)
              if (result.success) return { id: b.id, cover: result.cover }
            } catch {}
            return null
          })).then(results => {
            const updated = results.filter(Boolean)
            if (updated.length > 0) {
              window.api.getAllBooks().then(refreshed => setBooks(refreshed))
            }
          })
        }

        // 加载分类
        const categories = await window.api.getCategories()
        if (categories) setCategories(categories)

        // 恢复上次阅读
        const lastBookId = await window.api.getLastOpenedBook()
        if (lastBookId) {
          const lastBook = books.find(b => b.id === lastBookId)
          if (lastBook) {
            const exists = await window.api.fileExists(lastBook.filePath)
            if (exists) openBook(lastBook)
          }
        }
      } catch (e) {
        console.error('初始化失败:', e)
      }
    }
    init()
  }, [])

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

  return (
    <div className="app" data-theme={settings.theme} data-global-theme={settings.globalTheme || 'dark'}>
      <TitleBar />
      <div className="main-layout">
        <Sidebar />
        <div className="main-content">
          {currentView === 'library' ? <LibraryView onImport={importFiles} /> : <ReaderView />}
        </div>
      </div>
      {toast && <Toast {...toast} />}
      {confirm && <ConfirmModal {...confirm} />}
      {dragging && <DropOverlay />}
    </div>
  )
}
