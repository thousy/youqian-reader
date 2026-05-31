import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'

const FORMAT_COLORS = {
  EPUB: '#4ade80', PDF: '#f87171', AZW3: '#fb923c', MOBI: '#a78bfa', TXT: '#60a5fa'
}

const FORMAT_ICONS = {
  EPUB: '📖', PDF: '📄', AZW3: '📱', MOBI: '📚', TXT: '📝'
}

export function BookCard({ book, onClick, onDelete }) {
  const { books, setBooks, categories, showToast, setCategories } = useStore()
  const [showPopover, setShowPopover] = useState(false)
  const [isCreatingInPopover, setIsCreatingInPopover] = useState(false)
  const [popoverCatName, setPopoverCatName] = useState('')

  // 外部点击关闭气泡
  useEffect(() => {
    if (!showPopover) return
    const handleOutsideClick = () => {
      setShowPopover(false)
      setIsCreatingInPopover(false)
    }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [showPopover])

  // 修改分类分配
  const handleSetCategory = async (catId, e) => {
    e.stopPropagation()
    try {
      await window.api.updateBook(book.id, { categoryId: catId })
      const updatedBooks = books.map(b => b.id === book.id ? { ...b, categoryId: catId } : b)
      setBooks(updatedBooks)
      showToast('分类已更新', 'success')
      setShowPopover(false)
    } catch (err) {
      showToast('更新分类失败: ' + err.message, 'error')
    }
  }

  // 直接在 Popover 中新建分类并归档
  const handleCreateCategory = async (e) => {
    e.stopPropagation()
    const name = popoverCatName.trim()
    if (!name) return

    if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      showToast('分类已存在', 'error')
      return
    }

    const newCatId = 'cat_' + Date.now() + Math.random().toString(36).substr(2, 4)
    const newCat = { id: newCatId, name }
    const updatedCats = [...categories, newCat]
    
    try {
      await window.api.saveCategories(updatedCats)
      setCategories(updatedCats)
      
      // 直接将当前书籍归入此新分类
      await window.api.updateBook(book.id, { categoryId: newCatId })
      const updatedBooks = books.map(b => b.id === book.id ? { ...b, categoryId: newCatId } : b)
      setBooks(updatedBooks)
      
      setPopoverCatName('')
      setIsCreatingInPopover(false)
      setShowPopover(false)
      showToast(`已创建分类并归档`, 'success')
    } catch (err) {
      showToast('操作失败: ' + err.message, 'error')
    }
  }

  return (
    <div className="book-card" onClick={onClick} id={`book-card-${book.id}`} style={{ position: 'relative' }}>
      <div className="book-cover">
        {book.cover ? (
          <img src={book.cover} alt={book.title} loading="lazy" />
        ) : (
          <div className="book-cover-placeholder">
            <span style={{ fontSize: '32px' }}>{FORMAT_ICONS[book.format] || '📖'}</span>
            <div className="book-cover-title">{book.title}</div>
            <div className="book-cover-author">{book.author}</div>
          </div>
        )}
        <div className="book-format-badge" style={{ color: FORMAT_COLORS[book.format] || 'var(--accent-light)' }}>
          {book.format}
        </div>
      </div>
      <div className="book-info">
        <div className="book-title">{book.title}</div>
        <div className="book-author">{book.author}</div>
      </div>
      
      {/* 悬停动作层 */}
      <div className="book-card-hover-overlay">
        <button className="book-action-btn" title="阅读" onClick={onClick}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        </button>
        
        {/* 修改分类按钮 */}
        <button 
          className={`book-action-btn category ${showPopover ? 'active' : ''}`}
          title="修改分类" 
          onClick={(e) => {
            e.stopPropagation()
            setShowPopover(prev => !prev)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        <button className="book-action-btn delete" title="删除" onClick={onDelete}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>

      {/* 分类管理 Popover 气泡弹出层 */}
      {showPopover && (
        <div className="category-popover" onClick={e => e.stopPropagation()}>
          <div className="popover-title">移至分类</div>
          <div className="popover-list">
            {/* 未分类项 */}
            <div 
              className={`popover-item ${!book.categoryId ? 'active' : ''}`}
              onClick={(e) => handleSetCategory(null, e)}
            >
              <span className="popover-item-dot" />
              未分类
            </div>
            
            {/* 自定义分类项 */}
            {categories.map(cat => (
              <div 
                key={cat.id}
                className={`popover-item ${book.categoryId === cat.id ? 'active' : ''}`}
                onClick={(e) => handleSetCategory(cat.id, e)}
              >
                <span className="popover-item-dot" />
                {cat.name}
              </div>
            ))}
          </div>

          <div className="popover-divider" />

          {/* 新增分类内联入口 */}
          {isCreatingInPopover ? (
            <div className="popover-new-cat-panel">
              <input
                type="text"
                className="popover-new-input"
                placeholder="新分类名称"
                value={popoverCatName}
                onChange={e => setPopoverCatName(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateCategory(e)
                  if (e.key === 'Escape') setIsCreatingInPopover(false)
                }}
              />
              <div className="popover-new-actions">
                <button className="popover-new-btn confirm" onClick={handleCreateCategory}>创建</button>
                <button className="popover-new-btn cancel" onClick={(e) => { e.stopPropagation(); setIsCreatingInPopover(false); }}>取消</button>
              </div>
            </div>
          ) : (
            <button className="popover-add-trigger" onClick={(e) => { e.stopPropagation(); setIsCreatingInPopover(true); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新建分类
            </button>
          )}
        </div>
      )}
    </div>
  )
}
