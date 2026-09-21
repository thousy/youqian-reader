import React, { useState, useEffect, useRef, useCallback } from 'react'
import { StatusBar } from './StatusBar'
import { SourceSwitcherModal } from './SourceSwitcherModal'
import { OfflineCacheModal } from './OfflineCacheModal'
import { ReplaceRuleModal } from './ReplaceRuleModal'

// 高亮渲染函数
function renderParagraphWithHighlights(para, annotations = [], onAnnotationClick) {
  if (!para || !annotations || annotations.length === 0) return para

  const matchingAnns = annotations.filter(a => a.selectedText && para.includes(a.selectedText))
  if (matchingAnns.length === 0) return para

  let segments = [{ text: para, isHighlight: false }]
  for (const ann of matchingAnns) {
    const nextSegments = []
    for (const seg of segments) {
      if (seg.isHighlight) {
        nextSegments.push(seg)
      } else {
        const parts = seg.text.split(ann.selectedText)
        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) nextSegments.push({ text: parts[i], isHighlight: false })
          if (i < parts.length - 1) {
            nextSegments.push({ text: ann.selectedText, isHighlight: true, annotation: ann })
          }
        }
      }
    }
    segments = nextSegments
  }

  return segments.map((seg, idx) => {
    if (seg.isHighlight && seg.annotation) {
      return (
        <mark
          key={idx}
          className="user-annotation-highlight"
          onClick={(e) => {
            e.stopPropagation()
            onAnnotationClick?.(seg.annotation, e)
          }}
          title={seg.annotation.note ? `想法: ${seg.annotation.note}` : '划线高亮 (点击查看/编辑)'}
          style={{
            backgroundColor: seg.annotation.color || '#ffe066',
            color: '#1a1a2e',
            borderRadius: '2px',
            padding: '1px 2px',
            cursor: 'pointer',
            borderBottom: '2px solid rgba(0,0,0,0.3)',
            transition: 'opacity 0.15s ease'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          {seg.text}
        </mark>
      )
    }
    return seg.text
  })
}

export function OnlineNovelReader({
  book,
  savedProgress,
  settings = {},
  onProgressChange,
  registerGetPosition,
  registerSearchProvider,
  registerJumpTo,
  registerGetTtsBlocks,
  annotations = [],
  onAnnotationClick,
  showToc,
  onTocClose
}) {
  const [chapters, setChapters] = useState([])
  const [currentChapterIndex, setCurrentChapterIndex] = useState(savedProgress?.chapterIndex || 0)
  const [chapterContent, setChapterContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState(null)
  const [cachedSet, setCachedSet] = useState(new Set())
  const [currentSource, setCurrentSource] = useState(book?.sourceName || '当前书源')
  const [animState, setAnimState] = useState('idle')
  const [pageIndex, setPageIndex] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // 自动阅读与平滑滚屏引擎状态 (Auto-Reading Engine)
  const [isAutoReading, setIsAutoReading] = useState(false)
  const [autoSpeed, setAutoSpeed] = useState(6) // 左右模式：秒数间隔 (2s~20s)；垂直模式：1~5档速度
  const [isAutoPaused, setIsAutoPaused] = useState(false)
  const [countdown, setCountdown] = useState(6)
  const pauseTimerRef = useRef(null)

  // 当前章节名称（置顶声明，防止TDZ暂时性死区异常）
  const currentChapterTitle = chapters[currentChapterIndex]?.title || `第 ${currentChapterIndex + 1} 章`

  // 弹窗控制
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showCacheModal, setShowCacheModal] = useState(false)
  const [showReplaceModal, setShowReplaceModal] = useState(false)

  // 换源前的原始章节锚点保护状态（防止新书源缺章或对齐偏差导致阅读进度被立即冲掉）
  const [preSwitchState, setPreSwitchState] = useState(null)
  const preSwitchStateRef = useRef(null)
  preSwitchStateRef.current = preSwitchState

  const contentContainerRef = useRef(null)
  const innerContentRef = useRef(null)
  const activeTocRef = useRef(null)

  // 目录抽屉展开时，自动将视口精准居中定位到当前正在阅读的章节
  useEffect(() => {
    if (showToc && activeTocRef.current) {
      const timer = setTimeout(() => {
        activeTocRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [showToc, currentChapterIndex])
  const measureContainerRef = useRef(null)
  const isSwitchingChapterRef = useRef(false)
  const pendingPageRef = useRef(null)

  // 确认用户主动进行了翻章/选章操作，正式解除换源保护并将最新章节保存为阅读进度
  const confirmUserChapterAction = useCallback((targetIndex = null) => {
    if (preSwitchStateRef.current?.isPendingUserAction) {
      setPreSwitchState(null)
      preSwitchStateRef.current = null
      if (targetIndex !== null && chapters[targetIndex]) {
        const targetTitle = chapters[targetIndex]?.title || `第 ${targetIndex + 1} 章`
        onProgressChange?.({
          chapterIndex: targetIndex,
          chapterTitle: targetTitle,
          percentage: chapters.length > 0 ? (targetIndex + 1) / chapters.length : 0
        })
      }
    }
  }, [chapters, onProgressChange])

  // 屏蔽当前正文正在预览的问题书源（采集异常/乱码/缺章）
  const handleBlockCurrentSource = useCallback(async () => {
    if (!book?.id) return
    const curName = currentSource || book.sourceName || '当前书源'
    const ok = window.confirm(`发现书源「${curName}」采集有误？\n\n屏蔽后，本书（《${book.title}》）下次换源将不再展示此源。\n系统将立即为您重新打开换源列表以切换其他正常书源。`)
    if (!ok) return

    const currentBlocked = Array.isArray(book.blockedSources) ? book.blockedSources : []
    const newBlockedItem = {
      sourceId: book.novelSourceId,
      sourceName: curName,
      novelUrl: book.novelUrl,
      reason: '正文预览发现采集异常',
      blockedAt: new Date().toISOString()
    }
    const updated = [
      ...currentBlocked.filter(b => b.sourceId !== book.novelSourceId && b.novelUrl !== book.novelUrl),
      newBlockedItem
    ]

    book.blockedSources = updated
    try {
      await window.api.updateBook(book.id, { blockedSources: updated })
    } catch (_) {}

    // 自动打开换源弹窗，让用户立即选择其他可用书源
    setShowSwitcher(true)
  }, [book, currentSource])

  // 1. 初始化拉取目录与本地缓存状态
  const initChapters = useCallback(async (targetChapterIndex = null, forceRefreshContent = false, forceRefreshToc = false) => {
    if (!book?.id) return
    setLoading(true)
    setErrorMsg(null)
    try {
      // 拉取目录（支持换源后的强制刷新新源目录）
      const res = await window.api.novelGetStreamChapters(book.id, forceRefreshToc)
      if (res.success && res.chapters && res.chapters.length > 0) {
        setChapters(res.chapters)
        
        let targetIndex = 0
        if (targetChapterIndex !== null && targetChapterIndex !== undefined) {
          targetIndex = Math.min(res.chapters.length - 1, Math.max(0, targetChapterIndex))
        } else if (savedProgress?.chapterIndex !== undefined) {
          targetIndex = Math.min(res.chapters.length - 1, Math.max(0, savedProgress.chapterIndex))
        }
        
        setCurrentChapterIndex(targetIndex)
        await loadChapter(targetIndex, res.chapters, forceRefreshContent)
      } else {
        setErrorMsg(res.error || '解析目录失败，请尝试在上方换源')
      }

      // 获取缓存状态
      const statusRes = await window.api.novelCacheStatus(book.id)
      if (statusRes?.cachedIndices) {
        setCachedSet(new Set(statusRes.cachedIndices))
      }
    } catch (e) {
      setErrorMsg('加载目录异常: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [book?.id])

  useEffect(() => {
    initChapters()
  }, [initChapters])

  // 2. 加载指定章节正文
  const loadChapter = async (index, chapterList = chapters, forceFetch = false, scrollToBottom = false, isUserAction = false) => {
    if (!book?.id) return
    isSwitchingChapterRef.current = true
    setLoading(true)
    setErrorMsg(null)

    if (isUserAction) {
      confirmUserChapterAction(index)
    }

    try {
      const res = await window.api.novelGetStreamContent(book.id, index, forceFetch)
      if (res.success) {
        setChapterContent(res.content || '')
        setCurrentChapterIndex(index)

        // 刷新缓存集合
        setCachedSet(prev => new Set([...prev, index]))

        // 后台静默预拉取后 2 章
        window.api.novelPreloadChapters(book.id, index, 2)

        // 若读到最新章节，消除红点
        if (chapterList.length > 0 && index >= chapterList.length - 1) {
          window.api.novelMarkUpdateRead(book.id)
        }

        // 保存阅读进度（关键：若处于换源待确认保护期且非用户主动操作，继续保持换源前的真实章节锚点）
        const isPending = preSwitchStateRef.current?.isPendingUserAction && !isUserAction
        if (isPending) {
          onProgressChange?.({
            chapterIndex: preSwitchStateRef.current.chapterIndex,
            chapterTitle: preSwitchStateRef.current.chapterTitle,
            percentage: preSwitchStateRef.current.percentage || 0
          })
        } else {
          const currentTitle = chapterList[index]?.title || `第 ${index + 1} 章`
          onProgressChange?.({
            chapterIndex: index,
            chapterTitle: currentTitle,
            percentage: chapterList.length > 0 ? (index + 1) / chapterList.length : 0
          })
        }

        // 记录等待定位的目标页码 (0 或最后一页 'last')
        pendingPageRef.current = scrollToBottom ? 'last' : 0

        // 滚动定位：根据排版模式支持首部或尾部进入
        setTimeout(() => {
          if (contentContainerRef.current) {
            if (isVerticalMode) {
              if (scrollToBottom) {
                contentContainerRef.current.scrollTop = contentContainerRef.current.scrollHeight
              } else {
                contentContainerRef.current.scrollTop = 0
              }
            } else {
              // 左右翻页模式：外层容器绝对不可横向滚动，位置完全由 transform 与 pageIndex 精准控制
              contentContainerRef.current.scrollLeft = 0
              contentContainerRef.current.scrollTop = 0
            }
          }
        }, 50)
      } else {
        setErrorMsg(res.error || '获取该章节内容失败')
      }
    } catch (e) {
      setErrorMsg('加载正文异常: ' + e.message)
    } finally {
      setLoading(false)
      setTimeout(() => { isSwitchingChapterRef.current = false }, 100)
    }
  }

  // 章节切换与过渡动效处理器 (与本地 TXT 翻页完全一致)
  const triggerChapterTransition = useCallback((direction, callback) => {
    setAnimState(direction === 'next' ? 'out-left' : 'out-right')
    setTimeout(() => {
      callback?.()
      setAnimState(direction === 'next' ? 'in-right' : 'in-left')
      setTimeout(() => {
        setAnimState('idle')
      }, 180)
    }, 120)
  }, [])

  const handlePrevChapter = useCallback((scrollToBottom = false) => {
    if (currentChapterIndex > 0) {
      const nextIdx = currentChapterIndex - 1
      confirmUserChapterAction(nextIdx)
      triggerChapterTransition('prev', () => {
        loadChapter(nextIdx, chapters, false, scrollToBottom, true)
      })
    }
  }, [currentChapterIndex, chapters, loadChapter, triggerChapterTransition, confirmUserChapterAction])

  const handleNextChapter = useCallback(() => {
    if (currentChapterIndex < chapters.length - 1) {
      const nextIdx = currentChapterIndex + 1
      confirmUserChapterAction(nextIdx)
      triggerChapterTransition('next', () => {
        loadChapter(nextIdx, chapters, false, false, true)
      })
    }
  }, [currentChapterIndex, chapters, loadChapter, triggerChapterTransition, confirmUserChapterAction])

  // 排版模式检测 (与本地图书完全对齐)
  const isHorizontalScroll = settings.layoutMode === 'horizontal-scroll'
  const isVerticalMode = settings.layoutMode === 'vertical'
  const isPaginated = !isHorizontalScroll && !isVerticalMode // 默认为全窗口左右分页仿真翻页

  const reportProgress = useCallback((targetPage, totalP = totalPages) => {
    if (chapters.length > 0) {
      // 若处于换源待确认保护期，章内翻页也不冲掉换源前的原始进度
      if (preSwitchStateRef.current?.isPendingUserAction) {
        onProgressChange?.({
          chapterIndex: preSwitchStateRef.current.chapterIndex,
          chapterTitle: preSwitchStateRef.current.chapterTitle,
          percentage: preSwitchStateRef.current.percentage || 0
        })
        return
      }
      const pct = (currentChapterIndex + (targetPage + 1) / Math.max(1, totalP)) / chapters.length
      onProgressChange?.({
        chapterIndex: currentChapterIndex,
        pageIndex: targetPage,
        chapterTitle: currentChapterTitle,
        percentage: Math.min(1, Math.max(0, pct))
      })
    }
  }, [chapters.length, currentChapterIndex, totalPages, currentChapterTitle, onProgressChange])

  // 本地图书核心翻页机制：严格遵照 layoutMode 区分左右翻页、左右滚动与上下翻页
  const nextPage = useCallback(() => {
    // 每次翻页主动清除浏览器选区，坚决防止翻页过程中弹出标注工具条
    window.getSelection()?.removeAllRanges()

    const el = contentContainerRef.current
    if (!el) {
      handleNextChapter()
      return
    }

    if (!isVerticalMode) {
      // 模式 1：左右卡片平滑逐页翻页（严密卡片内平移，读完切章）
      if (pageIndex < totalPages - 1) {
        const nextP = pageIndex + 1
        setPageIndex(nextP)
        reportProgress(nextP)
      } else {
        // 本章最后一页读完，翻入下一章第一页
        if (currentChapterIndex < chapters.length - 1) {
          handleNextChapter()
        }
      }
    } else {
      // 模式 2：上下垂直滚动
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
      const isAtBottom = el.scrollTop >= maxScroll - 25
      if (!isAtBottom) {
        el.scrollBy({ top: el.clientHeight * 0.88, behavior: 'smooth' })
      } else if (currentChapterIndex < chapters.length - 1) {
        handleNextChapter()
      }
    }
  }, [isVerticalMode, pageIndex, totalPages, currentChapterIndex, chapters.length, handleNextChapter, reportProgress])

  const prevPage = useCallback(() => {
    // 每次翻页主动清除选区
    window.getSelection()?.removeAllRanges()

    const el = contentContainerRef.current
    if (!el) {
      handlePrevChapter()
      return
    }

    if (!isVerticalMode) {
      // 模式 1：左右卡片逐页翻页
      if (pageIndex > 0) {
        const prevP = pageIndex - 1
        setPageIndex(prevP)
        reportProgress(prevP)
      } else if (currentChapterIndex > 0) {
        handlePrevChapter(true)
      }
    } else {
      // 模式 2：上下垂直滚动
      const isAtTop = el.scrollTop <= 25
      if (!isAtTop) {
        el.scrollBy({ top: -el.clientHeight * 0.88, behavior: 'smooth' })
      } else if (currentChapterIndex > 0) {
        handlePrevChapter(true)
      }
    }
  }, [isVerticalMode, pageIndex, currentChapterIndex, handlePrevChapter])

  // 测算本章总页数与当前页码（严格遵照 layoutMode 排版测算）
  const updatePageInfo = useCallback(() => {
    const containerEl = contentContainerRef.current
    if (!containerEl) return

    if (!isVerticalMode) {
      // 左右翻页模式：强行保证外层滚动为 0，杜绝任何意外水平偏离导致的视口空白
      if (containerEl.scrollLeft !== 0) {
        containerEl.scrollLeft = 0
      }
      if (containerEl.scrollTop !== 0) {
        containerEl.scrollTop = 0
      }

      const measureEl = measureContainerRef.current
      if (!measureEl) return
      const pageW = Math.max(300, containerEl.clientWidth || 860)
      const scrollW = measureEl.scrollWidth || pageW
      // 减去 12px 容差，防止末尾微小内边距/字距溢出多算出一整页空白页
      const total = Math.max(1, Math.ceil((scrollW - 12) / pageW))
      setTotalPages(total)

      if (pendingPageRef.current === 'last') {
        setPageIndex(total - 1)
      } else if (typeof pendingPageRef.current === 'number') {
        setPageIndex(Math.min(total - 1, Math.max(0, pendingPageRef.current)))
      } else {
        setPageIndex(prev => Math.min(total - 1, Math.max(0, prev)))
      }
    } else {
      const step = Math.max(200, (containerEl.clientHeight || 1) * 0.88)
      const total = Math.max(1, Math.ceil(containerEl.scrollHeight / step))
      setTotalPages(total)
      setPageIndex(Math.min(total - 1, Math.max(0, Math.round(containerEl.scrollTop / step))))
    }
  }, [isVerticalMode])

  // 监听容器大小改变，实时重新计算总页数
  useEffect(() => {
    const el = contentContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      updatePageInfo()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [updatePageInfo])

  useEffect(() => {
    updatePageInfo()
    const t1 = setTimeout(updatePageInfo, 50)
    const t2 = setTimeout(updatePageInfo, 150)
    const t3 = setTimeout(() => {
      updatePageInfo()
      pendingPageRef.current = null // 在最后一次稳定测算完成后才置空
    }, 320)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [chapterContent, updatePageInfo, settings.layoutMode, settings.fontSize, settings.lineHeight, settings.fontFamily])

  // 3. 注册工具栏与系统能力接口 (TTS、定位、书签等)
  useEffect(() => {
    // 注册给书签取位置
    registerGetPosition?.(() => ({
      chapterIndex: currentChapterIndex,
      chapterTitle: chapters[currentChapterIndex]?.title || '',
      scrollTop: contentContainerRef.current?.scrollTop || 0
    }))

    // 注册给书签/笔记秒级精准跳转
    registerJumpTo?.((target) => {
      if (!target) return
      if (typeof target.chapterIndex === 'number' && target.chapterIndex !== currentChapterIndex) {
        loadChapter(target.chapterIndex).then(() => {
          if (target.selectedText && contentContainerRef.current) {
            scrollToText(target.selectedText)
          }
        })
      } else if (target.selectedText && contentContainerRef.current) {
        scrollToText(target.selectedText)
      }
    })

    // 注册给 TTS 听书系统提取文本块
    registerGetTtsBlocks?.(() => {
      if (!contentContainerRef.current) return []
      const paras = contentContainerRef.current.querySelectorAll('.novel-p')
      return Array.from(paras).map((p, idx) => ({
        index: idx,
        text: p.innerText?.trim() || '',
        element: p
      })).filter(b => b.text.length > 0)
    })
  }, [currentChapterIndex, chapters, chapterContent])

  const scrollToText = (text) => {
    if (!contentContainerRef.current || !text) return
    const marks = contentContainerRef.current.querySelectorAll('.user-annotation-highlight')
    for (const m of marks) {
      if (m.innerText?.includes(text)) {
        m.scrollIntoView({ behavior: 'smooth', block: 'center' })
        m.style.outline = '2px solid var(--accent)'
        setTimeout(() => { m.style.outline = 'none' }, 1500)
        return
      }
    }
  }

  // 格式化正文段落（含全场景智能断行自愈，无论书源格式多么混乱都能精准拆分段落并净化广告）
  const paragraphs = React.useMemo(() => {
    if (!chapterContent) return []
    let text = String(chapterContent)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\\r?\\n/g, '\n')

    // 1. 净化通用网站广告行与干扰内容（支持爱曲小说、笔趣阁等站点常见前缀）
    text = text
      .replace(/天才一秒记住.*?(\n|$)/gi, '')
      .replace(/https?:\/\/[^\n]*(\n|$)/gi, '')
      .replace(/最新网址[：:]\s*/gi, '')
      .replace(/本站首发.*?(\n|$)/gi, '')
      .replace(/一秒记住.*?(\n|$)/gi, '')
      .replace(/最快更新.*?(\n|$)/gi, '')
      .replace(/无广告.*?(\n|$)/gi, '')

    // 2. 逐行智能断行检测：对所有行进行全量深度解耦
    const rawLines = text.split(/\n+/)
    const cleanLines = []

    for (let line of rawLines) {
      let l = line.trim()
      if (!l) continue

      // 无论整篇有多少行，只要该行包含段落粘连特征，即刻拆分：
      // A. 中文句末标点（。！？…”」』）+ 连续空格或全角空格 + 下一段文本
      l = l.replace(/([。！？…”」』])(\u3000+| {2,})(?=[“「『\u4e00-\u9fa5a-zA-Z0-9])/g, '$1\n')
      // B. 句尾标点后跟 2 个及以上空格
      l = l.replace(/([。！？…”」』])\s{2,}/g, '$1\n')
      // C. 连续 4 个普通空格或 2 个全角空格作为段首缩进
      l = l.replace(/(^|[^。！？…”」』\s])\s*(\u3000{2}| {4,})(?=[“「『\u4e00-\u9fa5])/g, '$1\n')

      const splitted = l.split(/\n+/).map(s => s.trim()).filter(Boolean)
      cleanLines.push(...splitted)
    }

    return cleanLines
  }, [chapterContent])



  // 4. 自动阅读与滚屏调度引擎 (Auto-Reading Engine)
  const triggerTemporaryPause = useCallback(() => {
    if (!isAutoReading) return
    setIsAutoPaused(true)
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = setTimeout(() => {
      setIsAutoPaused(false)
    }, 2800)
  }, [isAutoReading])

  // 左右模式：定时自动翻页
  useEffect(() => {
    if (!isAutoReading || isAutoPaused || loading || isVerticalMode) return
    setCountdown(autoSpeed)

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          nextPage()
          return autoSpeed
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [isAutoReading, isAutoPaused, loading, isVerticalMode, autoSpeed, nextPage, pageIndex, currentChapterIndex])

  // 垂直模式：平滑匀速滚屏 (requestAnimationFrame)
  useEffect(() => {
    if (!isAutoReading || isAutoPaused || loading || !isVerticalMode) return
    let animId = null
    const el = contentContainerRef.current
    if (!el) return

    const step = autoSpeed * 0.42

    const scrollLoop = () => {
      if (!isAutoReading || isAutoPaused || loading) return
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
      if (el.scrollTop >= maxScroll - 5) {
        if (currentChapterIndex < chapters.length - 1) {
          handleNextChapter()
        } else {
          setIsAutoReading(false)
        }
        return
      }
      el.scrollTop += step
      animId = requestAnimationFrame(scrollLoop)
    }

    animId = requestAnimationFrame(scrollLoop)
    return () => {
      if (animId) cancelAnimationFrame(animId)
    }
  }, [isAutoReading, isAutoPaused, loading, isVerticalMode, autoSpeed, currentChapterIndex, chapters.length, handleNextChapter])

  // 5. 全套键盘快捷键监听（与本地图书完全对齐：左右键、PageUp/Down、空格翻页与自动阅读微调）
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return

      // 自动阅读快捷控制
      if (isAutoReading) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setIsAutoReading(false)
          setIsAutoPaused(false)
          return
        }
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault()
          setIsAutoPaused(prev => !prev)
          return
        }
        if (e.key === '-' || e.key === '[') {
          e.preventDefault()
          setAutoSpeed(prev => Math.max(isVerticalMode ? 1 : 2, prev - 1))
          return
        }
        if (e.key === '+' || e.key === '=' || e.key === ']') {
          e.preventDefault()
          setAutoSpeed(prev => Math.min(isVerticalMode ? 5 : 20, prev + 1))
          return
        }
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (settings.layoutMode !== 'vertical' && e.key === 'ArrowDown')) {
        e.preventDefault()
        triggerTemporaryPause()
        nextPage()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (settings.layoutMode !== 'vertical' && e.key === 'ArrowUp')) {
        e.preventDefault()
        triggerTemporaryPause()
        prevPage()
      } else if (e.key === ' ') {
        e.preventDefault()
        triggerTemporaryPause()
        if (e.shiftKey) {
          prevPage()
        } else {
          nextPage()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nextPage, prevPage, settings.layoutMode, isAutoReading, isVerticalMode, triggerTemporaryPause])

  // 6. 鼠标滚轮监听：左右模式逐页翻阅，垂直模式支持滚轮暂停保护
  const lastWheelTime = useRef(0)
  useEffect(() => {
    const el = contentContainerRef.current
    if (!el) return

    const handleWheel = (e) => {
      triggerTemporaryPause()
      if (settings.layoutMode === 'vertical') return

      // 左右模式：单次滚轮逐页翻阅，未读完本章前绝不跳章
      const now = Date.now()
      if (now - lastWheelTime.current < 250) return
      lastWheelTime.current = now

      if (e.deltaY > 0) {
        nextPage()
      } else if (e.deltaY < 0) {
        prevPage()
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: true })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [nextPage, prevPage, settings.layoutMode, triggerTemporaryPause])

  // 样式与环境主题计算（与本地图书 1:1 保持一致，全模式呈现精致居中书页卡片）
  const desktopBg = settings.theme === 'word' ? '#f3f3f3' : (settings.globalTheme === 'light' ? '#eaeaf2' : '#0d0d14')
  const isCardStyle = true // 统一保持居中卡片式排版，居中端正且具有实体纸张质感
  const readerBg = {
    light: '#fafafa',
    sepia: '#f4ede0',
    green: '#e3ece0',
    cyan: '#e0ede9',
    peach: '#faecea',
    ivory: '#f6f5ec',
    coffee: '#231f20',
    dark: '#12121c',
    night: '#05050a',
    word: '#ffffff'
  }[settings.theme] || '#12121c'
  const outerBg = settings.theme === 'word' ? '#f3f3f3' : desktopBg

  const fontStyle = {
    fontSize: `${settings.fontSize || 18}px`,
    fontFamily: `"${settings.fontFamily || 'system-ui'}", Georgia, "Noto Serif SC", serif`,
    lineHeight: settings.lineHeight || 1.8,
    fontWeight: settings.fontWeight || 400,
    color: 'var(--reader-text, var(--text-primary))'
  }

  const isLight = ['light', 'sepia', 'green', 'cyan', 'peach', 'ivory', 'word'].includes(settings.theme)
  const navButtonStyle = (side) => {
    const offset = '20px'
    return {
      position: 'absolute',
      top: '50%',
      [side]: offset,
      transform: 'translateY(-50%) scale(1)',
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      backgroundColor: isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.1)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: isLight ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.12)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
      color: settings.theme === 'word' ? '#333333' : 'var(--text-primary)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 90,
      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: 0.6,
      outline: 'none'
    }
  }

  const handleBtnMouseEnter = (e) => {
    e.currentTarget.style.opacity = '1'
    e.currentTarget.style.transform = 'translateY(-50%) scale(1.15)'
    e.currentTarget.style.backgroundColor = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.22)'
  }

  const handleBtnMouseLeave = (e) => {
    e.currentTarget.style.opacity = '0.6'
    e.currentTarget.style.transform = 'translateY(-50%) scale(1)'
    e.currentTarget.style.backgroundColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.1)'
  }

  return (
    <div
      className="online-novel-reader-root"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: outerBg,
        color: 'var(--reader-text, var(--text-primary))',
        ...fontStyle
      }}
    >
      {/* 顶部追书控制微栏 (换源 & 离线缓存入口) */}
      <div
        style={{
          height: '34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: settings.theme === 'word' ? '#eaeaea' : 'rgba(0, 0, 0, 0.08)',
          fontSize: '12px',
          color: 'var(--text-secondary)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>⚡ 在线连载</span>
          <span style={{ color: 'var(--border)' }}>|</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            书源: <strong>{currentSource}</strong>
          </span>
          <span style={{ color: 'var(--border)' }}>|</span>
          <span style={{ color: 'var(--text-muted)' }}>
            进度: {chapters.length > 0 ? (currentChapterIndex + 1) : 0} / {chapters.length} 章
          </span>
          {preSwitchState?.isPendingUserAction && (
            <span
              style={{
                fontSize: '10px',
                color: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                padding: '1px 6px',
                borderRadius: '4px',
                whiteSpace: 'nowrap'
              }}
              title={`正在预览新书源。系统进度仍为您锁定在换源前：${preSwitchState.chapterTitle}`}
            >
              🔒 换源锁定中 (原进度: {preSwitchState.chapterTitle})
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* 屏蔽书源按钮 */}
          <button
            onClick={handleBlockCurrentSource}
            title={`屏蔽书源「${currentSource || book?.sourceName || ''}」：发现采集异常或乱码时点击，本书将不再使用此源，并立即为您换源`}
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              color: '#ef4444',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: 500,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.18)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.08)' }}
          >
            <span>🚫</span> 屏蔽此书源
          </button>

          {/* 一键换源按钮 */}
          <button
            onClick={() => setShowSwitcher(true)}
            title="当前书源缺章或乱码时，一键换源并对齐当前章"
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-layer2)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              transition: 'var(--transition)'
            }}
          >
            <span>🔄</span> 换源
          </button>

          {/* 离线缓存按钮 */}
          <button
            onClick={() => setShowCacheModal(true)}
            title="像阅读 3.0 一样批量下载后 50/100/全本章节到本地离线阅读"
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-layer2)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              transition: 'var(--transition)'
            }}
          >
            <span>📥</span> 离线缓存
            {cachedSet.size > 0 && (
              <span style={{ fontSize: '10px', color: 'var(--accent-light)', marginLeft: '2px' }}>
                ({cachedSet.size})
              </span>
            )}
          </button>

          {/* 自动阅读/自动滚屏按钮 */}
          <button
            onClick={() => {
              setIsAutoReading(prev => !prev)
              setIsAutoPaused(false)
            }}
            title={isAutoReading ? '自动阅读运行中，点击关闭 (快捷键: Esc)' : '开启自动翻页 / 自动匀速滚屏 (快捷键: 空格键暂停/继续)'}
            style={{
              padding: '3px 9px',
              borderRadius: '5px',
              border: isAutoReading ? '1px solid #10b981' : '1px solid var(--border)',
              backgroundColor: isAutoReading ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-layer2)',
              color: isAutoReading ? '#34d399' : 'var(--text-primary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: isAutoReading ? 600 : 400,
              boxShadow: isAutoReading ? '0 0 8px rgba(16, 185, 129, 0.3)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <span>{isAutoReading ? '⚡' : '⏱'}</span> {isAutoReading ? '自动阅读中' : '自动阅读'}
          </button>
        </div>
      </div>

      {/* 换源待确认横幅提示条 */}
      {preSwitchState?.isPendingUserAction && (
        <div
          style={{
            margin: '8px 20px 0',
            padding: '7px 14px',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.28)',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '12px',
            color: 'var(--text-primary)',
            zIndex: 10
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <span style={{ fontSize: '14px' }}>🔖</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              换源提示：当前已载入新源「<strong>{currentChapterTitle}</strong>」，系统阅读进度仍保留在换源前「<strong>{preSwitchState.chapterTitle}</strong>」。翻章或选章后将正式更新。
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              onClick={() => confirmUserChapterAction(currentChapterIndex)}
              style={{
                padding: '3px 9px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: 'var(--accent)',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 500
              }}
              title="确认在该章节继续阅读，并正式将系统进度更新为此章"
            >
              确认在此章阅读
            </button>
            <button
              onClick={() => setShowSwitcher(true)}
              style={{
                padding: '3px 9px',
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'transparent',
                color: 'var(--accent-light)',
                cursor: 'pointer',
                fontSize: '11px'
              }}
              title="再次换源（将使用换源前真实章节继续匹配其他可用书源）"
            >
              再次换源
            </button>
          </div>
        </div>
      )}

      {/* 主体工作区（双栏水平布局：左侧目录面板 + 右侧阅读区） */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
          height: '100%'
        }}
      >
        {/* 目录面板（1:1 完全对齐本地图书 TxtReader/EpubReader 的 reader-toc-panel 嵌入式侧边栏） */}
        {showToc && chapters.length > 0 && (
          <div className="reader-toc-panel">
            <div className="toc-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>目录 (共 {chapters.length} 章)</span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                已缓存 {cachedSet.size} 章
              </span>
            </div>

            {/* 换源待确认期目录顶部提示 */}
            {preSwitchState?.isPendingUserAction && (
              <div
                style={{
                  margin: '8px 10px 4px',
                  padding: '6px 10px',
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  lineHeight: '1.4'
                }}
              >
                <div style={{ color: '#f59e0b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>🔒</span> 换源前阅读进度
                </div>
                <div style={{ color: 'var(--text-primary)', marginTop: '2px', wordBreak: 'break-all', fontSize: '11px' }}>
                  {preSwitchState.chapterTitle}
                </div>
              </div>
            )}

            {/* 章节列表 */}
            {chapters.map((ch, idx) => {
              const isCurrent = idx === currentChapterIndex
              const isCached = cachedSet.has(idx)
              const isPreAnchor = preSwitchState?.isPendingUserAction && (
                ch.title === preSwitchState.chapterTitle || idx === preSwitchState.chapterIndex
              )

              return (
                <div
                  key={idx}
                  ref={isCurrent ? activeTocRef : null}
                  className={`toc-item level-1 ${isCurrent ? 'active' : ''}`}
                  onClick={() => {
                    confirmUserChapterAction(idx)
                    loadChapter(idx, chapters, false, false, true)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {ch.title}
                  </span>
                  {isPreAnchor && (
                    <span
                      style={{
                        fontSize: '9px',
                        color: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0
                      }}
                    >
                      原进度
                    </span>
                  )}
                  {isCached && (
                    <span
                      title="已离线缓存到本地"
                      style={{
                        fontSize: '9px',
                        color: '#22c55e',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0
                      }}
                    >
                      已缓存
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 右侧正文与控制阅读区 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
            height: '100%'
          }}
        >
          {/* 主正文展示区（根据 layoutMode 严格区分左右仿真翻页、左右滚动与上下垂直滚动） */}
      {(() => {
        const containerW = contentContainerRef.current?.clientWidth || 860
        const padX = 60
        const colW = Math.max(200, containerW - padX * 2)
        const colGap = padX * 2

        return (
          <div
            ref={contentContainerRef}
            className="online-novel-content-scroll"
            style={{
              flex: 1,
              overflowX: 'hidden',
              overflowY: isVerticalMode ? 'auto' : 'hidden',
              width: 'calc(100% - 40px)',
              maxWidth: '860px',
              margin: '12px auto 16px',
              backgroundColor: readerBg,
              borderRadius: settings.theme === 'word' ? '0' : '8px',
              boxShadow: settings.theme === 'word' ? '0 4px 20px rgba(0,0,0,0.12), 0 0 2px rgba(0,0,0,0.08)' : '0 10px 40px rgba(0, 0, 0, 0.25)',
              border: settings.theme === 'word' ? '1px solid #d4d4d4' : 'none',
              boxSizing: 'border-box',
              position: 'relative',
              userSelect: 'text',
              transition: 'opacity 0.18s ease',
              opacity: (animState === 'out-left' || animState === 'out-right') ? 0.35 : 1
            }}
            onScroll={updatePageInfo}
          >
            <div
              ref={innerContentRef}
              style={(!isVerticalMode && !loading && !errorMsg) ? {
                width: `${Math.max(1, totalPages) * containerW}px`,
                height: '100%',
                columnWidth: `${colW}px`,
                columnGap: `${colGap}px`,
                columnFill: 'auto',
                padding: `48px ${padX}px 70px`,
                boxSizing: 'border-box',
                transform: `translateX(${-Math.min(Math.max(0, totalPages - 1), Math.max(0, pageIndex)) * containerW}px)`,
                transition: 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)',
                willChange: 'transform'
              } : {
                padding: '48px 60px 80px',
                boxSizing: 'border-box'
              }}
            >
        {/* 章节标题 */}
        <div style={{ marginBottom: '30px', textAlign: 'center' }}>
          <h2
            style={{
              fontSize: `${(settings.fontSize || 18) * 1.35}px`,
              fontWeight: 700,
              color: 'var(--reader-text)',
              marginBottom: '10px',
              letterSpacing: '0.5px'
            }}
          >
            {currentChapterTitle}
          </h2>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            书源: {currentSource || book.sourceName || '网络书源'} · {cachedSet.has(currentChapterIndex) ? '🟢 已本地离线缓存' : '🌐 在线流式加载'}
          </div>
        </div>

        {/* 正在加载骨架指示器 */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontSize: '14px' }}>
            <div style={{ display: 'inline-block', animation: 'spin 1s linear infinite', marginRight: '8px', fontSize: '18px' }}>
              ⏳
            </div>
            正在极速拉取正文...
          </div>
        )}

        {/* 加载异常与换源建议 */}
        {!loading && errorMsg && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              padding: '24px',
              textAlign: 'center',
              margin: '40px 0'
            }}
          >
            <div style={{ fontSize: '15px', color: '#ef4444', fontWeight: 600, marginBottom: '8px' }}>
              本章抓取异常: {errorMsg}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              目标站点可能开启了防盗链或暂时无法访问，您可以尝试重新加载或立即切换其他可用书源。
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (chapters.length === 0) {
                    initChapters()
                  } else {
                    loadChapter(currentChapterIndex)
                  }
                }}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                重试本章
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setShowSwitcher(true)}
                style={{ padding: '6px 16px', fontSize: '12px' }}
              >
                🔄 立即换源
              </button>
            </div>
          </div>
        )}

        {/* 正文段落渲染（完全对齐本地书籍排版） */}
        {!loading && !errorMsg && paragraphs.map((para, pIdx) => (
          <p
            key={pIdx}
            className="novel-p"
            style={{
              ...fontStyle,
              margin: '0 0 1.2em 0',
              textIndent: '2em',
              textAlign: 'justify',
              wordBreak: 'break-all',
              minHeight: para.trim() === '' ? '1em' : 'auto'
            }}
          >
            {renderParagraphWithHighlights(para, annotations, onAnnotationClick)}
          </p>
        ))}

        {/* 章节底部快捷翻章栏（仅在垂直滚动模式下显示，绝不混入多列左右排版中打乱列布局） */}
        {isVerticalMode && !loading && !errorMsg && (
          <div
            style={{
              marginTop: '50px',
              paddingTop: '24px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <button
              disabled={currentChapterIndex === 0}
              onClick={handlePrevChapter}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-layer2)',
                color: currentChapterIndex === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                cursor: currentChapterIndex === 0 ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              ⬅ 上一章
            </button>

            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              第 {currentChapterIndex + 1} / {chapters.length} 章
            </span>

            <button
              disabled={currentChapterIndex >= chapters.length - 1}
              onClick={handleNextChapter}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--accent)',
                color: '#ffffff',
                cursor: currentChapterIndex >= chapters.length - 1 ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              下一章 ➡
            </button>
          </div>
        )}
        </div>

        {/* 隐藏的宽度测算容器 (置于真实正文容器内部，完全继承真实视口高宽，实时精确测算多列总页数) */}
        {!isVerticalMode && (
          <div
            ref={measureContainerRef}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0,
              pointerEvents: 'none',
              zIndex: -1,
              overflow: 'hidden',
              width: '100%',
              height: '100%',
              columnWidth: `${colW}px`,
              columnGap: `${colGap}px`,
              columnFill: 'auto',
              padding: `48px ${padX}px 70px`,
              boxSizing: 'border-box',
              ...fontStyle
            }}
          >
            <div style={{ marginBottom: '30px', textAlign: 'center' }}>
              <h2
                style={{
                  fontSize: `${(settings.fontSize || 18) * 1.35}px`,
                  fontWeight: 700,
                  marginBottom: '10px',
                  letterSpacing: '0.5px'
                }}
              >
                {currentChapterTitle}
              </h2>
            </div>
            {paragraphs.map((para, idx) => (
              <p
                key={idx}
                style={{
                  ...fontStyle,
                  margin: '0 0 1.2em 0',
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
        )}
      </div>
        )
      })()}

      {/* 左右两侧毛玻璃悬浮翻页大按钮（1:1 完全对齐本地图书，先逐页翻阅，触底才切章） */}
      {(currentChapterIndex > 0 || pageIndex > 0) && (
        <button
          style={navButtonStyle('left')}
          onClick={prevPage}
          onMouseEnter={handleBtnMouseEnter}
          onMouseLeave={handleBtnMouseLeave}
          aria-label="上一页"
          title="上一页 (方向键左 / PageUp，触顶自动切上一章)"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {(currentChapterIndex < chapters.length - 1 || pageIndex < totalPages - 1) && (
        <button
          style={navButtonStyle('right')}
          onClick={nextPage}
          onMouseEnter={handleBtnMouseEnter}
          onMouseLeave={handleBtnMouseLeave}
          aria-label="下一页"
          title="下一页 (方向键右 / PageDown / 空格，触底自动切下一章)"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* 底部信息微栏 (StatusBar - 与本地图书 1:1 一致，显示本章页码与整书总进度) */}
      <StatusBar
        chapterName={currentChapterTitle}
        currentPage={pageIndex + 1}
        totalPages={totalPages}
        percentage={chapters.length > 0 ? (currentChapterIndex + (pageIndex + 1) / Math.max(1, totalPages)) / chapters.length : 0}
        onPageChange={(target) => {
          if (target === 'next') {
            nextPage()
          } else if (target === 'prev') {
            prevPage()
          } else if (target === 'home') {
            if (contentContainerRef.current) contentContainerRef.current.scrollTop = 0
          } else if (target === 'end') {
            if (contentContainerRef.current) contentContainerRef.current.scrollTop = contentContainerRef.current.scrollHeight
          } else {
            const num = parseInt(target)
            if (!isNaN(num) && contentContainerRef.current) {
              const step = (contentContainerRef.current.clientHeight || 1) * 0.88
              contentContainerRef.current.scrollTop = Math.max(0, (num - 1) * step)
            }
          }
        }}
      />
        </div>
      </div>

      {/* 自动阅读微型控制胶囊 (Auto Reading Floating Capsule) */}
      {isAutoReading && (
        <div
          className="auto-read-capsule"
          style={{
            position: 'fixed',
            bottom: '48px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(24, 24, 37, 0.88)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            boxShadow: '0 10px 36px rgba(0, 0, 0, 0.5)',
            borderRadius: '30px',
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            zIndex: 9999,
            color: '#fff',
            fontSize: '12px',
            userSelect: 'none',
            animation: 'fadeInUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          {/* 播放 / 暂停切换 */}
          <button
            onClick={() => setIsAutoPaused(prev => !prev)}
            style={{
              background: isAutoPaused ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)',
              border: isAutoPaused ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(16, 185, 129, 0.5)',
              color: isAutoPaused ? '#fbbf24' : '#34d399',
              borderRadius: '50%',
              width: '26px',
              height: '26px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '11px',
              padding: 0
            }}
            title={isAutoPaused ? '点击继续自动阅读 (空格键)' : '点击暂停 (空格键)'}
          >
            {isAutoPaused ? '▶' : '⏸'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 600, color: isAutoPaused ? '#f59e0b' : '#34d399' }}>
              {isAutoPaused ? '⏸ 临时暂停' : (isVerticalMode ? '⚡ 匀速滚屏中' : `⚡ 自动翻页 (${countdown}s)`)}
            </span>
          </div>

          <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.2)' }} />

          {/* 速度调节按钮组 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.6)' }}>速度:</span>
            <button
              onClick={() => setAutoSpeed(prev => Math.max(isVerticalMode ? 1 : 2, prev - 1))}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '4px',
                color: '#fff',
                padding: '2px 7px',
                fontSize: '11px',
                cursor: 'pointer'
              }}
              title="减速 (- 或 [ 键)"
            >
              -
            </button>
            <span style={{ minWidth: '38px', textAlign: 'center', fontWeight: 600, color: '#67e8f9' }}>
              {isVerticalMode ? `${autoSpeed}档` : `${autoSpeed}秒`}
            </span>
            <button
              onClick={() => setAutoSpeed(prev => Math.min(isVerticalMode ? 5 : 20, prev + 1))}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '4px',
                color: '#fff',
                padding: '2px 7px',
                fontSize: '11px',
                cursor: 'pointer'
              }}
              title="加速 (+ 或 ] 键)"
            >
              +
            </button>
          </div>

          <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.2)' }} />

          {/* 关闭退出按钮 */}
          <button
            onClick={() => {
              setIsAutoReading(false)
              setIsAutoPaused(false)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.5)',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1
            }}
            title="退出自动阅读 (Esc 键)"
          >
            ✕
          </button>
        </div>
      )}



      {/* 换源弹窗 */}
      <SourceSwitcherModal
        isOpen={showSwitcher}
        onClose={() => setShowSwitcher(false)}
        book={{ ...book, sourceName: currentSource }}
        currentChapterTitle={preSwitchState?.isPendingUserAction ? preSwitchState.chapterTitle : currentChapterTitle}
        currentChapterIndex={preSwitchState?.isPendingUserAction ? preSwitchState.chapterIndex : currentChapterIndex}
        onSourceSwitched={(res) => {
          // 换源成功，更新书源名称与来源属性，并立即从新书源强制拉取目录与章节正文
          if (res?.sourceName) {
            setCurrentSource(res.sourceName)
          }
          if (book && res) {
            book.sourceName = res.sourceName
            book.novelSourceId = res.sourceId
            book.novelUrl = res.novelUrl
          }

          // 核心优化：连续换源锚点继承
          // 若此前已处于换源待确认保护期（即连续换源），继续继承最原始真实的章节锚点；否则以当前章节建立新锚点
          const baseAnchor = preSwitchStateRef.current?.isPendingUserAction
            ? preSwitchStateRef.current
            : {
                chapterIndex: currentChapterIndex,
                chapterTitle: currentChapterTitle,
                percentage: savedProgress?.percentage || 0,
                sourceName: currentSource || '原书源',
                isPendingUserAction: true
              }

          const newAnchor = {
            ...baseAnchor,
            isPendingUserAction: true
          }
          setPreSwitchState(newAnchor)
          preSwitchStateRef.current = newAnchor

          const alignedIdx = (res && res.alignedIndex !== undefined) ? res.alignedIndex : newAnchor.chapterIndex
          initChapters(alignedIdx, true, true)
        }}
      />

      {/* 离线缓存弹窗 */}
      <OfflineCacheModal
        isOpen={showCacheModal}
        onClose={() => setShowCacheModal(false)}
        book={book}
        currentChapterIndex={currentChapterIndex}
        totalChapters={chapters.length}
        onCacheUpdated={(status) => {
          if (status?.cachedIndices) {
            setCachedSet(new Set(status.cachedIndices))
          }
        }}
      />

      {/* 阅读 3.0 替换净化规则管理弹窗 */}
      <ReplaceRuleModal
        isOpen={showReplaceModal}
        onClose={() => setShowReplaceModal(false)}
        currentBookTitle={book?.title}
        currentSourceName={currentSource}
        onRulesChanged={() => {
          // 规则改动或开关切换后，立刻重新加载本章正文以呈现最新净化效果
          loadChapter(currentChapterIndex, chapters, true)
        }}
      />
    </div>
  )
}
