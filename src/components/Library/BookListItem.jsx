import React from 'react'

const FORMAT_COLORS = {
  EPUB: '#4ade80', PDF: '#f87171', AZW3: '#fb923c', MOBI: '#a78bfa', TXT: '#60a5fa'
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

export function BookListItem({ book, onClick, onDelete }) {
  return (
    <div className="book-list-item" onClick={onClick} id={`book-list-${book.id}`}>
      <div className="book-list-cover">
        {book.cover
          ? <img src={book.cover} alt={book.title} />
          : <span style={{fontSize:'20px'}}>📚</span>
        }
      </div>
      <div className="book-list-info">
        <div className="book-list-title">{book.title}</div>
        <div className="book-list-author">{book.author}</div>
        <div className="book-list-meta">
          <span className="book-list-badge" style={{color: FORMAT_COLORS[book.format]}}>{book.format}</span>
          <span className="book-list-progress">{formatFileSize(book.fileSize)}</span>
          {book.lastReadAt && (
            <span className="book-list-progress">上次阅读: {formatDate(book.lastReadAt)}</span>
          )}
        </div>
      </div>
      <div className="book-list-actions">
        <button className="reader-toolbar-btn" title="阅读" onClick={onClick}
          style={{width:'30px',height:'30px'}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
        </button>
        <button className="reader-toolbar-btn" title="删除" onClick={onDelete}
          style={{width:'30px',height:'30px',color:'var(--text-muted)'}}
          onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
