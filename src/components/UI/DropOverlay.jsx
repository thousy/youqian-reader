import React from 'react'

export function DropOverlay() {
  return (
    <div className="drop-overlay">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span>松开以导入书籍</span>
      <span style={{fontSize:'13px', opacity: 0.7}}>支持 EPUB · PDF · AZW3 · MOBI · TXT</span>
    </div>
  )
}
