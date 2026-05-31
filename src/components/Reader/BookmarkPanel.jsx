import React from 'react'

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
}

export function BookmarkPanel({ bookmarks, onRemove }) {
  return (
    <div className="bookmark-panel">
      <div className="bookmark-panel-header">
        <span className="bookmark-panel-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{marginRight:'6px',verticalAlign:'middle'}}>
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          书签 ({bookmarks.length})
        </span>
      </div>

      <div className="bookmark-list">
        {bookmarks.length === 0 ? (
          <div style={{padding:'24px 12px',textAlign:'center',color:'var(--text-muted)',fontSize:'13px'}}>
            <div style={{marginBottom:'8px',fontSize:'24px'}}>🔖</div>
            暂无书签<br/>
            <span style={{fontSize:'12px'}}>点击工具栏书签图标添加</span>
          </div>
        ) : (
          bookmarks.map(bm => (
            <div key={bm.id} className="bookmark-item" id={`bookmark-${bm.id}`}>
              <svg className="bookmark-icon" width="12" height="12" viewBox="0 0 24 24" fill="var(--accent)" stroke="none">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              <div className="bookmark-info">
                <div className="bookmark-label">{bm.label}</div>
                <div className="bookmark-time">{formatTime(bm.createdAt)}</div>
              </div>
              <button
                className="bookmark-delete"
                onClick={(e) => { e.stopPropagation(); onRemove(bm.id) }}
                title="删除书签"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
