import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import defaultBookCover from '../../logo.png'
import { CategoryPopover } from './CategoryPopover'
import { cleanDisplayTitle } from '../../utils/titleCleaner'

const FORMAT_COLORS = {
  EPUB: '#4ade80', PDF: '#f87171', AZW3: '#fb923c', MOBI: '#a78bfa', TXT: '#60a5fa'
}

export function BookCard({ book, onClick, onDelete, onShowInfo, isBatchMode = false, isSelected = false, onToggleSelect }) {
  const { books, setBooks, categories, showToast, setCategories } = useStore()
  const [showPopover, setShowPopover] = useState(false)
  const [popoverAnchor, setPopoverAnchor] = useState(null)
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

  // 修改分类分配
  const handleSetCategory = async (catId) => {
    try {
      await window.api.updateBook(book.id, { categoryId: catId })
      const updatedBooks = books.map(b => b.id === book.id ? { ...b, categoryId: catId } : b)
      setBooks(updatedBooks)
      const targetCat = categories.find(c => c.id === catId)
      showToast(`已移至「${targetCat ? targetCat.name : '未分类'}」`, 'success')
      setShowPopover(false)
    } catch (err) {
      showToast('更新分类失败: ' + err.message, 'error')
    }
  }

  // 新建分类并归档
  const handleCreateCategory = async (name) => {
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
      await handleSetCategory(newCatId)
      showToast(`已创建分类「${name}」并将书籍移入`, 'success')
    } catch (err) {
      showToast('创建分类失败: ' + err.message, 'error')
    }
  }

  const handleCardClick = (e) => {
    if (isBatchMode) {
      e.stopPropagation()
      onToggleSelect?.(book.id)
    } else {
      onClick?.(e)
    }
  }

  const hasValidCover = book.cover && !imgError

  return (
    <div
      className={`book-card ${isBatchMode ? 'batch-mode' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={handleCardClick}
      id={`book-card-${book.id}`}
      style={{
        position: 'relative',
        boxShadow: isSelected ? '0 0 0 2px var(--accent), 0 8px 24px var(--accent-glow)' : undefined,
        borderColor: isSelected ? 'var(--accent)' : undefined
      }}
    >
      {/* 批量管理多选勾选框（仅在批量模式下出现） */}
      {isBatchMode && (
        <div
          className="book-batch-checkbox"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect?.(book.id)
          }}
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            zIndex: 10,
            width: '22px',
            height: '22px',
            borderRadius: '6px',
            backgroundColor: isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.92)',
            border: isSelected ? '2px solid var(--accent)' : '1.5px solid rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            transition: 'all 0.15s ease'
          }}
        >
          {isSelected && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      )}

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
            <div className="book-cover-title">{cleanDisplayTitle(book.title)}</div>
            <div className="book-cover-author">{book.author || '未知作者'}</div>
          </div>
        )}
        
        {/* 连载标签（原版浅蓝柔光质感） */}
        {Boolean(book.novelUrl || book.format === 'ONLINE') && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: isBatchMode ? '34px' : '6px',
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

        {/* 追更红点提示（原版样式） */}
        {Boolean(book.hasUpdate || (Number(book.unreadCount) > 0)) && (
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

        {/* 格式角标：100% 恢复原版 book-format-badge 定位与样式 */}
        <div className="book-format-badge" style={{ color: FORMAT_COLORS[book.format] || 'var(--accent-light)' }}>
          {book.format}
        </div>
      </div>

      {/* 书籍信息：100% 恢复原版紧凑字距与排版 */}
      <div className="book-info">
        <div className="book-title" title={cleanDisplayTitle(book.title)}>{cleanDisplayTitle(book.title)}</div>
        <div className="book-author" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{book.author}</span>
          {book.latestChapter && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85px' }} title={book.latestChapter}>
              {book.latestChapter}
            </span>
          )}
        </div>
      </div>
      
      {/* 悬停动作层：非批量模式下正常展示 */}
      {!isBatchMode && (
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
              onShowInfo?.(book)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
          
          {/* 修改分类按钮：唤起全局挂载在 document.body 的 CategoryPopover，完全不被框截断 */}
          <button 
            className={`book-action-btn category ${showPopover ? 'active' : ''}`}
            title="修改分类" 
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              setPopoverAnchor(rect)
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
      )}

      {/* 全局 Portal 分类弹出层 */}
      <CategoryPopover
        isOpen={showPopover}
        anchorRect={popoverAnchor}
        currentCategoryId={book.categoryId}
        categories={categories}
        onSelectCategory={handleSetCategory}
        onCreateCategory={handleCreateCategory}
        onClose={() => setShowPopover(false)}
        title="移至分类"
      />
    </div>
  )
}
