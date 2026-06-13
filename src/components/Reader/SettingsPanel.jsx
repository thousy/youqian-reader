import React from 'react'
import { useStore } from '../../store/useStore'

const DEFAULT_SETTINGS = {
  fontSize: 18,
  fontFamily: 'Noto Serif SC',
  theme: 'dark',
  lineHeight: 1.8,
  globalTheme: 'dark'
}

const FONT_MAP = {
  'BookDefault': '内嵌字体',
  'Microsoft YaHei': '微软雅黑',
  'YouYuan': '幼圆',
  'KaiTi': '楷体',
  'SimSun': '宋体',
  'Noto Serif SC': '思源宋体',
  'Georgia': 'Georgia',
  'Arial': 'Arial',
  'Times New Roman': '新罗马'
}

const FONT_OPTIONS = Object.keys(FONT_MAP)

export function SettingsPanel() {
  const {
    settings, updateSettings, setShowSettings,
    setCategories, setBooks, showToast
  } = useStore()


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

      {/* 排版模式 */}
      <div className="settings-group">
        <div className="settings-label">排版模式</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
          <button
            className={`theme-btn ${settings.layoutMode === 'horizontal' ? 'active' : ''}`}
            style={{
              padding: '6px 2px',
              borderRadius: '6px',
              border: '1px solid transparent',
              cursor: 'pointer',
              fontSize: '10.5px',
              fontWeight: '600',
              textAlign: 'center',
              backgroundColor: 'var(--bg-layer3)',
              color: 'var(--text-secondary)',
              borderColor: settings.layoutMode === 'horizontal' ? 'var(--accent)' : 'transparent'
            }}
            onClick={() => updateSettings({ layoutMode: 'horizontal' })}
            id="layout-horizontal-btn"
          >
            全窗口显示
          </button>
          <button
            className={`theme-btn ${settings.layoutMode === 'horizontal-scroll' ? 'active' : ''}`}
            style={{
              padding: '6px 2px',
              borderRadius: '6px',
              border: '1px solid transparent',
              cursor: 'pointer',
              fontSize: '10.5px',
              fontWeight: '600',
              textAlign: 'center',
              backgroundColor: 'var(--bg-layer3)',
              color: 'var(--text-secondary)',
              borderColor: settings.layoutMode === 'horizontal-scroll' ? 'var(--accent)' : 'transparent'
            }}
            onClick={() => updateSettings({ layoutMode: 'horizontal-scroll' })}
            id="layout-horizontal-scroll-btn"
          >
            左右滚动
          </button>
          <button
            className={`theme-btn ${settings.layoutMode === 'vertical' ? 'active' : ''}`}
            style={{
              padding: '6px 2px',
              borderRadius: '6px',
              border: '1px solid transparent',
              cursor: 'pointer',
              fontSize: '10.5px',
              fontWeight: '600',
              textAlign: 'center',
              backgroundColor: 'var(--bg-layer3)',
              color: 'var(--text-secondary)',
              borderColor: settings.layoutMode === 'vertical' ? 'var(--accent)' : 'transparent'
            }}
            onClick={() => updateSettings({ layoutMode: 'vertical' })}
            id="layout-vertical-btn"
          >
            上下滚动
          </button>
        </div>
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
              {FONT_MAP[f] || f}
            </button>
          ))}
        </div>
      </div>

      {/* 恢复默认设置 */}
      <button 
        className="settings-restore-btn"
        onClick={() => updateSettings(DEFAULT_SETTINGS)}
        id="btn-restore-default-settings"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
          <path d="M16 3h5v5"/>
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
          <path d="M8 21H3v-5"/>
        </svg>
        恢复默认设置
      </button>


    </div>
  )
}
