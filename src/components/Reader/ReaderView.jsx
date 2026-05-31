import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { EpubReader } from './EpubReader'
import { PdfReader } from './PdfReader'
import { TxtReader } from './TxtReader'
import { MobiReader } from './MobiReader'
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
    showToast, settings
  } = useStore()

  const [progress, setProgress] = useState(0)
  const getPositionRef = useRef(null)

  // 加载书签和进度
  useEffect(() => {
    if (!currentBook) return
    window.api.getBookmarks(currentBook.id).then(setBookmarks)
    window.api.getReadingProgress(currentBook.id).then(p => {
      if (p) setReadingProgress(p)
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
        window.api.saveReadingProgress(currentBook.id, p)
        setReadingProgress(p)
      },
      registerGetPosition: (fn) => { getPositionRef.current = fn },
      showToc,
      onTocItemClick: () => {}
    }
    switch (format) {
      case 'EPUB': return <EpubReader {...props} />
      case 'PDF': return <PdfReader {...props} />
      case 'TXT': return <TxtReader {...props} />
      case 'MOBI':
      case 'AZW3': return <MobiReader {...props} />
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
          className={`reader-book-info ${['EPUB', 'MOBI', 'AZW3'].includes(format) ? 'clickable' : ''}`}
          onClick={['EPUB', 'MOBI', 'AZW3'].includes(format) ? () => setShowToc(!showToc) : undefined}
          title={['EPUB', 'MOBI', 'AZW3'].includes(format) ? "点击切换目录" : ""}
        >
          <div className="reader-book-title">{currentBook.title}</div>
          <div className="reader-book-author">{currentBook.author}</div>
        </div>

        {/* 目录（仅 EPUB/MOBI/AZW3 支持） */}
        {['EPUB', 'MOBI', 'AZW3'].includes(format) && (
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

        {/* 阅读设置 */}
        <button
          className={`reader-toolbar-btn ${showSettings ? 'active' : ''}`}
          onClick={() => setShowSettings(!showSettings)}
          title="阅读设置"
          id="btn-settings"
          style={{position:'relative'}}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
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
