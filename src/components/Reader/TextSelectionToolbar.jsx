import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'

const HIGHLIGHT_COLORS = [
  { name: '阳光黄', color: '#ffe066', textBg: 'rgba(255, 224, 102, 0.4)' },
  { name: '薄荷绿', color: '#8ce99a', textBg: 'rgba(140, 233, 154, 0.4)' },
  { name: '樱花粉', color: '#ffa8a8', textBg: 'rgba(255, 168, 168, 0.4)' },
  { name: '天空蓝', color: '#74c0fc', textBg: 'rgba(116, 192, 252, 0.4)' },
  { name: '经典紫', color: '#d0bfff', textBg: 'rgba(208, 191, 255, 0.4)' }
]

export function TextSelectionToolbar({ position, selectedText, onHighlight, onSaveNote, onCopy, onAddBookmark, onClose, existingAnnotation, onDeleteAnnotation }) {
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [noteText, setNoteText] = useState(existingAnnotation?.note || '')
  const [coords, setCoords] = useState(null)
  const noteInputRef = useRef(null)
  const toolbarRef = useRef(null)

  useEffect(() => {
    if (isAddingNote) {
      setTimeout(() => {
        noteInputRef.current?.focus()
      }, 50)
    }
  }, [isAddingNote])

  // 精准整数像素测量定位：彻底避免 CSS translate(-50%, -100%) 产生的 0.5px 亚像素插值文字重影/发虚
  useLayoutEffect(() => {
    if (!toolbarRef.current || !position) return
    const rect = toolbarRef.current.getBoundingClientRect()
    const targetX = Math.round(position.x - rect.width / 2)
    const targetY = Math.round(position.y - rect.height - 12)

    // 屏幕安全边界约束（留出 12px 边距）
    const padding = 12
    const safeX = Math.max(padding, Math.min(window.innerWidth - rect.width - padding, targetX))
    // 顶部空间不足时自动翻转至选区下方
    const safeY = targetY < padding ? Math.round(position.y + 24) : targetY

    setCoords({ x: safeX, y: safeY })
  }, [position, isAddingNote])

  // 点击外部关闭（延时绑定，避免与划词鼠标抬起竞争）
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        onClose?.()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick)
    }, 120)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [onClose])

  if (!position) return null

  const handleColorClick = (colorObj) => {
    onHighlight?.(colorObj)
  }

  const handleSaveNoteSubmit = () => {
    onSaveNote?.(noteText.trim())
    setIsAddingNote(false)
  }

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSaveNoteSubmit()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setIsAddingNote(false)
    }
  }

  // 初始未测算时先隐藏，测量完毕后显示在完全对齐的整数坐标上，杜绝闪烁和模糊
  const toolbarStyle = {
    position: 'fixed',
    left: coords ? `${coords.x}px` : `${Math.round(position.x - 165)}px`,
    top: coords ? `${coords.y}px` : `${Math.round(position.y - 65)}px`,
    visibility: coords ? 'visible' : 'hidden',
    zIndex: 9999,
    backgroundColor: 'var(--bg-layer1)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.12)',
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    fontSize: '15px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", "PingFang SC", sans-serif',
    color: 'var(--text-primary)',
    minWidth: '330px',
    maxWidth: '420px',
    boxSizing: 'border-box',
    textRendering: 'geometricPrecision'
  }

  return (
    <div
      ref={toolbarRef}
      className="text-selection-toolbar"
      style={toolbarStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 顶部主工具条（等比放大20%） */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        {/* 色彩高亮圆点组（放大至 24px） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.color}
              onClick={() => handleColorClick(c)}
              title={`高亮标注: ${c.name}`}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: c.color,
                border: existingAnnotation?.color === c.color ? '2px solid #ffffff' : '1.5px solid rgba(0,0,0,0.18)',
                boxShadow: existingAnnotation?.color === c.color ? '0 0 0 2px var(--accent)' : '0 1px 3px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                padding: 0,
                transition: 'transform 0.12s ease',
                transform: 'scale(1)'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            />
          ))}
        </div>

        <div style={{ width: '1px', height: '22px', backgroundColor: 'var(--border)' }} />

        {/* 功能按钮组（图标放大至 18px） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* 想法批注 */}
          <button
            onClick={() => setIsAddingNote(!isAddingNote)}
            title={existingAnnotation?.note ? '编辑想法笔记' : '写想法批注'}
            style={{
              background: isAddingNote || existingAnnotation?.note ? 'var(--accent)' : 'transparent',
              color: isAddingNote || existingAnnotation?.note ? '#ffffff' : 'var(--text-primary)',
              border: 'none',
              borderRadius: '6px',
              padding: '5px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'var(--transition)'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>

          {/* 复制 */}
          <button
            onClick={onCopy}
            title="复制选中文本"
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              border: 'none',
              borderRadius: '6px',
              padding: '5px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'var(--transition)'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>

          {/* 加入书签 */}
          {onAddBookmark && (
            <button
              onClick={onAddBookmark}
              title="在此处添加书签"
              style={{
                background: 'transparent',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: '6px',
                padding: '5px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'var(--transition)'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
          )}

          {/* 删除标注 */}
          {existingAnnotation && (
            <button
              onClick={onDeleteAnnotation}
              title="删除此划线标注"
              style={{
                background: 'transparent',
                color: '#ef4444',
                border: 'none',
                borderRadius: '6px',
                padding: '5px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'var(--transition)'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 展开的想法输入框（等比放大20%，字号15px，无重影） */}
      {isAddingNote && (
        <div style={{ marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '10px' }} onKeyDown={handleKeyDown}>
          <textarea
            ref={noteInputRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="记录你的思考与想法 (Ctrl+Enter保存)..."
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--bg-layer2)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              padding: '10px 12px',
              fontSize: '15px',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", "PingFang SC", sans-serif',
              lineHeight: 1.55,
              resize: 'none',
              outline: 'none',
              transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)'
              e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-glow)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              onClick={() => setIsAddingNote(false)}
              className="btn btn-secondary"
              style={{
                padding: '6px 14px',
                fontSize: '14px',
                borderRadius: '7px',
                fontWeight: 500
              }}
            >
              取消
            </button>
            <button
              onClick={handleSaveNoteSubmit}
              className="btn btn-primary"
              style={{
                padding: '6px 18px',
                fontSize: '14px',
                borderRadius: '7px',
                fontWeight: 500
              }}
            >
              保存想法
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
