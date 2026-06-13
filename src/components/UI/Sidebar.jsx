import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../../store/useStore'

const FORMAT_COLORS = {
  EPUB: '#4ade80', PDF: '#f87171', AZW3: '#fb923c', MOBI: '#a78bfa', TXT: '#60a5fa'
}

export function Sidebar() {
  const {
    books, currentView, openBook, setBooks, showToast, showConfirm,
    categories, selectedCategoryId, setSelectedCategoryId, setCategories
  } = useStore()

  // 最近阅读的书
  const recentBooks = [...books]
    .filter(b => b.lastReadAt)
    .sort((a, b) => new Date(b.lastReadAt) - new Date(a.lastReadAt))
    .slice(0, 8)

  // 分类管理交互状态
  const [isAdding, setIsAdding] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')
  
  const addInputRef = useRef(null)
  const editInputRef = useRef(null)

  // 展开新建时自动聚焦
  useEffect(() => {
    if (isAdding && addInputRef.current) {
      addInputRef.current.focus()
    }
  }, [isAdding])

  // 展开编辑时自动聚焦
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingId])

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


  // 新建分类保存
  const handleAddCategory = async () => {
    const name = newCatName.trim()
    if (!name) return
    
    // 检查是否重名
    if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      showToast('分类名称已存在', 'error')
      return
    }

    const newCat = {
      id: 'cat_' + Date.now() + Math.random().toString(36).substr(2, 4),
      name
    }
    const updated = [...categories, newCat]
    try {
      await window.api.saveCategories(updated)
      setCategories(updated)
      setNewCatName('')
      setIsAdding(false)
      showToast('分类创建成功', 'success')
    } catch (e) {
      showToast('创建失败: ' + e.message, 'error')
    }
  }

  // 重命名分类保存
  const handleRenameCategory = async (id) => {
    const name = editingName.trim()
    if (!name) {
      setEditingId(null)
      return
    }

    // 检查除自身外是否重名
    if (categories.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) {
      showToast('其他分类已使用该名称', 'error')
      return
    }

    const updated = categories.map(c => c.id === id ? { ...c, name } : c)
    try {
      await window.api.saveCategories(updated)
      setCategories(updated)
      setEditingId(null)
      setEditingName('')
      showToast('重命名成功', 'success')
    } catch (e) {
      showToast('重命名失败: ' + e.message, 'error')
    }
  }

  // 删除分类并使书籍重归“未分类”
  const handleDeleteCategory = async (cat, e) => {
    e.stopPropagation()
    const confirmed = await showConfirm('删除分类', `确定要删除分类“${cat.name}”吗？分类下的书籍不会被删除。`)
    if (!confirmed) return

    // 1. 删除分类表项
    const updatedCats = categories.filter(c => c.id !== cat.id)
    try {
      await window.api.saveCategories(updatedCats)
      setCategories(updatedCats)

      // 2. 将书籍与分类脱钩并更新数据库
      const updatedBooks = books.map(b => b.categoryId === cat.id ? { ...b, categoryId: null } : b)
      for (const book of books) {
        if (book.categoryId === cat.id) {
          await window.api.updateBook(book.id, { categoryId: null })
        }
      }
      setBooks(updatedBooks)

      // 3. 路由重置
      if (selectedCategoryId === cat.id) {
        setSelectedCategoryId('all')
      }
      showToast('分类已删除', 'success')
    } catch (e) {
      showToast('操作失败: ' + e.message, 'error')
    }
  }

  return (
    <div className="sidebar">
      {/* 导入按钮 */}
      <div className="sidebar-header">
        <button className="sidebar-add-btn" id="add-books-btn" onClick={handleAddClick}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          添加书籍
        </button>
      </div>

      {/* 导航板块 */}
      <div className="sidebar-nav">
        <button 
          className={`nav-item ${currentView === 'library' && selectedCategoryId === 'all' ? 'active' : ''}`}
          onClick={() => {
            useStore.getState().closeBook()
            setSelectedCategoryId('all')
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          全部图书
          <span className="sidebar-badge">{books.length}</span>
        </button>

        <button 
          className={`nav-item ${currentView === 'library' && selectedCategoryId === 'uncategorized' ? 'active' : ''}`}
          onClick={() => {
            useStore.getState().closeBook()
            setSelectedCategoryId('uncategorized')
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          未分类
          <span className="sidebar-badge">{books.filter(b => !b.categoryId).length}</span>
        </button>

        {/* 书籍分类标题 */}
        <div className="sidebar-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'between', marginTop: '16px', marginBottom: '8px' }}>
          <span>书籍分类</span>
          <button 
            className="cat-add-trigger" 
            title="新建分类" 
            onClick={() => setIsAdding(prev => !prev)}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--text-muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>

        {/* 内联新建分类面板 */}
        {isAdding && (
          <div className="cat-inline-add-panel">
            <input
              ref={addInputRef}
              type="text"
              className="cat-inline-input"
              placeholder="新分类名称"
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddCategory()
                if (e.key === 'Escape') setIsAdding(false)
              }}
            />
            <div className="cat-inline-actions">
              <button className="cat-inline-btn confirm" onClick={handleAddCategory}>创建</button>
              <button className="cat-inline-btn cancel" onClick={() => setIsAdding(false)}>取消</button>
            </div>
          </div>
        )}

        {/* 分类树列表 */}
        <div className="sidebar-categories-list">
          {categories.map(cat => {
            const isEditing = editingId === cat.id
            const isActive = currentView === 'library' && selectedCategoryId === cat.id
            const count = books.filter(b => b.categoryId === cat.id).length

            return (
              <div 
                key={cat.id}
                className={`nav-item category-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  if (isEditing) return
                  useStore.getState().closeBook()
                  setSelectedCategoryId(cat.id)
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>

                {isEditing ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    className="cat-item-edit-input"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => handleRenameCategory(cat.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRenameCategory(cat.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <>
                    <span className="category-item-name">{cat.name}</span>
                    <span className="sidebar-badge" style={{ marginRight: '6px' }}>{count}</span>
                    
                    {/* 分类快捷操作 */}
                    <div className="category-item-actions">
                      <button 
                        className="category-action-mini" 
                        title="重命名"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingId(cat.id)
                          setEditingName(cat.name)
                        }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/>
                        </svg>
                      </button>
                      <button 
                        className="category-action-mini delete" 
                        title="删除分类"
                        onClick={(e) => handleDeleteCategory(cat, e)}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 最近阅读板块 */}
      {recentBooks.length > 0 && (
        <>
          <div className="sidebar-section-title" style={{ marginTop: '20px' }}>最近阅读</div>
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

      {/* 底部技术支持 */}
      <div className="sidebar-footer" style={{
        marginTop: 'auto',
        padding: '16px',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        <div style={{
          color: 'var(--text-muted)',
          fontSize: '12px',
          textAlign: 'center',
          userSelect: 'none',
          padding: '4px 0'
        }}>
          © YouQian Tech
        </div>
      </div>
    </div>
  )
}
