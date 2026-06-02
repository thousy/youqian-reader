import React, { useState, useEffect } from 'react'

function formatDateTime(date) {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}`
}

export function StatusBar({ chapterName, currentPage, totalPages, percentage }) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000) // update every 30s
    return () => clearInterval(timer)
  }, [])

  const pct = typeof percentage === 'number' ? percentage : (totalPages > 0 ? currentPage / totalPages : 0)
  const pctText = `${(pct * 100).toFixed(1)}%`

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
      pointerEvents: 'none',
      zIndex: 10,
      whiteSpace: 'nowrap'
    }}>
      {/* Left: date & time */}
      <span style={{ minWidth: '120px' }}>
        {formatDateTime(now)}
      </span>

      {/* Center: chapter + page info */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <span>章节：{chapterName}</span>
        <span style={{ margin: '0 16px', opacity: 0.4 }}>|</span>
        <span>第{currentPage}/{totalPages}页</span>
      </span>

      {/* Right: page fraction + percentage */}
      <span style={{ minWidth: '120px', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0 }}>
        <span>{currentPage}/{totalPages}</span>
        <span style={{ margin: '0 10px', opacity: 0.4 }}>|</span>
        <span>{pctText}</span>
      </span>
    </div>
  )
}
