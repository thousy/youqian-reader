import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { useStore } from '../../store/useStore'
import { StatusBar } from './StatusBar'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export function PdfReader({ book, savedProgress, settings, onProgressChange, registerGetPosition }) {
  const [pdf, setPdf] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [scale, setScale] = useState(1.2)
  const [jumpPage, setJumpPage] = useState('')
  const containerRef = useRef(null)
  const renderTaskRef = useRef(null)
  const canvasRef = useRef(null)
  const { showToast } = useStore()
  const [rect, setRect] = useState({ width: 0, height: 0 })
  const wrapperRef = useRef(null)

  const isCardStyle = settings.layoutMode === 'vertical' || settings.layoutMode === 'horizontal-scroll'
  const desktopBg = settings.globalTheme === 'light' ? '#eaeaf2' : '#0d0d14'
  const readerBg = {
    light: '#fafafa',
    sepia: '#f4ede0',
    dark: '#12121c',
    night: '#05050a'
  }[settings.theme] || '#12121c'

  const layoutWidth = isCardStyle ? Math.min(840, rect.width - 40) : rect.width
  const pageW = isCardStyle && layoutWidth ? Math.min(800, layoutWidth - 40) : 800
  const realStartPadding = (rect.width - pageW) / 2

  // 卡片滑动位移过渡动画状态 (垂直/水平翻页)
  const [animState, setAnimState] = useState('idle') // 'idle', 'out-up', 'out-down', 'in-up', 'in-down', 'out-left', 'out-right', 'in-left', 'in-right'
  const [isTransitionActive, setIsTransitionActive] = useState(false)
  const animationTimeoutRef = useRef(null)

  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const triggerPageTransition = useCallback((direction, changePageFn) => {
    if (animationTimeoutRef.current) return
    
    const layoutMode = settingsRef.current.layoutMode
    const isVertical = layoutMode === 'vertical'
    const isHorizontal = layoutMode === 'horizontal-scroll'
    
    setIsTransitionActive(true)
    if (isVertical) {
      setAnimState(direction === 'next' ? 'out-up' : 'out-down')
    } else if (isHorizontal) {
      setAnimState(direction === 'next' ? 'out-left' : 'out-right')
    }

    animationTimeoutRef.current = setTimeout(() => {
      try {
        changePageFn()
      } catch (err) {
        console.error(err)
      }

      setIsTransitionActive(false)
      if (isVertical) {
        setAnimState(direction === 'next' ? 'in-up' : 'in-down')
      } else if (isHorizontal) {
        setAnimState(direction === 'next' ? 'in-right' : 'in-left')
      }

      setTimeout(() => {
        setIsTransitionActive(true)
        setAnimState('idle')

        animationTimeoutRef.current = setTimeout(() => {
          setIsTransitionActive(false)
          animationTimeoutRef.current = null
        }, 150)
      }, 30)
    }, 150)
  }, [])

  const triggerPageTransitionRef = useRef(null)
  triggerPageTransitionRef.current = triggerPageTransition

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        const fileData = await window.api.readFile(book.filePath)
        let arrayBuffer
        if (fileData instanceof ArrayBuffer) {
          arrayBuffer = fileData
        } else if (fileData instanceof Uint8Array) {
          arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength)
        } else if (ArrayBuffer.isView(fileData)) {
          arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength)
        } else if (fileData && fileData.type === 'Buffer' && Array.isArray(fileData.data)) {
          arrayBuffer = new Uint8Array(fileData.data).buffer
        } else {
          throw new Error('无法识别文件数据格式')
        }
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
        const pdfDoc = await loadingTask.promise
        if (!mounted) return
        setPdf(pdfDoc)
        setTotalPages(pdfDoc.numPages)
        const startPage = savedProgress?.page || 1
        setCurrentPage(Math.min(startPage, pdfDoc.numPages))
        setLoading(false)
      } catch (e) {
        console.error('PDF 加载失败:', e)
        if (mounted) { setLoading(false); showToast('PDF 加载失败: ' + e.message, 'error') }
      }
    }
    load()
    return () => { mounted = false }
  }, [book.id])

  useEffect(() => {
    if (!pdf || !canvasRef.current) return
    renderPage(pdf, currentPage)
  }, [pdf, currentPage, scale])

  useEffect(() => {
    registerGetPosition(() => ({
      label: `第 ${currentPage} 页`,
      page: currentPage
    }))
  }, [currentPage])

  useEffect(() => {
    if (totalPages > 0) {
      onProgressChange({ page: currentPage, percentage: currentPage / totalPages })
    }
  }, [currentPage, totalPages])

  async function renderPage(pdfDoc, pageNum) {
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel() } catch {}
    }
    const page = await pdfDoc.getPage(pageNum)
    const canvas = canvasRef.current
    if (!canvas) return
    const viewport = page.getViewport({ scale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    const task = page.render({ canvasContext: ctx, viewport })
    renderTaskRef.current = task
    try {
      await task.promise
    } catch (e) {
      if (e.name !== 'RenderingCancelledException') console.error(e)
    }
  }

  const goNext = useCallback(() => {
    if (isCardStyle) {
      if (currentPage >= totalPages) return
      triggerPageTransitionRef.current?.('next', () => {
        setCurrentPage(p => Math.min(p + 1, totalPages))
      })
    } else {
      setCurrentPage(p => Math.min(p + 1, totalPages))
    }
  }, [isCardStyle, currentPage, totalPages])

  const goPrev = useCallback(() => {
    if (isCardStyle) {
      if (currentPage <= 1) return
      triggerPageTransitionRef.current?.('prev', () => {
        setCurrentPage(p => Math.max(p - 1, 1))
      })
    } else {
      setCurrentPage(p => Math.max(p - 1, 1))
    }
  }, [isCardStyle, currentPage, totalPages])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        goNext()
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        goPrev()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [goNext, goPrev])

  // 鼠标滚轮翻页（带 450ms 冷却防抖锁）
  const lastWheelTime = useRef(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e) => {
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelTime.current < 350) return
      
      if (e.deltaY > 0) {
        lastWheelTime.current = now
        goNext()
      } else if (e.deltaY < 0) {
        lastWheelTime.current = now
        goPrev()
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [goNext, goPrev, containerRef.current])

  const handleJump = (e) => {
    e.preventDefault()
    const n = parseInt(jumpPage)
    if (n >= 1 && n <= totalPages) { setCurrentPage(n); setJumpPage('') }
  }

  // 监听外层容器的实际大小
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 100 && height > 100) {
          setRect({ width, height })
        }
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 统一圆形悬浮按钮样式
  const navButtonStyle = (side) => {
    const isCard = settingsRef.current.layoutMode === 'vertical' || settingsRef.current.layoutMode === 'horizontal-scroll'
    const isWide = rect.width > 920
    let offset = '20px'
    if (isCard) {
      offset = isWide ? `${realStartPadding - 54}px` : '16px'
    }
    return {
      position: 'absolute',
      top: '50%',
      [side]: offset,
      transform: 'translateY(-50%) scale(1)',
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      backgroundColor: settingsRef.current.theme === 'light' || settingsRef.current.theme === 'sepia' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: settingsRef.current.theme === 'light' || settingsRef.current.theme === 'sepia' ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.12)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
      color: 'var(--text-primary)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: 0.5,
      outline: 'none'
    }
  }

  const handleBtnMouseEnter = (e) => {
    e.currentTarget.style.opacity = '1'
    e.currentTarget.style.transform = 'translateY(-50%) scale(1.12)'
    e.currentTarget.style.backgroundColor = settingsRef.current.theme === 'light' || settingsRef.current.theme === 'sepia' ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.18)'
  }

  const handleBtnMouseLeave = (e) => {
    e.currentTarget.style.opacity = '0.5'
    e.currentTarget.style.transform = 'translateY(-50%) scale(1)'
    e.currentTarget.style.backgroundColor = settingsRef.current.theme === 'light' || settingsRef.current.theme === 'sepia' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)'
  }

  return (
    <div ref={wrapperRef} style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',backgroundColor: isCardStyle ? desktopBg : 'var(--bg-base)'}}>
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner"/>
          <span>正在加载 PDF...</span>
        </div>
      )}
      <div style={{position:'relative',flex:1,overflow:'hidden'}}>
        <div 
          ref={containerRef} 
          className="pdf-container"
          style={{
            width: isCardStyle ? 'calc(100% - 40px)' : '100%',
            maxWidth: isCardStyle ? `${pageW}px` : 'none',
            margin: isCardStyle ? '0 auto 20px' : '0 auto',
            backgroundColor: isCardStyle ? readerBg : 'transparent',
            borderRadius: isCardStyle ? '0 0 8px 8px' : '0',
            boxShadow: isCardStyle ? '0 10px 40px rgba(0, 0, 0, 0.3)' : 'none',
            boxSizing: 'border-box',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: isCardStyle ? 'calc(100% - 20px)' : '100%',
            outline: 'none',
            transition: isTransitionActive ? 'transform 0.15s ease-in-out, opacity 0.15s ease-in-out' : 'none',
            transform: 
              animState === 'out-up' ? 'translateY(-60px)' :
              animState === 'out-down' ? 'translateY(60px)' :
              animState === 'in-up' ? 'translateY(60px)' :
              animState === 'in-down' ? 'translateY(-60px)' :
              animState === 'out-left' ? 'translateX(-60px)' :
              animState === 'out-right' ? 'translateX(60px)' :
              animState === 'in-right' ? 'translateX(60px)' :
              animState === 'in-left' ? 'translateX(-60px)' : 'translateY(0)',
            opacity: (
              animState === 'out-up' || animState === 'out-down' || animState === 'in-up' || animState === 'in-down' ||
              animState === 'out-left' || animState === 'out-right' || animState === 'in-left' || animState === 'in-right'
            ) ? 0 : 1
          }}
        >
          <canvas ref={canvasRef} className="pdf-page-canvas" id="pdf-canvas" style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            display: 'block'
          }}/>
        </div>
        {!loading && totalPages > 0 && (
          <StatusBar
            chapterName={book.title || '正文'}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={(page) => {
              if (page === 'home') setCurrentPage(1)
              else if (page === 'end') setCurrentPage(totalPages)
              else if (page === 'prev') setCurrentPage(prev => Math.max(1, prev - 1))
              else if (page === 'next') setCurrentPage(prev => Math.min(totalPages, prev + 1))
              else {
                const num = parseInt(page)
                if (!isNaN(num)) setCurrentPage(num)
              }
            }}
          />
        )}
        {!loading && currentPage > 1 && (
          <button
            style={navButtonStyle('left')}
            onClick={goPrev}
            onMouseEnter={handleBtnMouseEnter}
            onMouseLeave={handleBtnMouseLeave}
            aria-label="上一页"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}
        {!loading && currentPage < totalPages && (
          <button
            style={navButtonStyle('right')}
            onClick={goNext}
            onMouseEnter={handleBtnMouseEnter}
            onMouseLeave={handleBtnMouseLeave}
            aria-label="下一页"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}
      </div>
      {!loading && (
        <div className="pdf-controls">
          <button className="pdf-page-btn" id="pdf-prev-btn"
            onClick={goPrev}
            disabled={currentPage <= 1}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <form onSubmit={handleJump} style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <input type="number" value={jumpPage || currentPage}
              onChange={e => setJumpPage(e.target.value)}
              onFocus={e => setJumpPage(String(currentPage))}
              style={{
                width:'48px', textAlign:'center',
                background:'var(--bg-hover)', border:'1px solid var(--border)',
                borderRadius:'6px', color:'var(--text-primary)',
                fontSize:'13px', padding:'4px', outline:'none'
              }}
              min={1} max={totalPages}
            />
            <span className="pdf-page-info">/ {totalPages}</span>
          </form>
          <button className="pdf-page-btn" id="pdf-next-btn"
            onClick={goNext}
            disabled={currentPage >= totalPages}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <div style={{width:'1px',height:'20px',background:'var(--border-subtle)'}}/>
          <button className="pdf-page-btn" onClick={() => setScale(s => Math.max(0.5, s - 0.2))} title="缩小">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <span className="pdf-page-info">{Math.round(scale * 100)}%</span>
          <button className="pdf-page-btn" onClick={() => setScale(s => Math.min(3, s + 0.2))} title="放大">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
