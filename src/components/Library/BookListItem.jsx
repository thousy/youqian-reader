import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import defaultBookCover from '../../logo.png'
import { CategoryPopover } from './CategoryPopover'
import { cleanDisplayTitle, formatDisplayAuthor } from '../../utils/titleCleaner'

const FORMAT_COLORS = {
  EPUB: '#4ade80', PDF: '#f87171', AZW3: '#fb923c', MOBI: '#a78bfa', TXT: '#60a5fa', ONLINE: '#38bdf8'
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function BookListItem({ book, onClick, onDelete, isBatchMode = false, isSelected = false, onToggleSelect }) {
  const { books, setBooks, categories, showToast, setCategories } = useStore()
  const [showPopover, setShowPopover] = useState(false)
  const [popoverAnchor, setPopoverAnchor] = useState(null)

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

  // Popover 中新建分类并归档
  const handleCreateCategory = async (name) => {
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
      await handleSetCategory(newCatId)
      showToast(`已创建分类并归档`, 'success')
    } catch (err) {
      showToast('操作失败: ' + err.message, 'error')
    }
  }

  const handleItemClick = (e) => {
    if (isBatchMode) {
      e.stopPropagation()
      onToggleSelect?.(book.id)
    } else {
      onClick?.(e)
    }
  }

  return (
    <div
      className={`book-list-item ${isBatchMode ? 'batch-mode' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={handleItemClick}
      id={`book-list-${book.id}`}
      style={{
        position: 'relative',
        boxShadow: isSelected ? '0 0 0 2px var(--accent), 0 4px 16px var(--accent-glow)' : undefined,
        borderColor: isSelected ? 'var(--accent)' : undefined
      }}
    >
      {/* 批量管理多选勾选框 */}
      {isBatchMode && (
        <div
          className="book-batch-checkbox list-checkbox"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect?.(book.id)
          }}
          style={{
            width: '20px',
            height: '20px',
            borderRadius: '5px',
            backgroundColor: isSelected ? 'var(--accent)' : 'var(--bg-layer1)',
            border: isSelected ? '2px solid var(--accent)' : '2px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all 0.15s ease'
          }}
        >
          {isSelected && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      )}

      <div className="book-list-cover">
        {book.cover ? (
          <img src={book.cover} alt={book.title} />
        ) : (
          <span style={{ fontSize: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: 'var(--bg-button)' }}>📚</span>
        )}
      </div>

      <div className="book-list-info">
        <div className="book-list-title" title={cleanDisplayTitle(book.title)}>{cleanDisplayTitle(book.title)}</div>
        <div className="book-list-author">{formatDisplayAuthor(book.author, book.title)}</div>
        <div className="book-list-meta">
          <span className="book-list-badge" style={{ color: FORMAT_COLORS[book.format] || 'var(--text-muted)' }}>{book.format}</span>
          <span className="book-list-progress">{formatFileSize(book.fileSize)}</span>
          {book.lastReadAt && (
            <span className="book-list-progress">上次阅读: {formatDate(book.lastReadAt)}</span>
          )}
        </div>
      </div>
      
      {/* 动作栏（非批量模式展示） */}
      {!isBatchMode && (
        <div className="book-list-actions">
          <button 
            className="reader-toolbar-btn" 
            title="阅读" 
            onClick={onClick}
            style={{ width: '30px', height: '30px' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </button>

          {/* 修改分类按钮：获取按钮真实坐标唤起全局浮层 */}
          <button 
            className={`reader-toolbar-btn ${showPopover ? 'active' : ''}`}
            title="修改分类"
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              setPopoverAnchor(rect)
              setShowPopover(prev => !prev)
            }}
            style={{ width: '30px', height: '30px' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>

          <button 
            className="reader-toolbar-btn" 
            title="删除" 
            onClick={onDelete}
            style={{ width: '30px', height: '30px', color: 'var(--text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>
      )}

      {/* 全局 Portal 分类管理 Popover（彻底解决兄弟列表项盖住浮层的问题，完整显示在最外面） */}
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
