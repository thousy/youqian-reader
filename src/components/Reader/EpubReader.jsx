import React, { useEffect, useRef, useState } from 'react'
import ePub from 'epubjs'
import { useStore } from '../../store/useStore'

export function EpubReader({ book, savedProgress, settings, onProgressChange, registerGetPosition, showToc }) {
  const viewerRef = useRef(null)
  const renditionRef = useRef(null)
  const bookRef = useRef(null)
  const [toc, setToc] = useState([])
  const [currentTocItem, setCurrentTocItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pageIndex, setPageIndex] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [currentChapterName, setCurrentChapterName] = useState('正文')
  const { showToast } = useStore()

  // 用 ref 保存扁平化的目录列表，彻底解决 relocated 事件闭包捕获旧空数组问题
  const tocRef = useRef([])

  // 极速获取文件名用于解决 EPUB 章节路径 mismatch 难题
  const getFilename = (path) => {
    if (!path) return ''
    const clean = path.split('#')[0]
    const parts = clean.split('/')
    return parts[parts.length - 1]
  }

  // 将 savedProgress 存入 ref，避免闭包捕获旧值
  const savedProgressRef = useRef(savedProgress)
  savedProgressRef.current = savedProgress

  useEffect(() => {
    let mounted = true

    async function loadEpub() {
      try {
        setLoading(true)

        // 清理旧的 rendition 和 book
        if (renditionRef.current) {
          try { renditionRef.current.destroy() } catch {}
          renditionRef.current = null
        }
        if (bookRef.current) {
          try { bookRef.current.destroy() } catch {}
          bookRef.current = null
        }
        // 强行清空旧 iframe 残留
        if (viewerRef.current) {
          viewerRef.current.innerHTML = ''
        }

        // 1. 读取文件
        const fileData = await window.api.readFile(book.filePath)
        if (!mounted) return

        // IPC 结构化克隆后需要正确转换为 ArrayBuffer
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
          console.error('EPUB: 未知文件数据类型:', typeof fileData, fileData)
          throw new Error('无法识别文件数据格式')
        }

        console.log('EPUB: ArrayBuffer size =', arrayBuffer.byteLength, 'bytes')
        if (arrayBuffer.byteLength === 0) throw new Error('文件为空')

        // 2. 创建 epub book 并等待就绪
        const epubBook = ePub(arrayBuffer)
        bookRef.current = epubBook

        await epubBook.ready
        if (!mounted) return
        console.log('EPUB: Book ready')

        // 3. 等待容器有物理尺寸（防止 0x0 分页崩溃）
        await waitForContainerSize(viewerRef.current)
        if (!mounted) return

        // 4. 渲染到容器
        const rendition = epubBook.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          spread: 'none'
        })
        renditionRef.current = rendition

        // 调试桥梁
        window.__rendition = rendition
        window.__book = epubBook

        // 应用阅读设置
        applySettings(rendition, settings)

        // 加载目录
        epubBook.loaded.navigation.then(nav => {
          if (!mounted) return
          const flat = flattenToc(nav.toc)
          setToc(flat)
          tocRef.current = flat
          
          // 执行首次章节名字匹配
          const curLoc = renditionRef.current?.currentLocation()
          const href = curLoc?.start?.href
          if (href) {
            const matched = flat.find(item => {
              const clean1 = item.href.split('#')[0]
              const clean2 = href.split('#')[0]
              if (clean1 === clean2 || item.href === href) return true
              const file1 = getFilename(item.href)
              const file2 = getFilename(href)
              return file1 && file2 && file1 === file2
            })
            if (matched && matched.label) {
              setCurrentChapterName(matched.label.trim())
            }
          }
        })

        // 进度追踪
        rendition.on('relocated', (location) => {
          if (!mounted) return
          const progress = location.start.percentage || 0
          onProgressChange({ cfi: location.start.cfi, percentage: progress })
          
          const href = location.start.href
          setCurrentTocItem(href)

          // 极速模糊匹配章节名 (使用 tocRef.current 规避捕获空数组)
          const currentToc = tocRef.current
          if (href && currentToc && currentToc.length > 0) {
            const matched = currentToc.find(item => {
              const clean1 = item.href.split('#')[0]
              const clean2 = href.split('#')[0]
              if (clean1 === clean2 || item.href === href) return true
              const file1 = getFilename(item.href)
              const file2 = getFilename(href)
              return file1 && file2 && file1 === file2
            })
            if (matched && matched.label) {
              setCurrentChapterName(matched.label.trim())
            } else {
              setCurrentChapterName('正文')
            }
          } else {
            setCurrentChapterName('正文')
          }

          // 免 locations 绝对安全的物理章节内页码计算，完全杜绝黑屏死锁
          try {
            if (location.start.displayed) {
              const page = location.start.displayed.page
              const total = location.start.displayed.total
              if (page != null && total != null) {
                setPageIndex(page - 1)
                setTotalPages(total)
              }
            } else {
              const rendition = renditionRef.current
              const view = rendition?.manager?.current()
              if (view && view.document) {
                const doc = view.document
                const htmlEl = doc.documentElement
                const bodyEl = doc.body
                const scrollWidth = htmlEl.scrollWidth || bodyEl.scrollWidth || 1
                const offsetWidth = htmlEl.offsetWidth || bodyEl.offsetWidth || 1
                const total = Math.max(1, Math.ceil(scrollWidth / offsetWidth))
                const left = view.position()?.left || 0
                const current = Math.max(1, Math.min(total, Math.ceil(Math.abs(left) / offsetWidth) + 1))
                setPageIndex(current - 1)
                setTotalPages(total)
              }
            }
          } catch (err) {
            console.warn('EPUB: Physical page calculation failed:', err)
          }
        })

        // 注册获取当前位置的函数（用于书签）
        registerGetPosition(() => {
          const loc = renditionRef.current?.currentLocation()
          return {
            label: `${Math.round((loc?.start?.percentage || 0) * 100)}%`,
            cfi: loc?.start?.cfi,
            percentage: loc?.start?.percentage
          }
        })

        // 注册 iframe 内部键盘事件和滚轮事件
        rendition.hooks.content.register((contents) => {
          const doc = contents.document
          doc.addEventListener('keydown', handleKeyInsideIframe)
          doc.addEventListener('wheel', handleWheelInsideIframe, { passive: false })
        })

        // 5. 首次显示：优先恢复进度
        const targetPos = savedProgressRef.current?.cfi || undefined
        console.log('EPUB: Displaying with target:', targetPos || '(default)')
        await rendition.display(targetPos).catch(async (err) => {
          console.warn('EPUB: Display with saved position failed, fallback:', err)
          await rendition.display()
        })
        if (!mounted) return

        console.log('EPUB: Display complete')
        setLoading(false)

        // 强焦化：激活键盘翻页
        try {
          if (viewerRef.current) viewerRef.current.focus()
          const iframe = viewerRef.current?.querySelector('iframe')
          if (iframe) iframe.focus()
        } catch {}

      } catch (e) {
        console.error('EPUB 加载失败:', e)
        if (mounted) {
          setLoading(false)
          showToast('EPUB 加载失败: ' + e.message, 'error')
        }
      }
    }

    loadEpub()

    return () => {
      mounted = false
      if (renditionRef.current) {
        try { renditionRef.current.destroy() } catch {}
        renditionRef.current = null
      }
      if (bookRef.current) {
        try { bookRef.current.destroy() } catch {}
        bookRef.current = null
      }
      if (viewerRef.current) {
        try { viewerRef.current.innerHTML = '' } catch {}
      }
    }
  }, [book.id])

  // 监听窗口大小变化以重新计算分页
  useEffect(() => {
    const handleResize = () => {
      if (renditionRef.current) {
        renditionRef.current.resize('100%', '100%')
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 更新设置（字体、主题等）
  useEffect(() => {
    if (renditionRef.current) applySettings(renditionRef.current, settings)
  }, [settings])

  // 键盘翻页
  const handleKeyInsideIframe = (e) => {
    if (!renditionRef.current) return
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      renditionRef.current.next()
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      renditionRef.current.prev()
    }
  }

  // 鼠标滚轮翻页（带 450ms 冷却锁）
  const lastWheelTime = useRef(0)
  const handleWheelInsideIframe = (e) => {
    e.preventDefault()
    const now = Date.now()
    if (now - lastWheelTime.current < 450) return
    
    if (e.deltaY > 0) {
      lastWheelTime.current = now
      if (renditionRef.current) {
        renditionRef.current.next().catch(err => console.error(err))
      }
    } else if (e.deltaY < 0) {
      lastWheelTime.current = now
      if (renditionRef.current) {
        renditionRef.current.prev().catch(err => console.error(err))
      }
    }
  }

  useEffect(() => {
    document.addEventListener('keydown', handleKeyInsideIframe)
    
    // 给外部主容器也绑定一份滚轮，防止焦点在边缘时滚动无效
    const outerEl = viewerRef.current
    if (outerEl) {
      outerEl.addEventListener('wheel', handleWheelInsideIframe, { passive: false })
    }

    return () => {
      document.removeEventListener('keydown', handleKeyInsideIframe)
      if (outerEl) {
        outerEl.removeEventListener('wheel', handleWheelInsideIframe)
      }
    }
  }, [])

  // 等待容器有物理尺寸的辅助函数
  function waitForContainerSize(el, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        resolve()
        return
      }
      console.log('EPUB: Waiting for container to have size...')
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            observer.disconnect()
            clearTimeout(timer)
            resolve()
            return
          }
        }
      })
      observer.observe(el)
      const timer = setTimeout(() => {
        observer.disconnect()
        console.warn('EPUB: Container size wait timed out, proceeding anyway')
        resolve()
      }, timeoutMs)
    })
  }

  function applySettings(rendition, s) {
    const themes = {
      dark: { body: { background: '#12121c', color: '#d4d4e8' }, a: { color: '#a78bfa' } },
      light: { body: { background: '#fafafa', color: '#1a1a2e' }, a: { color: '#6d28d9' } },
      sepia: { body: { background: '#f4ede0', color: '#3d2b1f' }, a: { color: '#78350f' } },
      night: { body: { background: '#05050a', color: '#8888a8' }, a: { color: '#6d28d9' } }
    }
    rendition.themes.default({
      ...( themes[s.theme] || themes.dark ),
      'p, li, span': {
        'font-size': `${s.fontSize}px !important`,
        'font-family': `"${s.fontFamily}", Georgia, serif !important`,
        'line-height': `${s.lineHeight} !important`
      },
      'img[width="100%"], img[height="100%"], img[style*="width:100%"], img[style*="height:100%"], img[style*="width: 100%"], img[style*="height: 100%"]': {
        'max-width': '100% !important',
        'height': '100vh !important',
        'width': 'auto !important',
        'object-fit': 'contain !important',
        'margin': '0 auto !important',
        'display': 'block !important'
      },
      'svg[width="100%"], svg[height="100%"], svg[style*="width:100%"], svg[style*="height:100%"], svg[style*="width: 100%"], svg[style*="height: 100%"]': {
        'max-width': '100% !important',
        'height': '100vh !important',
        'width': 'auto !important',
        'margin': '0 auto !important',
        'display': 'block !important'
      },
      'svg[width="100%"] image, svg[height="100%"] image, svg[style*="width:100%"] image, svg[style*="height:100%"] image': {
        'height': '100% !important',
        'width': 'auto !important'
      }
    })
  }

  function flattenToc(items, level = 0) {
    return items.reduce((acc, item) => {
      acc.push({ ...item, level })
      if (item.subitems) acc.push(...flattenToc(item.subitems, level + 1))
      return acc
    }, [])
  }

  const goNext = () => {
    if (renditionRef.current) {
      renditionRef.current.next()
        .catch(err => console.error('EPUB: goNext failed:', err))
    }
  }

  const goPrev = () => {
    if (renditionRef.current) {
      renditionRef.current.prev()
        .catch(err => console.error('EPUB: goPrev failed:', err))
    }
  }

  return (
    <div style={{display:'flex',flex:1,overflow:'hidden',position:'relative'}}>
      {/* 目录面板 */}
      {showToc && toc.length > 0 && (
        <div className="reader-toc-panel">
          <div className="toc-header">目录</div>
          {toc.map((item, i) => (
            <div
              key={i}
              className={`toc-item level-${item.level} ${currentTocItem === item.href ? 'active' : ''}`}
              onClick={() => renditionRef.current?.display(item.href)}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}

      {/* 阅读区 */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',position:'relative'}}>
        {loading && (
          <div className="loading-overlay">
            <div className="loading-spinner"/>
            <span>正在加载书籍...</span>
          </div>
        )}
        <div ref={viewerRef} className="epub-container" id="epub-viewer" tabIndex={-1} style={{ flex: 1, overflow: 'hidden', position: 'relative', width: '100%', height: '100%', outline: 'none' }}/>

        {/* 翻页按钮 */}
        <button onClick={goPrev} id="epub-prev-btn" style={{
          position:'absolute', left:0, top:0, bottom:0, width:'80px',
          background:'transparent', border:'none', cursor:'pointer', zIndex:10,
          display:'flex', alignItems:'center', justifyContent:'flex-start',
          paddingLeft:'12px', opacity:0, transition:'opacity 0.2s',
          color:'var(--text-muted)'
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
        onMouseLeave={e => e.currentTarget.style.opacity = '0'}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button onClick={goNext} id="epub-next-btn" style={{
          position:'absolute', right:0, top:0, bottom:0, width:'80px',
          background:'transparent', border:'none', cursor:'pointer', zIndex:10,
          display:'flex', alignItems:'center', justifyContent:'flex-end',
          paddingRight:'12px', opacity:0, transition:'opacity 0.2s',
          color:'var(--text-muted)'
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
        onMouseLeave={e => e.currentTarget.style.opacity = '0'}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="9 18 15 12 9 6"/>
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
          {totalPages > 0 ? `章节：${currentChapterName}    第${pageIndex + 1}/${totalPages}页` : `正在计算页数...`}
        </div>
      </div>
    </div>
  )
}
