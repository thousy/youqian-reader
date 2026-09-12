import React, { useState, useEffect, useRef } from 'react'

export function InBookSearchModal({ isOpen, onClose, onSearch, onJumpTo, isSearching }) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [showResultList, setShowResultList] = useState(false)
  const inputRef = useRef(null)
  const searchTimeoutRef = useRef(null)
  const searchRequestIdRef = useRef(0)

  // 自动聚焦
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    } else {
      searchRequestIdRef.current++
      setKeyword('')
      setResults([])
      setCurrentIndex(-1)
      setShowResultList(false)
    }
  }, [isOpen])

  // 执行搜索防抖
  const handleKeywordChange = (e) => {
    const val = e.target.value
    setKeyword(val)

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    const trimmed = val.trim()
    if (!trimmed) {
      searchRequestIdRef.current++
      setResults([])
      setCurrentIndex(-1)
      return
    }

    const currentReqId = ++searchRequestIdRef.current
    searchTimeoutRef.current = setTimeout(async () => {
      if (!onSearch) return
      const res = await onSearch(trimmed)
      // 若当前返回的请求不是最新发起的查询，直接丢弃
      if (currentReqId !== searchRequestIdRef.current) return

      setResults(res || [])
      if (res && res.length > 0) {
        setCurrentIndex(0)
        onJumpTo?.(res[0])
      } else {
        setCurrentIndex(-1)
      }
    }, 350)
  }

  // 下一个
  const handleNext = () => {
    if (results.length === 0) return
    const nextIdx = (currentIndex + 1) % results.length
    setCurrentIndex(nextIdx)
    onJumpTo?.(results[nextIdx])
  }

  // 上一个
  const handlePrev = () => {
    if (results.length === 0) return
    const prevIdx = (currentIndex - 1 + results.length) % results.length
    setCurrentIndex(prevIdx)
    onJumpTo?.(results[prevIdx])
  }

  // 点击指定结果
  const handleSelectResult = (item, idx) => {
    setCurrentIndex(idx)
    onJumpTo?.(item)
  }

  // 键盘快捷键监听
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose?.()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        handlePrev()
      } else {
        handleNext()
      }
    }
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: '12px',
        right: '24px',
        width: '380px',
        backgroundColor: 'var(--bg-layer2)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.25)',
        zIndex: 1000,
        overflow: 'hidden',
        fontSize: '13px',
        color: 'var(--text-primary)',
        backdropFilter: 'blur(12px)'
      }}
      onKeyDown={handleKeyDown}
    >
      {/* 顶部搜索操作栏 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', gap: '6px' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={keyword}
          onChange={handleKeywordChange}
          placeholder="在全书中搜索关键字 (Enter跳转)..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: '13px',
            minWidth: 0
          }}
        />

        {/* 数量指示器 */}
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', userSelect: 'none' }}>
          {isSearching ? (
            '正在检索...'
          ) : results.length > 0 ? (
            `${currentIndex + 1} / ${results.length}`
          ) : keyword.trim() ? (
            '无匹配'
          ) : ''}
        </span>

        {/* 上一个 */}
        <button
          onClick={handlePrev}
          disabled={results.length === 0}
          title="上一个 (Shift+Enter)"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: results.length > 0 ? 'pointer' : 'default',
            opacity: results.length > 0 ? 1 : 0.35,
            color: 'var(--text-primary)',
            padding: '3px 4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>

        {/* 下一个 */}
        <button
          onClick={handleNext}
          disabled={results.length === 0}
          title="下一个 (Enter)"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: results.length > 0 ? 'pointer' : 'default',
            opacity: results.length > 0 ? 1 : 0.35,
            color: 'var(--text-primary)',
            padding: '3px 4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {/* 展开/折叠结果列表 */}
        {results.length > 0 && (
          <button
            onClick={() => setShowResultList(!showResultList)}
            title={showResultList ? '收起匹配列表' : '展开匹配列表'}
            style={{
              background: showResultList ? 'var(--accent)' : 'var(--bg-hover)',
              border: 'none',
              cursor: 'pointer',
              color: showResultList ? '#ffffff' : 'var(--text-secondary)',
              padding: '3px 6px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              fontSize: '11px',
              fontWeight: 500,
              transition: 'var(--transition)'
            }}
          >
            {results.length} 项
          </button>
        )}

        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          title="关闭 (Esc)"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: '3px 4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            transition: 'var(--transition)'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* 展开的匹配项详细列表 */}
      {showResultList && results.length > 0 && (
        <div
          style={{
            maxHeight: '320px',
            overflowY: 'auto',
            borderTop: '1px solid var(--border)',
            backgroundColor: 'var(--bg-layer1)'
          }}
        >
          {results.map((item, idx) => {
            const isSelected = idx === currentIndex
            return (
              <div
                key={idx}
                onClick={() => handleSelectResult(item, idx)}
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'var(--accent-glow)' : 'transparent',
                  borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                  transition: 'background-color 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                {/* 章节标题 */}
                <div style={{ fontSize: '11px', fontWeight: 600, color: isSelected ? 'var(--accent)' : 'var(--text-secondary)', marginBottom: '2px' }}>
                  {item.chapterTitle || `匹配项 #${idx + 1}`}
                </div>
                {/* 上下文文本高亮显示 */}
                <div style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  {renderHighlightedExcerpt(item.excerpt, keyword)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function renderHighlightedExcerpt(excerpt = '', keyword = '') {
  if (!excerpt || !keyword) return excerpt
  const parts = excerpt.split(new RegExp(`(${escapeRegExp(keyword)})`, 'gi'))
  return parts.map((part, index) => {
    if (part.toLowerCase() === keyword.toLowerCase()) {
      return (
        <mark
          key={index}
          style={{
            backgroundColor: 'rgba(255, 224, 102, 0.45)',
            color: 'inherit',
            borderRadius: '2px',
            padding: '0 2px',
            fontWeight: 600
          }}
        >
          {part}
        </mark>
      )
    }
    return part
  })
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
