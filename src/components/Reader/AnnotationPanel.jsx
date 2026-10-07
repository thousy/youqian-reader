import React, { useState } from 'react'
import { useStore } from '../../store/useStore'

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function AnnotationPanel({ annotations = [], onRemove, onSelect, onExport, bookTitle }) {
  const [filterKeyword, setFilterKeyword] = useState('')
  const [showThicknessSetting, setShowThicknessSetting] = useState(false)
  const { settings, updateSettings } = useStore()

  const thickness = settings?.annotationThickness || 2.5

  const filteredList = annotations.filter(a => {
    if (!filterKeyword.trim()) return true
    const kw = filterKeyword.toLowerCase()
    return (
      (a.selectedText && a.selectedText.toLowerCase().includes(kw)) ||
      (a.note && a.note.toLowerCase().includes(kw)) ||
      (a.chapterTitle && a.chapterTitle.toLowerCase().includes(kw))
    )
  })

  return (
    <div
      className="bookmark-panel"
      style={{
        width: '320px',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-layer1)',
        color: 'var(--text-primary)'
      }}
    >
      {/* 顶部标题与导出操作 */}
      <div
        className="bookmark-panel-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <span className="bookmark-panel-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          笔记与划线 ({annotations.length})
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setShowThicknessSetting(!showThicknessSetting)}
            className={`btn ${showThicknessSetting ? 'btn-primary' : 'btn-secondary'}`}
            title="划线样式设置"
            style={{
              padding: '2px 8px',
              fontSize: '11px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            划线设置
          </button>

          {annotations.length > 0 && (
            <button
              onClick={onExport}
              className="btn btn-secondary"
              title="导出笔记为 Markdown 文件"
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              导出 .md
            </button>
          )}
        </div>
      </div>

      {/* 划线设置展开卡片 */}
      {showThicknessSetting && (
        <div
          style={{
            padding: '12px 14px',
            backgroundColor: 'var(--bg-layer2)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              划线粗细
            </span>
            <span style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 'bold', fontFamily: 'monospace' }}>
              {thickness.toFixed(1)} px
            </span>
          </div>

          {/* 滑块 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>细</span>
            <input
              type="range"
              min="1.0"
              max="5.0"
              step="0.5"
              value={thickness}
              onChange={(e) => updateSettings({ annotationThickness: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>粗</span>
          </div>

          {/* 常用档位按钮 */}
          <div style={{ display: 'flex', gap: '6px' }}>
            {[
              { label: '极细 (1.5px)', val: 1.5 },
              { label: '标准 (2.5px)', val: 2.5 },
              { label: '加粗 (3.5px)', val: 3.5 }
            ].map(item => (
              <button
                key={item.val}
                onClick={() => updateSettings({ annotationThickness: item.val })}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  fontSize: '11px',
                  borderRadius: '4px',
                  border: thickness === item.val ? '1px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: thickness === item.val ? 'var(--accent)' : 'var(--bg-layer1)',
                  color: thickness === item.val ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* 实时效果预览 */}
          <div
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-layer1)',
              border: '1px solid var(--border-subtle)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>效果预览：</span>
            <span
              style={{
                color: 'var(--text-primary)',
                textDecoration: 'underline',
                textDecorationColor: 'var(--accent)',
                textDecorationThickness: `${thickness}px`,
                textUnderlineOffset: '6px'
              }}
            >
              重要段落与读书划线
            </span>
          </div>
        </div>
      )}

      {/* 搜索过滤框 */}
      {annotations.length > 3 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <input
            type="text"
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            placeholder="过滤笔记或引文..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--bg-layer2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              padding: '5px 8px',
              fontSize: '12px',
              outline: 'none',
              transition: 'var(--transition)'
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
        </div>
      )}

      {/* 笔记列表区域 */}
      <div className="bookmark-list" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {filteredList.length === 0 ? (
          <div style={{ padding: '36px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            <div style={{ marginBottom: '10px', fontSize: '28px' }}>📝</div>
            {annotations.length === 0 ? (
              <>
                暂无划线与读书笔记<br />
                <span style={{ fontSize: '11px', opacity: 0.8 }}>在正文中用鼠标选中文本即可划线和记想法</span>
              </>
            ) : (
              '未找到匹配的笔记'
            )}
          </div>
        ) : (
          filteredList.map((ann) => (
            <div
              key={ann.id}
              onClick={() => onSelect?.(ann)}
              style={{
                position: 'relative',
                padding: '10px 12px',
                marginBottom: '8px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-layer2)',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${ann.color || '#ffe066'}`,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-layer2)'
              }}
            >
              {/* 顶部章节与时间 + 删除操作 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                  {ann.chapterTitle || '正文'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatTime(ann.createdAt)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove?.(ann.id)
                    }}
                    title="删除该笔记"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '3px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#ef4444'
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.12)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-muted)'
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* 划线文本 */}
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--text-primary)',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                  fontStyle: 'italic',
                  marginBottom: ann.note ? '8px' : '0',
                  opacity: 0.95
                }}
              >
                “{ann.selectedText}”
              </div>

              {/* 想法笔记 */}
              {ann.note && (
                <div
                  style={{
                    backgroundColor: 'var(--bg-hover)',
                    border: '1px solid var(--border-subtle)',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                    lineHeight: 1.4,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '5px'
                  }}
                >
                  <span style={{ fontSize: '11px', flexShrink: 0 }}>💭</span>
                  <span style={{ wordBreak: 'break-word' }}>{ann.note}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
