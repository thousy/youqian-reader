import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useStore } from '../../store/useStore'

export function TxtReader({ book, savedProgress, settings, onProgressChange, registerGetPosition }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [rect, setRect] = useState({ width: 0, height: 0 })
  const [pageIndex, setPageIndex] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [currentChapterName, setCurrentChapterName] = useState('正文')
  
  const containerRef = useRef(null)
  const wrapperRef = useRef(null)
  const isInitialized = useRef(false)
  const { showToast } = useStore()

  // 将 TXT 文本切分为段落
  const paragraphs = useMemo(() => {
    if (!content) return []
    return content.split(/\r?\n/)
  }, [content])

  // 正则解析 TXT 目录章节
  const chapters = useMemo(() => {
    if (paragraphs.length === 0) return []
    const CHAPTER_REGEX = /^\s*(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕])(.*)$/i
    const list = []
    paragraphs.forEach((para, index) => {
      const text = para.trim()
      if (text.length > 0 && text.length < 50 && CHAPTER_REGEX.test(text)) {
        list.push({
          label: text,
          paraIndex: index
        })
      }
    })
    return list
  }, [paragraphs])

  // 监听外层容器的实际大小
  useEffect(() => {
    const el = wrapperRef.current
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

  // 加载 TXT 文本
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        const text = await window.api.readTxtFile(book.filePath)
        if (!mounted) return
        setContent(text)
        setLoading(false)
      } catch (e) {
        if (mounted) {
          setLoading(false)
          showToast('TXT 加载失败: ' + e.message, 'error')
        }
      }
    }
    load()
    return () => { mounted = false }
  }, [book.id])

  // 物理章节名动态匹配，完全规避 React JSX 渲染期副作用
  const updateChapterName = useCallback((pageIdx) => {
    if (chapters.length === 0) {
      setCurrentChapterName('正文')
      return
    }
    const el = containerRef.current
    if (!el || !rect.width) return
    const pElements = el.querySelectorAll('p')
    if (pElements.length === 0) return

    const scrollLeftVal = pageIdx * el.offsetWidth
    let currentParaIdx = 0
    for (let i = 0; i < pElements.length; i++) {
      const p = pElements[i]
      if (p.offsetLeft >= scrollLeftVal - 10) {
        currentParaIdx = i
        break
      }
    }

    let matchedChapter = '正文'
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].paraIndex <= currentParaIdx) {
        matchedChapter = chapters[i].label
      } else {
        break
      }
    }
    setCurrentChapterName(matchedChapter ? matchedChapter.trim() : '正文')
  }, [chapters, rect.width])

  // 当内容、尺寸或设置改变时，重新计算分页并对齐 scrollLeft
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
          setPageIndex(idx)
          el.scrollLeft = idx * el.offsetWidth
          updateChapterName(idx)
        } else {
          setPageIndex(0)
          el.scrollLeft = 0
          updateChapterName(0)
        }
      } else {
        const idx = Math.min(pageIndex, total - 1)
        setPageIndex(idx)
        el.scrollLeft = idx * el.offsetWidth
        updateChapterName(idx)
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [loading, rect.width, rect.height, content, settings.fontSize, settings.fontFamily, settings.lineHeight, updateChapterName])

  // 注册进度读取器
  useEffect(() => {
    registerGetPosition(() => {
      const percentage = totalPages > 1 ? pageIndex / (totalPages - 1) : 0
      return { label: `${Math.round(percentage * 100)}%`, pageIndex, percentage }
    })
  }, [pageIndex, totalPages])

  const goToPage = useCallback((idx) => {
    const el = containerRef.current
    if (!el || !rect.width) return
    const total = Math.max(1, Math.ceil(el.scrollWidth / el.offsetWidth))
    const clamped = Math.max(0, Math.min(idx, total - 1))
    
    setPageIndex(clamped)
    setTotalPages(total)
    el.scrollLeft = clamped * el.offsetWidth
    
    const percentage = total > 1 ? clamped / (total - 1) : 0
    onProgressChange({ pageIndex: clamped, percentage })
    
    updateChapterName(clamped)
  }, [rect.width, onProgressChange, updateChapterName])

  const nextPage = useCallback(() => goToPage(pageIndex + 1), [pageIndex, goToPage])
  const prevPage = useCallback(() => goToPage(pageIndex - 1), [pageIndex, goToPage])

  // 键盘快捷键
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        nextPage()
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        prevPage()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
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

  // 左右各留 80px 用于防止文字被左右两侧的 hover 箭头按钮遮挡
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
    display: 'block' // 必须是 block 才能正确触发 CSS Columns
  }

  const navBtnBase = {
    position: 'absolute',
    top: 0,
    height: '100%',
    width: '80px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    opacity: 0,
    transition: 'opacity 0.2s',
    zIndex: 10,
    color: 'var(--text-muted)'
  }

  return (
    <div 
      ref={wrapperRef} 
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', width: '100%', height: '100%' }}
    >
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: 'var(--text-muted)' }}>
          <div className="loading-spinner" />
          <span>正在加载...</span>
        </div>
      ) : (
        <>
          <div 
            ref={containerRef} 
            style={columnStyle} 
            id="txt-content"
          >
            {paragraphs.map((para, i) => (
              <p 
                key={i} 
                style={{ 
                  ...fontStyle,
                  margin: '0 0 1em 0', 
                  textIndent: '2em', 
                  textAlign: 'justify',
                  wordBreak: 'break-all',
                  minHeight: para.trim() === '' ? '1em' : 'auto'
                }}
              >
                {para}
              </p>
            ))}
          </div>

          {/* Left arrow */}
          <button
            onClick={prevPage}
            style={{ ...navBtnBase, left: 0, paddingLeft: '12px', justifyContent: 'flex-start' }}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0}
            aria-label="上一页"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Right arrow */}
          <button
            onClick={nextPage}
            style={{ ...navBtnBase, right: 0, paddingRight: '12px', justifyContent: 'flex-end' }}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0}
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
            章节：{currentChapterName}    第{pageIndex + 1}/{totalPages}页
          </div>
        </>
      )}
    </div>
  )
}
