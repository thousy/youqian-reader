import React, { useState, useEffect } from 'react'

function formatDateTime(date) {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}`
}

export function StatusBar({ chapterName, currentPage, totalPages, percentage, onPageChange, isReady = true }) {
  const [now, setNow] = useState(new Date())
  const [inputPage, setInputPage] = useState(String(currentPage))

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
    color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
    opacity: disabled ? 0.3 : 0.8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '12px',
    padding: '2px 6px',
    transition: 'all 0.2s',
    outline: 'none',
    pointerEvents: disabled ? 'none' : 'auto',
    borderRadius: '4px',
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
      padding: '6px 24px',
      background: 'rgba(128,128,128,0.08)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderTop: '1px solid rgba(128,128,128,0.1)',
      color: 'var(--text-muted)',
      fontSize: '12px',
      userSelect: 'none',
      zIndex: 10,
      whiteSpace: 'nowrap'
    }}>
      {/* Left: date & time */}
      <span style={{ minWidth: '120px' }}>
        {formatDateTime(now)}
      </span>

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
            <span style={{ margin: '0 8px', display: 'inline-flex', alignItems: 'center', color: 'var(--text-primary)' }}>
              第
              <input
                type="text"
                value={inputPage}
                onChange={(e) => setInputPage(e.target.value.replace(/\D/g, ''))}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                onFocus={e => { 
                  e.target.select()
                  e.currentTarget.style.borderBottom = '1px solid var(--accent, #6d28d9)'
                  e.currentTarget.style.background = 'rgba(128,128,128,0.15)'
                }}
                style={{
                  width: '40px',
                  textAlign: 'center',
                  background: 'rgba(128,128,128,0.06)',
                  border: 'none',
                  borderBottom: '1px solid rgba(128,128,128,0.3)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
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
