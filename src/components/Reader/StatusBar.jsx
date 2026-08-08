import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'

function formatDateTime(date) {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}`
}

export function StatusBar({ chapterName, currentPage, totalPages, percentage, onPageChange, isReady = true }) {
  const { settings } = useStore()
  const [now, setNow] = useState(new Date())
  const [inputPage, setInputPage] = useState(String(currentPage))
  const isWordTheme = settings?.theme === 'word'

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000) // update every 30s
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setInputPage(String(currentPage))
  }, [currentPage])

  const pct = typeof percentage === 'number' ? percentage : (totalPages > 0 ? currentPage / totalPages : 0)
  const pctText = `${(pct * 100).toFixed(1)}%`

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const page = parseInt(inputPage)
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        onPageChange?.(page)
      } else {
        setInputPage(String(currentPage))
      }
      e.target.blur()
    }
  }

  const handleBlur = () => {
    const page = parseInt(inputPage)
    if (isNaN(page) || page < 1 || page > totalPages) {
      setInputPage(String(currentPage))
    }
  }

  const navBtnStyle = (disabled) => ({
    background: 'none',
    border: 'none',
    color: disabled ? (isWordTheme ? 'rgba(255,255,255,0.4)' : 'var(--text-muted)') : (isWordTheme ? '#ffffff' : 'var(--text-primary)'),
    opacity: disabled ? 0.3 : 0.85,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '12px',
    padding: '2px 6px',
    transition: 'all 0.2s',
    outline: 'none',
    pointerEvents: disabled ? 'none' : 'auto',
    borderRadius: '3px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  })

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '4px 20px',
      background: isWordTheme ? '#185abd' : 'rgba(128,128,128,0.08)',
      backdropFilter: isWordTheme ? 'none' : 'blur(12px)',
      WebkitBackdropFilter: isWordTheme ? 'none' : 'blur(12px)',
      borderTop: isWordTheme ? '1px solid #144a9c' : '1px solid rgba(128,128,128,0.1)',
      color: isWordTheme ? '#ffffff' : 'var(--text-muted)',
      fontSize: '12px',
      fontFamily: isWordTheme ? '"Segoe UI", "Microsoft YaHei", sans-serif' : 'inherit',
      userSelect: 'none',
      zIndex: 10,
      whiteSpace: 'nowrap',
      boxShadow: isWordTheme ? '0 -2px 6px rgba(0,0,0,0.08)' : 'none'
    }}>
      {/* Left: date & time / Word indicators */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {isWordTheme ? (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', opacity: 0.95 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              文档 (编辑中)
            </span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span style={{ fontSize: '11px', opacity: 0.95 }}>中文 (中国)</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span style={{ fontSize: '11px', opacity: 0.95 }}>拼写检查: 无误</span>
          </>
        ) : (
          <span style={{ minWidth: '120px' }}>
            {formatDateTime(now)}
          </span>
        )}
      </div>

      {/* Center: chapter + page info */}
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>章节：{chapterName}</span>
        <span style={{ margin: '0 8px', opacity: 0.4 }}>|</span>
        
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <button 
            onClick={() => onPageChange?.('home')}
            disabled={isReady && currentPage <= 1}
            style={navBtnStyle(isReady && currentPage <= 1)}
            onMouseEnter={e => { if(!isReady || currentPage > 1) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(128,128,128,0.1)' } }}
            onMouseLeave={e => { if(!isReady || currentPage > 1) { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'none' } }}
          >
            首页
          </button>
          
          <span style={{ opacity: 0.4 }}>|</span>
          
          <button 
            onClick={() => onPageChange?.('prev')}
            disabled={isReady && currentPage <= 1}
            style={navBtnStyle(isReady && currentPage <= 1)}
            onMouseEnter={e => { if(!isReady || currentPage > 1) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(128,128,128,0.1)' } }}
            onMouseLeave={e => { if(!isReady || currentPage > 1) { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'none' } }}
          >
            &lt;
          </button>
          
          {isReady ? (
            <span style={{ margin: '0 8px', display: 'inline-flex', alignItems: 'center', color: isWordTheme ? '#ffffff' : 'var(--text-primary)' }}>
              第
              <input
                type="text"
                value={inputPage}
                onChange={(e) => setInputPage(e.target.value.replace(/\D/g, ''))}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                onFocus={e => { 
                  e.target.select()
                  e.currentTarget.style.borderBottom = isWordTheme ? '1px solid #ffffff' : '1px solid var(--accent, #6d28d9)'
                  e.currentTarget.style.background = isWordTheme ? 'rgba(255,255,255,0.25)' : 'rgba(128,128,128,0.15)'
                }}
                style={{
                  width: '40px',
                  textAlign: 'center',
                  background: isWordTheme ? 'rgba(255,255,255,0.15)' : 'rgba(128,128,128,0.06)',
                  border: 'none',
                  borderBottom: isWordTheme ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(128,128,128,0.3)',
                  borderRadius: '3px',
                  color: isWordTheme ? '#ffffff' : 'var(--text-primary)',
                  fontSize: '12px',
                  margin: '0 4px',
                  padding: '2px 0',
                  outline: 'none',
                  transition: 'all 0.2s',
                  fontWeight: 'bold'
                }}
              />
              页/共{totalPages}页
            </span>
          ) : (
            <span style={{ margin: '0 12px', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
              页码测算中...
            </span>
          )}
          
          <button 
            onClick={() => onPageChange?.('next')}
            disabled={isReady && currentPage >= totalPages}
            style={navBtnStyle(isReady && currentPage >= totalPages)}
            onMouseEnter={e => { if(!isReady || currentPage < totalPages) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(128,128,128,0.1)' } }}
            onMouseLeave={e => { if(!isReady || currentPage < totalPages) { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'none' } }}
          >
            &gt;
          </button>
          
          <span style={{ opacity: 0.4 }}>|</span>
          
          <button 
            onClick={() => onPageChange?.('end')}
            disabled={!isReady || (isReady && currentPage >= totalPages)}
            style={navBtnStyle(!isReady || (isReady && currentPage >= totalPages))}
            onMouseEnter={e => { if(isReady && currentPage < totalPages) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(128,128,128,0.1)' } }}
            onMouseLeave={e => { if(isReady && currentPage < totalPages) { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'none' } }}
          >
            末页
          </button>
        </span>
      </span>

      {/* Right: page fraction + percentage */}
      <span style={{ minWidth: '120px', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0 }}>
        {isReady && <span>{currentPage}/{totalPages}</span>}
        {isReady && <span style={{ margin: '0 10px', opacity: 0.4 }}>|</span>}
        <span>{pctText}</span>
      </span>
    </div>
  )
}
