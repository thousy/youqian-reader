import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../../store/useStore'

export function MobiReader({ book, savedProgress, settings, onProgressChange, registerGetPosition, showToc }) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [rect, setRect] = useState({ width: 0, height: 0 })
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [currentChapterName, setCurrentChapterName] = useState('正文')
  
  // 目录相关 State
  const [toc, setToc] = useState([])
  const [currentTocItem, setCurrentTocItem] = useState(null)

  const containerRef = useRef(null)
  const readerAreaRef = useRef(null)
  const isInitialized = useRef(false)
  const { showToast } = useStore()

  // 监听阅读区容器的实际大小（当目录面板展开/收缩时，此容器尺寸会发生改变）
  useEffect(() => {
    const el = readerAreaRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setRect({ width, height })
        }
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 加载 mobi 内容并动态解析提取目录 (TOC)
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        const result = await window.api.extractMobiContent(book.filePath)
        if (!mounted) return
        
        const rawHtml = result.html || '<p>无法读取内容</p>'
        
        // 使用 DOMParser 解析出标题，动态附加 ID 以生成目录
        const parser = new DOMParser()
        const doc = parser.parseFromString(rawHtml, 'text/html')
        
        const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6')
        const extractedToc = []
        
        headings.forEach((heading, index) => {
          let id = heading.getAttribute('id')
          if (!id) {
            id = `mobi-toc-heading-${index}`
            heading.setAttribute('id', id)
          }
          
          const label = heading.textContent.trim()
          if (label) {
            let level = 0
            const tagName = heading.tagName.toLowerCase()
            if (tagName === 'h1') level = 0
            else if (tagName === 'h2') level = 1
            else if (tagName === 'h3') level = 2
            else level = 3
            
            extractedToc.push({
              label,
              href: id,
              level
            })
          }
        })
        
        setToc(extractedToc)
        setContent(doc.body.innerHTML)
        setTitle(result.title || book.title)
        setLoading(false)
      } catch (e) {
        if (mounted) {
          setLoading(false)
          setContent(`<p style="color:var(--text-muted)">无法读取 ${book.format} 文件: ${e.message}</p>`)
          showToast(`${book.format} 加载失败: ${e.message}`, 'error')
        }
      }
    }
    load()
    return () => { mounted = false }
  }, [book.id])

  // 物理章节名动态匹配，并安全驱动 TOC 左侧联动高亮
  const updateChapterNameAndToc = useCallback((pageIdx) => {
    if (toc.length === 0) {
      setCurrentChapterName('正文')
      return
    }
    const el = containerRef.current
    if (!el || !rect.width) return

    const scrollLeftVal = pageIdx * el.offsetWidth
    let matchedChapter = '正文'
    let matchedId = null
    let closestOffset = -999999

    for (let item of toc) {
      const headingEl = document.getElementById(item.href)
      if (headingEl) {
        const offsetLeft = headingEl.offsetLeft
        if (offsetLeft <= scrollLeftVal + 10 && offsetLeft > closestOffset) {
          closestOffset = offsetLeft
          matchedChapter = item.label
          matchedId = item.href
        }
      }
    }

    setCurrentChapterName(matchedChapter ? matchedChapter.trim() : '正文')
    if (matchedId) {
      setCurrentTocItem(matchedId)
    }
  }, [toc, rect.width])

  // 内容、尺寸、目录显示或设置改变时，重新计算分页并对齐 scrollLeft
  useEffect(() => {
    if (loading || !rect.width || !rect.height || !containerRef.current) return

    const timer = setTimeout(() => {
      const el = containerRef.current
      if (!el) return
      
      const total = Math.max(1, Math.ceil(el.scrollWidth / el.offsetWidth))
      setTotalPages(total)

      if (!isInitialized.current) {
        isInitialized.current = true
        if (savedProgress?.pageIndex != null) {
          const idx = Math.min(savedProgress.pageIndex, total - 1)
          setCurrentPage(idx)
          el.scrollLeft = idx * el.offsetWidth
          updateChapterNameAndToc(idx)
        } else {
          setCurrentPage(0)
          el.scrollLeft = 0
          updateChapterNameAndToc(0)
        }
      } else {
        const idx = Math.min(currentPage, total - 1)
        setCurrentPage(idx)
        el.scrollLeft = idx * el.offsetWidth
        updateChapterNameAndToc(idx)
      }
    }, 120) // 给排版和可能的 DOM 变化多留一点渲染响应时间

    return () => clearTimeout(timer)
  }, [loading, rect.width, rect.height, content, showToc, settings.fontSize, settings.fontFamily, settings.lineHeight, updateChapterNameAndToc])

  // 注册进度读取器
  useEffect(() => {
    registerGetPosition(() => {
      const percentage = totalPages > 1 ? currentPage / (totalPages - 1) : 0
      return { label: `${Math.round(percentage * 100)}%`, pageIndex: currentPage, percentage }
    })
  }, [currentPage, totalPages])

  const goToPage = useCallback((pageIndex) => {
    const el = containerRef.current
    if (!el || !rect.width) return
    const total = Math.max(1, Math.ceil(el.scrollWidth / el.offsetWidth))
    const clamped = Math.max(0, Math.min(pageIndex, total - 1))
    
    el.scrollLeft = clamped * el.offsetWidth
    setCurrentPage(clamped)
    setTotalPages(total)
    
    const percentage = total > 1 ? clamped / (total - 1) : 0
    onProgressChange({ pageIndex: clamped, percentage })

    updateChapterNameAndToc(clamped)
  }, [rect.width, onProgressChange, updateChapterNameAndToc])

  // 目录项跳转定位方法
  const jumpToToc = useCallback((targetId) => {
    const el = containerRef.current
    if (!el || !rect.width) return
    const headingEl = el.querySelector(`#${targetId}`)
    if (!headingEl) return
    
    // 计算 headingEl 相对于 container 最左边缘的真实水平偏移（当前 scroll 偏移 + 当前视口左侧相对位移）
    const realLeft = headingEl.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
    const pageW = el.offsetWidth
    const pageIdx = Math.floor(realLeft / pageW)
    
    goToPage(pageIdx)
    setCurrentTocItem(targetId)
  }, [rect.width, goToPage])

  const nextPage = useCallback(() => goToPage(currentPage + 1), [currentPage, goToPage])
  const prevPage = useCallback(() => goToPage(currentPage - 1), [currentPage, goToPage])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        nextPage()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        prevPage()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nextPage, prevPage])

  // 鼠标滚轮翻页（带冷却锁，防止无极/物理滚轮产生连续滚动触发疯狂翻页）
  const lastWheelTime = useRef(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e) => {
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelTime.current < 400) return
      
      if (e.deltaY > 0) {
        lastWheelTime.current = now
        nextPage()
      } else if (e.deltaY < 0) {
        lastWheelTime.current = now
        prevPage()
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [nextPage, prevPage])

  const fontStyle = {
    fontSize: `${settings.fontSize}px`,
    fontFamily: `"${settings.fontFamily}", Georgia, "Noto Serif SC", serif`,
    lineHeight: settings.lineHeight,
    color: 'var(--reader-text, var(--text-primary))'
  }

  const paddingX = 80
  const paddingY = 40

  const columnStyle = {
    columnWidth: rect.width ? `${rect.width - paddingX * 2}px` : 'auto',
    columnGap: `${paddingX * 2}px`,
    height: '100%',
    overflow: 'hidden',
    padding: `${paddingY}px ${paddingX}px`,
    boxSizing: 'border-box',
    width: '100%',
    display: 'block'
  }

  const arrowButtonStyle = (side) => ({
    position: 'absolute',
    top: 0,
    [side]: 0,
    width: '80px',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: side === 'left' ? 'flex-start' : 'flex-end',
    paddingLeft: side === 'left' ? '12px' : undefined,
    paddingRight: side === 'right' ? '12px' : undefined,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    opacity: 0,
    transition: 'opacity 0.2s',
    color: 'var(--text-muted)',
    zIndex: 10,
    boxSizing: 'border-box'
  })

  return (
    <div 
      style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', position: 'relative', width: '100%', height: '100%' }}
    >
      {/* 目录面板 */}
      {showToc && toc.length > 0 && (
        <div className="reader-toc-panel">
          <div className="toc-header">目录</div>
          {toc.map((item, i) => (
            <div
              key={i}
              className={`toc-item level-${item.level} ${currentTocItem === item.href ? 'active' : ''}`}
              onClick={() => jumpToToc(item.href)}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}

      {/* 阅读区 */}
      <div 
        ref={readerAreaRef}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', height: '100%' }}
      >
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: 'var(--text-muted)' }}>
            <div className="loading-spinner" />
            <span>正在解析 {book.format} 文件...</span>
          </div>
        ) : (
          <>
            <div
              ref={containerRef}
              className="mobi-content"
              style={{ ...columnStyle, ...fontStyle }}
              id="mobi-content"
              dangerouslySetInnerHTML={{ __html: content }}
            />

            {/* Left arrow */}
            <button
              style={arrowButtonStyle('left')}
              onClick={prevPage}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0'}
              aria-label="上一页"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            {/* Right arrow */}
            <button
              style={arrowButtonStyle('right')}
              onClick={nextPage}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0'}
              aria-label="下一页"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            {/* Page indicator */}
            <div style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '4px 16px',
              borderRadius: '999px',
              background: 'rgba(128,128,128,0.15)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              color: 'var(--text-muted)',
              fontSize: '12px',
              userSelect: 'none',
              pointerEvents: 'none',
              zIndex: 10,
              whiteSpace: 'nowrap'
            }}>
              章节：{currentChapterName}    第{currentPage + 1}/{totalPages}页
            </div>
          </>
        )}
      </div>
    </div>
  )
}
