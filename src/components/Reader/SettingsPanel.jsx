import React from 'react'
import { useStore } from '../../store/useStore'

const FONT_OPTIONS = ['Georgia', 'Noto Serif SC', 'Arial', 'Times New Roman']

export function SettingsPanel() {
  const { settings, updateSettings, setShowSettings } = useStore()

  return (
    <div className="settings-panel" id="settings-panel">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}>
        <div className="settings-title">阅读设置</div>
        <button style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',padding:'2px'}}
          onClick={() => setShowSettings(false)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* 主题 */}
      <div className="settings-group">
        <div className="settings-label">背景主题</div>
        <div className="settings-theme-btns">
          {[
            { key: 'dark', label: '暗黑', cls: 'theme-dark' },
            { key: 'light', label: '亮白', cls: 'theme-light' },
            { key: 'sepia', label: '米黄', cls: 'theme-sepia' },
            { key: 'night', label: '夜间', cls: 'theme-night' },
          ].map(t => (
            <button
              key={t.key}
              className={`theme-btn ${t.cls} ${settings.theme === t.key ? 'active' : ''}`}
              onClick={() => updateSettings({ theme: t.key })}
              id={`theme-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 字号 */}
      <div className="settings-group">
        <div className="settings-label" style={{display:'flex',justifyContent:'space-between'}}>
          <span>字体大小</span>
          <span style={{color:'var(--text-secondary)'}}>{settings.fontSize}px</span>
        </div>
        <input
          type="range"
          className="settings-slider"
          min="12" max="32" step="1"
          value={settings.fontSize}
          onChange={e => updateSettings({ fontSize: Number(e.target.value) })}
          id="font-size-slider"
        />
      </div>

      {/* 行高 */}
      <div className="settings-group">
        <div className="settings-label" style={{display:'flex',justifyContent:'space-between'}}>
          <span>行间距</span>
          <span style={{color:'var(--text-secondary)'}}>{settings.lineHeight}</span>
        </div>
        <input
          type="range"
          className="settings-slider"
          min="1.2" max="2.5" step="0.1"
          value={settings.lineHeight}
          onChange={e => updateSettings({ lineHeight: Number(e.target.value) })}
          id="line-height-slider"
        />
      </div>

      {/* 字体 */}
      <div className="settings-group">
        <div className="settings-label">字体</div>
        <div className="settings-font-btns">
          {FONT_OPTIONS.map(f => (
            <button
              key={f}
              className={`font-btn ${settings.fontFamily === f ? 'active' : ''}`}
              onClick={() => updateSettings({ fontFamily: f })}
              style={{fontFamily: f}}
              id={`font-${f.replace(/\s/g, '-')}`}
            >
              {f === 'Georgia' ? 'Georgia' : f === 'Noto Serif SC' ? '宋体' : f === 'Arial' ? 'Arial' : '新罗马'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
