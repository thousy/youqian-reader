import React, { useEffect, useRef, useState, useCallback } from 'react'
import ePub from 'epubjs'
import { useStore } from '../../store/useStore'
import { StatusBar } from './StatusBar'

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
  const [rect, setRect] = useState({ width: 0, height: 0 })
  const wrapperRef = useRef(null)
  
  const [currentPercentage, setCurrentPercentage] = useState(savedProgress?.percentage || 0)
  const [globalCurrentPage, setGlobalCurrentPage] = useState(1)
  const [globalTotalPages, setGlobalTotalPages] = useState(1)
  const [isLocationsReady, setIsLocationsReady] = useState(false)
  const spineItemsRef = useRef(null)
  const lastProgressRef = useRef({
    sectionIndex: -1,
    pageIndex: -1,
    globalPage: 1
  })
  
  const desktopBg = settings.globalTheme === 'light' ? '#eaeaf2' : '#0d0d14'
  const readerBg = {
    light: '#fafafa',
    sepia: '#f4ede0',
    dark: '#12121c',
    night: '#05050a'
  }[settings.theme] || '#12121c'

  const isCardStyle = settings.layoutMode === 'vertical' || settings.layoutMode === 'horizontal-scroll'
  const outerBg = isCardStyle ? desktopBg : 'transparent'

  const layoutWidth = isCardStyle ? Math.min(840, rect.width - 40) : rect.width
  const pageW = isCardStyle && layoutWidth ? Math.min(800, layoutWidth - 40) : 800
  const realStartPadding = (rect.width - pageW) / 2

  // 卡片滑动位移过渡动画状态 (垂直/水平翻页)
  const [animState, setAnimState] = useState('idle') // 'idle', 'out-up', 'out-down', 'in-up', 'in-down', 'out-left', 'out-right', 'in-left', 'in-right'
  const [isTransitionActive, setIsTransitionActive] = useState(false)
  const animationTimeoutRef = useRef(null)

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

  // 将 settings 存入 ref，避免闭包捕获旧值
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const scrollTimeoutRef = useRef(null)
  const isAligningRef = useRef(false)

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

        // 算出所有 spine item 的大小，构建零开销虚拟全局页数系统
        const spineItems = []
        let totalSize = 0
        
        epubBook.spine.each((section) => {
          const href = section.href
          let file = null
          if (epubBook.archive && epubBook.archive.files) {
            file = epubBook.archive.files[href]
            if (!file) {
              const cleanHref = href.split('/').pop()
              const matchKey = Object.keys(epubBook.archive.files).find(k => k.endsWith(cleanHref))
              if (matchKey) {
                file = epubBook.archive.files[matchKey]
              }
            }
          }
          
          const size = file ? (file.length || 0) : 20000
          spineItems.push({
            index: section.index,
            href: section.href,
            size: size,
            startOffset: totalSize
          })
          totalSize += size
        })
        
        const BYTES_PER_PAGE = 2200 // 字节-页码比率系数，估算全局总页数
        const totalPageEst = Math.max(1, Math.ceil(totalSize / BYTES_PER_PAGE))
        
        spineItemsRef.current = {
          items: spineItems,
          totalSize: totalSize,
          totalPages: totalPageEst,
          bytesPerPage: BYTES_PER_PAGE
        }
        
        setGlobalTotalPages(totalPageEst)
        setIsLocationsReady(true)
        
        // 首次定位初始全局页码
        const targetPos = savedProgressRef.current?.cfi
        if (targetPos) {
          epubBook.ready.then(() => {
            const curSection = epubBook.spine.get(targetPos)
            if (curSection) {
              const curIdx = curSection.index
              const item = spineItems[curIdx]
              if (item) {
                const pct = savedProgressRef.current?.percentage || 0
                const readBytes = item.startOffset + (item.size * pct)
                const curPageEst = Math.max(1, Math.min(totalPageEst, Math.ceil(readBytes / BYTES_PER_PAGE)))
                setGlobalCurrentPage(curPageEst)
              }
            }
          })
        }



        // 自动检测内嵌字体并优先使用
        const files = epubBook.archive?.files || {}
        const hasFontFiles = Object.keys(files).some(name => /\.(ttf|otf|woff2?)$/i.test(name))
        const isNewBook = !savedProgressRef.current || (!savedProgressRef.current.cfi && !savedProgressRef.current.percentage)
        if (isNewBook && hasFontFiles) {
          useStore.getState().updateSettings({ fontFamily: 'BookDefault' })
        }

        // 3. 等待容器有物理尺寸（防止 0x0 分页崩溃）
        await waitForContainerSize(viewerRef.current)
        if (!mounted) return

        // 4. 渲染到容器
        const rendition = epubBook.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          flow: (settings.layoutMode === 'vertical' || settings.layoutMode === 'horizontal-scroll') ? 'paginated' : 'paginated',
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
          try {
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
          } catch (e) {
            console.log('EPUB: Initial chapter match skipped (rendition not fully ready yet).')
          }
        })

        // 进度追踪
        rendition.on('relocated', (location) => {
          if (!mounted) return

          const progress = location.start.percentage || 0
          setCurrentPercentage(progress)
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
            let currentPageInChapter = 1
            let totalPagesInChapter = 1

            if (location.start.displayed) {
              const page = location.start.displayed.page
              const total = location.start.displayed.total
              if (page != null && total != null) {
                setPageIndex(page - 1)
                setTotalPages(total)
                currentPageInChapter = page
                totalPagesInChapter = total
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
                if (offsetWidth >= 50) {
                  const total = Math.max(1, Math.ceil(scrollWidth / offsetWidth))
                  const left = view.position()?.left || 0
                  const current = Math.max(1, Math.min(total, Math.ceil(Math.abs(left) / offsetWidth) + 1))
                  setPageIndex(current - 1)
                  setTotalPages(total)
                  currentPageInChapter = current
                  totalPagesInChapter = total
                }
              }
            }

            // 物理页码差值联动算法，100% 确保在章内左右翻页时页码精准 +1 或 -1
            const lastState = lastProgressRef.current
            const curSectionIndex = location.start.index
            const curPageIndex = currentPageInChapter - 1
            
            const spineData = spineItemsRef.current
            let newGlobalPage = lastState.globalPage
            
            if (spineData && spineData.items.length > 0) {
              const item = spineData.items[curSectionIndex]
              if (item) {
                const isCrossSection = lastState.sectionIndex !== curSectionIndex
                const isJump = lastState.pageIndex !== -1 && Math.abs(curPageIndex - lastState.pageIndex) > 1
                
                if (lastState.sectionIndex === -1 || isCrossSection || isJump) {
                  // 跨章节、首次加载、或非连续大跳页：使用章节字节偏移量计算基准页码
                  const sectionPercentage = totalPagesInChapter > 0 
                    ? curPageIndex / totalPagesInChapter 
                    : 0
                  const readBytes = item.startOffset + (item.size * sectionPercentage)
                  newGlobalPage = Math.max(1, Math.min(spineData.totalPages, Math.ceil(readBytes / spineData.bytesPerPage)))
                } else {
                  // 连续翻页：直接物理差值联动，100% 保证加减 1
                  const diff = curPageIndex - lastState.pageIndex
                  newGlobalPage = Math.max(1, Math.min(spineData.totalPages, lastState.globalPage + diff))
                }
              }
            }
            
            setGlobalCurrentPage(newGlobalPage)
            
            // 记录当前状态到 ref，供下次翻页对比
            lastProgressRef.current = {
              sectionIndex: curSectionIndex,
              pageIndex: curPageIndex,
              globalPage: newGlobalPage
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

          // 监听水平/垂直滚动事件
          doc.addEventListener('scroll', () => {
            const currentMode = settingsRef.current.layoutMode
            const htmlEl = doc.documentElement
            const bodyEl = doc.body
            const scrollEl = htmlEl.scrollWidth > bodyEl.scrollWidth ? htmlEl : bodyEl
            
            if (currentMode === 'horizontal-scroll' || currentMode === 'vertical') {
              const scrollLeft = htmlEl.scrollLeft || bodyEl.scrollLeft
              const scrollWidth = htmlEl.scrollWidth || bodyEl.scrollWidth || 1
              const clientWidth = htmlEl.clientWidth || bodyEl.clientWidth || 1
              
              const maxScroll = scrollWidth - clientWidth
              const pct = maxScroll > 0 ? scrollLeft / maxScroll : 0
              
              const total = Math.max(1, Math.round(maxScroll / clientWidth) + 1)
              const current = Math.max(0, Math.min(total - 1, Math.round(scrollLeft / clientWidth)))
              
              setPageIndex(current)
              setTotalPages(total)
              
              const loc = renditionRef.current?.currentLocation()
              onProgressChange({
                cfi: loc?.start?.cfi,
                percentage: pct
              })
            }
          })

          // 注入自定义字体、字号和行高样式（使用 settingsRef 规避闭包陷阱）
          let styleEl = doc.getElementById('epub-custom-style')
          if (!styleEl) {
            styleEl = doc.createElement('style')
            styleEl.id = 'epub-custom-style'
            doc.head.appendChild(styleEl)
          }

          const themes = {
            dark: { body: { background: '#12121c', color: '#d4d4e8' } },
            light: { body: { background: '#fafafa', color: '#1a1a2e' } },
            sepia: { body: { background: '#f4ede0', color: '#3d2b1f' } },
            night: { body: { background: '#05050a', color: '#8888a8' } }
          }
          const activeTheme = themes[settingsRef.current.theme] || themes.dark
          const fg = activeTheme.body.color

          styleEl.innerHTML = `
            body, p, div, span, li, a, td {
              ${settingsRef.current.fontFamily !== 'BookDefault' ? `font-family: "${settingsRef.current.fontFamily}", Georgia, "Noto Serif SC", serif !important;` : ''}
              line-height: ${settingsRef.current.lineHeight} !important;
              font-size: ${settingsRef.current.fontSize}px !important;
            }
            html {
              background: transparent !important;
              box-sizing: border-box !important;
            }
            body {
              background: transparent !important;
              color: ${fg} !important;
              padding: 40px 50px !important;
              box-sizing: border-box !important;
            }
            /* 隐藏滚动条 */
            ::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
            }
          `
        })



        // 5. 首次显示：优先恢复进度
        const startPos = savedProgressRef.current?.cfi || undefined
        console.log('EPUB: Displaying with target:', startPos || '(default)')
        await rendition.display(startPos).catch(async (err) => {
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
  }, [book.id, settings.layoutMode])

  // 监听窗口大小变化以重新计算分页
  useEffect(() => {
    const handleResize = () => {
      const w = viewerRef.current?.clientWidth
      const h = viewerRef.current?.clientHeight
      if (w == null || h == null || w < 100 || h < 100) return // 防御：当切出窗口或最小化尺寸异常时，不进行重算，防止死锁卡死
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
    const s = settingsRef.current
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (s.layoutMode === 'vertical' && e.key === 'ArrowDown')) {
      e.preventDefault()
      goNext()
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (s.layoutMode === 'vertical' && e.key === 'ArrowUp')) {
      e.preventDefault()
      goPrev()
    }
  }

  // 鼠标滚轮翻页（左右/上下滚动下整页切换）
  const lastWheelTime = useRef(0)
  const handleWheelInsideIframe = (e) => {
    const s = settingsRef.current
    if (s.layoutMode === 'vertical' || s.layoutMode === 'horizontal-scroll') {
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelTime.current < 350) return
      lastWheelTime.current = now

      if (e.deltaY > 0) {
        triggerPageTransitionRef.current?.('next', () => {
          if (renditionRef.current) renditionRef.current.next()
        })
      } else if (e.deltaY < 0) {
        triggerPageTransitionRef.current?.('prev', () => {
          if (renditionRef.current) renditionRef.current.prev()
        })
      }
      return
    }

    e.preventDefault()
    const now = Date.now()
    if (now - lastWheelTime.current < 350) return
    
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
    const w = viewerRef.current?.clientWidth || 800
    const h = viewerRef.current?.clientHeight || 600
    const desktopBg = s.globalTheme === 'light' ? '#eaeaf2' : '#0d0d14'
    
    const pageW = Math.min(800, w - 80)
    const pageGap = 40
    const cycleW = w + pageGap
    const startPadding = (w - pageW) / 2

    const themes = {
      dark: { body: { background: '#12121c', color: '#d4d4e8' }, a: { color: '#a78bfa' } },
      light: { body: { background: '#fafafa', color: '#1a1a2e' }, a: { color: '#6d28d9' } },
      sepia: { body: { background: '#f4ede0', color: '#3d2b1f' }, a: { color: '#78350f' } },
      night: { body: { background: '#05050a', color: '#8888a8' }, a: { color: '#6d28d9' } }
    }
    
    // 应用背景主题
    rendition.themes.default({
      ...( themes[s.theme] || themes.dark ),
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

    // 动态向所有已渲染的视图直接注入/更新 style 标签
    rendition.views().forEach(view => {
      if (view && view.document) {
        // 同步更新 iframe 的 overflow 锁定属性 (仅在左右滚动时放开，普通与垂直翻页完全不干预，保持 epubjs 默认)
        const iframeEl = view.iframe || view.document.defaultView?.frameElement
        if (iframeEl && s.layoutMode === 'horizontal-scroll') {
          iframeEl.setAttribute('scrolling', 'yes')
          iframeEl.style.overflowX = 'auto'
          iframeEl.style.overflowY = 'hidden'
        }

        let styleEl = view.document.getElementById('epub-custom-style')
        if (!styleEl) {
          styleEl = view.document.createElement('style')
          styleEl.id = 'epub-custom-style'
          view.document.head.appendChild(styleEl)
        }

        const themes = {
          dark: { body: { background: '#12121c', color: '#d4d4e8' } },
          light: { body: { background: '#fafafa', color: '#1a1a2e' } },
          sepia: { body: { background: '#f4ede0', color: '#3d2b1f' } },
          night: { body: { background: '#05050a', color: '#8888a8' } }
        }
        const activeTheme = themes[s.theme] || themes.dark
        const fg = activeTheme.body.color
        const isHorizontalScroll = s.layoutMode === 'horizontal-scroll'

        styleEl.innerHTML = `
          body, p, div, span, li, a, td {
            ${s.fontFamily !== 'BookDefault' ? `font-family: "${s.fontFamily}", Georgia, "Noto Serif SC", serif !important;` : ''}
            line-height: ${s.lineHeight} !important;
            font-size: ${s.fontSize}px !important;
          }
          html {
            background: transparent !important;
            box-sizing: border-box !important;
          }
          body {
            background: transparent !important;
            color: ${fg} !important;
            padding: 40px 50px !important;
            box-sizing: border-box !important;
          }
          /* 隐藏滚动条 */
          ::-webkit-scrollbar {
            display: none !important;
            width: 0 !important;
            height: 0 !important;
          }
        `
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
    if (!renditionRef.current) return
    const s = settingsRef.current
    if (s.layoutMode === 'vertical' || s.layoutMode === 'horizontal-scroll') {
      triggerPageTransitionRef.current?.('next', () => {
        renditionRef.current.next()
      })
      return
    }

    renditionRef.current.next()
      .catch(err => console.error('EPUB: goNext failed:', err))
  }

  const goPrev = () => {
    if (!renditionRef.current) return
    const s = settingsRef.current
    if (s.layoutMode === 'vertical' || s.layoutMode === 'horizontal-scroll') {
      triggerPageTransitionRef.current?.('prev', () => {
        renditionRef.current.prev()
      })
      return
    }

    renditionRef.current.prev()
      .catch(err => console.error('EPUB: goPrev failed:', err))
  }

  const handlePageChange = (page) => {
    if (!renditionRef.current) return

    // 处理来自 StatusBar 的上一页、下一页、首页、末页信号
    if (page === 'prev') {
      goPrev()
      return
    }
    if (page === 'next') {
      goNext()
      return
    }
    if (page === 'home') {
      renditionRef.current.display(0)
      return
    }
    if (page === 'end') {
      if (bookRef.current && bookRef.current.spine && bookRef.current.spine.length > 0) {
        const lastSpineItem = bookRef.current.spine.get(bookRef.current.spine.length - 1)
        if (lastSpineItem) {
          renditionRef.current.display(lastSpineItem.href)
        }
      }
      return
    }

    // 虚拟全局页码跳页
    const spineData = spineItemsRef.current
    if (spineData && spineData.items.length > 0) {
      if (page >= 1 && page <= spineData.totalPages) {
        const targetBytes = (page - 1) * spineData.bytesPerPage
        // 找出匹配的章节
        const matchedItem = spineData.items.find(item => 
          targetBytes >= item.startOffset && targetBytes < (item.startOffset + item.size)
        ) || spineData.items[spineData.items.length - 1]
        
        if (matchedItem) {
          renditionRef.current.display(matchedItem.href).then(() => {
            setGlobalCurrentPage(page)
          })
        }
      }
    }
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
      <div ref={wrapperRef} style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',position:'relative',backgroundColor:outerBg}}>
        {loading && (
          <div className="loading-overlay">
            <div className="loading-spinner"/>
            <span>正在加载书籍...</span>
          </div>
        )}
        <div 
          ref={viewerRef} 
          className="epub-container" 
          id="epub-viewer" 
          tabIndex={-1} 
          style={{ 
            flex: 1, 
            width: isCardStyle ? 'calc(100% - 40px)' : '100%',
            maxWidth: isCardStyle ? `${pageW}px` : 'none',
            margin: isCardStyle ? '0 auto 20px' : '0 auto',
            backgroundColor: isCardStyle ? readerBg : 'transparent',
            borderRadius: isCardStyle ? '0 0 8px 8px' : '0',
            boxShadow: isCardStyle ? '0 10px 40px rgba(0, 0, 0, 0.3)' : 'none',
            boxSizing: 'border-box',
            overflow: 'hidden', 
            position: 'relative', 
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
        />

        {/* 翻页按钮 */}
        <>
          <button
            onClick={goPrev}
            id="epub-prev-btn"
            style={navButtonStyle('left')}
            onMouseEnter={handleBtnMouseEnter}
            onMouseLeave={handleBtnMouseLeave}
            aria-label="上一页"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            onClick={goNext}
            id="epub-next-btn"
            style={navButtonStyle('right')}
            onMouseEnter={handleBtnMouseEnter}
            onMouseLeave={handleBtnMouseLeave}
            aria-label="下一页"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>

        {/* Status bar */}
        <StatusBar
          isReady={isLocationsReady}
          chapterName={currentChapterName}
          currentPage={globalCurrentPage}
          totalPages={globalTotalPages}
          percentage={currentPercentage}
          onPageChange={handlePageChange}
        />
      </div>
    </div>
  )
}
