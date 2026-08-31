import React, { useState, useEffect, useRef } from 'react'

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
  const noteInputRef = useRef(null)
  const toolbarRef = useRef(null)

  useEffect(() => {
    if (isAddingNote) {
      setTimeout(() => {
        noteInputRef.current?.focus()
      }, 50)
    }
  }, [isAddingNote])

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

  return (
    <div
      ref={toolbarRef}
      className="text-selection-toolbar"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%) translateY(-10px)',
        zIndex: 9999,
        backgroundColor: 'var(--bg-layer1)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        fontSize: '12px',
        color: 'var(--text-primary)',
        backdropFilter: 'blur(12px)',
        minWidth: '220px',
        maxWidth: '320px',
        animation: 'fadeInPop 0.15s ease-out'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 顶部主工具条 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        {/* 色彩高亮圆点组 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.color}
              onClick={() => handleColorClick(c)}
              title={`高亮标注: ${c.name}`}
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: c.color,
                border: existingAnnotation?.color === c.color ? '2px solid #ffffff' : '1px solid rgba(0,0,0,0.2)',
                boxShadow: existingAnnotation?.color === c.color ? '0 0 0 1px var(--accent)' : 'none',
                cursor: 'pointer',
                padding: 0,
                transition: 'transform 0.1s ease',
                transform: 'scale(1)'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.2)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            />
          ))}
        </div>

        <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border)' }} />

        {/* 按钮组 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* 想法批注 */}
          <button
            onClick={() => setIsAddingNote(!isAddingNote)}
            title={existingAnnotation?.note ? '编辑想法笔记' : '写想法批注'}
            style={{
              background: isAddingNote || existingAnnotation?.note ? 'var(--accent)' : 'transparent',
              color: isAddingNote || existingAnnotation?.note ? '#ffffff' : 'var(--text-primary)',
              border: 'none',
              borderRadius: '4px',
              padding: '3px 5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              transition: 'var(--transition)'
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              borderRadius: '4px',
              padding: '3px 5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              transition: 'var(--transition)'
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                borderRadius: '4px',
                padding: '3px 5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'var(--transition)'
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
          )}

          {/* 删除此笔记（如果是已有标注） */}
          {existingAnnotation && (
            <button
              onClick={onDeleteAnnotation}
              title="删除此划线标注"
              style={{
                background: 'transparent',
                color: '#ef4444',
                border: 'none',
                borderRadius: '4px',
                padding: '3px 5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'var(--transition)'
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 展开的想法输入框 */}
      {isAddingNote && (
        <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }} onKeyDown={handleKeyDown}>
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
              borderRadius: '6px',
              color: 'var(--text-primary)',
              padding: '6px 8px',
              fontSize: '12px',
              lineHeight: 1.4,
              resize: 'none',
              outline: 'none'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <button
              onClick={() => setIsAddingNote(false)}
              className="btn btn-secondary"
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                borderRadius: '4px'
              }}
            >
              取消
            </button>
            <button
              onClick={handleSaveNoteSubmit}
              className="btn btn-primary"
              style={{
                padding: '2px 10px',
                fontSize: '11px',
                borderRadius: '4px'
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
