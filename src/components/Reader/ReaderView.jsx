import React, { useEffect, useRef, useState, Suspense } from 'react'
import { useStore } from '../../store/useStore'
// 懒加载各格式阅读器组件（首屏无需加载全部 ~260KB 的阅读器代码）
const EpubReader = React.lazy(() => import('./EpubReader').then(m => ({ default: m.EpubReader })))
const PdfReader = React.lazy(() => import('./PdfReader').then(m => ({ default: m.PdfReader })))
const TxtReader = React.lazy(() => import('./TxtReader').then(m => ({ default: m.TxtReader })))
const MobiReader = React.lazy(() => import('./MobiReader').then(m => ({ default: m.MobiReader })))
const Azw3Reader = React.lazy(() => import('./Azw3Reader').then(m => ({ default: m.Azw3Reader })))
import { BookmarkPanel } from './BookmarkPanel'
import { AnnotationPanel } from './AnnotationPanel'
import { TextSelectionToolbar } from './TextSelectionToolbar'
import { SettingsPanel } from './SettingsPanel'
import { BookInfoModal } from '../UI/BookInfoModal'
import { InBookSearchModal } from './InBookSearchModal'
import { TtsPlayerBar } from './TtsPlayerBar'

export function ReaderView() {
  const {
    currentBook, closeBook,
    showToc, setShowToc,
    showBookmarks, setShowBookmarks,
    showAnnotations, setShowAnnotations,
    showSearch, setShowSearch,
    showTts, setShowTts,
    showSettings, setShowSettings,
    bookmarks, setBookmarks, addBookmarkToStore, removeBookmarkFromStore,
    annotations, setAnnotations, addAnnotationToStore, updateAnnotationInStore, removeAnnotationFromStore,
    readingProgress, setReadingProgress,
    showToast, settings,
    updateSettings
  } = useStore()

  const [progress, setProgress] = useState(0)
  const [showInfoModal, setShowInfoModal] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const getPositionRef = useRef(null)
  const searchProviderRef = useRef(null)
  const jumpToRef = useRef(null)
  const getTtsBlocksRef = useRef(null)
  const saveProgressTimeoutRef = useRef(null)

  // 全局快捷键监听 Ctrl+F 唤起书内搜索
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setShowSearch(!useStore.getState().showSearch)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [setShowSearch])

  const handleDoSearch = async (kw) => {
    if (!searchProviderRef.current?.search) return []
    setIsSearching(true)
    try {
      return await searchProviderRef.current.search(kw)
    } catch (err) {
      console.error('书内搜索失败:', err)
      return []
    } finally {
      setIsSearching(false)
    }
  }

  const handleJumpToSearchResult = (result) => {
    if (searchProviderRef.current?.jumpTo) {
      searchProviderRef.current.jumpTo(result)
    }
  }

  // ===== 划词高亮与想法批注逻辑 =====
  const [selectionState, setSelectionState] = useState(null)

  useEffect(() => {
    const handleMouseUp = (e) => {
      // 避免在工具条内部或其子元素操作时被误当作重新划词
      if (e.target && e.target.closest && e.target.closest('.text-selection-toolbar')) {
        return
      }

      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) return
        const text = sel.toString().trim()
        if (text.length >= 1 && text.length <= 1500) {
          try {
            const range = sel.getRangeAt(0)
            const rect = range.getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0) {
              setSelectionState({
                position: {
                  x: Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2)),
                  y: Math.max(80, rect.top)
                },
                selectedText: text,
                existingAnnotation: null
              })
            }
          } catch (err) {}
        }
      }, 60)
    }

    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

  // 点击正文中已有划线触发工具条编辑或删除
  const handleAnnotationClick = (ann, e) => {
    if (!ann) return
    const rect = e?.currentTarget?.getBoundingClientRect?.()
    const pos = rect ? {
      x: Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2)),
      y: Math.max(80, rect.top)
    } : { x: window.innerWidth / 2, y: 150 }

    setSelectionState({
      position: pos,
      selectedText: ann.selectedText,
      existingAnnotation: ann
    })
  }

  // 添加或修改高亮标注
  const handleHighlight = async (colorObj) => {
    if (!selectionState?.selectedText || !currentBook?.id) return

    if (selectionState.existingAnnotation) {
      const annId = selectionState.existingAnnotation.id
      await window.api.updateAnnotation(currentBook.id, annId, { color: colorObj.color })
      updateAnnotationInStore(annId, { color: colorObj.color })
      showToast('已更新划线颜色', 'success')
      setSelectionState(null)
      return
    }

    const pos = getPositionRef.current ? getPositionRef.current() : null
    const newAnn = {
      bookId: currentBook.id,
      selectedText: selectionState.selectedText,
      cfiRange: selectionState.cfiRange || null,
      color: colorObj.color,
      chapterTitle: pos?.label || '正文',
      location: pos,
      note: ''
    }

    const saved = await window.api.addAnnotation(currentBook.id, newAnn)
    addAnnotationToStore(saved)
    showToast('已完成高亮划线', 'success')
    setSelectionState(null)
    window.getSelection()?.removeAllRanges()
  }

  // 保存想法笔记
  const handleSaveNote = async (noteText) => {
    if (!selectionState?.selectedText || !currentBook?.id) return

    if (selectionState.existingAnnotation) {
      const annId = selectionState.existingAnnotation.id
      await window.api.updateAnnotation(currentBook.id, annId, { note: noteText })
      updateAnnotationInStore(annId, { note: noteText })
      showToast('想法已更新', 'success')
      setSelectionState(null)
      return
    }

    const pos = getPositionRef.current ? getPositionRef.current() : null
    const newAnn = {
      bookId: currentBook.id,
      selectedText: selectionState.selectedText,
      cfiRange: selectionState.cfiRange || null,
      color: '#ffe066',
      chapterTitle: pos?.label || '正文',
      location: pos,
      note: noteText
    }

    const saved = await window.api.addAnnotation(currentBook.id, newAnn)
    addAnnotationToStore(saved)
    showToast('想法已记录', 'success')
    setSelectionState(null)
    window.getSelection()?.removeAllRanges()
  }

  // 复制文本
  const handleCopySelection = () => {
    if (selectionState?.selectedText) {
      navigator.clipboard.writeText(selectionState.selectedText)
      showToast('已复制选中文本', 'info')
      setSelectionState(null)
    }
  }

  // 删除单条划线笔记
  const handleRemoveAnnotation = async (annId) => {
    await window.api.removeAnnotation(currentBook.id, annId)
    removeAnnotationFromStore(annId)
    setSelectionState(null)
    showToast('划线笔记已删除', 'success')
  }

  // 点击笔记列表中的单项跳转定位
  const handleSelectAnnotation = (ann) => {
    if (!ann) return
    const target = ann.location || {
      cfiRange: ann.cfiRange,
      cfi: ann.cfiRange,
      chapterTitle: ann.chapterTitle,
      selectedText: ann.selectedText
    }

    if (ann.location) {
      setReadingProgress(ann.location)
    }

    let jumped = false
    if (jumpToRef.current) {
      jumpToRef.current(target)
      jumped = true
    } else if (searchProviderRef.current?.jumpTo) {
      searchProviderRef.current.jumpTo(target)
      jumped = true
    }

    if (!jumped && searchProviderRef.current?.search && ann.selectedText) {
      searchProviderRef.current.search(ann.selectedText.slice(0, 30)).then(results => {
        if (results && results.length > 0) {
          searchProviderRef.current.jumpTo(results[0])
        }
      })
    }

    showToast(`跳转至：${ann.chapterTitle || '目标划线'}`, 'info')
  }

  // 导出全部笔记为 Markdown
  const handleExportAnnotations = async () => {
    if (!annotations || annotations.length === 0) {
      showToast('当前书籍暂无划线或笔记', 'info')
      return
    }
    const res = await window.api.exportAnnotationsMarkdown({
      bookTitle: currentBook.title,
      bookAuthor: currentBook.author,
      annotations
    })
    if (res.success) {
      showToast('读书笔记已成功导出为 Markdown', 'success')
    } else if (res.error && res.error !== '用户取消了导出') {
      showToast('导出失败: ' + res.error, 'error')
    }
  }

  // ===== 听书模式与跟读高亮联动 =====
  const lastHighlightedElRef = useRef(null)

  const handleTtsParagraphChange = (idx, text) => {
    if (lastHighlightedElRef.current) {
      lastHighlightedElRef.current.classList.remove('tts-speaking-highlight')
      lastHighlightedElRef.current = null
    }

    if (!text) return

    // 优先通过 data-para-idx 寻找当前阅读器精准段落
    let targetEl = document.querySelector(`[data-para-idx="${idx}"]`)

    // 兜底：通过文本模糊匹配视口内的段落
    if (!targetEl) {
      const candidates = document.querySelectorAll('.reader-content-area p, #txt-content p, #mobi-scroll-content p')
      const snippet = text.slice(0, 15).trim()
      for (const el of candidates) {
        if (el.textContent && el.textContent.includes(snippet)) {
          targetEl = el
          break
        }
      }
    }

    if (targetEl) {
      targetEl.classList.add('tts-speaking-highlight')
      lastHighlightedElRef.current = targetEl
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  // 关闭听书时清除所有高亮
  useEffect(() => {
    if (!showTts && lastHighlightedElRef.current) {
      lastHighlightedElRef.current.classList.remove('tts-speaking-highlight')
      lastHighlightedElRef.current = null
    }
  }, [showTts])

  // 卸载时清理防抖定时器
  useEffect(() => {
    return () => {
      if (saveProgressTimeoutRef.current) {
        clearTimeout(saveProgressTimeoutRef.current)
      }
    }
  }, [])

  // 加载书签、笔记和进度
  useEffect(() => {
    if (!currentBook || !currentBook.id) {
      setAnnotations([])
      return
    }
    window.api.getBookmarks(currentBook.id).then(setBookmarks)
    window.api.getAnnotations(currentBook.id).then(setAnnotations)
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

  // 点击阅读设置面板外的区域时自动收起；设置按钮本身仍由其点击事件负责切换。
  useEffect(() => {
    if (!showSettings) return

    const handleClickOutsideSettings = (event) => {
      // 若当前正在与系统文件选择框交互或刚完成导入（1.5秒缓冲保护期），绝对不关闭
      if (window._isFileDialogActive || (window._lastImportTime && Date.now() - window._lastImportTime < 1500)) return

      // 若当前存在确认对话框，或者点击发生在确认对话框/提示框上，不关闭设置面板
      if (document.querySelector('.confirm-modal-overlay') || event.target?.closest?.('.confirm-modal-overlay, .toast')) return

      const settingsPanel = document.getElementById('settings-panel')
      const target = event.target
      if (settingsPanel?.contains(target) || target?.closest?.('#btn-settings')) return

      setShowSettings(false)
    }

    document.addEventListener('mousedown', handleClickOutsideSettings)
    return () => document.removeEventListener('mousedown', handleClickOutsideSettings)
  }, [showSettings, setShowSettings])

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

  const handleSelectBookmark = (bm) => {
    if (!bm) return
    setReadingProgress(bm)
    if (jumpToRef.current) {
      jumpToRef.current(bm)
      showToast(bm.label ? `已跳至：${bm.label}` : '已跳至书签位置', 'info')
    } else if (searchProviderRef.current?.jumpTo) {
      searchProviderRef.current.jumpTo(bm)
      showToast(bm.label ? `已跳至：${bm.label}` : '已跳至书签位置', 'info')
    }
  }

  const readerFallback = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
      <div className="loading-spinner" style={{ width: '24px', height: '24px', borderWidth: '2px' }} />
    </div>
  )

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
      registerSearchProvider: (provider) => { searchProviderRef.current = provider },
      registerJumpTo: (fn) => { jumpToRef.current = fn },
      registerGetTtsBlocks: (fn) => { getTtsBlocksRef.current = fn },
      annotations,
      onAnnotationClick: handleAnnotationClick,
      onTextSelected: setSelectionState,
      showToc,
      onTocItemClick: () => {}
    }
    let reader
    switch (format) {
      case 'EPUB': reader = <EpubReader {...props} />; break
      case 'PDF': reader = <PdfReader {...props} />; break
      case 'TXT': reader = <TxtReader {...props} />; break
      case 'MOBI': reader = <MobiReader {...props} />; break
      case 'AZW3': reader = <Azw3Reader {...props} />; break
      default: return <div style={{padding:'40px',color:'var(--text-muted)'}}>不支持的格式: {format}</div>
    }
    return <Suspense fallback={readerFallback}>{reader}</Suspense>
  }

  return (
    <div className="reader-view">
      {/* 进度条 */}
      <div className="reading-progress-bar">
        <div className="reading-progress-fill" style={{width: `${progress * 100}%`}} />
      </div>

      {/* 工具栏 */}
      {settings.theme === 'word' ? (
        <div style={{
          height: '38px',
          backgroundColor: '#f3f3f3',
          borderBottom: '1px solid #d4d4d4',
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          gap: '6px',
          color: '#333333',
          fontSize: '12px',
          flexShrink: 0,
          zIndex: 10,
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
        }}>
          <button 
            onClick={closeBook}
            style={{
              backgroundColor: '#185abd',
              color: '#ffffff',
              border: 'none',
              padding: '4px 12px',
              borderRadius: '2px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '12px',
              marginRight: '4px'
            }}
            title="返回书库"
          >
            文件
          </button>
          <span style={{ padding: '4px 10px', background: '#ffffff', borderTop: '2px solid #185abd', fontWeight: '600', color: '#185abd', cursor: 'default' }}>
            开始
          </span>
          <span 
            style={{ padding: '4px 10px', color: '#555555', cursor: 'pointer' }}
            onClick={['EPUB', 'MOBI', 'AZW3', 'TXT', 'PDF'].includes(format) ? () => setShowToc(!showToc) : undefined}
          >
            目录
          </span>

          {/* 右侧原核心功能与排版控制组 */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {['EPUB', 'MOBI', 'AZW3', 'TXT', 'PDF'].includes(format) && (
                <button
                  className={`reader-toolbar-btn ${showToc ? 'active' : ''}`}
                  onClick={() => setShowToc(!showToc)}
                  title="目录"
                  id="btn-toc"
                  style={{ background: '#ffffff', border: '1px solid #d0d0d0', color: '#333333' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                    <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
                    <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                </button>
              )}

              {/* 书内搜索 */}
              <button
                className={`reader-toolbar-btn ${showSearch ? 'active' : ''}`}
                onClick={() => setShowSearch(!showSearch)}
                title="书内搜索 (Ctrl+F)"
                id="btn-inbook-search"
                style={{ background: '#ffffff', border: '1px solid #d0d0d0', color: '#333333' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </button>

              <button 
                className="reader-toolbar-btn" 
                onClick={handleAddBookmark} 
                title="添加书签" 
                id="btn-add-bookmark"
                style={{ background: '#ffffff', border: '1px solid #d0d0d0', color: '#333333' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              </button>

              <button
                className={`reader-toolbar-btn ${showBookmarks ? 'active' : ''}`}
                onClick={() => setShowBookmarks(!showBookmarks)}
                title="书签列表"
                id="btn-bookmarks"
                style={{ background: '#ffffff', border: '1px solid #d0d0d0', color: '#333333', position: 'relative' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  <line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>
                </svg>
                {bookmarks.length > 0 && (
                  <span style={{
                    position:'absolute', top:'-4px', right:'-4px',
                    background:'#185abd', color:'white',
                    borderRadius:'50%', width:'14px', height:'14px',
                    fontSize:'9px', display:'flex', alignItems:'center', justifyContent:'center'
                  }}>{bookmarks.length}</span>
                )}
              </button>

              {/* 划线与读书笔记 */}
              <button
                className={`reader-toolbar-btn ${showAnnotations ? 'active' : ''}`}
                onClick={() => {
                  setShowAnnotations(!showAnnotations)
                  if (showBookmarks) setShowBookmarks(false)
                }}
                title="划线与读书笔记"
                id="btn-annotations"
                style={{
                  background: showAnnotations ? '#e8f0fe' : '#ffffff',
                  border: showAnnotations ? '1px solid #185abd' : '1px solid #d0d0d0',
                  color: showAnnotations ? '#185abd' : '#333333',
                  position: 'relative'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                {annotations.length > 0 && (
                  <span style={{
                    position:'absolute', top:'-4px', right:'-4px',
                    background:'#185abd', color:'white',
                    borderRadius:'50%', width:'14px', height:'14px',
                    fontSize:'9px', display:'flex', alignItems:'center', justifyContent:'center'
                  }}>{annotations.length}</span>
                )}
              </button>

              {/* 听书朗读 */}
              <button
                className={`reader-toolbar-btn ${showTts ? 'active' : ''}`}
                onClick={() => setShowTts(!showTts)}
                title="听书朗读模式"
                id="btn-tts"
                style={{
                  background: showTts ? '#e8f0fe' : '#ffffff',
                  border: showTts ? '1px solid #185abd' : '1px solid #d0d0d0',
                  color: showTts ? '#185abd' : '#333333'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                </svg>
              </button>

              <button
                className={`reader-toolbar-btn ${showInfoModal ? 'active' : ''}`}
                onClick={() => setShowInfoModal(true)}
                title="书籍信息"
                id="btn-book-info"
                style={{ background: '#ffffff', border: '1px solid #d0d0d0', color: '#333333' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="16" x2="12" y2="12"/>
                  <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
              </button>

              <button
                className={`reader-toolbar-btn ${showSettings ? 'active' : ''}`}
                onClick={() => setShowSettings(!showSettings)}
                title="阅读设置"
                id="btn-settings"
                style={{ background: '#ffffff', border: '1px solid #d0d0d0', color: '#333333' }}
              >
                <span style={{ fontSize: '13px', fontWeight: 'bold', fontFamily: 'system-ui' }}>Aa</span>
              </button>

              {/* 排版模式组 */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  className={`reader-toolbar-btn ${settings.layoutMode === 'horizontal' ? 'active' : ''}`}
                  onClick={() => updateSettings({ layoutMode: 'horizontal' })}
                  style={{ width: 'auto', padding: '0 8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '500', background: '#ffffff', border: '1px solid #d0d0d0', color: '#333333' }}
                  title="全窗口显示"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="4" y="3" width="16" height="18" rx="2" ry="2" />
                  </svg>
                  全窗口
                </button>
                <button
                  className={`reader-toolbar-btn ${settings.layoutMode === 'horizontal-scroll' ? 'active' : ''}`}
                  onClick={() => updateSettings({ layoutMode: 'horizontal-scroll' })}
                  style={{ width: 'auto', padding: '0 8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '500', background: '#ffffff', border: '1px solid #d0d0d0', color: '#333333' }}
                  title="左右滚动"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="20" y1="8" x2="4" y2="8" />
                  </svg>
                  左右滚动
                </button>
                <button
                  className={`reader-toolbar-btn ${settings.layoutMode === 'vertical' ? 'active' : ''}`}
                  onClick={() => updateSettings({ layoutMode: 'vertical' })}
                  style={{ width: 'auto', padding: '0 8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '500', background: '#ffffff', border: '1px solid #d0d0d0', color: '#333333' }}
                  title="上下滚动"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="8" y1="20" x2="8" y2="4" />
                  </svg>
                  上下滚动
                </button>
              </div>
            </div>
          </div>
        ) : (
        <div className="reader-toolbar">
          <button className="reader-back-btn" id="reader-back-btn" onClick={closeBook}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            书库
          </button>
          <div 
            className={`reader-book-info ${['EPUB', 'MOBI', 'AZW3', 'TXT', 'PDF'].includes(format) ? 'clickable' : ''}`}
            onClick={['EPUB', 'MOBI', 'AZW3', 'TXT', 'PDF'].includes(format) ? () => setShowToc(!showToc) : undefined}
            title={['EPUB', 'MOBI', 'AZW3', 'TXT', 'PDF'].includes(format) ? "点击切换目录" : ""}
          >
            <div className="reader-book-title">{currentBook.title}</div>
            <div className="reader-book-author">{currentBook.author}</div>
          </div>

          {/* 目录 */}
          {['EPUB', 'MOBI', 'AZW3', 'TXT', 'PDF'].includes(format) && (
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

          {/* 书内搜索 */}
          <button
            className={`reader-toolbar-btn ${showSearch ? 'active' : ''}`}
            onClick={() => setShowSearch(!showSearch)}
            title="书内搜索 (Ctrl+F)"
            id="btn-inbook-search"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>

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

          {/* 划线与读书笔记 */}
          <button
            className={`reader-toolbar-btn ${showAnnotations ? 'active' : ''}`}
            onClick={() => {
              setShowAnnotations(!showAnnotations)
              if (showBookmarks) setShowBookmarks(false)
            }}
            title="划线与读书笔记"
            id="btn-annotations"
            style={{ position: 'relative' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            {annotations.length > 0 && (
              <span style={{
                position:'absolute', top:'-4px', right:'-4px',
                background:'var(--accent, #4f46e5)', color:'white',
                borderRadius:'50%', width:'14px', height:'14px',
                fontSize:'9px', display:'flex', alignItems:'center', justifyContent:'center'
              }}>{annotations.length}</span>
            )}
          </button>

          {/* 听书朗读 */}
          <button
            className={`reader-toolbar-btn ${showTts ? 'active' : ''}`}
            onClick={() => setShowTts(!showTts)}
            title="听书朗读模式"
            id="btn-tts"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
            </svg>
          </button>

          {/* 书籍信息 */}
          <button
            className={`reader-toolbar-btn ${showInfoModal ? 'active' : ''}`}
            onClick={() => setShowInfoModal(true)}
            title="书籍信息"
            id="btn-book-info"
            style={{ position:'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
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
      )}

      {/* 内容区 */}
      <div className="reader-content-area" style={{position:'relative'}}>
        {renderReader()}
        {showBookmarks && (
          <BookmarkPanel
            bookmarks={bookmarks}
            onRemove={handleRemoveBookmark}
            onSelect={handleSelectBookmark}
          />
        )}
        {showAnnotations && (
          <AnnotationPanel
            annotations={annotations}
            onRemove={handleRemoveAnnotation}
            onSelect={handleSelectAnnotation}
            onExport={handleExportAnnotations}
            bookTitle={currentBook?.title}
          />
        )}
        {showSettings && <SettingsPanel />}
        {showInfoModal && <BookInfoModal book={currentBook} onClose={() => setShowInfoModal(false)} />}
        <InBookSearchModal
          isOpen={showSearch}
          onClose={() => setShowSearch(false)}
          onSearch={handleDoSearch}
          onJumpTo={handleJumpToSearchResult}
          isSearching={isSearching}
        />
        {selectionState && (
          <TextSelectionToolbar
            position={selectionState.position}
            selectedText={selectionState.selectedText}
            existingAnnotation={selectionState.existingAnnotation}
            onHighlight={handleHighlight}
            onSaveNote={handleSaveNote}
            onCopy={handleCopySelection}
            onAddBookmark={handleAddBookmark}
            onDeleteAnnotation={() => handleRemoveAnnotation(selectionState.existingAnnotation?.id)}
            onClose={() => setSelectionState(null)}
          />
        )}
        <TtsPlayerBar
          isOpen={showTts}
          onClose={() => setShowTts(false)}
          onParagraphChange={handleTtsParagraphChange}
          getTtsContext={() => (getTtsBlocksRef.current ? getTtsBlocksRef.current() : null)}
          readingProgress={readingProgress}
        />
      </div>
    </div>
  )
}
