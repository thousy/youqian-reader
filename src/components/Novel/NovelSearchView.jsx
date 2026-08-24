import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store/useStore'

const SOURCE_LABELS = {
  biquge: '笔趣阁',
  dingdian: '顶点小说',
  qimao: '七猫小说'
}

const getSourceName = (book) => {
  if (!book) return '未知书源'
  if (book.sourceName && book.sourceName.trim()) return book.sourceName.trim()
  if (SOURCE_LABELS[book.source]) return SOURCE_LABELS[book.source]
  if (book.url) {
    const domain = getDomain(book.url)
    if (domain) return domain
  }
  if (book.source) return book.source
  return '在线书源'
}

const getDomain = (url) => {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch (_) {
    return ''
  }
}

// 状态色
const STATUS_COLOR = {
  running: '#60a5fa',
  packaging: '#a78bfa',
  done: '#4ade80',
  error: '#f87171',
  cancelled: '#9ca3af'
}
const STATUS_LABEL = {
  running: '正在下载',
  packaging: '打包中',
  done: '已完成',
  error: '失败',
  cancelled: '已取消'
}

/**
 * 智能权重精准排序函数：将书名完全匹配、作者完全匹配的小说置顶在最前列
 */
function cleanItemData(item) {
  if (!item) return item
  let title = (item.title || '').trim()
  let author = (item.author || '').trim()
  let latestChapter = (item.latestChapter || '').trim()
  let lastUpdateTime = (item.lastUpdateTime || '').trim()

  const rawTextForBackup = title.length > author.length ? title : author

  if (title.includes('目录') || title.includes('作者') || title.includes('类别') || title.includes('字数') || title.includes('状态') || title.length > 40) {
    const m = title.match(/^([^\/\\|\n\r\t]+?)(?=\s*[\/\|]|\s*目录|\s*作者|\s*类别|\s*字数|\s*状态|\s*$)/)
    if (m && m[1].trim()) title = m[1].trim()
  }

  if (author === item.title || author.includes('作者') || author.includes('目录') || author.includes('类别') || author.length > 25) {
    const m = rawTextForBackup.match(/(?:作者[：:\s]*|writer[：:\s]*)([\u4e00-\u9fa5a-zA-Z0-9_\-·\s]{2,20})(?=\s*类别|\s*字数|\s*状态|\s*更新|\s*最新|\s*[\/\|]|\s*$)/)
    if (m && m[1].trim()) {
      author = m[1].trim()
    } else if (author === item.title && author.length > 20) {
      author = '未知'
    }
  }

  if (!latestChapter || latestChapter === '—') {
    const mCh = rawTextForBackup.match(/(?:最新章节[：:\s]*|最新[：:\s]*)(.+?)(?=\s*更新|\s*[\/\|]|\s*$)/)
    if (mCh && mCh[1].trim()) latestChapter = mCh[1].trim()
  }

  if (!lastUpdateTime || lastUpdateTime === '—') {
    const mTime = rawTextForBackup.match(/(?:更新[：:\s]*|时间[：:\s]*)([\d]{2,4}[-.\/][\d]{1,2}[-.\/][\d]{1,2})/)
    if (mTime && mTime[1].trim()) lastUpdateTime = mTime[1].trim()
  }

  return {
    ...item,
    title,
    author: author || '未知',
    latestChapter,
    lastUpdateTime
  }
}

function rankSearchResults(list, kw) {
  if (!list || !list.length) return list || []
  const cleanedList = list.map(cleanItemData)
  if (!kw) return cleanedList
  const cleanKw = kw.trim().toLowerCase().replace(/[！!？?。，,\s]/g, '')
  return [...cleanedList].sort((a, b) => {
    const aTitle = (a.title || '').toLowerCase().replace(/[！!？?。，,\s]/g, '')
    const bTitle = (b.title || '').toLowerCase().replace(/[！!？?。，,\s]/g, '')
    const aAuthor = (a.author || '').toLowerCase().replace(/\s/g, '')
    const bAuthor = (b.author || '').toLowerCase().replace(/\s/g, '')

    // 1. 书名完全相等（满分 100）
    const aExact = aTitle === cleanKw ? 100 : (aTitle.startsWith(cleanKw) ? 80 : (aTitle.includes(cleanKw) ? 60 : 0))
    const bExact = bTitle === cleanKw ? 100 : (bTitle.startsWith(cleanKw) ? 80 : (bTitle.includes(cleanKw) ? 60 : 0))
    if (aExact !== bExact) return bExact - aExact

    // 2. 作者完全相等（加 50 分）
    const aAuth = aAuthor === cleanKw ? 50 : 0
    const bAuth = bAuthor === cleanKw ? 50 : 0
    if (aAuth !== bAuth) return bAuth - aAuth

    // 3. 有最新章节的排前面
    const aChap = a.latestChapter ? 10 : 0
    const bChap = b.latestChapter ? 10 : 0
    return bChap - aChap
  })
}

