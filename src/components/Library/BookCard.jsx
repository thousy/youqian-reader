import React from 'react'

const FORMAT_COLORS = {
  EPUB: '#4ade80', PDF: '#f87171', AZW3: '#fb923c', MOBI: '#a78bfa', TXT: '#60a5fa'
}

const FORMAT_ICONS = {
  EPUB: '📖', PDF: '📄', AZW3: '📱', MOBI: '📚', TXT: '📝'
}

export function BookCard({ book, onClick, onDelete }) {
  return (
    <div className="book-card" onClick={onClick} id={`book-card-${book.id}`}>
      <div className="book-cover">
        {book.cover ? (
          <img src={book.cover} alt={book.title} loading="lazy" />
        ) : (
          <div className="book-cover-placeholder">
            <span style={{fontSize:'32px'}}>{FORMAT_ICONS[book.format] || '📖'}</span>
            <div className="book-cover-title">{book.title}</div>
            <div className="book-cover-author">{book.author}</div>
          </div>
        )}
        <div className="book-format-badge"
          style={{color: FORMAT_COLORS[book.format] || 'var(--accent-light)'}}>
          {book.format}
        </div>
      </div>
      <div className="book-info">
        <div className="book-title">{book.title}</div>
        <div className="book-author">{book.author}</div>
      </div>
      <div className="book-card-hover-overlay">
        <button className="book-action-btn" title="阅读" onClick={onClick}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
        </button>
        <button className="book-action-btn delete" title="删除" onClick={onDelete}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
