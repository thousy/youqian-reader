import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store/useStore'
import { StatusBar } from './StatusBar'

export function Azw3Reader({ book, savedProgress, settings, onProgressChange, registerGetPosition, showToc }) {
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
  const [debugInfo, setDebugInfo] = useState({ scrollW: 0, maxLeft: 0, tradTotal: 0, lastEl: '' })
  const [embeddedStyles, setEmbeddedStyles] = useState('')

  // 当排版参数变化时，重置测算状态并递增触发器以进入 Loading 重算
  useEffect(() => {
    setIsMeasured(false)
    setMeasureTrigger(prev => prev + 1)
  }, [book.id, content, rect.width, rect.height, settings.fontSize, settings.fontFamily, settings.lineHeight, settings.layoutMode])

  // 监听浏览器自定义字体加载完毕，就绪后强制触发高精度物理排版重算，消灭空白页
  useEffect(() => {
    let active = true
    document.fonts.ready.then(() => {
      if (active) {
        console.log('AZW3: 浏览器系统字体完全就绪，强制高排版精度重算')
        setIsMeasured(false)
        setMeasureTrigger(prev => prev + 1)
      }
    })
    return () => { active = false }
  }, [content])

  const containerRef = useRef(null)
  const readerAreaRef = useRef(null)
  const isInitialized = useRef(false)
  const scrollTimeoutRef = useRef(null)
  const isAligningRef = useRef(false)
  const { showToast } = useStore()

  // 极致 O(1) 性能保障：存储目录项与其对应正文 DOM 元素的映射指针
  const headingMapRef = useRef(new Map())
  const isNotesInjectedRef = useRef(false)

  // 注释悬浮气泡 & 点击 Modal 相关的 State 和 Ref
  const [activeTooltip, setActiveTooltip] = useState(null) // { text }
  const [activeNoteModal, setActiveNoteModal] = useState(null) // { title, text }
  const tooltipRef = useRef(null)
  const mousePosRef = useRef({ x: 0, y: 0 })

  const measureContainerRef = useRef(null)

  // 动态实测多栏布局的总宽度，用来执行黄金对齐公式，100% 解决舍入误差
  const contentRef = useRef(null)
  const [realScrollW, setRealScrollW] = useState(0)

  // 排版模式参数
  const isCardStyle = settings.layoutMode === 'vertical' || settings.layoutMode === 'horizontal-scroll'
  const isHorizontalScroll = settings.layoutMode === 'horizontal-scroll'
  const isVerticalMode = settings.layoutMode === 'vertical'
  const isPaginatedOrVertical = isHorizontalScroll || isVerticalMode

  // 卡片滑动位移过渡动画状态
  const [animState, setAnimState] = useState('idle') 
  const [isTransitionActive, setIsTransitionActive] = useState(false)
  const animationTimeoutRef = useRef(null)

  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  // 卡片翻页过渡效果
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

  const paddingY = 40
  const desktopBg = settings.globalTheme === 'light' ? '#eaeaf2' : '#0d0d14'
  const outerBg = isCardStyle ? desktopBg : 'transparent'
  const readerBg = {
    light: '#fafafa',
    sepia: '#f4ede0',
    dark: '#12121c',
    night: '#05050a'
  }[settings.theme] || '#12121c'

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

  // 物理同源对齐步长：测算端与展示端已像素级锁定，直接使用物理理论步长以 100% 免疫任何 scrollWidth 异步测量导致的排版偏位
  const stepW = cycleW
  const translateX = -pageIndex * stepW

  // 纯粹 DOM 定位更新函数
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
      left = clientX + 15
      transform = 'translate(0, -50%)'
    } else {
      left = clientX - 15
      transform = 'translate(-100%, -50%)'
    }

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

  // 悬浮气泡事件委托
  const handleMouseMove = useCallback((e) => {
    const anchor = e.target.closest('a[data-rebuilt="true"]')
    if (!anchor) {
      if (activeTooltip) setActiveTooltip(null)
      return
    }

    const noteText = anchor.getAttribute('data-note')
    if (!noteText) return

    mousePosRef.current = { x: e.clientX, y: e.clientY }

    if (!activeTooltip || activeTooltip.text !== noteText) {
      setActiveTooltip({ text: noteText })
    } else {
      updateTooltipPosition(e.clientX, e.clientY)
    }
  }, [activeTooltip, updateTooltipPosition])

  const handleMouseLeave = useCallback(() => {
    setActiveTooltip(null)
  }, [])

  // 气泡可见过渡驱动
  useEffect(() => {
    if (!activeTooltip) return
    let active = true
    requestAnimationFrame(() => {
      const el = tooltipRef.current
      if (!el || !active) return
      updateTooltipPosition(mousePosRef.current.x, mousePosRef.current.y)
      el.getBoundingClientRect()
      el.classList.add('visible')
    })
    return () => { active = false }
  }, [activeTooltip, updateTooltipPosition])

  // 监听阅读区容器的实际大小
  useEffect(() => {
    const el = readerAreaRef.current
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

  // 加载 mobi/azw3 内容并动态解析提取目录 (TOC)
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        setEmbeddedStyles('')
        isNotesInjectedRef.current = false
        const result = await window.api.extractMobiContent(book.filePath)
        if (!mounted) return
        
        const rawHtml = result.html || '<p>无法读取内容</p>'
        
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

        // 级联一：原生 filepos 链接抓取
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
            console.log(`AZW3 级联一（集中目录页提取）匹配成功！专属抓取原生 filepos 目录共 ${finalFileposToc.length} 条。`)
          }
        }

        // 级联二：标题标签提取
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
          }
        }

        // 级联三：内嵌超链接目录提取
        if (extractedToc.length < 3) {
          const links = doc.querySelectorAll('a[href^="#"]')
          const linkToc = []
          links.forEach((link) => {
            const label = link.textContent.trim()
            const hrefAttr = link.getAttribute('href')
            if (!hrefAttr || hrefAttr.length <= 1) return
            const href = hrefAttr.substring(1)
            
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
          }
        }

        // 级联四：正则扫描兜底章节提取
        if (extractedToc.length < 3) {
          const CHAPTER_REGEX = /^\s*(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕]|Chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万零\d]+|\d+[\.、\s]+)/i
          const paras = doc.querySelectorAll('p, div, blockquote')
          const regexToc = []
          let matchedCount = 0
          
          for (let i = 0; i < paras.length; i++) {
            const p = paras[i]
            
            // O(1) 高能前置检查，避免对几十万个段落执行昂贵的 textContent 获取
            const firstChild = p.firstChild
            if (!firstChild || firstChild.nodeType !== 3) continue
            const val = firstChild.nodeValue
            if (!val) continue
            const firstChar = val[0] === ' ' ? val.trim()[0] : val[0]
            if (!firstChar) continue
            const isDigit = firstChar >= '0' && firstChar <= '9'
            if (firstChar !== '第' && firstChar !== 'C' && firstChar !== 'c' && !isDigit) continue
            
            const text = p.textContent
            if (text.length === 0 || text.length > 80) continue
            
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
          }
        }
        
        // 去重与合并
        const tocMap = new Map()
        extractedToc.forEach(item => {
          if (item.label) {
            tocMap.set(item.label.trim(), item)
          }
        })
        extractedToc = Array.from(tocMap.values())
        setToc(extractedToc)
        
        // 封面图处理
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

        try {
          processNotesInDoc(doc, extractedToc)
        } catch (noteErr) {
          console.error('内存注释搬移引擎执行异常:', noteErr)
        }

        const hasEmbeddedFonts = /@font-face/i.test(rawHtml) || /\.(ttf|otf|woff2?)\b/i.test(rawHtml)
        const isNewBook = !savedProgress || (savedProgress.pageIndex === 0 && !savedProgress.percentage)
        if (isNewBook && hasEmbeddedFonts) {
          useStore.getState().updateSettings({ fontFamily: 'BookDefault' })
        }

        setContent(doc.body.innerHTML)
        setTitle(result.title || book.title)
        
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
        console.log(`[AZW3 Page Measure] 超级大书性能降级保护启动！总长度: ${content.length} 字符，采用估计页数: ${safeTotal}`)
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
          console.log(`[AZW3 Page Measure] scrollWidth=${curEl.scrollWidth}, maxLeft=${maxLeft}, finalPages=${safeTotal}, lastEl=${lastElText}`)
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

  // 无自然目录时生成虚拟目录
  useEffect(() => {
    if (loading || totalPages <= 1) return
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
  }, [totalPages, loading, toc])

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

  // 进度跳转逻辑
  const goToPageCard = useCallback((idx) => {
    if (totalPages <= 0) return
    const safeIdx = Math.max(0, Math.min(idx, totalPages - 1))
    setPageIndex(safeIdx)
    const pct = totalPages > 1 ? safeIdx / (totalPages - 1) : 0
    onProgressChange({
      pageIndex: safeIdx,
      percentage: pct
    })
    updateChapterNameAndToc(safeIdx)
  }, [totalPages, onProgressChange, updateChapterNameAndToc])

  const goToPage = useCallback((idx) => {
    if (isCardStyle) {
      goToPageCard(idx)
      return
    }
    const el = containerRef.current
    if (!el || totalPages <= 0) return
    const viewWidth = el.offsetWidth
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
  }, [totalPages, onProgressChange, updateChapterNameAndToc, isCardStyle])

  // 响应窗口/进度加载/切换排版设置等引起的分页物理重对齐
  useEffect(() => {
    if (loading || !rect.width || !rect.height) return

    const timer = setTimeout(() => {
      if (isCardStyle) {
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
        return
      }

      const el = containerRef.current
      if (!el) return
      const viewWidth = el.offsetWidth
      const total = totalPages

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
    }, 50)

    return () => clearTimeout(timer)
  }, [loading, rect.width, rect.height, settings.fontSize, settings.fontFamily, settings.lineHeight, settings.layoutMode, totalPages, isCardStyle])

  // 内容与目录缓存指针映射绑定
  useEffect(() => {
    if (loading || toc.length === 0) return
    headingMapRef.current.clear()
    const container = document.getElementById('mobi-scroll-content') || containerRef.current
    if (!container) return

    // 优先提取标题标签、章节专属类名，仅对符合章节首字符特征的 p/div 进行提取，避免庞大段落库引起检索卡死
    const paras = []
    const rawElements = container.querySelectorAll('h1, h2, h3, h4, h5, h6, .chapter, .chaptertitle, .chapter-title, .heading, .header, .title, p, div')
    for (let i = 0; i < rawElements.length; i++) {
      const el = rawElements[i]
      const tagName = el.tagName.toLowerCase()
      if (
        tagName.startsWith('h') || 
        el.classList.contains('chapter') || 
        el.classList.contains('chaptertitle') || 
        el.classList.contains('chapter-title') || 
        el.classList.contains('heading') || 
        el.classList.contains('header') || 
        el.classList.contains('title')
      ) {
        paras.push(el)
      } else {
        const firstChild = el.firstChild
        if (firstChild && firstChild.nodeType === 3) {
          const val = firstChild.nodeValue
          if (val) {
            const firstChar = val[0] === ' ' ? val.trim()[0] : val[0]
            if (firstChar === '第' || firstChar === 'C' || firstChar === 'c' || (firstChar >= '0' && firstChar <= '9')) {
              paras.push(el)
            }
          }
        }
      }
    }

    const dehydrateText = (str) => {
      return str.replace(/[\s\-\=\_\*～~]/g, '')
    }

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

      if (!el) {
        const cleanLabel = item.label.trim()
        const coreLabel = cleanLabel.replace(/^\s*(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕]|Chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万零\d]+|\d+[\.、\s]+)/i, '').trim()
        const dryCleanLabel = dehydrateText(cleanLabel)
        const dryCoreLabel = dehydrateText(coreLabel)
        const tocRatio = toc.length > 0 ? tocIndex / toc.length : 0

        let matchedData = textToElMap.get(dryCleanLabel) || textToElMap.get(dryCoreLabel)
        
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

  // 注册获取定位的回调
  useEffect(() => {
    registerGetPosition(() => {
      const pct = totalPages > 1 ? pageIndex / (totalPages - 1) : 0
      return { label: `第 ${pageIndex + 1} / ${totalPages} 页`, pageIndex, percentage: pct }
    })
  }, [pageIndex, totalPages])

  // 目录跳转
  const jumpToToc = useCallback((targetItem) => {
    if (targetItem.isVirtual) {
      goToPage(targetItem.pageIndex)
      setCurrentTocItem(targetItem.href)
      return
    }

    const queryBase = document.getElementById('mobi-scroll-content') || containerRef.current
    if (!queryBase || !rect.width || totalPages <= 0) return
    
    let headingEl = headingMapRef.current.get(targetItem.href)
    
    if (!headingEl) {
      try {
        headingEl = queryBase.querySelector(`#${CSS.escape(targetItem.href)}`)
      } catch {}
      if (!headingEl) {
        headingEl = document.getElementById(targetItem.href)
      }
      
      if (!headingEl && targetItem.href.startsWith('filepos-')) {
        const fileposVal = targetItem.href.substring(8)
        try {
          const matches = queryBase.querySelectorAll(`[name="filepos${fileposVal}"], #filepos${fileposVal}, #filepos-${fileposVal}`)
          if (matches.length > 0) {
            headingEl = matches[matches.length - 1]
          }
        } catch {}
      }
    }
    
    if (headingEl) {
      const realLeft = headingEl.offsetLeft
      const pageIdxVal = Math.round(realLeft / stepW)
      
      const isIntro = /^(版权|序|译者|前言|引言|序言|目录|Contents|TOC)/i.test(targetItem.label.trim())
      const isPhysicalAnchor = headingEl.classList.contains('reader-filepos-anchor')
      if (pageIdxVal <= 4 && !isIntro && !isPhysicalAnchor) {
        console.log(`智能甄别：章节 [${targetItem.label}] 指向了前置目录区，强行废弃并触发倒序检索！`)
        headingEl = null
      }
    }
    
    if (!headingEl) {
      const cleanLabel = targetItem.label.trim()
      const coreLabel = cleanLabel.replace(/^\s*(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕]|Chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万零\d]+|\d+[\.、\s]+)/i, '').trim()
      
      // 高性能筛选出潜在标题节点，防止回溯遍历全书段落卡死
      const paras = []
      const rawElements = queryBase.querySelectorAll('h1, h2, h3, h4, h5, h6, .chapter, .chaptertitle, .chapter-title, .heading, .header, .title, p, div')
      for (let i = 0; i < rawElements.length; i++) {
        const el = rawElements[i]
        const tagName = el.tagName.toLowerCase()
        if (
          tagName.startsWith('h') || 
          el.classList.contains('chapter') || 
          el.classList.contains('chaptertitle') || 
          el.classList.contains('chapter-title') || 
          el.classList.contains('heading') || 
          el.classList.contains('header') || 
          el.classList.contains('title')
        ) {
          paras.push(el)
        } else {
          const firstChild = el.firstChild
          if (firstChild && firstChild.nodeType === 3) {
            const val = firstChild.nodeValue
            if (val) {
              const firstChar = val[0] === ' ' ? val.trim()[0] : val[0]
              if (firstChar === '第' || firstChar === 'C' || firstChar === 'c' || (firstChar >= '0' && firstChar <= '9')) {
                paras.push(el)
              }
            }
          }
        }
      }
      
      const tocIndex = toc.findIndex(t => t.href === targetItem.href)
      const tocRatio = tocIndex !== -1 && toc.length > 0 ? tocIndex / toc.length : 0

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
            const itemPageIdx = Math.round(itemLeft / stepW)
            const isIntro = /^(版权|序|译者|前言|引言|序言|目录|Contents|TOC)/i.test(targetItem.label.trim())
            
            if (itemPageIdx <= 4 && !isIntro) {
              continue
            }

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
      console.warn(`跳转未匹配：未能在文章中找到与目录 [${targetItem.label}] 相匹配 of ID 或内容文本！`)
      showToast(`未能在正文中匹配到章节: ${targetItem.label}`, 'warning')
      return
    }
    
    let currentCheck = headingEl
    let foundPageBreak = null
    
    for (let up = 0; up < 2 && currentCheck && currentCheck !== queryBase; up++) {
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
        headingEl = realTarget
      }
    }

    const pageIdx = Math.round(headingEl.offsetLeft / stepW)
    goToPage(pageIdx)
    setCurrentTocItem(targetItem.href)
  }, [rect.width, totalPages, goToPage, showToast, stepW, toc])

  // 全局拦截正文内嵌入目录超链接的点击事件（事件委托）
  const handleContentClick = useCallback((e) => {
    const anchor = e.target.closest('a')
    if (!anchor) return
    
    if (anchor.getAttribute('data-rebuilt') === 'true') {
      e.preventDefault()
      e.stopPropagation()
      setActiveTooltip(null)
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
      const matchingTocItem = toc.find(t => t.href === targetHref)
      if (matchingTocItem) {
        jumpToToc(matchingTocItem)
      } else {
        jumpToToc({ href: targetHref, label: anchor.textContent || '' })
      }
    } else if (href && href.startsWith('#')) {
      e.preventDefault()
      const targetId = href.substring(1)
      const matchingTocItem = toc.find(t => t.href === targetId)
      if (matchingTocItem) {
        jumpToToc(matchingTocItem)
      } else {
        jumpToToc({ href: targetId, label: anchor.textContent || '' })
      }
    }
  }, [toc, jumpToToc])

  // 翻页动作调度
  const nextPage = useCallback(() => {
    if (isCardStyle) {
      const isBottom = pageIndex >= totalPages - 1
      if (isBottom) {
        showToast('已经是最后一页了', 'info')
      } else {
        triggerPageTransition('next', () => {
          goToPageCard(pageIndex + 1)
        })
      }
      return
    }

    const el = containerRef.current
    if (!el || totalPages <= 0) return
    const isBottom = pageIndex >= totalPages - 1
    if (isBottom) {
      showToast('已经是最后一页了', 'info')
      return
    }
    goToPage(pageIndex + 1)
  }, [pageIndex, goToPage, isCardStyle, totalPages, showToast, triggerPageTransition, goToPageCard])

  const prevPage = useCallback(() => {
    if (isCardStyle) {
      const isTop = pageIndex <= 0
      if (isTop) {
        showToast('已经是第一页了', 'info')
      } else {
        triggerPageTransition('prev', () => {
          goToPageCard(pageIndex - 1)
        })
      }
      return
    }

    const el = containerRef.current
    if (!el || totalPages <= 0) return
    const isTop = pageIndex <= 0
    if (isTop) {
      showToast('已经是第一页了', 'info')
      return
    }
    goToPage(pageIndex - 1)
  }, [pageIndex, goToPage, isCardStyle, totalPages, showToast, triggerPageTransition, goToPageCard])

  // 键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (isCardStyle && e.key === 'ArrowDown')) {
        e.preventDefault()
        nextPage()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (isCardStyle && e.key === 'ArrowUp')) {
        e.preventDefault()
        prevPage()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nextPage, prevPage, isCardStyle])

  // 鼠标滚轮物理翻页监听
  const lastWheelTime = useRef(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e) => {
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelTime.current < 350) return
      
      lastWheelTime.current = now
      if (e.deltaY > 0) {
        nextPage()
      } else if (e.deltaY < 0) {
        prevPage()
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [nextPage, prevPage, containerRef.current])

  // 设置字体与颜色样式
  const fontStyle = {
    fontSize: `${settings.fontSize}px`,
    fontFamily: `"${settings.fontFamily}", Georgia, "Noto Serif SC", serif`,
    lineHeight: settings.lineHeight,
    color: 'var(--reader-text, var(--text-primary))'
  }

  const paddingX = 80
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

      {/* 阅读渲染区 */}
      <div 
        ref={readerAreaRef}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', height: '100%', backgroundColor: outerBg }}
      >
        {!isBaseLoading && (
          <>
            {/* 精准双 ID 精准选择器样式绑定，保障两容器排版字号高度一致，且绝对不影响无关层级 */}
            {/* 精准双 ID 选择器样式绑定，废除低效通配符（*），采用继承与常见文本元素以提升巨量 DOM 下的渲染性能 */}
            <style dangerouslySetInnerHTML={{ __html: `
              #mobi-scroll-content, #mobi-measure-content {
                ${settings.fontFamily !== 'BookDefault' ? `font-family: "${settings.fontFamily}", Georgia, "Noto Serif SC", serif !important;` : ''}
                line-height: ${settings.lineHeight} !important;
                font-size: ${settings.fontSize}px !important;
              }
              #mobi-scroll-content p, #mobi-scroll-content div, #mobi-scroll-content span, #mobi-scroll-content li,
              #mobi-measure-content p, #mobi-measure-content div, #mobi-measure-content span, #mobi-measure-content li {
                ${settings.fontFamily !== 'BookDefault' ? `font-family: "${settings.fontFamily}", Georgia, "Noto Serif SC", serif !important;` : ''}
                line-height: ${settings.lineHeight} !important;
                font-size: ${settings.fontSize}px !important;
              }
              #mobi-scroll-content img, #mobi-measure-content img {
                max-width: 100% !important;
                height: auto !important;
              }
              #mobi-scroll-content table, #mobi-measure-content table {
                max-width: 100% !important;
                table-layout: fixed !important;
              }
              ${embeddedStyles}
            `}} />
            
            {/* 核心排版模式分支渲染 */}
            {isCardStyle ? (
              /* 模式一：100% 同源物理对称渲染 - 始终挂载，测算前视觉隐藏，彻底消灭任何排版偏差 */
              <div
                ref={containerRef}
                className="azw3-container"
                id="azw3-viewer"
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
                      transition: 'transform 0.22s cubic-bezier(0.25, 1, 0.5, 1)'
                    }}
                    dangerouslySetInnerHTML={{ __html: content }}
                  />
                </div>
              </div>
            ) : (
              /* 模式二：全窗口显示模式 (layoutMode === 'horizontal')，不需要等待 isMeasured */
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

            {/* 翻页按钮和状态栏 (仅在内容准备就绪后展示) */}
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

                {/* 状态栏 */}
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
  console.time('processNotesInDoc')

  const tocHrefSet = new Set(toc.filter(t => !t.isVirtual).map(t => t.href))

  const paras = doc.querySelectorAll('p, div')
  const noteMap = new Map()
  const NOTE_REGEX = /^\s*\[?(\d+)\]?[\.、\s\-\]\}]+(.*)$/

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]
    // 快速前置条件：仅对以数字或特定注释符号开头的文本节点执行 textContent 获取，跳过 99.9% 冗余段落，极大提高大书打开速度
    const firstChild = p.firstChild
    if (!firstChild || firstChild.nodeType !== 3) continue
    const val = firstChild.nodeValue
    if (!val) continue
    const firstChar = val[0] === ' ' ? val.trim()[0] : val[0]
    if (!firstChar) continue
    if (firstChar !== '[' && firstChar !== '(' && firstChar !== '（' && !(firstChar >= '0' && firstChar <= '9')) {
      continue
    }

    const text = p.textContent
    if (!text) continue

    const match = text.trim().match(NOTE_REGEX)
    if (match) {
      const noteNum = parseInt(match[1])
      const noteText = match[2].trim()
      if (noteText.length > 2 && noteNum > 0 && noteNum < 1500) {
        if (!/^[年\-]/i.test(noteText)) {
          noteMap.set(noteNum, noteText)
        }
      }
    }
  }

  console.log(`气泡注入引擎：成功在内存中收集到原书静态注释段落 ${noteMap.size} 条。`)

  const links = doc.querySelectorAll('a[filepos], a[href^="#"]')
  links.forEach(link => {
    const fileposVal = link.getAttribute('filepos')
    const hrefAttr = link.getAttribute('href') || ''
    
    if (fileposVal && tocHrefSet.has(`filepos-${fileposVal}`)) return
    if (hrefAttr && hrefAttr.startsWith('#') && tocHrefSet.has(hrefAttr.substring(1))) return

    let noteNum = null
    
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

    if (!noteNum) return

    let noteText = ''
    let targetEl = null

    // 废除大体积预建 Map 机制，改用原生高速哈希及局部按需检索，避免大书初始化卡死
    if (hrefAttr.startsWith('#')) {
      const targetId = hrefAttr.substring(1)
      targetEl = doc.getElementById(targetId)
    }

    // 优先使用高效率的原生 getElementsByName 和 getElementById，避免昂贵的 querySelector 遍历
    if (!targetEl && fileposVal) {
      const nameMatches = doc.getElementsByName(`filepos${fileposVal}`)
      if (nameMatches.length > 0) {
        targetEl = nameMatches[nameMatches.length - 1]
      }
      if (!targetEl) {
        targetEl = doc.getElementById(`filepos${fileposVal}`) || doc.getElementById(`filepos-${fileposVal}`)
      }
    }

    if (targetEl) {
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
      
      rawText = rawText.replace(/^[\[\(（]?\d+[\]\)）]?[\.、\s\-\]\}]*/, '')
      rawText = rawText.replace(/\s*(?:返回|↩|back|top)\s*$/i, '')
      if (rawText.length > 1) {
        noteText = rawText
      }
    }

    if (!noteText) {
      noteText = noteMap.get(noteNum) || ''
    }

    if (noteText) {
      link.setAttribute('data-note', noteText)
      link.setAttribute('data-rebuilt', 'true')
      link.setAttribute('style', 'display: inline !important; margin: 0 1px !important; cursor: pointer !important; text-decoration: none !important; color: var(--accent); font-weight: 700;')
    }
  })
  console.timeEnd('processNotesInDoc')
}
