import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store/useStore'

export function CategoryPopover({
  isOpen,
  anchorRect,
  currentCategoryId,
  categories = [],
  onSelectCategory,
  onCreateCategory,
  onClose,
  title = '移至分类'
}) {
  const { settings } = useStore()
  const globalTheme = settings?.globalTheme || 'dark'
  const [isCreating, setIsCreating] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [coords, setCoords] = useState(null)
  const popoverRef = useRef(null)
  const inputRef = useRef(null)

  // 聚焦新建输入框
  useEffect(() => {
    if (isCreating) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    }
  }, [isCreating])

  // 精确计算 fixed 坐标，避免被任何父容器 overflow:hidden 截断，且自动视口防溢出
  useLayoutEffect(() => {
    if (!isOpen || !anchorRect || !popoverRef.current) return

    const popoverEl = popoverRef.current
    const popWidth = popoverEl.offsetWidth || 180
    const popHeight = popoverEl.offsetHeight || 220

    // 默认水平位置：右对齐触发按钮或居中对齐
    let left = anchorRect.right - popWidth
    // 视口水平安全边界（留出 12px 边距）
    left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, left))

    // 垂直方向：优先在按钮下方弹出
    let top = anchorRect.bottom + 6
    // 若底部空间不足，则向上翻转
    if (top + popHeight > window.innerHeight - 12) {
      top = Math.max(12, anchorRect.top - popHeight - 6)
    }

    setCoords({ x: Math.round(left), y: Math.round(top) })
  }, [isOpen, anchorRect, isCreating, categories.length])

  // 点击外部和键盘 Esc 关闭
  useEffect(() => {
    if (!isOpen) return

    const handleOutsideClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose?.()
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.()
      }
    }

    // 延后注册，避免当前按钮的点击冒泡立即触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick, true)
      document.addEventListener('pointerdown', handleOutsideClick, true)
      window.addEventListener('keydown', handleKeyDown, true)
    }, 20)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleOutsideClick, true)
      document.removeEventListener('pointerdown', handleOutsideClick, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isOpen, onClose])

  if (!isOpen || !anchorRect) return null

  const handleCreateSubmit = (e) => {
    e?.stopPropagation()
    const trimmed = newCatName.trim()
    if (!trimmed) return
    onCreateCategory?.(trimmed)
    setNewCatName('')
    setIsCreating(false)
  }

  const popoverContent = (
    <div
      ref={popoverRef}
      className="category-popover global-portal-popover"
      data-global-theme={globalTheme}
      style={{
        position: 'fixed',
        left: coords ? `${coords.x}px` : `${Math.round(anchorRect.left)}px`,
        top: coords ? `${coords.y}px` : `${Math.round(anchorRect.bottom + 6)}px`,
        bottom: 'auto',
        height: 'auto',
        maxHeight: '280px',
        visibility: coords ? 'visible' : 'hidden',
        zIndex: 99999,
        width: '180px'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="popover-title">{title}</div>
      <div className="popover-list">
        {/* 未分类选项 */}
        <div
          className={`popover-item ${currentCategoryId === null || currentCategoryId === undefined ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onSelectCategory?.(null)
          }}
        >
          <span className="popover-item-dot" />
          未分类
        </div>

        {/* 现有自定义分类列表 */}
        {categories.map((cat) => (
          <div
            key={cat.id}
            className={`popover-item ${currentCategoryId === cat.id ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onSelectCategory?.(cat.id)
            }}
          >
            <span className="popover-item-dot" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cat.name}
            </span>
          </div>
        ))}
      </div>

      <div className="popover-divider" />

      {/* 新建分类输入面板 */}
      {isCreating ? (
        <div className="popover-new-cat-panel">
          <input
            ref={inputRef}
            type="text"
            className="popover-new-input"
            placeholder="新分类名称"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSubmit(e)
              if (e.key === 'Escape') setIsCreating(false)
            }}
          />
          <div className="popover-new-actions">
            <button className="popover-new-btn confirm" onClick={handleCreateSubmit}>
              创建
            </button>
            <button
              className="popover-new-btn cancel"
              onClick={(e) => {
                e.stopPropagation()
                setIsCreating(false)
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          className="popover-add-btn"
          onClick={(e) => {
            e.stopPropagation()
            setIsCreating(true)
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建分类
        </button>
      )}
    </div>
  )

  return createPortal(popoverContent, document.body)
}
