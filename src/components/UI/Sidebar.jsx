import React from 'react'
import { useStore } from '../../store/useStore'

const FORMAT_COLORS = {
  EPUB: '#4ade80', PDF: '#f87171', AZW3: '#fb923c', MOBI: '#a78bfa', TXT: '#60a5fa'
}

export function Sidebar() {
  const { books, currentView, openBook, setBooks, showToast } = useStore()

  // 最近阅读的书（按 lastReadAt 降序）
  const recentBooks = [...books]
    .filter(b => b.lastReadAt)
    .sort((a, b) => new Date(b.lastReadAt) - new Date(a.lastReadAt))
    .slice(0, 8)

  const handleAddClick = async () => {
    const paths = await window.api.selectBooks()
    if (!paths?.length) return
    const { setIsLoading, showToast } = useStore.getState()
    setIsLoading(true)
    try {
      const results = await window.api.importBooks(paths)
      const allBooks = await window.api.getAllBooks()
      setBooks(allBooks)
      const success = results.filter(r => r.success).length
      if (success > 0) showToast(`已添加 ${success} 本书籍`, 'success')
      else showToast(results[0]?.error || '书籍已存在', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button className="sidebar-add-btn" id="add-books-btn" onClick={handleAddClick}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          添加书籍
        </button>
      </div>

      <div className="sidebar-nav">
        <button className={`nav-item ${currentView === 'library' ? 'active' : ''}`}
          onClick={() => useStore.getState().closeBook()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          我的书库
          <span style={{marginLeft:'auto',fontSize:'11px',background:'var(--bg-hover)',padding:'1px 7px',borderRadius:'10px',color:'var(--text-muted)'}}>
            {books.length}
          </span>
        </button>
      </div>

      {recentBooks.length > 0 && (
        <>
          <div className="sidebar-section-title">最近阅读</div>
          <div className="sidebar-recent">
            {recentBooks.map(book => (
              <div key={book.id} className="recent-book-item" onClick={() => openBook(book)}>
                <div className="recent-book-cover">
                  {book.cover
                    ? <img src={book.cover} alt="" />
                    : <span style={{color: FORMAT_COLORS[book.format] || 'var(--accent)'}}>{book.format?.slice(0,1)}</span>
                  }
                </div>
                <div className="recent-book-info">
                  <div className="recent-book-title">{book.title}</div>
                  <div className="recent-book-author">{book.author}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