export function NovelSearchView() {
  const { showToast, setBooks, setFilterFormat } = useStore()

  const [keyword, setKeyword] = useState('')
  const [sourceId, setSourceId] = useState('all')
  const [sources, setSources] = useState([])
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [viewMode, setViewMode] = useState('table') // 'table' | 'grid'

  // 列表各列宽度状态 (默认自适应 100% 充满屏幕不超出，手动拖拽时转为精准像素)
  const [colWidths, setColWidths] = useState({
    idx: '4%',
    title: '22%',
    author: '10%',
    latestChapter: '20%',
    lastUpdateTime: '11%',
    source: '11%',
    action: '22%'
  })

  const tableRef = useRef(null)
  const [resizingCol, setResizingCol] = useState(null)

  // 鼠标按住表头边框拖拽调整列宽 Handler (支持百分比与像素无缝转换)
  const handleResizeStart = (e, colKey) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingCol(colKey)

    // 若当前仍为百分比占比，首次拖拽时瞬间捕获转为各列真实像素宽度
    let currentWidths = { ...colWidths }
    if (tableRef.current && typeof currentWidths.idx === 'string') {
      const ths = tableRef.current.querySelectorAll('th')
      const keys = ['idx', 'title', 'author', 'latestChapter', 'lastUpdateTime', 'source', 'action']
      if (ths && ths.length === 7) {
        ths.forEach((th, i) => {
          currentWidths[keys[i]] = th.getBoundingClientRect().width
        })
        setColWidths(currentWidths)
      }
    }

    const startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0)
    const startWidth = typeof currentWidths[colKey] === 'number' ? currentWidths[colKey] : 120

    const onPointerMove = (moveEvent) => {
      moveEvent.preventDefault()
      const currentX = moveEvent.clientX || (moveEvent.touches && moveEvent.touches[0] ? moveEvent.touches[0].clientX : startX)
      const deltaX = currentX - startX
      const newWidth = Math.max(40, startWidth + deltaX)
      setColWidths(prev => ({
        ...prev,
        [colKey]: newWidth
      }))
    }

    const onPointerUp = () => {
      setResizingCol(null)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseup', onPointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)
  }

  // 章节下载选择弹窗
  const [chapterModal, setChapterModal] = useState(null)
  const [loadingChapters, setLoadingChapters] = useState(false)

  // 在线阅读预览弹窗
  const [previewModal, setPreviewModal] = useState(null)

  // 下载任务
  const [tasks, setTasks] = useState({})

  const inputRef = useRef(null)
  const keywordRef = useRef(keyword)
  useEffect(() => { keywordRef.current = keyword }, [keyword])

  const reloadSources = async () => {
    try {
      let srcList = await window.api.novelGetSources()
      if (!Array.isArray(srcList) || srcList.length === 0) {
        srcList = await window.api.novelGetSourcesDetail()
      }
      if (Array.isArray(srcList)) {
        setSources(srcList.filter(s => s.enabled !== false))
      }
    } catch (e) {
      console.error('获取书源失败:', e)
    }
  }

  useEffect(() => {
    reloadSources()
    inputRef.current?.focus()

    const onProgress = async (data) => {
      setTasks(prev => ({
        ...prev,
        [data.taskId]: { ...prev[data.taskId], ...data }
      }))
      if (data.status === 'done') {
        const fmt = data.format || '文件'
        showToast(`《${data.novelTitle || ''}》下载完成 [${fmt}]，已自动导入书架！`, 'success')
        if (data.outputPath) {
          try { await window.api.novelImportAfterDownload(data.outputPath) } catch (_) {}
        }
        if (typeof setFilterFormat === 'function') setFilterFormat('all')
        window.api.getAllBooks().then(books => {
          if (Array.isArray(books)) setBooks(books)
        })
      } else if (data.status === 'error') {
        showToast(`下载失败: ${data.error || '未知错误'}`, 'error')
      }
    }

    const onPartial = (newItems) => {
      if (!Array.isArray(newItems) || !newItems.length) return
      setResults(prev => {
        const seen = new Set(prev.map(b => `${b.source}_${b.url || b.title}`))
        const addition = newItems.filter(b => !seen.has(`${b.source}_${b.url || b.title}`))
        const merged = [...prev, ...addition]
        return rankSearchResults(merged, keywordRef.current || '')
      })
    }

    window.api.onDownloadProgress?.(onProgress)
    window.api.onSearchPartial?.(onPartial)

    return () => {
      window.api.offDownloadProgress?.(onProgress)
      window.api.offSearchPartial?.(onPartial)
    }
  }, [])

  // 书源多选勾选状态 (null 表示默认全选所有书源，数组表示自定义勾选 ID 列表)
  const [selectedSourceIds, setSelectedSourceIds] = useState(null)
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const [sourcePickerQuery, setSourcePickerQuery] = useState('')

  // 计算当前有效选中的书源集合与全选状态
  const allSourceIds = sources.map(s => s.id)
  const currentSelectedIds = selectedSourceIds === null ? allSourceIds : selectedSourceIds
  const isAllSelected = sources.length > 0 && currentSelectedIds.length === sources.length

  const handleSearch = async () => {
    if (!keyword.trim()) return
    if (currentSelectedIds.length === 0) {
      showToast('请至少勾选一个书源后再进行搜索', 'warning')
      return
    }
    setSearching(true)
    setSearchError('')
    setResults([])
    try {
      // 如果处于全选状态传入 null 聚合搜索所有，否则传入具体选中的书源 ID 数组
      const targetSources = isAllSelected ? null : currentSelectedIds
      const res = await window.api.novelSearch(keyword.trim(), targetSources)
      if (res && res.success) {
        if (res.results && res.results.length > 0) {
          setResults(rankSearchResults(res.results, keyword.trim()))
        } else {
          setResults(prev => {
            if (prev.length === 0) setSearchError('未找到相关小说，请尝试其他关键词')
            return prev
          })
        }
      } else {
        setResults(prev => {
          if (prev.length === 0) setSearchError(res?.error || '搜索失败')
          return prev
        })
      }
    } catch (e) {
      setResults(prev => {
        if (prev.length === 0) setSearchError('搜索出错: ' + e.message)
        return prev
      })
    } finally {
      setSearching(false)
    }
  }

  const handleStopSearch = async () => {
    try {
      await window.api.novelCancelSearch()
      showToast('已取消搜索', 'info')
    } catch (_) { }
    setSearching(false)
  }

  // 打开下载弹窗
  const handleOpenDownloadModal = async (book) => {
    setLoadingChapters(true)
    setChapterModal({ novelInfo: book, chapters: [], sourceId: book.source, loading: true })
    try {
      const res = await window.api.novelGetChapters(book.url, book.source)
      if (res.success) {
        setChapterModal({
          novelInfo: { ...book, title: res.title || book.title, author: res.author || book.author, description: res.description || book.description, cover: res.cover || book.cover },
          chapters: res.chapters || [],
          sourceId: book.source,
          loading: false
        })
      } else {
        showToast('获取章节失败: ' + res.error, 'error')
        setChapterModal(null)
      }
    } catch (e) {
      showToast('获取章节出错: ' + e.message, 'error')
      setChapterModal(null)
    } finally {
      setLoadingChapters(false)
    }
  }

  // 打开在线预览（失败时保留弹窗展示换源面板，不关闭）
  const handleOpenPreview = async (book) => {
    setPreviewModal({
      novelInfo: book,
      chapters: [],
      currentIdx: 0,
      content: '',
      loading: true
    })
    try {
      const res = await window.api.novelGetChapters(book.url, book.source)
      if (res.success && res.chapters && res.chapters.length > 0) {
        const chapters = res.chapters
        const firstCh = chapters[0]
        let contentText = '【获取章节正文失败】'
        try {
          const contentRes = await window.api.novelGetContent(firstCh.url, book.source)
          if (contentRes.success) contentText = contentRes.content
        } catch (_) {}
        // 验证 res.title 是否为有效书名（排除网站名、域名等干扰值）
        const isValidResTitle = res.title && res.title.length >= 2 && res.title !== book.sourceName &&
          !res.title.includes('小说网') && !res.title.includes('书院') && !res.title.includes('.com') &&
          !res.title.includes('.cc') && !res.title.includes('.net')
        setPreviewModal({
          novelInfo: {
            ...book,
            title: isValidResTitle ? res.title : book.title,
            originalSearchTitle: book.title, // 始终保存搜索结果中的原始书名，用于换源匹配
            author: res.author || book.author,
            description: res.description || book.description,
            cover: res.cover || book.cover
          },
          chapters,
          currentIdx: 0,
          content: contentText,
          loading: false
        })
      } else {
        // 章节目录获取失败 → 保留弹窗并显示错误+换源面板
        setPreviewModal(prev => prev ? ({
          ...prev,
          content: '【获取章节目录失败：该书源目标站点可能已宕机或反爬限流，请尝试下方换源】',
          loading: false
        }) : null)
      }
    } catch (e) {
      // 网络异常 → 保留弹窗并显示错误+换源面板
      setPreviewModal(prev => prev ? ({
        ...prev,
        content: '【预览出错: ' + e.message + '，请尝试下方换源】',
        loading: false
      }) : null)
    }
  }

  const handleStartDownload = async (novelInfo, chapters, sourceId, format = 'EPUB', concurrency = null) => {
    try {
      const res = await window.api.novelStartDownload(novelInfo, chapters, sourceId, format, concurrency)
      setTasks(prev => ({
        ...prev,
        [res.taskId]: { status: 'running', progress: 0, total: chapters.length, novelTitle: novelInfo.title, format, concurrency }
      }))
      setChapterModal(null)
      if (previewModal) setPreviewModal(null)
      const threadTip = concurrency ? ` [${concurrency}线程]` : ''
      showToast(`已开始下载《${novelInfo.title}》[${format}]${threadTip}，共 ${chapters.length} 章`, 'success')
    } catch (e) {
      showToast('启动下载失败: ' + e.message, 'error')
    }
  }

  // 搜书结果列表/卡片一键按格式直接下载全本
  const handleQuickDownload = async (book, format) => {
    showToast(`正在解析《${book.title}》章节目录并准备下载 [${format}]...`, 'info')
    try {
      const res = await window.api.novelGetChapters(book.url, book.source)
      if (res.success && res.chapters && res.chapters.length > 0) {
        const fullNovelInfo = {
          ...book,
          title: res.title || book.title,
          author: res.author || book.author,
          description: res.description || book.description,
          cover: res.cover || book.cover
        }
        await handleStartDownload(fullNovelInfo, res.chapters, book.source, format)
      } else {
        showToast('获取章节失败，无法直下: ' + (res.error || '未获取到章节目录'), 'error')
      }
    } catch (e) {
      showToast('一键下载出错: ' + e.message, 'error')
    }
  }

  const handleCancelTask = async (taskId) => {
    await window.api.novelCancelDownload(taskId)
    setTasks(prev => ({ ...prev, [taskId]: { ...prev[taskId], status: 'cancelled' } }))
  }

  const handleImportSource = async () => {
    try {
      const res = await window.api?.novelImportSource?.()
      if (res?.canceled) return
      if (res?.success) {
        showToast(`成功导入 ${res.count || 1} 个书源！`, 'success')
        reloadSources()
      } else {
        showToast(`导入失败: ${res?.error || '未识别到有效书源'}`, 'error')
      }
    } catch (e) {
      showToast('导入出错: ' + e.message, 'error')
    }
  }

  const taskList = Object.entries(tasks)

  return (
    <div className="novel-search-view">
      {/* 头部搜索区 */}
      <div className="novel-search-header">
        <div className="novel-search-title">
          <span className="novel-search-icon">🔍</span>
          <h2>在线找书</h2>
          <span className="novel-search-subtitle">聚合全网书源，实时在线预览、章节范围下载与管理</span>
        </div>

        <div className="novel-search-bar">
          <div className="novel-source-selector" style={{ position: 'relative' }}>
            {/* 书源多选与搜索下拉按钮 */}
            <button
              onClick={() => {
                if (!showSourcePicker) reloadSources()
                setShowSourcePicker(!showSourcePicker)
              }}
              style={{
                padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--accent)',
                background: 'var(--bg-layer1)', color: 'var(--text-primary)', cursor: 'pointer',
                fontSize: '13px', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '6px'
              }}
              title="点击可搜索并自由勾选要使用的书源"
            >
              <span>
                {isAllSelected
                  ? (sources.length > 0 ? `🌐 全部书源 (${sources.length}个聚合)` : '🌐 全部书源 (全量聚合)')
                  : (currentSelectedIds.length === 0
                      ? '⚠️ 未选择书源 (请勾选)'
                      : `🌐 已选 ${currentSelectedIds.length} 个书源`)}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--accent-light)' }}>▾</span>
            </button>

            {/* 下拉面板：搜索书源 + 复选框勾选列表 */}
            {showSourcePicker && (
              <div
                style={{
                  position: 'absolute', top: '110%', left: 0, zIndex: 1200,
                  width: '360px', maxHeight: '420px', background: 'var(--bg-layer1)',
                  borderRadius: '12px', border: '1px solid var(--border)',
                  boxShadow: '0 15px 40px rgba(0,0,0,0.5)', padding: '14px',
                  display: 'flex', flexDirection: 'column', gap: '10px'
                }}
              >
                {/* 1. 浮层顶栏：搜书源输入框 */}
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={sourcePickerQuery}
                    onChange={e => setSourcePickerQuery(e.target.value)}
                    placeholder="🔍 搜索书源名称（如：笔趣阁、书海阁）..."
                    style={{
                      width: '100%', padding: '7px 10px', borderRadius: '6px',
                      border: '1px solid var(--border)', background: 'var(--bg-layer2)',
                      color: 'var(--text-primary)', fontSize: '12px'
                    }}
                  />
                </div>

                {/* 2. 快捷选择控制栏 */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px' }}>
                  <button
                    onClick={() => {
                      if (isAllSelected) {
                        // 当前已全选，再按一次全选 => 取消全选（清空勾选）
                        setSelectedSourceIds([])
                      } else {
                        // 当前非全选 => 全选所有
                        setSelectedSourceIds(allSourceIds)
                      }
                    }}
                    style={{
                      padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border)',
                      background: isAllSelected ? 'var(--accent)' : 'var(--bg-layer2)',
                      color: isAllSelected ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
                      fontWeight: isAllSelected ? 600 : 400
                    }}
                    title={isAllSelected ? '点击取消全选' : '点击全选所有书源'}
                  >
                    🌐 全选 ({sources.length})
                  </button>
                  <button
                    onClick={() => {
                      const builtinIds = sources.filter(s => !s.id.startsWith('custom_')).map(s => s.id)
                      setSelectedSourceIds(builtinIds)
                    }}
                    style={{
                      padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border)',
                      background: 'var(--bg-layer2)', color: 'var(--text-secondary)', cursor: 'pointer'
                    }}
                  >
                    🌟 只选核心精选源
                  </button>
                  <button
                    onClick={() => {
                      const inverted = allSourceIds.filter(id => !currentSelectedIds.includes(id))
                      setSelectedSourceIds(inverted)
                    }}
                    style={{
                      padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border)',
                      background: 'var(--bg-layer2)', color: 'var(--text-secondary)', cursor: 'pointer'
                    }}
                  >
                    🔄 反选
                  </button>
                  <span style={{ marginLeft: 'auto', color: 'var(--accent-light)', fontWeight: 600 }}>
                    已勾选 {currentSelectedIds.length} 个
                  </span>
                </div>

                {/* 3. 带复选框的书源列表 (过滤渲染) */}
                <div style={{ flex: 1, overflowY: 'auto', maxHeight: '260px', display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '4px' }}>
                  {sources
                    .filter(s => {
                      if (!sourcePickerQuery.trim()) return true
                      return s.name.toLowerCase().includes(sourcePickerQuery.toLowerCase().trim())
                    })
                    .map(s => {
                      const isChecked = currentSelectedIds.includes(s.id)
                      return (
                        <label
                          key={s.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
                            borderRadius: '6px', background: isChecked ? 'var(--bg-layer2)' : 'transparent',
                            cursor: 'pointer', fontSize: '12px', userSelect: 'none',
                            border: `1px solid ${isChecked ? 'var(--border-subtle)' : 'transparent'}`
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSourceIds([...currentSelectedIds, s.id])
                              } else {
                                setSelectedSourceIds(currentSelectedIds.filter(id => id !== s.id))
                              }
                            }}
                            style={{ accentColor: 'var(--accent)', width: '15px', height: '15px', cursor: 'pointer' }}
                          />
                          <span style={{ color: 'var(--text-primary)', fontWeight: isChecked ? 500 : 400 }}>{s.name}</span>
                          <span style={{
                            marginLeft: 'auto', fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
                            background: s.id.startsWith('custom_') ? '#8b5cf620' : '#3b82f620',
                            color: s.id.startsWith('custom_') ? '#a78bfa' : '#60a5fa'
                          }}>
                            {s.id.startsWith('custom_') ? '自定义' : '核心'}
                          </span>
                        </label>
                      )
                    })}
                </div>

                {/* 4. 底部确定与关闭 */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={() => setShowSourcePicker(false)}
                    style={{
                      padding: '5px 16px', borderRadius: '6px', border: 'none',
                      background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600
                    }}
                  >
                    完成勾选
                  </button>
                </div>
              </div>
            )}

            <button
              className="novel-import-source-btn"
              onClick={() => {
                reloadSources()
                showToast(`已刷新书源列表，当前共 ${sources.length} 个书源`, 'info')
              }}
              title="刷新书源列表"
            >
              🔄 刷新
            </button>
            <button
              className="novel-import-source-btn"
              onClick={handleImportSource}
              title="导入自定义 JSON/JSON5/阅读3.0 书源文件"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              导入书源
            </button>
          </div>
          <input
            ref={inputRef}
            id="novel-search-input"
            className="novel-search-input"
            type="text"
            placeholder="输入书名或作者名（如：快收了神通吧）..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          {searching ? (
            <button
              id="novel-search-btn"
              className="novel-search-btn stop-btn"
              onClick={handleStopSearch}
              title="停止当前搜索"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              停止搜索
            </button>
          ) : (
            <button
              id="novel-search-btn"
              className="novel-search-btn"
              onClick={handleSearch}
              disabled={!keyword.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              搜索
            </button>
          )}
        </div>

        {/* 结果控制与视图切换 */}
        {results.length > 0 && (
          <div className="novel-results-bar">
            <span className="novel-results-count">共检索到 {results.length} 条结果</span>
            <div className="novel-view-mode-toggle">
              <button
                className={`novel-view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
                title="列表模式 (精确对齐 so-novel 终端布局)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
                列表模式
              </button>
              <button
                className={`novel-view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="卡片视图"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
                卡片模式
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 下载任务栏 */}
      {taskList.length > 0 && (
        <div className="novel-task-bar">
          <div className="novel-task-bar-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            下载任务
          </div>
          <div className="novel-task-list">
            {taskList.map(([taskId, task]) => (
              <div key={taskId} className={`novel-task-item task-${task.status}`}>
                <div className="novel-task-info">
                  <span className="novel-task-title">《{task.novelTitle}》 <span style={{ fontSize: '11px', padding: '1px 5px', borderRadius: '4px', background: 'var(--bg-layer2)', color: 'var(--accent-light)', border: '1px solid var(--border)' }}>{task.format || 'EPUB'}</span></span>
                  <span className="novel-task-status" style={{ color: STATUS_COLOR[task.status] || '#9ca3af' }}>
                    {STATUS_LABEL[task.status] || task.status}
                  </span>
                </div>
                {(task.status === 'running' || task.status === 'packaging') && (
                  <div className="novel-task-progress-wrap">
                    <div className="novel-task-progress-bar">
                      <div
                        className="novel-task-progress-fill"
                        style={{ width: `${task.total ? Math.round(task.progress / task.total * 100) : 0}%` }}
                      />
                    </div>
                    <span className="novel-task-progress-text">
                      {task.status === 'packaging' ? '打包中...' : `${task.progress}/${task.total} 章`}
                    </span>
                  </div>
                )}
                <div className="novel-task-actions">
                  {(task.status === 'running' || task.status === 'packaging') && (
                    <button className="novel-task-cancel-btn" onClick={() => handleCancelTask(taskId)} title="取消">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 搜索结果区域 */}
      <div className="novel-results-area">
        {/* 仅在 0 条结果且正在搜索时显示全屏 loading */}
        {searching && results.length === 0 && (
          <div className="novel-loading-state">
            <div className="novel-loading-spinner" />
            <span>正在聚合全网书源搜索中...</span>
          </div>
        )}

        {/* 正在搜索且已有结果时，在顶部显示流式进度小提示 */}
        {searching && results.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px',
            background: 'var(--bg-layer2)', borderRadius: '8px', border: '1px solid var(--accent)',
            marginBottom: '12px', fontSize: '13px', color: 'var(--accent-light)'
          }}>
            <div className="novel-loading-spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
            <span>已找到 <strong>{results.length}</strong> 条结果，后台正在持续检索其余书源中...（您可以直接点击预览或下载）</span>
          </div>
        )}

        {!searching && searchError && results.length === 0 && (
          <div className="novel-empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
            <span style={{ fontSize: '42px', display: 'block', marginBottom: '12px' }}>📭</span>
            <p style={{ fontSize: '15px', color: 'var(--text-primary)', marginBottom: '8px' }}>{searchError}</p>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 16px auto' }}>
              提示：部分老旧小说网站可能存在临时维护或反爬限流。您可以尝试切换下拉框中的单个书源，或点击顶部【导入书源】/左侧【书源工坊】添加最新书源。
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                className="novel-import-source-btn"
                onClick={handleSearch}
                style={{ padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}
              >
                🔄 重新搜索
              </button>
              <button
                className="novel-import-source-btn"
                onClick={handleImportSource}
                style={{ padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}
              >
                📥 导入 JSON 书源
              </button>
            </div>
          </div>
        )}

        {!searching && results.length === 0 && !searchError && (
          <div className="novel-empty-state novel-welcome">
            <div className="novel-welcome-icon">📚</div>
            <h3>搜索你想看的小说</h3>
            {sources.length > 0 ? (
              <>
                <p>已载入 {sources.length} 个书源，支持书名、作者精准及模糊搜索</p>
                <div className="novel-source-tags">
                  {sources.slice(0, 15).map(s => (
                    <span key={s.id} className="novel-source-tag">{s.name}</span>
                  ))}
                  {sources.length > 15 && <span className="novel-source-tag">...等{sources.length}个</span>}
                </div>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--accent-light)', marginBottom: '12px' }}>
                  提示：本软件原始不内置任何默认书源，彻底保持纯净。
                </p>
                <button
                  className="novel-import-source-btn"
                  onClick={handleImportSource}
                  style={{ padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', margin: '0 auto' }}
                >
                  📥 导入您的 JSON 书源规则文件
                </button>
              </>
            )}
          </div>
        )}

        {results.length > 0 && (
          viewMode === 'table' ? (
            /* 表格列表模式 - 展示 序号 / 书名 / 作者 / 最新章节 / 最后更新时间 / 来源名称 / 操作(预览+下载) */
            <div className="novel-table-container">
              <table ref={tableRef} className="novel-results-table">
                <colgroup>
                  <col style={{ width: typeof colWidths.idx === 'number' ? `${colWidths.idx}px` : colWidths.idx }} />
                  <col style={{ width: typeof colWidths.title === 'number' ? `${colWidths.title}px` : colWidths.title }} />
                  <col style={{ width: typeof colWidths.author === 'number' ? `${colWidths.author}px` : colWidths.author }} />
                  <col style={{ width: typeof colWidths.latestChapter === 'number' ? `${colWidths.latestChapter}px` : colWidths.latestChapter }} />
                  <col style={{ width: typeof colWidths.lastUpdateTime === 'number' ? `${colWidths.lastUpdateTime}px` : colWidths.lastUpdateTime }} />
                  <col style={{ width: typeof colWidths.source === 'number' ? `${colWidths.source}px` : colWidths.source }} />
                  <col style={{ width: typeof colWidths.action === 'number' ? `${colWidths.action}px` : colWidths.action }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>
                      序号
                      <div
                        className={`column-resizer ${resizingCol === 'idx' ? 'resizing' : ''}`}
                        onMouseDown={e => handleResizeStart(e, 'idx')}
                        onPointerDown={e => handleResizeStart(e, 'idx')}
                        title="按住拖拽调整序号列宽度"
                      />
                    </th>
                    <th>
                      书名
                      <div
                        className={`column-resizer ${resizingCol === 'title' ? 'resizing' : ''}`}
                        onMouseDown={e => handleResizeStart(e, 'title')}
                        onPointerDown={e => handleResizeStart(e, 'title')}
                        title="按住拖拽调整书名列宽度"
                      />
                    </th>
                    <th>
                      作者
                      <div
                        className={`column-resizer ${resizingCol === 'author' ? 'resizing' : ''}`}
                        onMouseDown={e => handleResizeStart(e, 'author')}
                        onPointerDown={e => handleResizeStart(e, 'author')}
                        title="按住拖拽调整作者列宽度"
                      />
                    </th>
                    <th>
                      最新章节
                      <div
                        className={`column-resizer ${resizingCol === 'latestChapter' ? 'resizing' : ''}`}
                        onMouseDown={e => handleResizeStart(e, 'latestChapter')}
                        onPointerDown={e => handleResizeStart(e, 'latestChapter')}
                        title="按住拖拽调整最新章节列宽度"
                      />
                    </th>
                    <th>
                      最后更新时间
                      <div
                        className={`column-resizer ${resizingCol === 'lastUpdateTime' ? 'resizing' : ''}`}
                        onMouseDown={e => handleResizeStart(e, 'lastUpdateTime')}
                        onPointerDown={e => handleResizeStart(e, 'lastUpdateTime')}
                        title="按住拖拽调整更新时间列宽度"
                      />
                    </th>
                    <th>
                      来源书源
                      <div
                        className={`column-resizer ${resizingCol === 'source' ? 'resizing' : ''}`}
                        onMouseDown={e => handleResizeStart(e, 'source')}
                        onPointerDown={e => handleResizeStart(e, 'source')}
                        title="按住拖拽调整书源列宽度"
                      />
                    </th>
                    <th style={{ textAlign: 'center' }}>
                      直下与操作
                      <div
                        className={`column-resizer ${resizingCol === 'action' ? 'resizing' : ''}`}
                        onMouseDown={e => handleResizeStart(e, 'action')}
                        onPointerDown={e => handleResizeStart(e, 'action')}
                        title="按住拖拽调整操作列宽度"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((book, idx) => (
                    <tr key={`${book.source}_${idx}`} className="novel-table-row">
                      <td className="col-idx">{idx + 1}</td>
                      <td className="col-title" title={book.title}>
                        <span className="book-name-text">{book.title}</span>
                      </td>
                      <td className="col-author" title={book.author}>{book.author || '未知'}</td>
                      <td className="col-chapter" title={book.latestChapter || '—'}>
                        {book.latestChapter ? (
                          <span className="latest-chapter-tag">{book.latestChapter}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="col-time">{book.lastUpdateTime || '—'}</td>
                      <td className="col-source" title={`书源: ${getSourceName(book)}\n网址: ${book.url || '未知'}`}>
                        <div className="source-badge-box">
                          <span className="source-badge-title">{getSourceName(book)}</span>
                          {getDomain(book.url) && (
                            <span className="source-badge-domain">{getDomain(book.url)}</span>
                          )}
                        </div>
                      </td>
                      <td className="col-action" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '3px', justifyContent: 'center', alignItems: 'center', whiteSpace: 'nowrap', flexWrap: 'nowrap' }}>
                          <button
                            onClick={() => handleOpenPreview(book)}
                            style={{
                              padding: '3px 6px', borderRadius: '5px', border: '1px solid var(--border)',
                              background: 'var(--bg-layer2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '11px',
                              whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '2px'
                            }}
                            title="在线试读章节"
                          >
                            📖 预览
                          </button>
                          <button
                            onClick={() => handleQuickDownload(book, 'TXT')}
                            style={{
                              padding: '3px 6px', borderRadius: '5px', border: 'none',
                              background: '#0284c7', color: '#ffffff', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                              whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '2px'
                            }}
                            title="一键直接下载 TXT 全本纯文本"
                          >
                            📄 TXT
                          </button>
                          <button
                            onClick={() => handleQuickDownload(book, 'EPUB')}
                            style={{
                              padding: '3px 6px', borderRadius: '5px', border: 'none',
                              background: '#8b5cf6', color: '#ffffff', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                              whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '2px'
                            }}
                            title="一键直接下载 EPUB 电子书"
                          >
                            📚 EPUB
                          </button>
                          <button
                            onClick={() => handleQuickDownload(book, 'PDF')}
                            style={{
                              padding: '3px 6px', borderRadius: '5px', border: 'none',
                              background: '#ef4444', color: '#ffffff', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                              whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '2px'
                            }}
                            title="一键直接下载 PDF 精美高清电子书"
                          >
                            📕 PDF
                          </button>
                          <button
                            onClick={() => handleOpenDownloadModal(book)}
                            style={{
                              padding: '3px 6px', borderRadius: '5px', border: '1px solid var(--accent)',
                              background: 'var(--bg-layer1)', color: 'var(--accent-light)', cursor: 'pointer', fontSize: '11px',
                              whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '2px'
                            }}
                            title="打开选章下载与范围设置"
                          >
                            ⚙️ 选章
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* 卡片模式 */
            <div className="novel-results-grid">
              {results.map((book, idx) => (
                <NovelCard
                  key={`${book.source}_${idx}`}
                  book={book}
                  onPreview={() => handleOpenPreview(book)}
                  onDownload={() => handleOpenDownloadModal(book)}
                  onQuickDownload={(fmt) => handleQuickDownload(book, fmt)}
                />
              ))}
            </div>
          )
        )}
      </div>

      {/* 1. 章节下载选择弹窗 (原项目 3 种下载模式) */}
      {chapterModal && (
        <ChapterModal
          novelInfo={chapterModal.novelInfo}
          chapters={chapterModal.chapters}
          sourceId={chapterModal.sourceId}
          loading={chapterModal.loading}
          onClose={() => setChapterModal(null)}
          onDownload={handleStartDownload}
          onOpenPreview={(chIdx) => {
            setPreviewModal({
              novelInfo: chapterModal.novelInfo,
              chapters: chapterModal.chapters,
              currentIdx: chIdx,
              content: '',
              loading: true
            })
            window.api.novelGetContent(chapterModal.chapters[chIdx].url, chapterModal.sourceId).then(r => {
              setPreviewModal(prev => prev ? ({ ...prev, content: r.success ? r.content : '【获取正文失败】', loading: false }) : null)
            })
          }}
        />
      )}

      {/* 2. 在线试读预览弹窗 */}
      {previewModal && (
        <NovelPreviewModal
          novelInfo={previewModal.novelInfo}
          chapters={previewModal.chapters}
          currentIdx={previewModal.currentIdx}
          content={previewModal.content}
          loading={previewModal.loading}
          allResults={results}
          onSwitchBook={(altBook) => handleOpenPreview(altBook)}
          onClose={() => setPreviewModal(null)}
          onDownload={() => {
            const b = previewModal.novelInfo
            setPreviewModal(null)
            handleOpenDownloadModal(b)
          }}
          onChangeChapter={async (idx) => {
            const ch = previewModal.chapters[idx]
            if (!ch) return
            setPreviewModal(prev => ({ ...prev, currentIdx: idx, loading: true }))
            try {
              const res = await window.api.novelGetContent(ch.url, previewModal.novelInfo.source)
              setPreviewModal(prev => ({
                ...prev,
                currentIdx: idx,
                content: res.success ? res.content : '【获取正文失败，请尝试重新加载或点击上方换源】',
                loading: false
              }))
            } catch (e) {
              setPreviewModal(prev => ({
                ...prev,
                currentIdx: idx,
                content: '【获取章节正文出错: ' + e.message + '】',
                loading: false
              }))
            }
          }}
        />
      )}
    </div>
  )
}

// ─── 书籍卡片 ──────────────────────────────────────────
function NovelCard({ book, onPreview, onDownload, onQuickDownload }) {
  const [imgError, setImgError] = useState(false)
  const hasValidCover = book.cover && !imgError

  return (
    <div className="novel-card" id={`novel-card-${book.source}-${book.title.slice(0, 8).replace(/\s/g, '_')}`}>
      <div className="novel-card-cover" onClick={onPreview} style={{ cursor: 'pointer' }}>
        {hasValidCover ? (
          <img 
            src={book.cover} 
            alt={book.title} 
            loading="lazy" 
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="novel-card-cover-placeholder" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            background: 'linear-gradient(135deg, var(--bg-layer2) 0%, var(--bg-layer3) 100%)',
            color: 'var(--text-primary)',
            padding: '12px',
            boxSizing: 'border-box',
            textAlign: 'center'
          }}>
            <span style={{ fontSize: '36px', marginBottom: '8px' }}>📖</span>
            <div style={{ fontSize: '13px', fontWeight: '600', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {book.title}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {book.author || '未知作者'}
            </div>
          </div>
        )}
        <div className="novel-card-source-badge" title={book.url}>
          {getSourceName(book)}
        </div>
      </div>
      <div className="novel-card-info">
        <div className="novel-card-title" title={book.title} onClick={onPreview} style={{ cursor: 'pointer' }}>
          {book.title}
        </div>
        <div className="novel-card-author">{book.author}</div>
        {book.latestChapter && (
          <div className="novel-card-latest" title={book.latestChapter}>最新: {book.latestChapter}</div>
        )}
        {book.lastUpdateTime && (
          <div className="novel-card-time">更新: {book.lastUpdateTime}</div>
        )}
        <div className="novel-card-source-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="source-tag">{getSourceName(book)}</span>
            <span style={{ userSelect: 'none' }}>&nbsp;&nbsp;</span>
            <button
              onClick={onPreview}
              style={{
                padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)',
                background: 'var(--bg-layer2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '11px',
                whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '3px'
              }}
            >
              📖 在线预览
            </button>
          </div>
          {/* 一键格式直下按钮行 */}
          <div style={{ display: 'flex', gap: '3px', justifyContent: 'space-between' }}>
            <button
              onClick={() => onQuickDownload?.('TXT')}
              style={{
                flex: 1, padding: '4px 2px', borderRadius: '4px', border: 'none',
                background: '#0284c7', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '2px', whiteSpace: 'nowrap'
              }}
              title="一键直接下载 TXT 纯文本"
            >
              📄 TXT
            </button>
            <button
              onClick={() => onQuickDownload?.('EPUB')}
              style={{
                flex: 1, padding: '4px 2px', borderRadius: '4px', border: 'none',
                background: '#8b5cf6', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '2px', whiteSpace: 'nowrap'
              }}
              title="一键直接下载 EPUB 电子书"
            >
              📚 EPUB
            </button>
            <button
              onClick={() => onQuickDownload?.('PDF')}
              style={{
                flex: 1, padding: '4px 2px', borderRadius: '4px', border: 'none',
                background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '2px', whiteSpace: 'nowrap'
              }}
              title="一键直接下载 PDF 电子书"
            >
              📕 PDF
            </button>
            <button
              onClick={onDownload}
              style={{
                padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--accent)',
                background: 'var(--bg-layer1)', color: 'var(--accent-light)', cursor: 'pointer', fontSize: '11px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap'
              }}
              title="选章与高级设置"
            >
              ⚙️
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 章节选择与下载模式弹窗 (完全对齐原项目 3 种模式) ──────────
function ChapterModal({ novelInfo, chapters, sourceId, loading, onClose, onDownload, onOpenPreview }) {
  // 下载模式: 'all' (1: 下载全本) | 'range' (2: 指定范围章节) | 'latest' (3: 下载最新章节)
  const [downloadMode, setDownloadMode] = useState('all')
  // 导出格式: 'EPUB' (默认推荐) | 'TXT' | 'PDF'
  const [downloadFormat, setDownloadFormat] = useState('EPUB')
  // 下载并发线程数 (1 ~ 16)
  const [downloadConcurrency, setDownloadConcurrency] = useState(4)

  const [startChapter, setStartChapter] = useState(1)
  const [endChapter, setEndChapter] = useState(1)
  const [latestCount, setLatestCount] = useState(20)

  useEffect(() => {
    if (chapters.length > 0) {
      setEndChapter(chapters.length)
    }
    // 读取系统默认下载并发配置
    window.api?.novelGetDownloadConfig?.().then(cfg => {
      if (cfg && cfg.concurrency) {
        setDownloadConcurrency(cfg.concurrency)
      }
    })
  }, [chapters.length])

  // 计算要下载的具体章节列表
  let selectedChapters = []
  if (downloadMode === 'all') {
    selectedChapters = chapters.map((ch, idx) => ({ ...ch, originalIndex: idx }))
  } else if (downloadMode === 'range') {
    const s = Math.max(1, Math.min(chapters.length, startChapter)) - 1
    const e = Math.max(s + 1, Math.min(chapters.length, endChapter))
    selectedChapters = chapters.slice(s, e).map((ch, i) => ({ ...ch, originalIndex: s + i }))
  } else if (downloadMode === 'latest') {
    const count = Math.max(1, Math.min(chapters.length, latestCount))
    const startIdx = Math.max(0, chapters.length - count)
    selectedChapters = chapters.slice(startIdx).map((ch, i) => ({ ...ch, originalIndex: startIdx + i }))
  }

  const handleDownload = () => {
    if (selectedChapters.length === 0) return
    onDownload(novelInfo, selectedChapters, sourceId, downloadFormat, downloadConcurrency)
  }

  return (
    <div className="novel-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="novel-modal" style={{ maxWidth: '640px' }}>
        <div className="novel-modal-header">
          <div className="novel-modal-book-info">
            {novelInfo.cover ? (
              <img src={novelInfo.cover} alt="" className="novel-modal-cover" />
            ) : (
              <div className="novel-modal-cover-ph">{novelInfo.title?.slice(0, 2)}</div>
            )}
            <div>
              <div className="novel-modal-title">{novelInfo.title}</div>
              <div className="novel-modal-author">作者：{novelInfo.author || '未知'}</div>
              <div className="novel-modal-source-info">
                <span>来源书源：<strong>{getSourceName(novelInfo)}</strong></span>
                {getDomain(novelInfo.url) && <span> ({getDomain(novelInfo.url)})</span>}
              </div>
              {novelInfo.description && (
                <div className="novel-modal-desc">{novelInfo.description.slice(0, 120)}...</div>
              )}
            </div>
          </div>
          <button className="novel-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="novel-modal-body">
          {loading ? (
            <div className="novel-modal-loading">
              <div className="novel-loading-spinner" />
              <span>正在解析章节目录...</span>
            </div>
          ) : chapters.length === 0 ? (
            <div className="novel-modal-loading">
              <span>未获取到章节，请尝试切换其他书源</span>
            </div>
          ) : (
            <>
              {/* 原项目 3 种下载模式选择器 */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  📥 1. 选择下载范围 (共 {chapters.length} 章)：
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  <button
                    onClick={() => setDownloadMode('all')}
                    style={{
                      padding: '9px 8px', borderRadius: '8px', border: `1px solid ${downloadMode === 'all' ? 'var(--accent)' : 'var(--border)'}`,
                      background: downloadMode === 'all' ? 'var(--accent)' : 'var(--bg-layer2)',
                      color: downloadMode === 'all' ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer', fontSize: '13px', fontWeight: downloadMode === 'all' ? 600 : 400,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    🌟 下载全本
                    <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>全量 {chapters.length} 章</div>
                  </button>

                  <button
                    onClick={() => setDownloadMode('range')}
                    style={{
                      padding: '9px 8px', borderRadius: '8px', border: `1px solid ${downloadMode === 'range' ? 'var(--accent)' : 'var(--border)'}`,
                      background: downloadMode === 'range' ? 'var(--accent)' : 'var(--bg-layer2)',
                      color: downloadMode === 'range' ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer', fontSize: '13px', fontWeight: downloadMode === 'range' ? 600 : 400,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    🎯 指定范围章节
                    <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>自定义起始~结束</div>
                  </button>

                  <button
                    onClick={() => setDownloadMode('latest')}
                    style={{
                      padding: '9px 8px', borderRadius: '8px', border: `1px solid ${downloadMode === 'latest' ? 'var(--accent)' : 'var(--border)'}`,
                      background: downloadMode === 'latest' ? 'var(--accent)' : 'var(--bg-layer2)',
                      color: downloadMode === 'latest' ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer', fontSize: '13px', fontWeight: downloadMode === 'latest' ? 600 : 400,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    ⚡ 下载最新章节
                    <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>更新追更推荐</div>
                  </button>
                </div>
              </div>

              {/* 模式 2 详情：指定范围输入框 */}
              {downloadMode === 'range' && (
                <div style={{
                  background: 'var(--bg-layer2)', padding: '10px 14px', borderRadius: '8px',
                  border: '1px solid var(--border)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px'
                }}>
                  <span>从第</span>
                  <input
                    type="number"
                    min={1}
                    max={chapters.length}
                    value={startChapter}
                    onChange={e => setStartChapter(Math.max(1, Math.min(chapters.length, parseInt(e.target.value) || 1)))}
                    style={{ width: '65px', padding: '5px 6px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', textAlign: 'center' }}
                  />
                  <span>章 到 第</span>
                  <input
                    type="number"
                    min={startChapter}
                    max={chapters.length}
                    value={endChapter}
                    onChange={e => setEndChapter(Math.max(startChapter, Math.min(chapters.length, parseInt(e.target.value) || chapters.length)))}
                    style={{ width: '65px', padding: '5px 6px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', textAlign: 'center' }}
                  />
                  <span>章（已选 <strong>{selectedChapters.length}</strong> 章）</span>
                </div>
              )}

              {/* 模式 3 详情：下载最新章节 */}
              {downloadMode === 'latest' && (
                <div style={{
                  background: 'var(--bg-layer2)', padding: '10px 14px', borderRadius: '8px',
                  border: '1px solid var(--border)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px'
                }}>
                  <span>下载最新的</span>
                  <input
                    type="number"
                    min={1}
                    max={chapters.length}
                    value={latestCount}
                    onChange={e => setLatestCount(Math.max(1, Math.min(chapters.length, parseInt(e.target.value) || 20)))}
                    style={{ width: '65px', padding: '5px 6px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', textAlign: 'center' }}
                  />
                  <span>章</span>

                  {/* 快捷按钮 */}
                  <div style={{ display: 'flex', gap: '5px', marginLeft: 'auto' }}>
                    {[10, 20, 50, 100].map(cnt => (
                      <button
                        key={cnt}
                        onClick={() => setLatestCount(cnt)}
                        style={{
                          padding: '3px 7px', borderRadius: '4px', border: '1px solid var(--border)',
                          background: latestCount === cnt ? 'var(--accent)' : 'var(--bg-base)',
                          color: latestCount === cnt ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px'
                        }}
                      >
                        最新{cnt}章
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 导出格式选择器 */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>📑 2. 选择导出格式：</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>当前格式：<strong>{downloadFormat}</strong></span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  {/* TXT 选项 */}
                  <button
                    type="button"
                    onClick={() => setDownloadFormat('TXT')}
                    style={{
                      padding: '8px 6px', borderRadius: '8px',
                      border: `1.5px solid ${downloadFormat === 'TXT' ? '#0284c7' : 'var(--border)'}`,
                      background: downloadFormat === 'TXT' ? 'rgba(2, 132, 199, 0.12)' : 'var(--bg-layer2)',
                      color: downloadFormat === 'TXT' ? '#38bdf8' : 'var(--text-primary)',
                      cursor: 'pointer', textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: downloadFormat === 'TXT' ? 700 : 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      📄 TXT
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.75 }}>纯文本 · 极速轻量</span>
                  </button>

                  {/* EPUB 选项 */}
                  <button
                    type="button"
                    onClick={() => setDownloadFormat('EPUB')}
                    style={{
                      padding: '8px 6px', borderRadius: '8px',
                      border: `1.5px solid ${downloadFormat === 'EPUB' ? '#8b5cf6' : 'var(--border)'}`,
                      background: downloadFormat === 'EPUB' ? 'rgba(139, 92, 246, 0.15)' : 'var(--bg-layer2)',
                      color: downloadFormat === 'EPUB' ? '#c084fc' : 'var(--text-primary)',
                      cursor: 'pointer', textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: downloadFormat === 'EPUB' ? 700 : 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      📚 EPUB <span style={{ fontSize: '10px', padding: '1px 4px', borderRadius: '3px', background: '#8b5cf6', color: '#fff', fontWeight: 600 }}>推荐</span>
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.75 }}>标准电子书 · 含完整排版</span>
                  </button>

                  {/* PDF 选项 */}
                  <button
                    type="button"
                    onClick={() => setDownloadFormat('PDF')}
                    style={{
                      padding: '8px 6px', borderRadius: '8px',
                      border: `1.5px solid ${downloadFormat === 'PDF' ? '#ef4444' : 'var(--border)'}`,
                      background: downloadFormat === 'PDF' ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-layer2)',
                      color: downloadFormat === 'PDF' ? '#f87171' : 'var(--text-primary)',
                      cursor: 'pointer', textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: downloadFormat === 'PDF' ? 700 : 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      📕 PDF
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.75 }}>精美排版 · 便于离线阅读</span>
                  </button>
                </div>
              </div>

              {/* ⚡ 3. 下载并发线程数调节 */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>⚡ 3. 并发下载线程数：</span>
                  <span style={{ fontSize: '12px', color: 'var(--accent-light)', fontFamily: 'monospace', fontWeight: 600 }}>
                    {downloadConcurrency} 线程
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg-layer2)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <input
                    type="range"
                    min="1"
                    max="16"
                    value={downloadConcurrency}
                    onChange={e => setDownloadConcurrency(parseInt(e.target.value) || 4)}
                    style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[
                      { count: 2, label: '防封 2' },
                      { count: 4, label: '推荐 4' },
                      { count: 8, label: '极速 8' },
                      { count: 16, label: '狂飙 16' }
                    ].map(item => (
                      <button
                        key={item.count}
                        type="button"
                        onClick={() => setDownloadConcurrency(item.count)}
                        style={{
                          padding: '2px 7px', borderRadius: '4px',
                          border: `1px solid ${downloadConcurrency === item.count ? 'var(--accent)' : 'var(--border)'}`,
                          background: downloadConcurrency === item.count ? 'var(--accent)' : 'var(--bg-base)',
                          color: downloadConcurrency === item.count ? '#fff' : 'var(--text-secondary)',
                          cursor: 'pointer', fontSize: '11px', fontWeight: downloadConcurrency === item.count ? 600 : 400
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  💡 提示：建议设为 3~6 线程。线程数过高可能触发部分源站防爬限流。
                </div>
              </div>

              {/* 章节目录展示与直接预览入口 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>目录预览（点击任意章节可立即在线试读）：</span>
              </div>
              <div className="novel-chapter-preview" style={{ maxHeight: '160px' }}>
                {selectedChapters.slice(0, 10).map((ch, i) => (
                  <div
                    key={i}
                    className="novel-chapter-item"
                    onClick={() => onOpenPreview?.(chapters.indexOf(ch))}
                    style={{ cursor: 'pointer' }}
                    title="点击在线试读此章节"
                  >
                    <span className="novel-chapter-num">{chapters.indexOf(ch) + 1}</span>
                    <span className="novel-chapter-name" style={{ color: 'var(--accent-light)' }}>{ch.title}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>📖 试读</span>
                  </div>
                ))}
                {selectedChapters.length > 10 && (
                  <div className="novel-chapter-more">...已选 {selectedChapters.length} 章节</div>
                )}
              </div>
            </>
          )}
        </div>

        {!loading && chapters.length > 0 && (
          <div className="novel-modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <span className="novel-modal-tip" style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                下载完成后自动加入书库并生成 <strong>{downloadFormat}</strong> 文件 ({downloadConcurrency} 线程)
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                当前已选：<strong style={{ color: 'var(--accent-light)' }}>{selectedChapters.length}</strong> 章
              </span>
            </div>
            <div className="novel-modal-btns" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
              <button className="novel-modal-cancel-btn" onClick={onClose}>取消</button>
              <button
                onClick={handleDownload}
                disabled={selectedChapters.length === 0}
                style={{
                  padding: '8px 18px', borderRadius: '8px', border: 'none',
                  background: downloadFormat === 'EPUB'
                    ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)'
                    : downloadFormat === 'PDF'
                      ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                      : 'linear-gradient(135deg, #0284c7, #0369a1)',
                  color: '#fff', cursor: selectedChapters.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: '13px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)', transition: 'all 0.2s ease',
                  opacity: selectedChapters.length === 0 ? 0.6 : 1
                }}
                title={`按当前选择下载 ${selectedChapters.length} 章为 ${downloadFormat} 格式 (${downloadConcurrency} 线程)`}
              >
                <span>{downloadFormat === 'EPUB' ? '📚' : downloadFormat === 'PDF' ? '📕' : '📄'}</span>
                <span>立即下载 {downloadFormat} ({selectedChapters.length}章 · {downloadConcurrency}线程)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 沉浸式在线章节阅读预览浮层 ────────────────────────────
function NovelPreviewModal({ novelInfo, chapters = [], currentIdx = 0, content = '', loading = false, onClose, onDownload, onChangeChapter, allResults = [], onSwitchBook }) {
  const currentChapter = (chapters && chapters[currentIdx]) || { title: '第一章' }
  const [fontSize, setFontSize] = useState(16)

  return (
    <div className="novel-modal-overlay" style={{ zIndex: 1100, background: 'rgba(0, 0, 0, 0.85)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="novel-modal" style={{ width: '760px', maxWidth: '92vw', height: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-layer1, #181825)', color: 'var(--text-primary, #e2e8f0)', boxShadow: '0 25px 65px rgba(0, 0, 0, 0.85)' }}>
        {/* 顶部控制栏 */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-layer2)'
        }}>
          <div>
            <span style={{ fontSize: '12px', color: 'var(--accent-light)', fontWeight: 600, display: 'block' }}>
              📖 在线试读预览 · {getSourceName(novelInfo)}
            </span>
            <h3 style={{ margin: '2px 0 0 0', fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
              《{novelInfo.title}》 - {currentChapter.title}
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* 字号调节 */}
            <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-base)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border)' }}>
              <button
                onClick={() => setFontSize(s => Math.max(12, s - 2))}
                style={{ padding: '2px 8px', border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '12px' }}
                title="缩小字号"
              >
                A-
              </button>
              <button
                onClick={() => setFontSize(s => Math.min(26, s + 2))}
                style={{ padding: '2px 8px', border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '12px' }}
                title="放大字号"
              >
                A+
              </button>
            </div>

            <button
              onClick={onDownload}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: 'none',
                background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600
              }}
            >
              ⬇️ 下载全本/范围
            </button>

            <button className="novel-modal-close" onClick={onClose} style={{ marginLeft: '4px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* 正文阅读区 */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '30px 40px', background: 'var(--bg-layer1)',
          fontSize: `${fontSize}px`, lineHeight: '2', color: 'var(--text-primary)', userSelect: 'text'
        }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              <div className="novel-loading-spinner" style={{ marginBottom: '12px' }} />
              <span>正在向书源节点抓取章节正文...</span>
            </div>
          ) : !content || content.trim().length === 0 || (content.startsWith('【') && (content.includes('失败') || content.includes('为空') || content.includes('超时') || content.includes('出错') || content.includes('拦截'))) ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '50px 20px', textAlign: 'center'
            }}>
              <span style={{ fontSize: '42px', marginBottom: '16px' }}>📡</span>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '17px', color: 'var(--text-primary)' }}>
                当前书源（{getSourceName(novelInfo)}）暂未响应正文
              </h4>
              <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-muted)', maxWidth: '460px', lineHeight: '1.6' }}>
                该书源目标站点当前可能正在维护或反爬限流。您可以点击重试，或直接点击下方已搜出的<strong>其他同名书源版本</strong>无缝秒换源试读：
              </p>

              {/* 同名其他书源一键切换列表（不限数量，优先展示搜索成功的书源） */}
              {(() => {
                const cleanStr = (t) => (t || '').replace(/[《》【】\s_]/g, '').trim()
                const curClean = cleanStr(novelInfo.originalSearchTitle || novelInfo.title)
                const candidates = allResults ? allResults.filter(b => {
                  if (b.source === novelInfo.source) return false
                  const bClean = cleanStr(b.title)
                  return bClean.includes(curClean) || curClean.includes(bClean)
                }) : []
                // 去重（同源只保留第一个）并按书源名排序
                const seen = new Set()
                const deduped = candidates.filter(b => {
                  if (seen.has(b.source)) return false
                  seen.add(b.source)
                  return true
                })
                return deduped
              })().length > 0 && (
                <div style={{
                  background: 'var(--bg-layer2)', padding: '12px 16px', borderRadius: '10px',
                  border: '1px solid var(--border)', marginBottom: '20px', maxWidth: '520px', width: '100%'
                }}>
                  <div style={{ fontSize: '12px', color: 'var(--accent-light)', fontWeight: 600, marginBottom: '8px', textAlign: 'left' }}>
                    🔀 推荐一键换源试读：
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-start' }}>
                    {(() => {
                      const cleanStr = (t) => (t || '').replace(/[《》【】\s_]/g, '').trim()
                      const curClean = cleanStr(novelInfo.originalSearchTitle || novelInfo.title)
                      const candidates = allResults ? allResults.filter(b => {
                        if (b.source === novelInfo.source) return false
                        const bClean = cleanStr(b.title)
                        return bClean.includes(curClean) || curClean.includes(bClean)
                      }) : []
                      const seen = new Set()
                      return candidates.filter(b => {
                        if (seen.has(b.source)) return false
                        seen.add(b.source)
                        return true
                      })
                    })()
                      .map((altBook, idx) => (
                        <button
                          key={idx}
                          onClick={() => onSwitchBook?.(altBook)}
                          style={{
                            padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--accent)',
                            background: 'var(--bg-base)', color: 'var(--accent-light)', cursor: 'pointer', fontSize: '12px',
                            display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 500
                          }}
                          title={`切换至 ${getSourceName(altBook)} 试读`}
                        >
                          ⚡ 切换至【{getSourceName(altBook)}】
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => onChangeChapter(currentIdx)}
                  style={{
                    padding: '8px 18px', borderRadius: '8px', border: '1px solid var(--border)',
                    background: 'var(--bg-layer2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'
                  }}
                >
                  🔄 重新加载本章
                </button>
                <button
                  onClick={onDownload}
                  style={{
                    padding: '8px 18px', borderRadius: '8px', border: 'none',
                    background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600
                  }}
                >
                  ⬇️ 下载全本或指定范围
                </button>
              </div>
            </div>
          ) : (
            <div>
              <h2 style={{ fontSize: `${fontSize + 6}px`, fontWeight: 600, borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '24px' }}>
                {currentChapter.title}
              </h2>
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {content}
              </div>
            </div>
          )}
        </div>

        {/* 底部翻页控制 */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-layer2)'
        }}>
          <button
            disabled={currentIdx <= 0 || loading}
            onClick={() => onChangeChapter(currentIdx - 1)}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border)',
              background: 'var(--bg-base)', color: currentIdx <= 0 ? 'var(--text-muted)' : 'var(--text-primary)',
              cursor: currentIdx <= 0 ? 'not-allowed' : 'pointer', fontSize: '13px'
            }}
          >
            ⬅️ 上一章
          </button>

          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            第 {currentIdx + 1} / {chapters.length} 章
          </span>

          <button
            disabled={currentIdx >= chapters.length - 1 || loading}
            onClick={() => onChangeChapter(currentIdx + 1)}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border)',
              background: 'var(--bg-base)', color: currentIdx >= chapters.length - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
              cursor: currentIdx >= chapters.length - 1 ? 'not-allowed' : 'pointer', fontSize: '13px'
            }}
          >
            下一章 ➡️
          </button>
        </div>
      </div>
    </div>
  )
}
