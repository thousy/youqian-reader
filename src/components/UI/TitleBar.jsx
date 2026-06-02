import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const { settings, updateSettings } = useStore()
  const isDark = settings.globalTheme !== 'light'

  const toggleTheme = () => {
    updateSettings({ globalTheme: isDark ? 'light' : 'dark' })
  }

  useEffect(() => {
    window.api?.isMaximized().then(setMaximized)
    window.api?.onMaximized(setMaximized)
  }, [])

  return (
    <div className="titlebar">
      <div className="titlebar-logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
        <span className="titlebar-title">YouQian Reader</span>
      </div>
      <div className="titlebar-spacer" />
      <div className="titlebar-controls">
        <button 
          className="titlebar-btn" 
          onClick={toggleTheme} 
          title={isDark ? '切换到明亮模式' : '切换到暗黑模式'}
          style={{ marginRight: '6px' }}
        >
          {isDark ? (
            /* Sun Icon */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            /* Moon Icon */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button className="titlebar-btn" onClick={() => window.api?.minimize()} title="最小化">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button className="titlebar-btn" onClick={() => window.api?.maximize()} title={maximized ? '还原' : '最大化'}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 0H10V8H2zM0 2V10H8V2" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          )}
        </button>
        <button className="titlebar-btn close" onClick={() => window.api?.close()} title="关闭">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
