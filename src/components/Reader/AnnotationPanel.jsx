import React, { useState } from 'react'

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function AnnotationPanel({ annotations = [], onRemove, onSelect, onExport, bookTitle }) {
  const [filterKeyword, setFilterKeyword] = useState('')

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
                <span style={{ fontSize: '11px', opacity: 0.8 }}>在正文中用鼠标选中文本即可高亮和记想法</span>
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
              {/* 顶部章节与时间 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {ann.chapterTitle || '正文'}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  {formatTime(ann.createdAt)}
                </span>
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

              {/* 删除按钮 */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove?.(ann.id)
                }}
                title="删除该笔记"
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '2px',
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'var(--transition)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#ef4444'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-muted)'
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
