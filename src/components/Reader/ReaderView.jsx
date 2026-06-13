import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { EpubReader } from './EpubReader'
import { PdfReader } from './PdfReader'
import { TxtReader } from './TxtReader'
import { MobiReader } from './MobiReader'
import { Azw3Reader } from './Azw3Reader'
import { BookmarkPanel } from './BookmarkPanel'
import { SettingsPanel } from './SettingsPanel'

export function ReaderView() {
  const {
    currentBook, closeBook,
    showToc, setShowToc,
    showBookmarks, setShowBookmarks,
    showSettings, setShowSettings,
    bookmarks, setBookmarks, addBookmarkToStore, removeBookmarkFromStore,
    readingProgress, setReadingProgress,
    showToast, settings,
    updateSettings
  } = useStore()

  const [progress, setProgress] = useState(0)
  const getPositionRef = useRef(null)
  const saveProgressTimeoutRef = useRef(null)

  // 卸载时清理防抖定时器
  useEffect(() => {
    return () => {
      if (saveProgressTimeoutRef.current) {
        clearTimeout(saveProgressTimeoutRef.current)
      }
    }
  }, [])

  // 加载书签和进度
  useEffect(() => {
    if (!currentBook) return
    window.api.getBookmarks(currentBook.id).then(setBookmarks)
    window.api.getReadingProgress(currentBook.id).then(p => {
      if (p) {
        setReadingProgress(p)
        setProgress(p.percentage || 0)
      } else {
        setReadingProgress(null)
        setProgress(0)
      }
    })
  }, [currentBook?.id])

  if (!currentBook) return null

  const format = currentBook.format

  // 添加书签
  const handleAddBookmark = async () => {
    let label = '书签'
    let positionData = {}
    if (getPositionRef.current) {
      const pos = getPositionRef.current()
      label = pos.label || '书签'
      positionData = pos
    }
    const bm = await window.api.addBookmark(currentBook.id, { label, ...positionData })
    addBookmarkToStore(bm)
    showToast('书签已添加', 'success')
  }

  const handleRemoveBookmark = async (bmId) => {
    await window.api.removeBookmark(currentBook.id, bmId)
    removeBookmarkFromStore(bmId)
    showToast('书签已删除', 'success')
  }

  const renderReader = () => {
    const props = {
      book: currentBook,
      savedProgress: readingProgress,
      settings,
      onProgressChange: (p) => {
        setProgress(p?.percentage || 0)
        setReadingProgress(p)

        // 引入 200ms 防抖保存，防止高频滚动期间密集触发 IPC 磁盘 I/O
        if (saveProgressTimeoutRef.current) {
          clearTimeout(saveProgressTimeoutRef.current)
        }
        saveProgressTimeoutRef.current = setTimeout(() => {
          window.api.saveReadingProgress(currentBook.id, p)
        }, 200)
      },
      registerGetPosition: (fn) => { getPositionRef.current = fn },
      showToc,
      onTocItemClick: () => {}
    }
    switch (format) {
      case 'EPUB': return <EpubReader {...props} />
      case 'PDF': return <PdfReader {...props} />
      case 'TXT': return <TxtReader {...props} />
      case 'MOBI': return <MobiReader {...props} />
      case 'AZW3': return <Azw3Reader {...props} />
      default: return <div style={{padding:'40px',color:'var(--text-muted)'}}>不支持的格式: {format}</div>
    }
  }

  return (
    <div className="reader-view">
      {/* 进度条 */}
      <div className="reading-progress-bar">
        <div className="reading-progress-fill" style={{width: `${progress * 100}%`}} />
      </div>

      {/* 工具栏 */}
      <div className="reader-toolbar">
        <button className="reader-back-btn" id="reader-back-btn" onClick={closeBook}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          书库
        </button>
        <div 
          className={`reader-book-info ${['EPUB', 'MOBI', 'AZW3', 'TXT'].includes(format) ? 'clickable' : ''}`}
          onClick={['EPUB', 'MOBI', 'AZW3', 'TXT'].includes(format) ? () => setShowToc(!showToc) : undefined}
          title={['EPUB', 'MOBI', 'AZW3', 'TXT'].includes(format) ? "点击切换目录" : ""}
        >
          <div className="reader-book-title">{currentBook.title}</div>
          <div className="reader-book-author">{currentBook.author}</div>
        </div>

        {/* 目录 */}
        {['EPUB', 'MOBI', 'AZW3', 'TXT'].includes(format) && (
          <button
            className={`reader-toolbar-btn ${showToc ? 'active' : ''}`}
            onClick={() => setShowToc(!showToc)}
            title="目录"
            id="btn-toc"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
        )}

        {/* 添加书签 */}
        <button className="reader-toolbar-btn" onClick={handleAddBookmark} title="添加书签" id="btn-add-bookmark">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>

        {/* 书签列表 */}
        <button
          className={`reader-toolbar-btn ${showBookmarks ? 'active' : ''}`}
          onClick={() => setShowBookmarks(!showBookmarks)}
          title="书签列表"
          id="btn-bookmarks"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>
          </svg>
          {bookmarks.length > 0 && (
            <span style={{
              position:'absolute', top:'-4px', right:'-4px',
              background:'var(--accent)', color:'white',
              borderRadius:'50%', width:'14px', height:'14px',
              fontSize:'9px', display:'flex', alignItems:'center', justifyContent:'center'
            }}>{bookmarks.length}</span>
          )}
        </button>

        {/* 右侧设置与排版控制组 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* 阅读设置 */}
          <button
            className={`reader-toolbar-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="阅读设置"
            id="btn-settings"
            style={{ position:'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span style={{ fontSize: '13px', fontWeight: 'bold', fontFamily: 'system-ui' }}>Aa</span>
          </button>

          {/* 顶部排版模式切换 */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              className={`reader-toolbar-btn ${settings.layoutMode === 'horizontal' ? 'active' : ''}`}
              onClick={() => updateSettings({ layoutMode: 'horizontal' })}
              style={{ width: 'auto', padding: '0 8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '500' }}
              title="全窗口显示"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="3" width="16" height="18" rx="2" ry="2" />
                <line x1="9" y1="9" x2="15" y2="9" />
                <line x1="9" y1="13" x2="15" y2="13" />
              </svg>
              全窗口
            </button>
            <button
              className={`reader-toolbar-btn ${settings.layoutMode === 'horizontal-scroll' ? 'active' : ''}`}
              onClick={() => updateSettings({ layoutMode: 'horizontal-scroll' })}
              style={{ width: 'auto', padding: '0 8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '500' }}
              title="左右滚动"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="20" y1="8" x2="4" y2="8" /><polyline points="8 4 4 8 8 12" />
                <line x1="4" y1="16" x2="20" y2="16" /><polyline points="16 12 20 16 16 20" />
              </svg>
              左右滚动
            </button>
            <button
              className={`reader-toolbar-btn ${settings.layoutMode === 'vertical' ? 'active' : ''}`}
              onClick={() => updateSettings({ layoutMode: 'vertical' })}
              style={{ width: 'auto', padding: '0 8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '500' }}
              title="上下滚动"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="20" x2="8" y2="4" /><polyline points="4 8 8 4 12 8" />
                <line x1="16" y1="4" x2="16" y2="20" /><polyline points="12 16 16 20 20 16" />
              </svg>
              上下滚动
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="reader-content-area" style={{position:'relative'}}>
        {renderReader()}
        {showBookmarks && (
          <BookmarkPanel
            bookmarks={bookmarks}
            onRemove={handleRemoveBookmark}
          />
        )}
        {showSettings && <SettingsPanel />}
      </div>
    </div>
  )
}
