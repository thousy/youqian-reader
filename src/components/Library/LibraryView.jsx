import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import logoIcon from '../../logo.png'
import { BookCard } from './BookCard'
import { BookListItem } from './BookListItem'
import { BookInfoModal } from '../UI/BookInfoModal'
import { SettingsPanel } from '../Reader/SettingsPanel'
import { GlobalSettingsModal } from '../UI/GlobalSettingsModal'

export function LibraryView({ onImport }) {
  const {
    filteredBooks, books, viewMode, searchQuery, filterFormat,
    setSearchQuery, setFilterFormat, setViewMode, isLoading, openBook,
    removeBook: removeFromStore, setBooks, showToast, showConfirm,
    setCategories, selectedCategoryId, categories, setCurrentView
  } = useStore()

  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [infoBook, setInfoBook] = useState(null)
  const [showGlobalSettings, setShowGlobalSettings] = useState(false)
  const [showReaderSettings, setShowReaderSettings] = useState(false)
  const [appVersion, setAppVersion] = useState('2.1.0')
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const settingsMenuRef = useRef(null)

  // 像阅读3.0一样：动态计算当前分类标题
  const currentCategoryTitle = React.useMemo(() => {
    if (selectedCategoryId === 'online') return '在线追书'
    if (selectedCategoryId === 'local') return '本地书籍'
    if (selectedCategoryId === 'uncategorized') return '未分类书籍'
    if (selectedCategoryId === 'all') return '我的书库'
    const found = categories?.find(c => c.id === selectedCategoryId)
    return found ? found.name : '我的书库'
  }, [selectedCategoryId, categories])

  // 当在侧边栏切换分类（如从本地书籍跳转到在线追书）时，重置格式筛选为“全部格式”
  useEffect(() => {
    setFilterFormat('all')
  }, [selectedCategoryId, setFilterFormat])

  // 一键检查所有连载小说更新并批量拉取
  const handleCheckAllUpdates = async () => {
    setIsCheckingUpdates(true)
    try {
      showToast('正在检查书架连载小说更新...', 'info')
      const updates = await window.api.novelCheckAllUpdates()
      if (!updates || updates.length === 0) {
        showToast('所有连载小说均已是最新章节', 'info')
        return
      }

      showToast(`检测到 ${updates.length} 本小说有新章节，正在批量更新...`, 'info')
      let successCount = 0
      for (const u of updates) {
        const res = await window.api.novelPerformUpdate(u.bookId)
        if (res.success) successCount++
      }

      const all = await window.api.getAllBooks()
      setBooks(all)
      showToast(`一键追更完成！成功更新了 ${successCount} 本小说`, 'success')
    } catch (err) {
      showToast('一键追更失败: ' + err.message, 'error')
    } finally {
      setIsCheckingUpdates(false)
    }
  }

  // 像阅读 3.0 一样自动后台静默检查追更与红点刷新
  useEffect(() => {
    const silentCheck = async () => {
      try {
        const updates = await window.api.novelCheckAllUpdates()
        if (updates && updates.length > 0) {
          const all = await window.api.getAllBooks()
          setBooks(all)
        }
      } catch (_) {}
    }

    // 延时 2 秒启动首次静默检查（避免阻塞首屏渲染）
    const initialTimer = setTimeout(silentCheck, 2000)
    // 之后每 30 分钟静默轮询一次
    const intervalTimer = setInterval(silentCheck, 30 * 60 * 1000)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(intervalTimer)
    }
  }, [setBooks])

  useEffect(() => {
    window.api?.getAppVersion?.().then(v => {
      if (v) setAppVersion(v)
    })
  }, [])

  // 外部点击关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target)) {
        setShowSettingsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleExportBackup = async () => {
    setShowSettingsMenu(false)
    try {
      const result = await window.api.exportBackup()
      if (result.success) {
        showToast('备份文件导出成功', 'success')
      } else if (result.error && result.error !== '用户取消了导出') {
        showToast(result.error, 'error')
      }
    } catch (e) {
      showToast('导出备份失败: ' + e.message, 'error')
    }
  }

  const handleImportBackup = async () => {
    setShowSettingsMenu(false)
    try {
      const result = await window.api.importBackup()
      if (result.success) {
        if (result.settings) {
          useStore.getState().updateSettings(result.settings)
        }
        if (result.categories) {
          setCategories(result.categories)
        }
        const allBooks = await window.api.getAllBooks()
        setBooks(allBooks)
        
        const currentBook = useStore.getState().currentBook
        if (currentBook) {
          const progress = await window.api.getReadingProgress(currentBook.id)
          const bookmarks = await window.api.getBookmarks(currentBook.id)
          useStore.getState().setReadingProgress(progress)
          useStore.getState().setBookmarks(bookmarks)
        }
        showToast('备份导入成功', 'success')
      } else if (result.error && result.error !== '用户取消了导入') {
        showToast(result.error, 'error')
      }
    } catch (e) {
      showToast('导入备份失败: ' + e.message, 'error')
    }
  }

  const handleResetDatabase = async () => {
    setShowSettingsMenu(false)
    
    const action = await showConfirm(
      '一键还原初始状态',
      '警告：确定要还原初始状态吗？此操作将清空所有书籍、分类、阅读进度和书签数据，且不可逆！\n\n建议您在还原前备份当前配置。',
      {
        buttons: [
          { label: '备份并还原', value: 'backup-and-reset', className: 'btn btn-primary' },
          { label: '直接还原', value: 'reset-only', className: 'btn btn-danger' },
          { label: '取消', value: 'cancel', className: 'btn btn-secondary' }
        ]
      }
    )

    if (!action || action === 'cancel') return

    const performReset = async () => {
      try {
        const result = await window.api.resetDatabase()
        if (result.success) {
          setBooks([])
          setCategories([])
          const defaultSettings = await window.api.getSettings()
          useStore.getState().updateSettings(defaultSettings)
          showToast('已还原为初始状态', 'success')
        }
      } catch (e) {
        showToast('还原失败: ' + e.message, 'error')
      }
    }

    if (action === 'backup-and-reset') {
      try {
        const result = await window.api.exportBackup()
        if (result.success) {
          showToast('备份文件导出成功，开始还原...', 'success')
          await performReset()
        } else if (result.error && result.error !== '用户取消了导出') {
          showToast('备份失败，还原操作已中止: ' + result.error, 'error')
        }
      } catch (e) {
        showToast('备份导出失败，还原操作已中止: ' + e.message, 'error')
      }
    } else if (action === 'reset-only') {
      await performReset()
    }
  }

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

  const formats = ['all', 'ONLINE', 'EPUB', 'PDF', 'AZW3', 'MOBI', 'TXT']

  return (
    <div className="library-view">
      <div className="library-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h1 className="library-title">{currentCategoryTitle}</h1>
          <span className="library-version-badge" style={{
            fontSize: '11px',
            fontWeight: '600',
            color: 'var(--accent-light)',
            background: 'var(--accent-glow)',
            padding: '2px 6px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            userSelect: 'none'
          }}>
            v{appVersion}
          </span>
        </div>
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

        {/* 一键追更按钮 */}
        <button
          className="btn btn-secondary"
          onClick={handleCheckAllUpdates}
          disabled={isCheckingUpdates}
          title="检查所有连载小说的最新章节"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 10px',
            fontSize: '12px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--bg-layer2)',
            color: 'var(--text-primary)',
            cursor: isCheckingUpdates ? 'default' : 'pointer',
            opacity: isCheckingUpdates ? 0.7 : 1
          }}
        >
          <span style={{ fontSize: '13px', display: 'inline-block', animation: isCheckingUpdates ? 'spin 1s linear infinite' : 'none' }}>⚡</span>
          {isCheckingUpdates ? '正在追更...' : '一键追更'}
        </button>

        {/* 齿轮数据设置按钮及下拉菜单 */}
        <div className="settings-menu-container" ref={settingsMenuRef}>
          <button
            className={`settings-menu-btn ${showSettingsMenu ? 'active' : ''}`}
            onClick={() => setShowSettingsMenu(!showSettingsMenu)}
            title="数据设置"
            id="btn-settings-menu"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          {showSettingsMenu && (
            <div className="settings-dropdown-menu">
              <button
                className="settings-dropdown-item"
                onClick={() => {
                  setShowSettingsMenu(false)
                  setShowGlobalSettings(true)
                }}
                id="menu-global-settings-btn"
                style={{ fontWeight: 600, color: 'var(--accent-light)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                ⚙️ 全局系统设置
              </button>
              <button
                className="settings-dropdown-item"
                onClick={() => {
                  setShowSettingsMenu(false)
                  setShowReaderSettings(true)
                }}
                id="menu-reader-settings-btn"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                </svg>
                📖 阅读排版偏好
              </button>
              <div className="settings-dropdown-divider" />
              <button className="settings-dropdown-item" onClick={handleExportBackup}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                备份数据
              </button>
              <button className="settings-dropdown-item" onClick={handleImportBackup}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                恢复数据
              </button>
              <div className="settings-dropdown-divider" />
              <button className="settings-dropdown-item danger" onClick={handleResetDatabase}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  <line x1="10" y1="11" x2="10" y2="17"/>
                  <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
                还原初始状态
              </button>
            </div>
          )}
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
          {selectedCategoryId === 'online' ? (
            <>
              <div className="empty-icon">
                <span style={{ fontSize: '42px', display: 'inline-flex', alignItems: 'center' }}>⚡</span>
              </div>
              <h3>暂无在线追更书籍</h3>
              <p>您可以前往「在线找书」聚合全网书源搜索小说，一键加入书架流式追更</p>
              <button
                className="empty-add-btn"
                onClick={() => setCurrentView('novelSearch')}
                style={{
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  border: 'none',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                }}
              >
                <span>🔍</span> 前往在线找书
              </button>
            </>
          ) : selectedCategoryId === 'local' ? (
            <>
              <div className="empty-icon">
                <span style={{ fontSize: '42px', display: 'inline-flex', alignItems: 'center' }}>📁</span>
              </div>
              <h3>暂无本地导入书籍</h3>
              <p>点击下方按钮导入您的 EPUB、PDF、AZW3、MOBI、TXT 电子书</p>
              <button className="empty-add-btn" onClick={handleAddClick}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                导入本地图书
              </button>
            </>
          ) : books.length === 0 ? (
            <>
              <div className="empty-icon">
                <span style={{ fontSize: '40px', display: 'inline-flex', alignItems: 'center' }}>📚</span>
              </div>
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
              <div className="empty-icon">
                <span style={{ fontSize: '40px', display: 'inline-flex', alignItems: 'center' }}>🔍</span>
              </div>
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
              onShowInfo={setInfoBook}
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
      {infoBook && <BookInfoModal book={infoBook} onClose={() => setInfoBook(null)} />}
      
      {/* 书库阅读设置模态弹窗 */}
      {showReaderSettings && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (window._isFileDialogActive || (window._lastImportTime && Date.now() - window._lastImportTime < 1500)) return
            if (document.querySelector('.confirm-modal-overlay')) return
            if (e.target === e.currentTarget) {
              setShowReaderSettings(false)
            }
          }}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(6, 6, 10, 0.65)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          <div onClick={e => e.stopPropagation()}>
            <SettingsPanel
              onClose={() => setShowReaderSettings(false)}
              isModal={true}
              onOpenGlobalSettings={() => {
                setShowReaderSettings(false)
                setShowGlobalSettings(true)
              }}
            />
          </div>
        </div>
      )}

      {/* 全新高颜值现代化全局设置中心 */}
      <GlobalSettingsModal
        isOpen={showGlobalSettings}
        onClose={() => setShowGlobalSettings(false)}
      />
    </div>
  )
}
