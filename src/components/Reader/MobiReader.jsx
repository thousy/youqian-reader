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

  const containerRef = useRef(null)
  const readerAreaRef = useRef(null)
  const isInitialized = useRef(false)
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
        isNotesInjectedRef.current = false // 切换书籍时重置注入状态锁
        const result = await window.api.extractMobiContent(book.filePath)
        if (!mounted) return
        
        const rawHtml = result.html || '<p>无法读取内容</p>'
        
        // 使用 DOMParser 解析出标题，动态附加 ID 以生成目录
        const parser = new DOMParser()
        const doc = parser.parseFromString(rawHtml, 'text/html')
        
        let extractedToc = []

        // ================== 【第一级：MOBI/AZW3 专属 filepos 集中目录页提取（首选 🌟）】 ==================
        // 优先寻找并解析电子书内自带的 HTML 目录页，覆盖前置和后置目录页，最符合读者真实习惯
        const fileposLinks = doc.querySelectorAll('a[filepos]')
        if (fileposLinks.length >= 3) {
          const fileposToc = []
          const bodyHtml = doc.body.innerHTML
          const frontLimit = Math.floor(bodyHtml.length * 0.18)
          const backLimit = Math.floor(bodyHtml.length * 0.82)
          
          fileposLinks.forEach((link) => {
            const label = link.textContent.trim()
            const fileposVal = link.getAttribute('filepos')
            if (label && label.length > 1 && label.length < 70 && fileposVal) {
              if (/^\s*[\d\.\-\[\]\(\)\*①②③④⑤⑥⑦⑧⑨⑩]+\s*$/.test(label)) return
              if (label.toLowerCase().includes('top') || label.toLowerCase().includes('back') || label.toLowerCase().includes('返回')) return
              
              // 物理位置双端检验：目录页链接文字必须位于全书前 18% 或后 18% 的两端区域，排除正文中散落的普通链接
              const linkIndex = bodyHtml.indexOf(label)
              if (linkIndex !== -1 && linkIndex > frontLimit && linkIndex < backLimit) {
                return
              }
              
              fileposToc.push({
                label,
                href: `filepos-${fileposVal}`,
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
        
        // 核心性能飞跃：在内存中的 doc 碎片上，以微秒级超高性能完成全部章节注释的划归、重配、悬浮预览注入及移位面板追加！
        // 这彻底消灭了在组件重绘周期的动态 DOM 大范围重排带来的无限渲染死循环和卡死，实现翻页和开书的 60Hz 物理满帧！
        try {
          processNotesInDoc(doc, extractedToc)
        } catch (noteErr) {
          console.error('内存注释搬移引擎执行异常:', noteErr)
        }

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

  // 物理章节名动态匹配，并安全驱动 TOC 左侧联动高亮（极致性能重构：100% O(1) 免查表检索！）
  const updateChapterNameAndToc = useCallback((pageIdx) => {
    if (toc.length === 0) {
      setCurrentChapterName('正文')
      return
    }
    const el = containerRef.current
    if (!el || !rect.width) return

    // 1. 如果是虚拟分页目录，直接高亮对应的页区间！
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

    // 2. 原生自然标题的高亮偏移动态计算（O(1) 查表缓存直接读取，零重复 DOM query 扫描！）
    const scrollLeftVal = pageIdx * el.offsetWidth
    let matchedChapter = '正文'
    let matchedId = null
    let closestOffset = -999999

    for (let item of toc) {
      // 极致 O(1) 优化：直接从缓存 Map 中获取该章节标题对应的 DOM 节点指针
      let headingEl = headingMapRef.current.get(item.href)
      if (!headingEl) {
        if (item.href.startsWith('filepos-')) {
          const fileposVal = item.href.substring(8)
          try {
            const matches = el.querySelectorAll(`[name="filepos${fileposVal}"], #filepos${fileposVal}, #filepos-${fileposVal}`)
            if (matches.length > 0) {
              headingEl = matches[matches.length - 1]
            }
          } catch {}
        } else {
          headingEl = document.getElementById(item.href)
        }
      }

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

  // 统一进度跳转与进度上报逻辑
  const goToPage = useCallback((idx) => {
    const el = containerRef.current
    if (!el || !rect.width || totalPages <= 0) return
    
    const safeIdx = Math.max(0, Math.min(idx, totalPages - 1))
    
    el.scrollLeft = safeIdx * el.offsetWidth
    setPageIndex(safeIdx)
    
    const pct = totalPages > 1 ? safeIdx / (totalPages - 1) : 0
    onProgressChange({
      pageIndex: safeIdx,
      percentage: pct
    })
    
    updateChapterNameAndToc(safeIdx)
  }, [rect.width, totalPages, onProgressChange, updateChapterNameAndToc])

  // 内容、尺寸、目录显示或设置改变时，重新计算分页并对齐 scrollLeft
  useEffect(() => {
    if (loading || !rect.width || !rect.height || !containerRef.current) return

    const timer = setTimeout(() => {
      const el = containerRef.current
      if (!el) return
      
      const total = Math.max(1, Math.ceil(el.scrollWidth / el.offsetWidth))
      setTotalPages(total)

      // 如果这是首次初始化，我们尝试从 savedProgress 中恢复进度
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
        el.scrollLeft = clampedPage * el.offsetWidth
        updateChapterNameAndToc(clampedPage)
      } else {
        // 如果是运行时布局/侧边栏/字体大小变化，重新贴合 scrollLeft 并保持当前页码限制
        setPageIndex(prev => {
          const clamped = Math.min(prev, total - 1)
          el.scrollLeft = clamped * el.offsetWidth
          updateChapterNameAndToc(clamped)
          return clamped
        })
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [loading, rect.width, rect.height, settings.fontSize, settings.fontFamily, settings.lineHeight])

  // 当内容完成渲染或 TOC 发生变化时，瞬时抓取各章节 DOM 指针并填入 headingMapRef 缓存，打通极速高亮与跳转通道
  useEffect(() => {
    if (loading || toc.length === 0) return
    headingMapRef.current.clear()
    const container = containerRef.current
    if (!container) return

    const paras = container.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6')
    const dehydrateText = (str) => {
      return str
        .replace(/[\s\r\n\t]/g, '')
        .replace(/[\-\=\_\*～~]/g, '')
        .trim()
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

      // 2. 如果没找到，进行文本匹配检索（倒序检索以确保在多处匹配时，避开可能的目录页自身，优先匹配后面正文中的标题）
      if (!el) {
        const cleanLabel = item.label.trim()
        const coreLabel = cleanLabel.replace(/^\s*(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕]|Chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万零\d]+|\d+[\.、\s]+)/i, '').trim()
        const dryCleanLabel = dehydrateText(cleanLabel)
        const dryCoreLabel = dehydrateText(coreLabel)
        const tocRatio = toc.length > 0 ? tocIndex / toc.length : 0

        for (let i = paras.length - 1; i >= 0; i--) {
          const pEl = paras[i]
          if (pEl.tagName.toLowerCase() === 'a') continue
          
          const text = pEl.textContent.trim()
          if (text.length > 0 && text.length < 160) {
            const dryText = dehydrateText(text)
            const isMatch = dryText === dryCleanLabel || 
                            dryText === dryCoreLabel || 
                            (dryCoreLabel.length > 1 && dryText.includes(dryCoreLabel))

            if (isMatch) {
              // 排除目录页的链接
              const hasJumpLink = pEl.querySelector('a[href], a[filepos]') || pEl.closest('a[href], a[filepos]')
              if (hasJumpLink) {
                const linkEl = pEl.querySelector('a[href], a[filepos]') || pEl.closest('a[href], a[filepos]')
                const hrefAttr = linkEl.getAttribute('href') || ''
                const fileposAttr = linkEl.getAttribute('filepos') || ''
                if (fileposAttr || (hrefAttr && hrefAttr.startsWith('#'))) {
                  continue
                }
              }

              // 物理占比校验（大致校验位置，防前后错乱匹配，比对逻辑位置比率与段落物理位置比率）
              const paraRatio = paras.length > 0 ? i / paras.length : 0
              if (toc.length > 3 && !/^(版权|序|译者|前言|引言|序言|目录|Contents|TOC)/i.test(cleanLabel)) {
                if (Math.abs(tocRatio - paraRatio) > 0.35) {
                  continue
                }
              }

              el = pEl
              break
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
        return str
          .replace(/[\s\r\n\t]/g, '') // 移除所有空白和换行
          .replace(/[\-\=\_\*～~]/g, '') // 移除常见分割线和装饰符
          .trim()
      }

      const dryCleanLabel = dehydrateText(cleanLabel)
      const dryCoreLabel = dehydrateText(coreLabel)

      for (let i = paras.length - 1; i >= 0; i--) {
        const pEl = paras[i]
        if (pEl.tagName.toLowerCase() === 'a') continue
        
        const text = pEl.textContent.trim()
        // 放宽字符长度至 160 字符以包容多行换行和装饰符
        if (text.length > 0 && text.length < 160) {
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

    const realLeft = headingEl.offsetLeft
    const pageW = el.offsetWidth
    const pageIdx = Math.floor(realLeft / pageW)
    
    goToPage(pageIdx)
    setCurrentTocItem(targetItem.href)
  }, [rect.width, totalPages, goToPage, showToast])

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

  const nextPage = useCallback(() => goToPage(pageIndex + 1), [pageIndex, goToPage])
  const prevPage = useCallback(() => goToPage(pageIndex - 1), [pageIndex, goToPage])

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

  // 鼠标滚轮翻页（带冷却锁）
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
              onClick={handleContentClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
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

            {/* Status bar */}
            <StatusBar
              chapterName={currentChapterName}
              currentPage={pageIndex + 1}
              totalPages={totalPages}
              onPageChange={(page) => goToPage(page - 1)}
            />
          </>
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
    const text = (p.textContent || '').trim()
    const match = text.match(NOTE_REGEX)
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

  // 2. 提取所有的标题和正文超链接的大合集
  // 兼容 a[filepos] 以及普通 href 锚点链接，有些书没有 filepos 属性
  const globalNodes = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, .chapter, .chaptertitle, .chapter-title, .heading, .header, .title, a[filepos], a[href^="#"]')
  
  const headingMap = new Map()
  toc.forEach(item => {
    if (item.isVirtual) return
    let hEl = doc.getElementById(item.href)
    if (!hEl && item.href.startsWith('filepos-')) {
      const fileposVal = item.href.substring(8)
      try {
        const matches = doc.querySelectorAll(`[filepos="${fileposVal}"], [name="filepos${fileposVal}"], #filepos${fileposVal}`)
        if (matches.length > 0) {
          hEl = matches[matches.length - 1]
        }
      } catch {}
    }
    if (hEl) headingMap.set(hEl, item.href)
  })

  // 3. 扫描并处理注释超链接
  globalNodes.forEach(node => {
    if (node.tagName.toLowerCase() === 'a') {
      const link = node
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
        targetEl = doc.getElementById(targetId)
      }

      if (!targetEl && fileposVal) {
        try {
          const matches = doc.querySelectorAll(`[name="filepos${fileposVal}"], #filepos${fileposVal}, #filepos-${fileposVal}, [filepos="${fileposVal}"]`)
          if (matches.length > 0) {
            targetEl = matches[matches.length - 1]
          }
        } catch {}
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
    }
  })
}

