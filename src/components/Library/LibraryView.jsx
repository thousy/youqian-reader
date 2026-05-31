import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import { BookCard } from './BookCard'
import { BookListItem } from './BookListItem'

export function LibraryView({ onImport }) {
  const {
    filteredBooks, books, viewMode, searchQuery, filterFormat,
    setSearchQuery, setFilterFormat, setViewMode, isLoading, openBook,
    removeBook: removeFromStore, setBooks, showToast, showConfirm
  } = useStore()

  const handleRemoveBook = async (book, e) => {
    e?.stopPropagation()
    const confirmed = await showConfirm('删除书籍', `确定要从书库中移除《${book.title}》吗？文件本身不会被删除。`)
    if (!confirmed) return
    await window.api.removeBook(book.id)
    const allBooks = await window.api.getAllBooks()
    setBooks(allBooks)
    showToast('已从书库移除', 'success')
  }

  const handleAddClick = async () => {
    const paths = await window.api.selectBooks()
    if (paths?.length) await onImport(paths)
  }

  const formats = ['all', 'EPUB', 'PDF', 'AZW3', 'MOBI', 'TXT']

  return (
    <div className="library-view">
      <div className="library-toolbar">
        <h1 className="library-title">我的书库</h1>
        <span className="library-count">{filteredBooks.length} 本</span>

        <div className="search-bar">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            id="search-books-input"
            type="text"
            placeholder="搜索书名、作者..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <select
          className="filter-select"
          value={filterFormat}
          onChange={e => setFilterFormat(e.target.value)}
          id="format-filter"
        >
          <option value="all">全部格式</option>
          {formats.slice(1).map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>

        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="网格视图"
            id="view-grid-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="列表视图"
            id="view-list-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {isLoading && (
        <div style={{padding:'16px 24px',display:'flex',alignItems:'center',gap:'10px',color:'var(--text-muted)',fontSize:'13px'}}>
          <div className="loading-spinner" style={{width:'18px',height:'18px',borderWidth:'2px'}}/>
          正在导入书籍...
        </div>
      )}

      {filteredBooks.length === 0 ? (
        <div className="empty-library">
          <div className="empty-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </div>
          {books.length === 0 ? (
            <>
              <h3>书库空空如也</h3>
              <p>点击"添加书籍"或将文件拖入此处，支持 EPUB、PDF、AZW3、MOBI、TXT 格式</p>
              <button className="empty-add-btn" id="empty-add-btn" onClick={handleAddClick}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                添加第一本书
              </button>
            </>
          ) : (
            <>
              <h3>没有找到相关书籍</h3>
              <p>尝试修改搜索词或筛选条件</p>
            </>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="library-grid">
          {filteredBooks.map(book => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => openBook(book)}
              onDelete={(e) => handleRemoveBook(book, e)}
            />
          ))}
        </div>
      ) : (
        <div className="library-list">
          {filteredBooks.map(book => (
            <BookListItem
              key={book.id}
              book={book}
              onClick={() => openBook(book)}
              onDelete={(e) => handleRemoveBook(book, e)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
