import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store/useStore'
import { StatusBar } from './StatusBar'

export function MobiReader({ book, savedProgress, settings, onProgressChange, registerGetPosition, showToc }) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [rect, setRect] = useState({ width: 0, height: 0 })
  const [pageIndex, setPageIndex] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [currentChapterName, setCurrentChapterName] = useState('正文')
  
  // 目录相关 State
  const [toc, setToc] = useState([])
  const [currentTocItem, setCurrentTocItem] = useState(null)
  const [isMeasured, setIsMeasured] = useState(false)
  const [measureTrigger, setMeasureTrigger] = useState(0)

  // 当排版参数变化时，重置测算状态并递增触发器以进入 Loading 重算
  useEffect(() => {
    setIsMeasured(false)
    setMeasureTrigger(prev => prev + 1)
  }, [book.id, content, rect.width, rect.height, settings.fontSize, settings.fontFamily, settings.lineHeight, settings.layoutMode])


  const [debugInfo, setDebugInfo] = useState({ scrollW: 0, maxLeft: 0, tradTotal: 0, lastEl: '' })
  const contentRef = useRef(null)
  const [realScrollW, setRealScrollW] = useState(0)
  const [embeddedStyles, setEmbeddedStyles] = useState('')

  const containerRef = useRef(null)
  const readerAreaRef = useRef(null)
  const isInitialized = useRef(false)
  const scrollTimeoutRef = useRef(null)
  const isAligningRef = useRef(false)
  const { showToast } = useStore()

  // 极致 O(1) 性能保障：存储目录项与其对应正文 DOM 元素的映射指针
  const headingMapRef = useRef(new Map())

  // 核心性能锁：确保一本书的“章节注释物理重排搬移引擎”仅在加载就绪后运行仅此一次，彻底消除重排重计算卡顿
  const isNotesInjectedRef = useRef(false)

  // 注释悬浮气泡 & 点击 Modal 相关的 State 和 Ref
  const [activeTooltip, setActiveTooltip] = useState(null) // { text }
  const [activeNoteModal, setActiveNoteModal] = useState(null) // { title, text }
  const tooltipRef = useRef(null)
  const mousePosRef = useRef({ x: 0, y: 0 })

  const measureContainerRef = useRef(null)
  const [verticalTotalPages, setVerticalTotalPages] = useState(1)

  const isHorizontalScroll = settings.layoutMode === 'horizontal-scroll'
  const isVerticalMode = settings.layoutMode === 'vertical'
  const isPaginatedOrVertical = isHorizontalScroll || isVerticalMode
  
  const isCardStyle = settings.layoutMode === 'vertical' || settings.layoutMode === 'horizontal-scroll'

  // 卡片滑动位移过渡动画状态 (垂直/水平翻页)
  const [animState, setAnimState] = useState('idle') // 'idle', 'out-up', 'out-down', 'in-up', 'in-down', 'out-left', 'out-right', 'in-left', 'in-right'
  const [isTransitionActive, setIsTransitionActive] = useState(false)
  const animationTimeoutRef = useRef(null)

  const totalPagesRef = useRef(totalPages)
  useEffect(() => {
    totalPagesRef.current = totalPages
  }, [totalPages])

  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const triggerPageTransition = useCallback((direction, changePageFn) => {
    const isHugeBook = totalPagesRef.current > 350 || (content && content.length > 600000)
    if (isHugeBook) {
      // 针对大书瞬间切页，免除重绘大 DOM 淡入淡出动画引起的卡顿
      changePageFn()
      return
    }

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
  }, [content])

  const triggerPageTransitionRef = useRef(null)
  triggerPageTransitionRef.current = triggerPageTransition
  
  // 计算多栏排版参数 (卡片模型下，周期 cycleW 完美与卡片宽度 pageW 对齐)
  const layoutWidth = isCardStyle ? Math.min(840, rect.width - 40) : rect.width
  const pageW = isPaginatedOrVertical && layoutWidth ? Math.min(800, layoutWidth - 40) : 800
  const cycleW = isCardStyle ? pageW : pageW + 40
  const startPadding = isPaginatedOrVertical && layoutWidth ? (layoutWidth - pageW) / 2 : 0
  const isBaseLoading = loading || !rect.width || !rect.height
  const isActuallyLoading = isBaseLoading || (isCardStyle && !isMeasured)
  const cardHeight = rect.height ? rect.height - 60 : 0
  const realStartPadding = (rect.width - pageW) / 2

  const columnStyleMeasure = isCardStyle ? {
    columnWidth: `${pageW - 80}px`,
    columnGap: '80px',
    height: '100%',
    overflow: 'visible',
    padding: '40px 40px',
    boxSizing: 'border-box',
    width: '100%',
    display: 'block'
  } : {
    columnWidth: `${pageW - 80}px`,
    columnGap: `${2 * startPadding + 120}px`,
    height: '100%',
    overflow: 'visible',
    padding: `60px ${startPadding + 40}px`,
    boxSizing: 'border-box',
    width: '100%',
    display: 'block'
  }

  // 物理同源对齐步长：测算端与展示端已像素级锁定，直接使用物理理论步长以 100% 免疫任何 scrollWidth 异步测量导致的排版偏位
  const stepW = cycleW
  const translateX = -pageIndex * stepW

  // 常显、高级半透明毛玻璃悬浮翻页按钮样式
  const navButtonStyle = (side) => {
    const isCard = settings.layoutMode === 'vertical' || settings.layoutMode === 'horizontal-scroll'
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
      backgroundColor: settings.theme === 'light' || settings.theme === 'sepia' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: settings.theme === 'light' || settings.theme === 'sepia' ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.12)',
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
    e.currentTarget.style.backgroundColor = settings.theme === 'light' || settings.theme === 'sepia' ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.18)'
  }

  const handleBtnMouseLeave = (e) => {
    e.currentTarget.style.opacity = '0.5'
    e.currentTarget.style.transform = 'translateY(-50%) scale(1)'
    e.currentTarget.style.backgroundColor = settings.theme === 'light' || settings.theme === 'sepia' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)'
  }

  const paddingY = isHorizontalScroll ? 60 : 40

  // 在排版就绪且渲染完毕后，抓取真实多栏滚动宽度
  useEffect(() => {
    if (loading || !contentRef.current) return
    const updateRealScrollW = () => {
      if (contentRef.current) {
        setRealScrollW(contentRef.current.scrollWidth)
      }
    }
    const timer = setTimeout(() => {
      requestAnimationFrame(updateRealScrollW)
    }, 150)
    return () => clearTimeout(timer)
  }, [loading, content, totalPages, rect.width, rect.height, settings.fontSize, settings.fontFamily, settings.lineHeight])

  const desktopBg = settings.globalTheme === 'light' ? '#eaeaf2' : '#0d0d14'
  const outerBg = isCardStyle ? desktopBg : 'transparent'
  const readerBg = {
    light: '#fafafa',
    sepia: '#f4ede0',
    dark: '#12121c',
    night: '#05050a'
  }[settings.theme] || '#12121c'
  const renderedBackgroundPages = Math.min(totalPages, 200)
  const visibleVerticalPageIndex = containerRef.current?.clientHeight
    ? Math.round(containerRef.current.scrollTop / containerRef.current.clientHeight)
    : pageIndex
  const shouldRenderVerticalPage = (index) => {
    const candidates = [pageIndex, visibleVerticalPageIndex].filter(Number.isFinite)
    return candidates.length === 0 || candidates.some(candidate => Math.abs(index - candidate) <= 2)
  }

  // 纯粹的 DOM 定位更新函数，用于在 mousemove 事件和 tooltip 挂载时瞬时更新位置，杜绝 React 重绘
  const updateTooltipPosition = useCallback((clientX, clientY) => {
    const el = tooltipRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const winW = window.innerWidth
    const winH = window.innerHeight

    let left = clientX
    let top = clientY
    let transform = ''

    if (clientX < winW / 2) {
      // 鼠标靠左 -> 显示在右边
      left = clientX + 15
      transform = 'translate(0, -50%)'
    } else {
      // 鼠标靠右 -> 显示在左边
      left = clientX - 15
      transform = 'translate(-100%, -50%)'
    }

    // 垂直边界溢出防护
    const halfH = rect.height / 2
    if (top - halfH < 10) {
      top = 10
      transform = transform.replace('-50%', '0%')
    } else if (top + halfH > winH - 10) {
      top = winH - 10
      transform = transform.replace('-50%', '-100%')
    }

    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.transform = transform
  }, [])

  // 悬浮气泡事件委托，使用 mousemove 和 mouseleave 驱动
  const handleMouseMove = useCallback((e) => {
    const anchor = e.target.closest('a[data-rebuilt="true"]')
    if (!anchor) {
      if (activeTooltip) setActiveTooltip(null)
      return
    }

    const noteText = anchor.getAttribute('data-note')
    if (!noteText) return

    // 记录最新鼠标绝对坐标
    mousePosRef.current = { x: e.clientX, y: e.clientY }

    if (!activeTooltip || activeTooltip.text !== noteText) {
      // 仅当气泡内容发生变化或初次划入时更新 state，实现挂载/内容变更
      setActiveTooltip({ text: noteText })
    } else {
      // 在链接内部滑动时，直接更新 DOM 坐标，完全避免组件重绘
      updateTooltipPosition(e.clientX, e.clientY)
    }
  }, [activeTooltip, updateTooltipPosition])

  const handleMouseLeave = useCallback(() => {
    setActiveTooltip(null)
  }, [])

  // 气泡挂载时的初始定位物理防抖与可见过渡驱动
  useEffect(() => {
    if (!activeTooltip) return

    let active = true
    requestAnimationFrame(() => {
      const el = tooltipRef.current
      if (!el || !active) return

      // 执行初始定位
      updateTooltipPosition(mousePosRef.current.x, mousePosRef.current.y)
      
      // 强制重绘，触发 opacity 过渡动画
      el.getBoundingClientRect()
      el.classList.add('visible')
    })

    return () => { active = false }
  }, [activeTooltip, updateTooltipPosition])


  // 监听阅读区容器的实际大小（当目录面板展开/收缩时，此容器尺寸会发生改变）
  useEffect(() => {
    const el = readerAreaRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 100 && height > 100) { // 防御：当宽度异常（如切换窗口/最小化/关闭）时，不更新rect，防极端数值产生
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
        setEmbeddedStyles('')
        isNotesInjectedRef.current = false // 切换书籍时重置注入状态锁
        const result = await window.api.extractMobiContent(book.filePath)
        if (!mounted) return
        
        const rawHtml = result.html || '<p>无法读取内容</p>'
        
        // 使用 DOMParser 解析出标题，动态附加 ID 以生成目录
        const parser = new DOMParser()
        const doc = parser.parseFromString(rawHtml, 'text/html')
        
        // 提取 body 中的 style 标签内容，并从 body 中彻底移除，防止干扰多栏排版产生空白页
        const styleTexts = []
        doc.body.querySelectorAll('style').forEach(styleEl => {
          styleTexts.push(styleEl.textContent)
          styleEl.remove()
        })
        setEmbeddedStyles(styleTexts.join('\n'))

        // 移除所有 script, noscript, template 标签
        doc.body.querySelectorAll('script, noscript, template').forEach(el => el.remove())

        // 精准反向物理清除尾部连续的所有垃圾空占位标签（从最后一个子元素自后往前），避免全树遍历，O(1) 性能级消灭尾部空白
        let lastChild = doc.body.lastElementChild
        while (lastChild) {
          const tagName = lastChild.tagName.toLowerCase()
          const isTextContainer = ['p', 'div', 'span', 'font', 'a', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th'].includes(tagName)
          
          if (isTextContainer) {
            const hasVisualMedia = lastChild.querySelector('img, table, hr, svg, iframe, video')
            const hasText = lastChild.textContent && lastChild.textContent.trim().length > 0
            const hasAnchor = lastChild.getAttribute('id') || lastChild.getAttribute('name')
            
            if (!hasVisualMedia && !hasText && !hasAnchor) {
              const prev = lastChild.previousElementSibling
              lastChild.remove()
              lastChild = prev
              continue
            }
          }
          break // 一旦遇到任何有字、有图或非文本容器的有效元素，立刻停止清理！
        }
        
        let extractedToc = []

        // ================== 【第一级：MOBI/AZW3 专属 filepos 集中目录页提取（首选 🌟）】 ==================
        // 优先寻找并解析电子书内自带的 HTML 目录页，覆盖前置和后置目录页，最符合读者真实习惯
        const fileposLinks = doc.querySelectorAll('a[filepos]')
        if (fileposLinks.length >= 3) {
          const fileposToc = []
          
          let maxFilepos = 0
          fileposLinks.forEach(link => {
            const val = parseInt(link.getAttribute('filepos'))
            if (!isNaN(val) && val > maxFilepos) {
              maxFilepos = val
            }
          })

          fileposLinks.forEach((link) => {
            const label = link.textContent.trim()
            const fileposValStr = link.getAttribute('filepos')
            const fileposVal = parseInt(fileposValStr)
            if (label && label.length > 1 && label.length < 70 && !isNaN(fileposVal)) {
              if (/^\s*[\d\.\-\[\]\(\)\*①②③④⑤⑥⑦⑧⑨⑩]+\s*$/.test(label)) return
              if (label.toLowerCase().includes('top') || label.toLowerCase().includes('back') || label.toLowerCase().includes('返回')) return
              
              if (maxFilepos > 0 && fileposVal > maxFilepos * 0.18 && fileposVal < maxFilepos * 0.82) {
                return
              }
              
              fileposToc.push({
                label,
                href: `filepos-${fileposValStr}`,
                level: 0,
                isVirtual: false
              })
            }
          })
          
          const fileposMap = new Map()
          fileposToc.forEach(item => {
            if (item.label) fileposMap.set(item.label.trim(), item)
          })
          const finalFileposToc = Array.from(fileposMap.values())

          if (finalFileposToc.length >= 3) {
            extractedToc = finalFileposToc
            console.log(`MOBI 级联一（集中目录页提取）匹配成功！专属抓取原生 filepos 目录共 ${finalFileposToc.length} 条。`)
          }
        }

        // ================== 【第二级：标准 HTML 标题元素提取】 ==================
        if (extractedToc.length < 3) {
          const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, .chapter, .chaptertitle, .chapter-title, .heading, .header, .title')
          let headingToc = []
          headings.forEach((heading, index) => {
            let id = heading.getAttribute('id')
            if (!id) {
              id = `mobi-toc-heading-${index}`
              heading.setAttribute('id', id)
            }
            
            const label = heading.textContent.trim()
            if (label && label.length > 1 && label.length < 70) {
              let level = 0
              const tagName = heading.tagName.toLowerCase()
              if (tagName.startsWith('h')) {
                level = parseInt(tagName[1]) - 1
              } else if (heading.classList.contains('chapter') || heading.classList.contains('chapter-title')) {
                level = 0
              } else {
                level = 1
              }
              
              headingToc.push({
                label,
                href: id,
                level: Math.max(0, level),
                isVirtual: false
              })
            }
          })

          const headingMap = new Map()
          headingToc.forEach(item => {
            if (item.label) headingMap.set(item.label.trim(), item)
          })
          headingToc = Array.from(headingMap.values())

          if (headingToc.length >= 3) {
            extractedToc = headingToc
            console.log(`MOBI 级联二（常规标题提取）匹配成功！本书拥有标准常规标题目录，捕获 ${headingToc.length} 条。`)
          }
        }

        // ================== 【第三级：内嵌 HTML 常常规锚点超链接目录提取】 ==================
        if (extractedToc.length < 3) {
          const links = doc.querySelectorAll('a[href^="#"]')
          const linkToc = []
          links.forEach((link) => {
            const label = link.textContent.trim()
            const hrefAttr = link.getAttribute('href')
            if (!hrefAttr || hrefAttr.length <= 1) return
            const href = hrefAttr.substring(1) // 剥离 '#'
            
            if (label && label.length > 1 && label.length < 50) {
              if (/^\s*[\d\.\-\[\]\(\)\*①②③④⑤⑥⑦⑧⑨⑩]+\s*$/.test(label)) return
              if (label.toLowerCase().includes('top') || label.toLowerCase().includes('back') || label.toLowerCase().includes('返回')) return
              
              linkToc.push({
                label,
                href,
                level: 0,
                isVirtual: false
              })
            }
          })
          
          const linkMap = new Map()
          linkToc.forEach(item => {
            if (item.label) linkMap.set(item.label.trim(), item)
          })
          const finalLinkToc = Array.from(linkMap.values())

          if (finalLinkToc.length >= 3) {
            extractedToc = finalLinkToc
            console.log(`MOBI 级联三（锚点超链接提取）匹配成功！捕获内嵌超链接目录共 ${finalLinkToc.length} 条。`)
          }
        }

        // ================== 【第四级：高性能段落正则扫描提取（兜底）】 ==================
        if (extractedToc.length < 3) {
          const CHAPTER_REGEX = /^\s*(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕]|Chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万零\d]+|\d+[\.、\s]+)/i
          const paras = doc.querySelectorAll('p, div, blockquote')
          const regexToc = []
          let matchedCount = 0
          
          for (let i = 0; i < paras.length; i++) {
            const p = paras[i]
            const text = p.textContent
            if (text.length === 0 || text.length > 80) continue
            
            const firstChar = text[0] === ' ' ? text.trim()[0] : text[0]
            if (!firstChar) continue
            const isDigit = firstChar >= '0' && firstChar <= '9'
            if (firstChar !== '第' && firstChar !== 'C' && firstChar !== 'c' && !isDigit) continue
            
            const cleanText = text.trim()
            if (CHAPTER_REGEX.test(cleanText)) {
              let id = p.getAttribute('id')
              if (!id) {
                id = `mobi-auto-regex-toc-${matchedCount++}`
                p.setAttribute('id', id)
              }
              regexToc.push({
                label: cleanText,
                href: id,
                level: 0,
                isVirtual: false
              })
            }
          }
          
          if (regexToc.length >= 3) {
            extractedToc = regexToc
            console.log(`MOBI 级联四（正则扫描提取）匹配成功！正则扫描兜底共抓取章节 ${regexToc.length} 条！`)
          }
        }
        
        // ================== 【终极去重】 ==================
        const tocMap = new Map()
        extractedToc.forEach(item => {
          if (item.label) {
            tocMap.set(item.label.trim(), item)
          }
        })
        extractedToc = Array.from(tocMap.values())
        
        setToc(extractedToc)
        
        // 智能封面植入引擎：如果图书拥有封面元数据，则在正文最前端植入精美封面页并强制分栏，同时去重原正文内的重复封面
        if (book.cover) {
          const images = doc.querySelectorAll('img')
          images.forEach(img => {
            const cleanSrc = (src) => src ? src.replace(/\s/g, '') : ''
            const srcVal = cleanSrc(img.getAttribute('src'))
            const coverVal = cleanSrc(book.cover)
            
            const isCover = srcVal === coverVal || 
                            (srcVal.includes(';base64,') && coverVal.includes(';base64,') && 
                             srcVal.split(';base64,')[1] === coverVal.split(';base64,')[1])
            
            if (isCover) {
              const parent = img.parentElement
              if (parent && (parent.tagName.toLowerCase() === 'p' || parent.tagName.toLowerCase() === 'div') && parent.children.length === 1) {
                parent.remove()
              } else {
                img.remove()
              }
            }
          })

          const coverContainer = doc.createElement('div')
          coverContainer.className = 'mobi-cover-container'
          coverContainer.setAttribute('style', `
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            break-after: column;
            page-break-after: always;
            -webkit-column-break-after: always;
            break-inside: avoid;
            page-break-inside: avoid;
            -webkit-column-break-inside: avoid;
            box-sizing: border-box;
            padding: 20px 0;
          `)

          const coverImg = doc.createElement('img')
          coverImg.src = book.cover
          coverImg.className = 'mobi-cover-img'
          coverImg.setAttribute('style', `
            max-width: 100%;
            max-height: 100%;
            height: auto;
            object-fit: contain;
            display: block;
            margin: 0 auto;
            border-radius: 6px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            break-inside: avoid;
            page-break-inside: avoid;
            -webkit-column-break-inside: avoid;
          `)

          coverContainer.appendChild(coverImg)
          doc.body.insertBefore(coverContainer, doc.body.firstChild)
        }

        // 核心性能飞跃：在内存中的 doc 碎片上，以微秒级超高性能完成全部章节注释的划归、重配、悬浮预览注入及移位面板追加！
        // 这彻底消灭了在组件重绘周期的动态 DOM 大范围重排带来的无限渲染死循环和卡死，实现翻页和开书的 60Hz 物理满帧！
        try {
          processNotesInDoc(doc, extractedToc)
        } catch (noteErr) {
          console.error('内存注释搬移引擎执行异常:', noteErr)
        }

        // 自动检测内嵌字体并优先使用
        const hasEmbeddedFonts = /@font-face/i.test(rawHtml) || /\.(ttf|otf|woff2?)\b/i.test(rawHtml)
        const isNewBook = !savedProgress || (savedProgress.pageIndex === 0 && !savedProgress.percentage)
        if (isNewBook && hasEmbeddedFonts) {
          useStore.getState().updateSettings({ fontFamily: 'BookDefault' })
        }

        setContent(doc.body.innerHTML)
        setTitle(result.title || book.title)
        
        // 延迟 350ms 关闭加载遮罩，给浏览器以充足时间在后台解析渲染首帧大 DOM，消除闪烁与黑屏
        setTimeout(() => {
          if (mounted) {
            setLoading(false)
          }
        }, 350)
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

  // 测算排版总页数，直接使用真实的展示容器，100% 绝对同源避免任何误差
  useEffect(() => {
    if (loading || !rect.width || !rect.height) return

    // 递归逆向深度搜索最后一个具有物理尺寸和有效内容的渲染节点，避免 querySelectorAll 全书节点引起卡死
    const findLastVisualElement = (root) => {
      let node = root.lastElementChild
      while (node) {
        const tagName = node.tagName.toLowerCase()
        const isExcludedTag = ['style', 'script', 'noscript', 'template'].includes(tagName)
        
        if (!isExcludedTag && node.offsetWidth > 0 && node.offsetHeight > 0) {
          // 优先递归搜索子节点
          if (node.children && node.children.length > 0) {
            const lastChildVisual = findLastVisualElement(node)
            if (lastChildVisual) return lastChildVisual
          }
          
          // 判断自身是否包含实质内容
          const hasContent = 
            tagName === 'img' || 
            tagName === 'table' || 
            tagName === 'hr' || 
            tagName === 'svg' || 
            (node.textContent && node.textContent.trim().length > 0)
            
          if (hasContent) return node
        }
        node = node.previousElementSibling
      }
      return null
    }

    let mounted = true
    let timer = null

    if (isCardStyle) {
      if (isMeasured) return // 避免重复测算导致循环
      const el = contentRef.current
      if (!el || !pageW || pageW <= 100) return

      // 针对字符数 > 200 万的超级大书启动性能降级保护，不进行会导致重排卡死的高精页数微调，直接秒开
      const isSuperBook = content && content.length > 2000000
      if (isSuperBook) {
        const traditionalTotal = Math.max(1, Math.round((el.scrollWidth - pageW) / pageW) + 1)
        const safeTotal = Math.min(traditionalTotal, 5000)
        console.log(`[MOBI Page Measure] 超级大书性能降级保护启动！总长度: ${content.length} 字符，采用估计页数: ${safeTotal}`)
        setDebugInfo({ scrollW: el.scrollWidth, maxLeft: 0, tradTotal: traditionalTotal, lastEl: 'SUPER_BOOK_LIMIT' })
        setTotalPages(safeTotal)
        setIsMeasured(true)
        return
      }

      // 延迟到下一帧渲染之后，让浏览器先行排版，避免 Forced Synchronous Layout 强迫同步重排导致大书卡死
      timer = setTimeout(() => {
        requestAnimationFrame(() => {
          if (!mounted || !contentRef.current) return
          const curEl = contentRef.current

          // 1. 获取传统的 scrollWidth 物理页数上限
          const traditionalTotal = Math.max(1, Math.round((curEl.scrollWidth - pageW) / pageW) + 1)
          
          // 2. 物理高精定位：自下而上反向抓取最后一个真正有视觉内容的子元素的 offsetLeft 位置
          let maxLeft = 0
          let lastElText = ''
          
          const lastVisualEl = findLastVisualElement(curEl)
          if (lastVisualEl) {
            if (lastVisualEl.offsetLeft > 0 && lastVisualEl.offsetLeft < curEl.scrollWidth) {
              maxLeft = lastVisualEl.offsetLeft
              const tagName = lastVisualEl.tagName.toLowerCase()
              const textContent = (lastVisualEl.textContent || '').trim()
              lastElText = `<${tagName}>${textContent.substring(0, 8)}`
            }
          }
          
          // 3. 将物理页数与传统上限结合，完美剔除末尾多余的空白页
          let realPages = traditionalTotal
          if (maxLeft > 0) {
            const calculatedPages = Math.ceil((maxLeft - 40) / pageW) + 1
            realPages = Math.min(traditionalTotal, Math.max(1, calculatedPages))
          }
          
          const safeTotal = Math.min(realPages, 5000)
          console.log(`[MOBI Page Measure] scrollWidth=${curEl.scrollWidth}, maxLeft=${maxLeft}, finalPages=${safeTotal}, lastEl=${lastElText}`)
          setDebugInfo({ scrollW: curEl.scrollWidth, maxLeft, tradTotal: traditionalTotal, lastEl: lastElText })
          setTotalPages(safeTotal)
          setIsMeasured(true)
        })
      }, 100)
    } else if (!isCardStyle && containerRef.current) {
      const viewWidth = containerRef.current.offsetWidth
      if (viewWidth > 100) {
        const total = Math.max(1, Math.ceil(containerRef.current.scrollWidth / viewWidth))
        setTotalPages(total)
        setIsMeasured(true)
      }
    }

    return () => {
      mounted = false
      if (timer) clearTimeout(timer)
    }
  }, [loading, pageW, rect.width, rect.height, content, settings.fontSize, settings.fontFamily, settings.lineHeight, isCardStyle, settings.layoutMode, measureTrigger, isMeasured])

  // 当总页数计算完成，且书籍无自然目录时，自动生成按页切片的虚拟目录，保证目录绝不空置
  useEffect(() => {
    if (loading || totalPages <= 1) return
    
    // 如果已经解析出了自然的标题目录，则无需覆盖
    if (toc.length > 0 && !toc[0].isVirtual) return
    
    const list = []
    const step = 20
    const chunks = Math.ceil(totalPages / step)
    for (let i = 0; i < chunks; i++) {
      const pageNum = i * step
      list.push({
        label: `第 ${i + 1} 部分 (第 ${pageNum + 1} 页起)`,
        href: `virtual-page-anchor-${pageNum}`,
        level: 0,
        pageIndex: pageNum,
        isVirtual: true
      })
    }
    setToc(list)
  }, [totalPages, loading])

  // 物理章节名动态高亮联动
  const updateChapterNameAndToc = useCallback((pageIdx) => {
    if (pageIdx === 0 && book.cover) {
      setCurrentChapterName('封面')
      setCurrentTocItem(null)
      return
    }
    if (toc.length === 0) {
      setCurrentChapterName('正文')
      return
    }
    const queryBase = document.getElementById('mobi-scroll-content') || containerRef.current
    if (!queryBase || !rect.width) return

    if (toc[0].isVirtual) {
      let matchedIdx = 0
      for (let i = 0; i < toc.length; i++) {
        if (toc[i].pageIndex <= pageIdx) {
          matchedIdx = i
        } else {
          break
        }
      }
      setCurrentChapterName(toc[matchedIdx].label)
      setCurrentTocItem(toc[matchedIdx].href)
      return
    }

    const scrollVal = pageIdx * stepW
    let matchedChapter = '正文'
    let matchedId = null
    let closestOffset = -999999

    for (let item of toc) {
      let headingEl = headingMapRef.current.get(item.href)
      if (!headingEl) {
        if (item.href.startsWith('filepos-')) {
          const fileposVal = item.href.substring(8)
          try {
            const matches = queryBase.querySelectorAll(`[name="filepos${fileposVal}"], #filepos${fileposVal}, #filepos-${fileposVal}`)
            if (matches.length > 0) {
              headingEl = matches[matches.length - 1]
            }
          } catch {}
        } else {
          headingEl = document.getElementById(item.href)
        }
      }

      if (headingEl) {
        const offsetVal = headingEl.offsetLeft
        if (offsetVal <= scrollVal + 40 && offsetVal > closestOffset) {
          closestOffset = offsetVal
          matchedChapter = item.label
          matchedId = item.href
        }
      }
    }

    setCurrentChapterName(matchedChapter ? matchedChapter.trim() : '正文')
    if (matchedId) {
      setCurrentTocItem(matchedId)
    }
  }, [toc, rect.width, book.cover, stepW])

  const goToPageCard = useCallback((idx) => {
    if (totalPages <= 0) return
    const safeIdx = Math.max(0, Math.min(idx, totalPages - 1))
    setPageIndex(safeIdx)
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0
      containerRef.current.scrollTop = 0
    }
    const pct = totalPages > 1 ? safeIdx / (totalPages - 1) : 0
    onProgressChange({
      pageIndex: safeIdx,
      percentage: pct
    })
    updateChapterNameAndToc(safeIdx)
  }, [totalPages, onProgressChange, updateChapterNameAndToc])

  // 统一进度跳转与进度上报逻辑
  const goToPage = useCallback((idx) => {
    if (isCardStyle) {
      goToPageCard(idx)
      return
    }
    const el = containerRef.current
    if (!el || totalPages <= 0) return
    
    const isHorizontalScroll = settings.layoutMode === 'horizontal-scroll'
    const viewWidth = isHorizontalScroll ? cycleW : el.offsetWidth
    if (!viewWidth) return
    
    const safeIdx = Math.max(0, Math.min(idx, totalPages - 1))
    
    el.scrollLeft = safeIdx * viewWidth
    setPageIndex(safeIdx)
    
    const pct = totalPages > 1 ? safeIdx / (totalPages - 1) : 0
    onProgressChange({
      pageIndex: safeIdx,
      percentage: pct
    })
    
    updateChapterNameAndToc(safeIdx)
  }, [totalPages, onProgressChange, updateChapterNameAndToc, settings.layoutMode, cycleW])

  // 内容、尺寸、目录显示或设置改变时，重新计算分页并对齐 scrollLeft/scrollTop
  useEffect(() => {
    if (loading || !rect.width || !rect.height) return

    const timer = setTimeout(() => {
      if (isCardStyle) {
        if (!isMeasured) return
        if (totalPages <= 1) return
        if (!isInitialized.current) {
          isInitialized.current = true
          let startPageIdx = 0

          if (savedProgress?.pageIndex != null) {
            startPageIdx = savedProgress.pageIndex
          } else if (savedProgress?.percentage != null) {
            startPageIdx = Math.max(0, Math.min(totalPages - 1, Math.floor(savedProgress.percentage * totalPages)))
          }

          setPageIndex(startPageIdx)
          updateChapterNameAndToc(startPageIdx)
        } else {
          setPageIndex(prev => {
            const clamped = Math.min(prev, totalPages - 1)
            updateChapterNameAndToc(clamped)
            return clamped
          })
        }
        if (containerRef.current) {
          containerRef.current.scrollLeft = 0
          containerRef.current.scrollTop = 0
        }
        setIsMeasured(true)
        return
      }

      const el = containerRef.current
      if (!el) return
      
      const isVertical = settings.layoutMode === 'vertical'
      
      if (isVertical) {
        const clientHeight = el.clientHeight
        const total = verticalTotalPages
        setTotalPages(total)

        if (!isInitialized.current) {
          isInitialized.current = true
          let startPct = 0

          if (savedProgress?.percentage != null) {
            startPct = savedProgress.percentage
          } else if (savedProgress?.pageIndex != null) {
            startPct = total > 1 ? savedProgress.pageIndex / (total - 1) : 0
          }

          const targetScrollTop = startPct * (total - 1) * clientHeight
          el.scrollTop = targetScrollTop
          
          const startPageIdx = Math.max(0, Math.min(total - 1, Math.round(targetScrollTop / clientHeight)))
          setPageIndex(startPageIdx)
          updateChapterNameAndToc(startPageIdx)
        } else {
          setPageIndex(prev => {
            const clamped = Math.min(prev, total - 1)
            el.scrollTop = clamped * clientHeight
            updateChapterNameAndToc(clamped)
            return clamped
          })
        }
      } else {
        const isHorizontalScroll = settings.layoutMode === 'horizontal-scroll'
        const viewWidth = isHorizontalScroll ? cycleW : el.offsetWidth
        
        let total = 1
        if (isHorizontalScroll) {
          total = Math.max(1, Math.round((el.scrollWidth - rect.width) / cycleW) + 1)
        } else {
          total = Math.max(1, Math.ceil(el.scrollWidth / viewWidth))
        }
        setTotalPages(total)

        if (!isInitialized.current) {
          isInitialized.current = true
          let startPageIdx = 0

          if (savedProgress?.pageIndex != null) {
            startPageIdx = savedProgress.pageIndex
          } else if (savedProgress?.percentage != null) {
            startPageIdx = Math.floor(savedProgress.percentage * total)
          }

          const clampedPage = Math.min(startPageIdx, total - 1)
          setPageIndex(clampedPage)
          el.scrollLeft = clampedPage * viewWidth
          updateChapterNameAndToc(clampedPage)
        } else {
          setPageIndex(prev => {
            const clamped = Math.min(prev, total - 1)
            el.scrollLeft = clamped * viewWidth
            updateChapterNameAndToc(clamped)
            return clamped
          })
        }
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [loading, rect.width, rect.height, settings.fontSize, settings.fontFamily, settings.lineHeight, settings.layoutMode, cycleW, totalPages, toc, measureTrigger])

  // 当内容完成渲染或 TOC 发生变化时，瞬时抓取各章节 DOM 指针并填入 headingMapRef 缓存，打通极速高亮与跳转通道
  useEffect(() => {
    if (loading || toc.length === 0) return
    headingMapRef.current.clear()
    const container = document.getElementById('mobi-scroll-content') || containerRef.current
    if (!container) return

    const paras = container.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6')
    const dehydrateText = (str) => {
      return str.replace(/[\s\-\=\_\*～~]/g, '')
    }

    // 预先建立高性能脱水文本哈希映射表，将 O(M*N) 的检索复杂度暴降为 O(M+N)
    const textToElMap = new Map()
    for (let i = 0; i < paras.length; i++) {
      const pEl = paras[i]
      if (pEl.tagName.toLowerCase() === 'a') continue
      
      const text = pEl.textContent
      if (!text) continue
      const len = text.length
      if (len > 0 && len < 100) {
        const dry = dehydrateText(text)
        if (dry) {
          textToElMap.set(dry, { el: pEl, index: i })
        }
      }
    }

    toc.forEach((item, tocIndex) => {
      if (item.isVirtual) return
      let el = null

      // 1. 优先根据 ID 或 Name 定位
      if (item.href.startsWith('filepos-')) {
        const fileposVal = item.href.substring(8)
        try {
          const matches = container.querySelectorAll(`[name="filepos${fileposVal}"], #filepos${fileposVal}, #filepos-${fileposVal}`)
          if (matches.length > 0) {
            el = matches[matches.length - 1]
          }
        } catch {}
      } else {
        el = document.getElementById(item.href)
      }

      // 2. 如果没找到，进行文本匹配检索（使用 Map 哈希匹配）
      if (!el) {
        const cleanLabel = item.label.trim()
        const coreLabel = cleanLabel.replace(/^\s*(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕]|Chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万零\d]+|\d+[\.、\s]+)/i, '').trim()
        const dryCleanLabel = dehydrateText(cleanLabel)
        const dryCoreLabel = dehydrateText(coreLabel)
        const tocRatio = toc.length > 0 ? tocIndex / toc.length : 0

        // 优先精确匹配
        let matchedData = textToElMap.get(dryCleanLabel) || textToElMap.get(dryCoreLabel)
        
        // 兜底：如果精确匹配不到且 dryCoreLabel 比较长，尝试 Map 的键模糊扫描
        if (!matchedData && dryCoreLabel.length > 3) {
          for (let [dryKey, data] of textToElMap.entries()) {
            if (dryKey.includes(dryCoreLabel)) {
              matchedData = data
              break
            }
          }
        }

        if (matchedData) {
          const { el: pEl, index: i } = matchedData
          
          let isExcluded = false
          const hasJumpLink = pEl.querySelector('a[href], a[filepos]') || pEl.closest('a[href], a[filepos]')
          if (hasJumpLink) {
            const linkEl = pEl.querySelector('a[href], a[filepos]') || pEl.closest('a[href], a[filepos]')
            const hrefAttr = linkEl.getAttribute('href') || ''
            const fileposAttr = linkEl.getAttribute('filepos') || ''
            if (fileposAttr || (hrefAttr && hrefAttr.startsWith('#'))) {
              isExcluded = true
            }
          }

          if (!isExcluded) {
            const paraRatio = paras.length > 0 ? i / paras.length : 0
            let isRatioOk = true
            if (toc.length > 3 && !/^(版权|序|译者|前言|引言|序言|目录|Contents|TOC)/i.test(cleanLabel)) {
              if (Math.abs(tocRatio - paraRatio) > 0.35) {
                isRatioOk = false
              }
            }
            if (isRatioOk) {
              el = pEl
            }
          }
        }
      }

      if (el) {
        headingMapRef.current.set(item.href, el)
      }
    })
  }, [loading, toc, content])
  // 注册获取当前精确定位的回调函数
  useEffect(() => {
    registerGetPosition(() => {
      const pct = totalPages > 1 ? pageIndex / (totalPages - 1) : 0
      return { label: `第 ${pageIndex + 1} / ${totalPages} 页`, pageIndex, percentage: pct }
    })
  }, [pageIndex, totalPages])

  // 目录项跳转定位方法（支持高精度物理 offsetLeft 偏移定位、前置假锚点甄别过滤与文本倒序检索“物理过滤装甲”！）
  // 极致 O(1) 性能优化：跳转时直接读取 Map 缓存指针，零重新检索！
  const jumpToToc = useCallback((targetItem) => {
    if (targetItem.isVirtual) {
      goToPage(targetItem.pageIndex)
      setCurrentTocItem(targetItem.href)
      return
    }

    const el = containerRef.current
    if (!el || !rect.width || totalPages <= 0) return
    
    // 极致 O(1) 性能保障：优先从 headingMapRef 缓存读取
    let headingEl = headingMapRef.current.get(targetItem.href)
    
    if (!headingEl) {
      // 优先通过精准的 ID 进行直接检索定位！
      try {
        headingEl = el.querySelector(`#${CSS.escape(targetItem.href)}`)
      } catch {}
      if (!headingEl) {
        headingEl = document.getElementById(targetItem.href)
      }
      
      // 如果依然没找到，且属于 filepos- 类型的跳转，做备用兼容
      if (!headingEl && targetItem.href.startsWith('filepos-')) {
        const fileposVal = targetItem.href.substring(8)
        try {
          // 修正：移除了可能导致误匹配点击源自身的 [filepos] 属性，同时支持物理插入的带连字符 ID
          const matches = el.querySelectorAll(`[name="filepos${fileposVal}"], #filepos${fileposVal}, #filepos-${fileposVal}`)
          if (matches.length > 0) {
            headingEl = matches[matches.length - 1]
          }
        } catch {}
      }
    }
    
    // 智能前置假锚点甄别
    if (headingEl) {
      const realLeft = headingEl.offsetLeft
      const pageW = el.offsetWidth
      const pageIdx = Math.floor(realLeft / pageW)
      
      const isIntro = /^(版权|序|译者|前言|引言|序言|目录|Contents|TOC)/i.test(targetItem.label.trim())
      const isPhysicalAnchor = headingEl.classList.contains('reader-filepos-anchor')
      // 修正：物理插入的锚点必然是真实正文地址，跳过假锚点甄别
      if (pageIdx <= 4 && !isIntro && !isPhysicalAnchor) {
        console.log(`智能甄别：章节 [${targetItem.label}] 指向了前置目录区，强行废弃并触发倒序检索！`)
        headingEl = null
      }
    }
    
    // 兜底倒序检索（仅在缓存中没有该指针且锚点失效时，作为极低概率的兜底触发）
    if (!headingEl) {
      const cleanLabel = targetItem.label.trim()
      const coreLabel = cleanLabel.replace(/^\s*(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕]|Chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万零\d]+|\d+[\.、\s]+)/i, '').trim()
      
      const paras = el.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6')
      const pageW = el.offsetWidth
      
      // 计算当前目录项在整个目录列表中的位置比例
      const tocIndex = toc.findIndex(t => t.href === targetItem.href)
      const tocRatio = tocIndex !== -1 && toc.length > 0 ? tocIndex / toc.length : 0

      // 辅助函数：将文本脱水（移除换行、空格及常见装饰线）
      const dehydrateText = (str) => {
        return str.replace(/[\s\-\=\_\*～~]/g, '')
      }

      const dryCleanLabel = dehydrateText(cleanLabel)
      const dryCoreLabel = dehydrateText(coreLabel)

      for (let i = paras.length - 1; i >= 0; i--) {
        const pEl = paras[i]
        if (pEl.tagName.toLowerCase() === 'a') continue
        
        const text = pEl.textContent
        if (!text) continue
        const len = text.length
        if (len > 0 && len < 100) {
          const dryText = dehydrateText(text)
          const isMatch = dryText === dryCleanLabel || 
                          dryText === dryCoreLabel || 
                          (dryCoreLabel.length > 1 && dryText.includes(dryCoreLabel))

          if (isMatch) {
            // 1. 过滤：如果段落内包含带有跳转功能的超链接 a[href] 或 a[filepos]（或者被其包裹），说明这是目录页的点击链接，而非正文标题
            const hasJumpLink = pEl.querySelector('a[href], a[filepos]') || pEl.closest('a[href], a[filepos]')
            if (hasJumpLink) {
              const linkEl = pEl.querySelector('a[href], a[filepos]') || pEl.closest('a[href], a[filepos]')
              const hrefAttr = linkEl.getAttribute('href') || ''
              const fileposAttr = linkEl.getAttribute('filepos') || ''
              if (fileposAttr || (hrefAttr && hrefAttr.startsWith('#'))) {
                continue
              }
            }

            const itemLeft = pEl.offsetLeft
            const itemPageIdx = Math.floor(itemLeft / pageW)
            const isIntro = /^(版权|序|译者|前言|引言|序言|目录|Contents|TOC)/i.test(targetItem.label.trim())
            
            // 2. 智能过滤前置目录区
            if (itemPageIdx <= 4 && !isIntro) {
              continue
            }

            // 3. 物理一致性校验：章节在目录中的逻辑占比与在页面中的物理占比差值绝对值不应超过 35%，防止跨越式误匹配到尾部或前置目录页
            const pageRatio = totalPages > 1 ? itemPageIdx / (totalPages - 1) : 0
            if (tocIndex !== -1 && toc.length > 3) {
              if (!isIntro && tocRatio > 0.08 && tocRatio < 0.92) {
                if (Math.abs(tocRatio - pageRatio) > 0.35) {
                  console.log(`物理一致性拦截：章节 [${targetItem.label}] 目录占比 ${tocRatio.toFixed(2)}，但匹配位置物理页码占比 ${pageRatio.toFixed(2)}，差距过大，予以忽略。`)
                  continue
                }
              }
            }

            headingEl = pEl
            break
          }
        }
      }
    }

    if (!headingEl) {
      console.warn(`跳转未匹配：未能在文章中找到与目录 [${targetItem.label}] 相匹配的 ID 或内容文本！`)
      showToast(`未能在正文中匹配到章节: ${targetItem.label}`, 'warning')
      return
    }
    
    // 物理分页符对齐越过：如果定位到的元素位于物理分页符的前面（包括被段落包裹的情况），则越过分页符将跳转点微调至分页符后方的第一个实际正文节点，防跳转偏前一页
    let currentCheck = headingEl
    let foundPageBreak = null
    
    for (let up = 0; up < 2 && currentCheck && currentCheck !== el; up++) {
      let sibling = currentCheck.nextElementSibling
      for (let s = 0; s < 2 && sibling; s++) {
        if (sibling.classList.contains('page-break') || sibling.tagName.toLowerCase() === 'hr') {
          foundPageBreak = sibling
          break
        }
        if (sibling.textContent.trim() === '') {
          sibling = sibling.nextElementSibling
        } else {
          break
        }
      }
      if (foundPageBreak) break
      currentCheck = currentCheck.parentElement
    }

    if (foundPageBreak) {
      let realTarget = foundPageBreak.nextElementSibling
      while (realTarget && (realTarget.textContent.trim() === '' || realTarget.tagName.toLowerCase() === 'br')) {
        realTarget = realTarget.nextElementSibling
      }
      if (realTarget) {
        console.log(`物理分页符对齐成功：检测到分页符，已将跳转目标对齐至分页符后方的首个内容元素 [${realTarget.tagName}]`);
        headingEl = realTarget
      }
    }

    if (isCardStyle) {
      const pageIdx = Math.round(headingEl.offsetLeft / stepW)
      goToPageCard(pageIdx)
      setCurrentTocItem(targetItem.href)
      setCurrentChapterName(targetItem.label)
      return
    }

    const isVertical = settings.layoutMode === 'vertical'
    if (isVertical) {
      el.scrollTop = headingEl.offsetTop - 20
      setCurrentTocItem(targetItem.href)
      
      const total = Math.max(1, Math.ceil(el.scrollHeight / el.clientHeight))
      const current = Math.max(0, Math.min(total - 1, Math.floor(el.scrollTop / el.clientHeight)))
      const pct = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0
      setPageIndex(current)
      setTotalPages(total)
      onProgressChange({ pageIndex: current, percentage: pct })
      setCurrentChapterName(targetItem.label)
      return
    }

    const isHorizontalScroll = settings.layoutMode === 'horizontal-scroll'
    if (isHorizontalScroll) {
      const pageIdx = Math.round(headingEl.offsetLeft / cycleW)
      el.scrollLeft = pageIdx * cycleW
      setCurrentTocItem(targetItem.href)
      
      const maxScroll = el.scrollWidth - rect.width
      const total = Math.max(1, Math.round(maxScroll / cycleW) + 1)
      const current = Math.max(0, Math.min(total - 1, pageIdx))
      const pct = maxScroll > 0 ? el.scrollLeft / maxScroll : 0
      setPageIndex(current)
      setTotalPages(total)
      onProgressChange({ pageIndex: current, percentage: pct })
      setCurrentChapterName(targetItem.label)
      return
    }

    const realLeft = headingEl.offsetLeft
    const pageW = el.offsetWidth
    const pageIdx = Math.floor(realLeft / pageW)
    
    goToPage(pageIdx)
    setCurrentTocItem(targetItem.href)
  }, [rect.width, totalPages, goToPage, showToast, settings.layoutMode, onProgressChange, stepW, toc])

  // 垂直模式滚动回调处理器
  const handleVerticalScroll = useCallback((e) => {
    if (settings.layoutMode !== 'vertical') return
    const el = e.currentTarget
    
    const scrollTop = el.scrollTop
    const clientHeight = el.clientHeight
    const total = verticalTotalPages
    const current = Math.max(0, Math.min(total - 1, Math.round(scrollTop / clientHeight)))
    
    setPageIndex(current)
    setTotalPages(total)
    
    const pct = total > 1 ? current / (total - 1) : 0
    onProgressChange({
      pageIndex: current,
      percentage: pct
    })
    
    updateChapterNameAndToc(current)

    // 自动吸附对齐逻辑 (垂直模式)
    if (isAligningRef.current) return
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      if (!el || isAligningRef.current) return
      const targetPage = Math.round(el.scrollTop / clientHeight)
      const targetTop = targetPage * clientHeight
      if (Math.abs(el.scrollTop - targetTop) > 3) {
        el.scrollTo({ top: targetTop, behavior: 'smooth' })
      }
    }, 200)
  }, [settings.layoutMode, onProgressChange, updateChapterNameAndToc, verticalTotalPages])

  // 左右滚动模式滚动回调处理器
  const handleHorizontalScroll = useCallback((e) => {
    if (settings.layoutMode !== 'horizontal-scroll') return
    const el = e.currentTarget
    
    const scrollLeft = el.scrollLeft
    const scrollWidth = el.scrollWidth
    
    const maxScroll = scrollWidth - rect.width
    const pct = maxScroll > 0 ? scrollLeft / maxScroll : 0
    
    const total = Math.max(1, Math.round(maxScroll / cycleW) + 1)
    const current = Math.max(0, Math.min(total - 1, Math.round(scrollLeft / cycleW)))
    
    setPageIndex(current)
    setTotalPages(total)
    
    onProgressChange({
      pageIndex: current,
      percentage: pct
    })
    
    updateChapterNameAndToc(current)

    // 自动吸附对齐逻辑
    if (isAligningRef.current) return
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      if (!el || isAligningRef.current) return
      const targetPage = Math.round(el.scrollLeft / cycleW)
      const targetLeft = targetPage * cycleW
      if (Math.abs(el.scrollLeft - targetLeft) > 3) {
        el.scrollTo({ left: targetLeft, behavior: 'smooth' })
      }
    }, 200)
  }, [settings.layoutMode, onProgressChange, updateChapterNameAndToc, rect.width, cycleW])

  // 全局拦截正文内嵌入目录超链接的点击事件（事件委托）
  const handleContentClick = useCallback((e) => {
    const anchor = e.target.closest('a')
    if (!anchor) return
    
    // 拦截注释链接以阻止跳转并唤起精致 Modal
    if (anchor.getAttribute('data-rebuilt') === 'true') {
      e.preventDefault()
      e.stopPropagation()
      setActiveTooltip(null) // 清除悬浮窗以防冲突
      const noteText = anchor.getAttribute('data-note')
      setActiveNoteModal({
        title: anchor.textContent || '注释',
        text: noteText || '无注释内容'
      })
      return
    }
    
    const fileposVal = anchor.getAttribute('filepos')
    const href = anchor.getAttribute('href')
    
    if (fileposVal) {
      e.preventDefault()
      const targetHref = `filepos-${fileposVal}`
      console.log(`全局拦截：点击原生 filepos="${fileposVal}" 链接，正在调度物理高精度跳转...`)
      
      const matchingTocItem = toc.find(t => t.href === targetHref)
      if (matchingTocItem) {
        jumpToToc(matchingTocItem)
      } else {
        jumpToToc({ href: targetHref, label: anchor.textContent || '' })
      }
    } else if (href && href.startsWith('#')) {
      e.preventDefault()
      const targetId = href.substring(1)
      console.log(`全局拦截：点击常规 href="${href}" 链接，正在调度物理高精度跳转...`)
      
      const matchingTocItem = toc.find(t => t.href === targetId)
      if (matchingTocItem) {
        jumpToToc(matchingTocItem)
      } else {
        jumpToToc({ href: targetId, label: anchor.textContent || '' })
      }
    }
  }, [toc, jumpToToc])

  const nextPage = useCallback(() => {
    if (isCardStyle) {
      const isBottom = pageIndex >= totalPages - 1
      if (isBottom) {
        showToast('已经是最后一页了', 'info')
      } else {
        triggerPageTransitionRef.current?.('next', () => {
          goToPageCard(pageIndex + 1)
        })
      }
      return
    }

    const el = containerRef.current
    if (!el) return
    if (settings.layoutMode === 'vertical') {
      const isBottom = pageIndex >= verticalTotalPages - 1
      if (isBottom) {
        showToast('已经是最后一页了', 'info')
      } else {
        const cycleH = el.clientHeight
        el.scrollTo({ top: (pageIndex + 1) * cycleH, behavior: 'smooth' })
      }
    } else if (settings.layoutMode === 'horizontal-scroll') {
      el.scrollLeft += cycleW
    } else {
      goToPage(pageIndex + 1)
    }
  }, [pageIndex, goToPage, settings.layoutMode, cycleW, verticalTotalPages, isCardStyle, totalPages, goToPageCard])

  const prevPage = useCallback(() => {
    if (isCardStyle) {
      const isTop = pageIndex <= 0
      if (isTop) {
        showToast('已经是第一页了', 'info')
      } else {
        triggerPageTransitionRef.current?.('prev', () => {
          goToPageCard(pageIndex - 1)
        })
      }
      return
    }

    const el = containerRef.current
    if (!el) return
    if (settings.layoutMode === 'vertical') {
      const isTop = pageIndex <= 0
      if (isTop) {
        showToast('已经是第一页了', 'info')
      } else {
        const cycleH = el.clientHeight
        el.scrollTo({ top: (pageIndex - 1) * cycleH, behavior: 'smooth' })
      }
    } else if (settings.layoutMode === 'horizontal-scroll') {
      el.scrollLeft -= cycleW
    } else {
      goToPage(pageIndex - 1)
    }
  }, [pageIndex, goToPage, settings.layoutMode, cycleW, verticalTotalPages, isCardStyle, totalPages, goToPageCard])

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

  // 鼠标滚轮翻页（左右滚动下整页切换）
  const lastWheelTime = useRef(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e) => {
      if (isCardStyle) {
        e.preventDefault()
        const now = Date.now()
        if (now - lastWheelTime.current < 350) return
        lastWheelTime.current = now

        if (e.deltaY > 0) {
          nextPage()
        } else if (e.deltaY < 0) {
          prevPage()
        }
        return
      }

      // 垂直滚动模式下的整页上下翻页接管！
      if (settings.layoutMode === 'vertical') {
        e.preventDefault()
        const now = Date.now()
        if (now - lastWheelTime.current < 350) return
        
        let targetPage = Math.round(el.scrollTop / el.clientHeight)
        if (e.deltaY > 0) {
          targetPage += 1
        } else if (e.deltaY < 0) {
          targetPage -= 1
        }
        
        const total = verticalTotalPages
        const safePage = Math.max(0, Math.min(targetPage, total - 1))
        const targetTop = safePage * el.clientHeight
        
        isAligningRef.current = true
        el.scrollTo({ top: targetTop, behavior: 'smooth' })
        lastWheelTime.current = now
        
        setTimeout(() => {
          isAligningRef.current = false
        }, 400)
        return
      }
      
      if (settings.layoutMode === 'horizontal-scroll') {
        e.preventDefault()
        const now = Date.now()
        if (now - lastWheelTime.current < 350) return
        
        let targetPage = Math.round(el.scrollLeft / cycleW)
        if (e.deltaY > 0) {
          targetPage += 1
        } else if (e.deltaY < 0) {
          targetPage -= 1
        }
        
        const maxScroll = el.scrollWidth - rect.width
        const maxPage = Math.max(1, Math.round(maxScroll / cycleW) + 1) - 1
        const safePage = Math.max(0, Math.min(targetPage, maxPage))
        const targetLeft = safePage * cycleW
        
        isAligningRef.current = true
        el.scrollTo({ left: targetLeft, behavior: 'smooth' })
        lastWheelTime.current = now
        
        setTimeout(() => {
          isAligningRef.current = false
        }, 400)
        return
      }

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
  }, [nextPage, prevPage, settings.layoutMode, cycleW, rect.width, isCardStyle, containerRef.current])

  const fontStyle = {
    fontSize: `${settings.fontSize}px`,
    fontFamily: `"${settings.fontFamily}", Georgia, "Noto Serif SC", serif`,
    lineHeight: settings.lineHeight,
    color: 'var(--reader-text, var(--text-primary))'
  }

  const paddingX = 80

  const horizontalScrollBackgroundStyle = isHorizontalScroll && rect.width && rect.height ? {
    backgroundColor: desktopBg,
    backgroundImage: [
      `linear-gradient(to right, ${readerBg} 0px, ${readerBg} ${pageW}px, transparent ${pageW}px)`,
      `linear-gradient(to right, transparent ${pageW}px, rgba(0,0,0,0.18) ${pageW}px, rgba(0,0,0,0.08) ${pageW + 4}px, rgba(0,0,0,0.03) ${pageW + 10}px, transparent ${pageW + 15}px)`,
      `linear-gradient(to right, rgba(0,0,0,0.03) 0px, rgba(0,0,0,0.08) 5px, rgba(0,0,0,0.15) 15px, transparent 15px)`,
      `linear-gradient(to bottom, transparent calc(100% - 30px), rgba(0,0,0,0.22) calc(100% - 30px), rgba(0,0,0,0.1) calc(100% - 22px), rgba(0,0,0,0.03) calc(100% - 12px), transparent calc(100% - 5px))`,
      `linear-gradient(to bottom, transparent 20px, rgba(0,0,0,0.03) 23px, rgba(0,0,0,0.08) 27px, rgba(0,0,0,0.15) 30px, transparent 30px)`
    ].join(', '),
    backgroundSize: [
      `${cycleW}px calc(100% - 60px)`,
      `${cycleW}px calc(100% - 60px)`,
      `${cycleW}px calc(100% - 60px)`,
      `${pageW}px 100%`,
      `${pageW}px 100%`
    ].join(', '),
    backgroundPosition: [
      `${startPadding}px 30px`,
      `${startPadding}px 30px`,
      `${startPadding - 15}px 30px`,
      `${startPadding}px 0px`,
      `${startPadding}px 0px`
    ].join(', '),
    backgroundRepeat: 'repeat-x',
    backgroundAttachment: 'local'
  } : {}

  const columnStyle = isHorizontalScroll ? {
    columnWidth: `${pageW - 80}px`,
    columnGap: `${2 * startPadding + 120}px`,
    height: '100%',
    overflow: 'visible',
    padding: `60px ${startPadding + 40}px`,
    boxSizing: 'border-box',
    width: '100%',
    display: 'block'
  } : {
    columnWidth: rect.width ? `${rect.width - paddingX * 2}px` : 'auto',
    columnGap: `${paddingX * 2}px`,
    height: '100%',
    overflow: 'hidden',
    padding: `${paddingY}px ${paddingX}px`,
    boxSizing: 'border-box',
    width: '100%',
    display: 'block'
  }



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
              onClick={() => jumpToToc(item)}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}

      {/* 阅读区 */}
      <div 
        ref={readerAreaRef}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', height: '100%', backgroundColor: outerBg }}
      >
        {(!isActuallyLoading || content) && (
          <>
            <style dangerouslySetInnerHTML={{ __html: `
              #mobi-scroll-content, #mobi-content,
              #mobi-scroll-content p, #mobi-content p, 
              #mobi-scroll-content div, #mobi-content div, 
              #mobi-scroll-content span, #mobi-content span, 
              #mobi-scroll-content li, #mobi-content li, 
              #mobi-scroll-content a, #mobi-content a {
                ${settings.fontFamily !== 'BookDefault' ? `font-family: "${settings.fontFamily}", Georgia, "Noto Serif SC", serif !important;` : ''}
                line-height: ${settings.lineHeight} !important;
                font-size: ${settings.fontSize}px !important;
              }
              #mobi-scroll-content img, #mobi-content img {
                max-width: 100% !important;
                height: auto !important;
              }
              #mobi-scroll-content table, #mobi-content table {
                max-width: 100% !important;
                table-layout: fixed !important;
              }
              ${embeddedStyles}
            `}} />
            {isCardStyle ? (
              /* 模式一：100% 同源物理对称渲染 - 始终挂载，测算前视觉隐藏，彻底消灭任何排版偏差 */
              <div
                ref={containerRef}
                className="mobi-container"
                id="mobi-viewer"
                tabIndex={-1}
                style={{
                  flex: 1,
                  width: 'calc(100% - 40px)',
                  maxWidth: `${pageW}px`, 
                  height: `${cardHeight}px`,
                  margin: '0 auto 20px',
                  backgroundColor: readerBg,
                  borderRadius: '0 0 8px 8px',
                  boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  position: 'relative',
                  outline: 'none',
                  isolation: 'isolate',
                  // 未就绪时视觉隐藏但保留物理排版
                  visibility: isMeasured ? 'visible' : 'hidden',
                  pointerEvents: isMeasured ? 'auto' : 'none',
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
                onClick={handleContentClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
                {/* 物理裁剪遮罩层：无圆角无变换，强制 100% 物理拦截溢出文字 */}
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                  <div
                    ref={contentRef}
                    id="mobi-scroll-content"
                    className="mobi-content"
                    style={{
                      ...columnStyleMeasure,
                      width: isMeasured ? `${totalPages * cycleW}px` : `${pageW}px`,
                      overflow: isMeasured ? 'visible' : 'hidden',
                      height: '100%',
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      transform: `translateX(${translateX}px) translateZ(0)`,
                      willChange: 'transform',
                      background: 'transparent',
                      ...fontStyle,
                      transition: (totalPages > 350 || (content && content.length > 600000)) ? 'none' : 'transform 0.22s cubic-bezier(0.25, 1, 0.5, 1)'
                    }}
                    dangerouslySetInnerHTML={{ __html: content }}
                  />
                </div>
              </div>
            ) : settings.layoutMode === 'vertical' ? (
              <div 
                ref={containerRef}
                className="reader-scroll-container"
                id="mobi-scroll-container"
                style={{
                  width: '100%',
                  height: 'calc(100% - 32px)',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  position: 'relative',
                  backgroundColor: desktopBg,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column'
                }}
                onScroll={handleVerticalScroll}
                onClick={handleContentClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
                {/* 纵向排列的多张真卡片 */}
                {Array.from({ length: verticalTotalPages }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      flexShrink: 0,
                      boxSizing: 'border-box'
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        width: `${pageW}px`,
                        height: 'calc(100% - 60px)',
                        backgroundColor: readerBg,
                        borderRadius: '8px',
                        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
                        boxSizing: 'border-box',
                        overflow: 'hidden'
                      }}
                    >
                      {shouldRenderVerticalPage(i) && (
                      <div
                        id="mobi-content"
                        className="mobi-content"
                        style={{
                          ...columnStyleMeasure,
                          width: `${verticalTotalPages * cycleW}px`,
                          height: '100%',
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          transform: `translateX(${-i * cycleW}px)`,
                          background: 'transparent',
                          ...fontStyle
                        }}
                        dangerouslySetInnerHTML={{ __html: content }}
                      />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : settings.layoutMode === 'horizontal-scroll' ? (
              <div 
                ref={containerRef} 
                className="reader-horizontal-scroll-container"
                style={{
                  width: '100%',
                  height: 'calc(100% - 32px)',
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  position: 'relative',
                  backgroundColor: desktopBg
                }} 
                onScroll={handleHorizontalScroll}
              >
                {/* 背景真卡片层 (绝对定位，不参与内层分栏，杜绝渲染冲突) */}
                <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}>
                  {Array.from({ length: renderedBackgroundPages }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        left: `${i * cycleW + startPadding}px`,
                        top: '30px',
                        width: `${pageW}px`,
                        height: 'calc(100% - 60px)',
                        backgroundColor: readerBg,
                        borderRadius: '8px',
                        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
                        boxSizing: 'border-box'
                      }}
                    />
                  ))}
                </div>

                {/* 文本分栏层 (具有 columnStyle 且 overflow: visible 确保溢出能穿透到滚动父级) */}
                <div 
                  id="mobi-content"
                  className="mobi-content"
                  style={{
                    ...columnStyle,
                    position: 'relative',
                    zIndex: 1,
                    background: 'transparent',
                    ...fontStyle
                  }}
                  onClick={handleContentClick}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              </div>
            ) : (
              <div 
                ref={containerRef} 
                className="mobi-content"
                style={{
                  ...columnStyle,
                  overflowX: 'hidden',
                  overflowY: 'hidden',
                  ...fontStyle
                }} 
                id="mobi-content"
                onClick={handleContentClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                dangerouslySetInnerHTML={{ __html: content }}
              />
            )}

            {/* 隐藏的宽度测算容器 (在isCardStyle或垂直模式下进行排版测算) */}
            {(isCardStyle || settings.layoutMode === 'vertical') && (
              <div 
                ref={measureContainerRef} 
                className="mobi-content"
                style={{
                  ...columnStyleMeasure,
                  position: 'absolute',
                  left: '-99999px',
                  top: '-99999px',
                  visibility: 'hidden',
                  width: layoutWidth ? `${layoutWidth}px` : '100%',
                  height: rect.height ? `${rect.height - 32}px` : '100%'
                }}
                dangerouslySetInnerHTML={{ __html: content }}
              />
            )}

            {(!isCardStyle || isMeasured) && (
              <>
                <>
                  <button
                    style={navButtonStyle('left')}
                    onClick={prevPage}
                    onMouseEnter={handleBtnMouseEnter}
                    onMouseLeave={handleBtnMouseLeave}
                    aria-label="上一页"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <button
                    style={navButtonStyle('right')}
                    onClick={nextPage}
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
                  chapterName={currentChapterName}
                  currentPage={pageIndex + 1}
                  totalPages={totalPages}
                  onPageChange={(page) => goToPage(page - 1)}
                />
              </>
            )}
          </>
        )}

        {isActuallyLoading && (
          <div style={{ 
            position: 'absolute', 
            inset: 0, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '12px', 
            color: 'var(--text-muted)',
            backgroundColor: desktopBg,
            zIndex: 100
          }}>
            <div className="loading-spinner" />
            <span>正在解析 {book.format} 文件...</span>
          </div>
        )}
      </div>

      {/* 注释悬浮气泡 Tooltip */}
      {activeTooltip && createPortal(
        <div
          ref={tooltipRef}
          className="reader-note-tooltip"
        >
          {activeTooltip.text}
        </div>,
        document.body
      )}

      {/* 注释精致 Modal 弹窗 */}
      <div 
        className={`reader-note-modal-overlay ${activeNoteModal ? 'visible' : ''}`}
        onClick={() => setActiveNoteModal(null)}
      >
        <div 
          className="reader-note-modal"
          onClick={e => e.stopPropagation()}
        >
          <div className="reader-note-modal-header">
            <div className="reader-note-modal-title">{activeNoteModal?.title || '注释详情'}</div>
            <button className="reader-note-modal-close-btn" onClick={() => setActiveNoteModal(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div className="reader-note-modal-body">
            {activeNoteModal?.text}
          </div>
        </div>
      </div>
    </div>
  )
}

function processNotesInDoc(doc, toc) {
  if (!doc || !toc || toc.length === 0) return

  // 1. 扫描内存中的 doc，收集以数字开头的全部原装注释段落（作为兜底用）
  const paras = doc.querySelectorAll('p, div')
  const noteMap = new Map()
  const NOTE_REGEX = /^\s*\[?(\d+)\]?[\.、\s\-\]\}]+(.*)$/

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]
    const text = p.textContent
    if (!text) continue
    
    // 快速前置字符过滤：如果开头不包含数字或常用括号，则绝非注释段落，直接跳过以大幅提升速度
    const firstChar = text[0] === ' ' ? text.trim()[0] : text[0]
    if (!firstChar) continue
    if (firstChar !== '[' && firstChar !== '(' && firstChar !== '（' && !(firstChar >= '0' && firstChar <= '9')) {
      continue
    }

    const match = text.trim().match(NOTE_REGEX)
    if (match) {
      const noteNum = parseInt(match[1])
      const noteText = match[2].trim()
      // 过滤年份等大数字和极短非注释段落，注号限制在合理范围内
      if (noteText.length > 2 && noteNum > 0 && noteNum < 1500) {
        if (!/^[年\-]/i.test(noteText)) {
          noteMap.set(noteNum, noteText)
        }
      }
    }
  }

  console.log(`气泡注入引擎：成功在内存中收集到原书静态注释段落 ${noteMap.size} 条。`)

  // 预先建立通用标识符映射索引表，完全消灭后续 querySelectorAll 检索带来的性能黑洞！
  const elementIdMap = new Map()
  const elementNameMap = new Map()
  const elementFileposMap = new Map()

  // 仅仅遍历一次所有可能的潜在定位目标元素，搜集所有定位属性，O(N) 级开销
  const candidates = doc.querySelectorAll('[id], [name], [filepos]')
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i]
    const idVal = el.getAttribute('id')
    if (idVal) elementIdMap.set(idVal, el)
    
    const nameVal = el.getAttribute('name')
    if (nameVal) elementNameMap.set(nameVal, el)
    
    const fileposVal = el.getAttribute('filepos')
    if (fileposVal) elementFileposMap.set(fileposVal, el)
  }

  const headingMap = new Map()
  toc.forEach(item => {
    if (item.isVirtual) return
    let hEl = elementIdMap.get(item.href)
    if (!hEl && item.href.startsWith('filepos-')) {
      const fileposVal = item.href.substring(8)
      hEl = elementFileposMap.get(fileposVal) || 
            elementNameMap.get(`filepos${fileposVal}`) || 
            elementIdMap.get(`filepos${fileposVal}`)
    }
    if (hEl) headingMap.set(hEl, item.href)
  })

  // 3. 扫描并处理注释超链接 (仅收集 a 标签，彻底避免查询十万级段落节点引起的严重卡死)
  const links = doc.querySelectorAll('a[filepos], a[href^="#"]')
  links.forEach(link => {
    const fileposVal = link.getAttribute('filepos')
      const hrefAttr = link.getAttribute('href') || ''
      
      // 安全过滤：排除目录项自身
      if (fileposVal && toc.some(t => t.href === `filepos-${fileposVal}`)) return
      if (hrefAttr && hrefAttr.startsWith('#') && toc.some(t => t.href === hrefAttr.substring(1))) return

      // 提取全局注释编号 noteNum
      let noteNum = null
      
      // 优先从超链接文本提取数字 (如 "注153" 提取出 153)
      const textMatch = link.textContent.match(/\d+/)
      if (textMatch) {
        noteNum = parseInt(textMatch[0])
      }
      
      if (!noteNum && hrefAttr.startsWith('#')) {
        const hrefMatch = hrefAttr.match(/\d+/)
        if (hrefMatch) noteNum = parseInt(hrefMatch[0])
      }

      if (!noteNum) {
        const idMatch = (link.getAttribute('id') || '').match(/\d+/)
        if (idMatch) noteNum = parseInt(idMatch[0])
      }

      if (!noteNum && fileposVal) {
        const numVal = parseInt(fileposVal)
        if (noteMap.has(numVal)) noteNum = numVal
      }

      // 如果无法提取出合法的注号，说明不是注释链接
      if (!noteNum) return

      // --- 主动 DOM 爬取算法 ---
      let noteText = ''
      let targetEl = null

      if (hrefAttr.startsWith('#')) {
        const targetId = hrefAttr.substring(1)
        targetEl = elementIdMap.get(targetId)
      }

      if (!targetEl && fileposVal) {
        // 使用 O(1) 预存索引极速匹配，彻底取代慢速 querySelectorAll
        targetEl = elementNameMap.get(`filepos${fileposVal}`) || 
                   elementIdMap.get(`filepos${fileposVal}`) || 
                   elementIdMap.get(`filepos-${fileposVal}`) || 
                   elementFileposMap.get(fileposVal)
      }

      if (targetEl) {
        // 避免 targetEl 指向链接自身或其父子级，且避免指向同一个段落（防止将正文当做注解内容）
        const linkParent = link.closest('p, div, li')
        const targetParent = targetEl.closest('p, div, li')
        if (targetEl === link || link.contains(targetEl) || targetEl.contains(link) || (linkParent && targetParent && linkParent === targetParent)) {
          targetEl = null
        }
      }

      if (targetEl) {
        let parentP = targetEl.closest('p, div, li')
        let rawText = ''
        if (parentP) {
          rawText = parentP.textContent.trim()
        } else {
          rawText = targetEl.parentElement ? targetEl.parentElement.textContent.trim() : targetEl.textContent.trim()
        }
        
        // 过滤前导数字和末尾的返回字符
        rawText = rawText.replace(/^[\[\(（]?\d+[\]\)）]?[\.、\s\-\]\}]*/, '')
        rawText = rawText.replace(/\s*(?:返回|↩|back|top)\s*$/i, '')
        if (rawText.length > 1) {
          noteText = rawText
        }
      }

      // 兜底使用 noteMap 中的静态缓存文本
      if (!noteText) {
        noteText = noteMap.get(noteNum) || ''
      }

      // 仅当找到有效的注释文本时才进行高亮重建，防止误伤普通的普通网页外链
      if (noteText) {
        link.setAttribute('data-note', noteText)
        link.setAttribute('data-rebuilt', 'true')
        link.setAttribute('style', 'display: inline !important; margin: 0 1px !important; cursor: pointer !important; text-decoration: none !important; color: var(--accent); font-weight: 700;')
      }
  })
}
