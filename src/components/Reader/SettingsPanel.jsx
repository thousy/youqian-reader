import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { registerSingleCustomFont } from '../../utils/fontLoader'

const DEFAULT_SETTINGS = {
  fontSize: 18,
  fontFamily: 'Noto Serif SC',
  theme: 'dark',
  lineHeight: 1.8,
  fontWeight: 400,
  globalTheme: 'dark'
}

const PRESET_FONT_MAP = {
  'BookDefault': '内嵌字体',
  'system-ui': '系统默认',
  'Noto Serif SC': '思源宋体',
  'KaiTi': '楷体',
  'Microsoft YaHei': '微软雅黑',
  'SimSun': '宋体',
  'Georgia': 'Georgia',
  'Arial': 'Arial',
  'Times New Roman': '新罗马'
}

const PRESET_FONT_OPTIONS = Object.keys(PRESET_FONT_MAP)

export function SettingsPanel({ onClose, isModal = false }) {
  const {
    settings, updateSettings, setShowSettings,
    setCategories, setBooks, showToast, showConfirm
  } = useStore()

  const [customFonts, setCustomFonts] = useState([])
  const [importingFont, setImportingFont] = useState(false)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedFontFiles, setSelectedFontFiles] = useState([])

  // 处理关闭
  const handleClose = () => {
    if (onClose) {
      onClose()
    } else {
      setShowSettings(false)
    }
  }

  // 加载自定义字体列表
  const refreshCustomFonts = async () => {
    try {
      if (window.api?.customFontGetList) {
        const list = await window.api.customFontGetList()
        setCustomFonts(list || [])
      }
    } catch (_) {}
  }

  useEffect(() => {
    refreshCustomFonts()
  }, [])

  // 处理导入字体
  const handleImportFont = async (e) => {
    e?.stopPropagation?.()
    if (importingFont) return
    setImportingFont(true)
    window._isFileDialogActive = Date.now()
    window._lastImportTime = Date.now()

    try {
      const res = await window.api?.customFontImport?.()
      if (res?.success) {
        showToast(`🎉 成功导入 ${res.count} 个自定义字体！`, 'success')
        // 动态注册新导入的字体
        if (Array.isArray(res.fonts)) {
          for (const f of res.fonts) {
            await registerSingleCustomFont(f)
          }
          setCustomFonts(res.fonts)
          // 默认自动切换为刚导入的第一个字体
          if (res.fonts.length > 0) {
            const latestFont = res.fonts[res.fonts.length - 1]
            updateSettings({ fontFamily: latestFont.name })
          }
        }
      } else if (!res?.canceled && res?.error) {
        showToast('导入字体失败: ' + res.error, 'error')
      }
    } catch (err) {
      showToast('导入出错: ' + err.message, 'error')
    } finally {
      window._lastImportTime = Date.now()
      // 延迟 1.5 秒清除防误触标记，杜绝系统文件对话框关闭时冒泡导致面板被自动退出
      setTimeout(() => {
        window._isFileDialogActive = null
        setImportingFont(false)
      }, 1500)
    }
  }

  // 处理删除单个自定义字体
  const handleDeleteCustomFont = async (font, e) => {
    e.stopPropagation()
    const ok = await showConfirm('删除自定义字体', `确定要删除字体“${font.name}”吗？\n删除后该字体文件将被移出。`)
    if (!ok) return

    try {
      const res = await window.api?.customFontDelete?.(font.fileName)
      if (res?.success) {
        showToast(`已删除字体“${font.name}”`, 'success')
        setCustomFonts(res.fonts || [])
        // 若当前选中的正是被删除的字体，回退到默认
        if (settings.fontFamily === font.name) {
          updateSettings({ fontFamily: 'Noto Serif SC' })
        }
      }
    } catch (err) {
      showToast('删除字体出错: ' + err.message, 'error')
    }
  }

  // 切换单个字体的选中状态
  const handleToggleSelectFont = (fileName, e) => {
    e?.stopPropagation?.()
    setSelectedFontFiles(prev =>
      prev.includes(fileName) ? prev.filter(f => f !== fileName) : [...prev, fileName]
    )
  }

  // 全选 / 全不选
  const handleToggleSelectAll = (e) => {
    e?.stopPropagation?.()
    if (selectedFontFiles.length === customFonts.length) {
      setSelectedFontFiles([])
    } else {
      setSelectedFontFiles(customFonts.map(cf => cf.fileName))
    }
  }

  // 批量删除已选字体
  const handleBatchDelete = async (e) => {
    e?.stopPropagation?.()
    if (selectedFontFiles.length === 0) {
      showToast('请先选择要删除的字体', 'warning')
      return
    }

    const count = selectedFontFiles.length
    const ok = await showConfirm(
      '批量删除字体',
      `确定要删除选中的 ${count} 个自定义字体吗？\n删除后字体文件将被彻底移除。`
    )
    if (!ok) return

    try {
      let deleteSuccess = false
      let latestFonts = customFonts

      // 优先尝试主进程批量接口
      if (window.api?.customFontBatchDelete) {
        try {
          const res = await window.api.customFontBatchDelete(selectedFontFiles)
          if (res?.success || res?.fonts) {
            deleteSuccess = true
            latestFonts = res.fonts || []
          }
        } catch (e) {
          // 主进程若尚未重启，则自动平滑降级为逐个调用单项删除接口
          console.warn('[FontManager] 批量接口未就绪，自动降级为逐项删除:', e)
        }
      }

      // 若批量接口不可用或调用失败，自动降级逐一删除
      if (!deleteSuccess) {
        for (const fn of selectedFontFiles) {
          try {
            const singleRes = await window.api?.customFontDelete?.(fn)
            if (singleRes?.fonts) {
              latestFonts = singleRes.fonts
            }
          } catch (_) {}
        }
        deleteSuccess = true
      }

      if (deleteSuccess) {
        showToast(`🎉 成功批量删除 ${count} 个字体！`, 'success')
        setCustomFonts(latestFonts)

        // 检查当前使用的字体是否在被删除的列表中
        const deletedNames = customFonts
          .filter(f => selectedFontFiles.includes(f.fileName))
          .map(f => f.name)

        if (deletedNames.includes(settings.fontFamily)) {
          updateSettings({ fontFamily: 'Noto Serif SC' })
        }

        setSelectedFontFiles([])
        setIsBatchMode(false)
      }
    } catch (err) {
      showToast('批量删除出错: ' + err.message, 'error')
    }
  }

  const weightMap = { 1: 300, 2: 400, 3: 600, 4: 800, 5: 900 }
  const weightMapReverse = { 300: 1, 400: 2, 600: 3, 800: 4, 900: 5 }
  const sliderWeight = weightMapReverse[settings.fontWeight] || 2

  return (
    <div className={`settings-panel ${isModal ? 'settings-panel-modal' : ''}`} id="settings-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div className="settings-title">阅读设置</div>
        <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          onClick={handleClose}
          title="关闭设置"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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
            { key: 'word', label: 'Word', cls: 'theme-word' },
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
        <div className="settings-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>字体大小</span>
          <span style={{ color: 'var(--text-secondary)' }}>{settings.fontSize}px</span>
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
        <div className="settings-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>行间距</span>
          <span style={{ color: 'var(--text-secondary)' }}>{settings.lineHeight}</span>
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

      {/* 字体粗细 */}
      <div className="settings-group">
        <div className="settings-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>字体粗细</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {settings.fontWeight === 300 ? '细体' :
              settings.fontWeight === 400 ? '常规' :
                settings.fontWeight === 600 ? '小粗' :
                  settings.fontWeight === 800 ? '中粗' :
                    settings.fontWeight === 900 ? '大粗' : '常规'}
          </span>
        </div>
        <input
          type="range"
          className="settings-slider"
          min="1" max="5" step="1"
          value={sliderWeight}
          onChange={e => updateSettings({ fontWeight: weightMap[Number(e.target.value)] || 400 })}
          id="font-weight-slider"
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

      {/* 字体设置区域 */}
      <div className="settings-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div className="settings-label" style={{ margin: 0 }}>预设字体</div>
          <button
            onClick={handleImportFont}
            disabled={importingFont}
            style={{
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '6px',
              padding: '3px 8px',
              color: 'var(--accent-light)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: importingFont ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="支持导入电脑本地的 .ttf / .otf / .woff / .woff2 字体文件"
          >
            <span>📥 导入本地字体</span>
          </button>
        </div>

        {/* 预设安全字体列表 */}
        <div className="settings-font-btns">
          {PRESET_FONT_OPTIONS.map(f => (
            <button
              key={f}
              className={`font-btn ${settings.fontFamily === f ? 'active' : ''}`}
              onClick={() => updateSettings({ fontFamily: f })}
              style={{ fontFamily: f }}
              id={`font-${f.replace(/\s/g, '-')}`}
            >
              {PRESET_FONT_MAP[f] || f}
            </button>
          ))}
        </div>

        {/* 用户自定义导入字体列表 */}
        {customFonts.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            {!isBatchMode ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  📂 我的自定义字体 ({customFonts.length})
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsBatchMode(true)
                    setSelectedFontFiles([])
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '2px 7px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s'
                  }}
                  title="开启批量删除字体"
                  id="btn-font-batch-delete-mode"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>批量删除</span>
                </button>
              </div>
            ) : (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
                padding: '5px 8px',
                background: 'var(--bg-layer3)',
                borderRadius: '6px',
                border: '1px solid var(--border)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    onClick={handleToggleSelectAll}
                    style={{
                      background: 'var(--bg-layer2)',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '10.5px',
                      color: 'var(--text-primary)',
                      cursor: 'pointer'
                    }}
                  >
                    {selectedFontFiles.length === customFonts.length ? '全不选' : '全选'}
                  </button>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    已选 <b style={{ color: selectedFontFiles.length > 0 ? '#ef4444' : 'inherit' }}>{selectedFontFiles.length}</b>/{customFonts.length}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <button
                    onClick={handleBatchDelete}
                    disabled={selectedFontFiles.length === 0}
                    style={{
                      background: selectedFontFiles.length === 0 ? 'rgba(239, 68, 68, 0.2)' : '#ef4444',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: selectedFontFiles.length === 0 ? 'var(--text-muted)' : '#ffffff',
                      cursor: selectedFontFiles.length === 0 ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      transition: 'all 0.15s'
                    }}
                    id="btn-font-batch-delete-confirm"
                  >
                    <span>删除所选 ({selectedFontFiles.length})</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsBatchMode(false)
                      setSelectedFontFiles([])
                    }}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '10.5px',
                      color: 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
              {customFonts.map(cf => {
                const isActive = settings.fontFamily === cf.name
                const isSelected = selectedFontFiles.includes(cf.fileName)

                if (isBatchMode) {
                  return (
                    <div
                      key={cf.fileName}
                      onClick={(e) => handleToggleSelectFont(cf.fileName, e)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: isSelected ? '1px solid #ef4444' : '1px solid var(--border)',
                        background: isSelected ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-layer2)',
                        color: isSelected ? '#ef4444' : 'var(--text-primary)',
                        fontSize: '12px',
                        fontFamily: `"${cf.name}", sans-serif`,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        transition: 'all 0.15s',
                        userSelect: 'none'
                      }}
                      title={isSelected ? '点击取消勾选' : '点击勾选'}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cf.name}
                      </span>
                      <span style={{
                        color: isSelected ? '#ef4444' : 'var(--text-muted)',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        marginLeft: '4px'
                      }}>
                        {isSelected ? '☑' : '☐'}
                      </span>
                    </div>
                  )
                }

                return (
                  <div
                    key={cf.fileName}
                    onClick={() => updateSettings({ fontFamily: cf.name })}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                      background: isActive ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-layer2)',
                      color: isActive ? 'var(--accent-light)' : 'var(--text-primary)',
                      fontSize: '12px',
                      fontFamily: `"${cf.name}", sans-serif`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.15s'
                    }}
                    title={`点击切换为自定义字体: ${cf.name}`}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cf.name}
                    </span>
                    <button
                      onClick={(e) => handleDeleteCustomFont(cf, e)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '12px',
                        lineHeight: 1,
                        opacity: 0.7
                      }}
                      title="删除此字体"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 恢复默认设置 */}
      <button
        className="settings-restore-btn"
        onClick={() => updateSettings(DEFAULT_SETTINGS)}
        id="btn-restore-default-settings"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M16 3h5v5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 21H3v-5" />
        </svg>
        恢复默认设置
      </button>


    </div>
  )
}
