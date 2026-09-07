import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import defaultBookCover from '../../logo.png'

const FORMAT_COLORS = {
  EPUB: '#4ade80', PDF: '#f87171', AZW3: '#fb923c', MOBI: '#a78bfa', TXT: '#60a5fa', ONLINE: '#38bdf8'
}

export function BookCard({ book, onClick, onDelete, onShowInfo }) {
  const { books, setBooks, categories, showToast, setCategories } = useStore()
  const [showPopover, setShowPopover] = useState(false)
  const [isCreatingInPopover, setIsCreatingInPopover] = useState(false)
  const [popoverCatName, setPopoverCatName] = useState('')
  const [imgError, setImgError] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  // 检查单本小说更新
  const handleCheckUpdate = async (e) => {
    e.stopPropagation()
    setIsUpdating(true)
    try {
      const res = await window.api.novelCheckBookUpdate(book.id)
      if (res.hasUpdate) {
        showToast(`《${book.title}》发现 ${res.newCount} 篇新章节！`, 'success')
        const all = await window.api.getAllBooks()
        setBooks(all)
      } else {
        showToast(res.message || '当前已是最新章节', 'info')
      }
    } catch (err) {
      showToast('追更检查失败: ' + err.message, 'error')
    } finally {
      setIsUpdating(false)
    }
  }

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
    const updatedCategories = [...categories, newCat]
    
    try {
      await window.api.saveCategories(updatedCategories)
      setCategories(updatedCategories)
      
      // 直接将当前书籍归入此新分类
      await window.api.updateBook(book.id, { categoryId: newCatId })
      const updatedBooks = books.map(b => b.id === book.id ? { ...b, categoryId: newCatId } : b)
      setBooks(updatedBooks)
      
      showToast(`已创建分类「${name}」并将书籍移入`, 'success')
      setShowPopover(false)
      setPopoverCatName('')
      setIsCreatingInPopover(false)
    } catch (err) {
      showToast('创建分类失败: ' + err.message, 'error')
    }
  }

  const hasValidCover = book.cover && !imgError

  return (
    <div className="book-card" onClick={onClick} id={`book-card-${book.id}`} style={{ position: 'relative' }}>
      <div className="book-cover">
        {hasValidCover ? (
          <img 
            src={book.cover} 
            alt={book.title} 
            loading="lazy" 
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="book-cover-placeholder">
            <span style={{ fontSize: '32px', marginBottom: '8px', display: 'block' }}>📚</span>
            <div className="book-cover-title">{book.title}</div>
            <div className="book-cover-author">{book.author || '未知作者'}</div>
          </div>
        )}
        
        {/* 连载标签 */}
        {(book.novelUrl || book.format === 'ONLINE') && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: '6px',
              backgroundColor: 'rgba(56, 189, 248, 0.2)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              fontSize: '10px',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: '4px',
              backdropFilter: 'blur(4px)',
              zIndex: 2
            }}
          >
            连载
          </div>
        )}

        {/* 像阅读 3.0 一样的追更红点提示 */}
        {(book.hasUpdate || (book.unreadCount && book.unreadCount > 0)) && (
          <div
            className="book-update-red-badge"
            title={`有新章节更新！未读: ${book.unreadCount || 1} 章`}
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              color: '#ffffff',
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: '10px',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              zIndex: 3,
              animation: 'novel-badge-pulse 2s infinite'
            }}
          >
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#ffffff', display: 'inline-block' }} />
            {book.unreadCount ? `${book.unreadCount}新` : '新'}
          </div>
        )}

        <div className="book-format-badge" style={{ color: FORMAT_COLORS[book.format] || 'var(--accent-light)' }}>
          {book.format}
        </div>
      </div>
      <div className="book-info">
        <div className="book-title">{book.title}</div>
        <div className="book-author" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{book.author}</span>
          {book.latestChapter && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85px' }} title={book.latestChapter}>
              {book.latestChapter}
            </span>
          )}
        </div>
      </div>
      
      {/* 悬停动作层 */}
      <div className="book-card-hover-overlay">
        {/* 追更检查按钮 */}
        {book.novelUrl && book.novelSourceId && (
          <button
            className="book-action-btn"
            title="检查章节更新"
            disabled={isUpdating}
            onClick={handleCheckUpdate}
            style={{ color: 'var(--accent-light)' }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ animation: isUpdating ? 'spin 1s linear infinite' : 'none' }}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        )}

        <button 
          className="book-action-btn" 
          title="书籍信息" 
          onClick={(e) => {
            e.stopPropagation()
            onShowInfo(book)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
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
