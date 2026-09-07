import React, { useState, useEffect, useMemo } from 'react'

/**
 * 阅读 3.0 (Legado) 规则管理中心（包含正文替换净化与 TXT 目录识别规则）
 */
export function ReplaceRuleModal({ isOpen, onClose, onRulesChanged, currentBookTitle, currentSourceName }) {
  const [activeTab, setActiveTab] = useState('replace') // 'replace' | 'txtToc'
  
  // 替换净化规则状态
  const [replaceRules, setReplaceRules] = useState([])
  const [replaceLoading, setReplaceLoading] = useState(true)
  const [replaceSearch, setReplaceSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importJsonText, setImportJsonText] = useState('')
  const [importError, setImportError] = useState('')

  // 新增表单字段
  const [newName, setNewName] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const [newReplacement, setNewReplacement] = useState('')
  const [newScope, setNewScope] = useState('')
  const [newIsRegex, setNewIsRegex] = useState(true)

  // TXT 目录规则状态
  const [txtTocRules, setTxtTocRules] = useState([])
  const [txtTocLoading, setTxtTocLoading] = useState(false)

  // 1. 加载替换规则
  const loadReplaceRules = async () => {
    setReplaceLoading(true)
    try {
      const res = await window.api.novelGetReplaceRules()
      setReplaceRules(Array.isArray(res) ? res : [])
    } catch (e) {
      console.warn('获取替换净化规则失败:', e)
    } finally {
      setReplaceLoading(false)
    }
  }

  // 2. 加载 TXT 目录规则
  const loadTxtTocRules = async () => {
    setTxtTocLoading(true)
    try {
      const res = await window.api.novelGetTxtTocRules()
      setTxtTocRules(Array.isArray(res) ? res : [])
    } catch (e) {
      console.warn('获取 TXT 目录规则失败:', e)
    } finally {
      setTxtTocLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadReplaceRules()
      loadTxtTocRules()
      setShowAddForm(false)
      setShowImportModal(false)
      setImportError('')
      setReplaceSearch('')
    }
  }, [isOpen])

  // 检索过滤（必须置于条件返回之前，严格遵守 React Hook 规则）
  const filteredReplaceRules = useMemo(() => {
    if (!replaceSearch.trim()) return replaceRules
    const kw = replaceSearch.trim().toLowerCase()
    return replaceRules.filter(r => 
      (r.name && r.name.toLowerCase().includes(kw)) ||
      (r.pattern && r.pattern.toLowerCase().includes(kw)) ||
      (r.scope && r.scope.toLowerCase().includes(kw))
    )
  }, [replaceRules, replaceSearch])

  const visibleReplaceRules = filteredReplaceRules.slice(0, 100)

  // 切换替换规则启用
  const handleToggleReplace = async (id, currentEnabled) => {
    try {
      await window.api.novelToggleReplaceRule(id, !currentEnabled)
      setReplaceRules(prev => prev.map(r => r.id === id ? { ...r, isEnabled: !currentEnabled } : r))
      onRulesChanged?.()
    } catch (e) {
      console.error(e)
    }
  }

  // 删除替换规则
  const handleDeleteReplace = async (id) => {
    if (!window.confirm('确定删除该替换净化规则吗？')) return
    try {
      await window.api.novelDeleteReplaceRule(id)
      setReplaceRules(prev => prev.filter(r => r.id !== id))
      onRulesChanged?.()
    } catch (e) {
      console.error(e)
    }
  }

  // 新增替换规则
  const handleAddReplaceSubmit = async (e) => {
    e.preventDefault()
    if (!newPattern.trim()) {
      alert('请填写匹配正则或关键词！')
      return
    }
    const ruleObj = {
      name: newName.trim() || '自定义净化规则',
      pattern: newPattern.trim(),
      replacement: newReplacement,
      scope: newScope.trim(),
      isRegex: newIsRegex,
      isEnabled: true
    }
    try {
      await window.api.novelAddReplaceRule(ruleObj)
      await loadReplaceRules()
      setShowAddForm(false)
      setNewName('')
      setNewPattern('')
      setNewReplacement('')
      setNewScope('')
      onRulesChanged?.()
    } catch (e) {
      alert('添加失败: ' + e.message)
    }
  }

  // 导入阅读 3.0 JSON
  const handleImportSubmit = async () => {
    if (!importJsonText.trim()) return
    setImportError('')
    try {
      const res = await window.api.novelImportReplaceRules(importJsonText)
      if (res.success) {
        alert(`成功导入 ${res.count} 条阅读 3.0 替换规则！`)
        setShowImportModal(false)
        setImportJsonText('')
        await loadReplaceRules()
        onRulesChanged?.()
      } else {
        setImportError(res.error || '导入失败')
      }
    } catch (err) {
      setImportError('解析失败: ' + err.message)
    }
  }

  // 切换 TXT 目录规则启用
  const handleToggleTxtToc = async (idx) => {
    const updated = [...txtTocRules]
    updated[idx] = { ...updated[idx], enable: !updated[idx].enable }
    setTxtTocRules(updated)
    try {
      await window.api.novelSaveTxtTocRules(updated)
      onRulesChanged?.()
    } catch (e) {
      console.error(e)
    }
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(6px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '720px',
          height: '86vh',
          maxHeight: '700px',
          backgroundColor: 'var(--bg-layer1, #1e1e28)',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          color: 'var(--text-primary)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-layer2, #252533)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>⚙️</span>
            <span style={{ fontSize: '15px', fontWeight: 600 }}>阅读 3.0 规则管理中心</span>
            <span
              style={{
                fontSize: '11px',
                color: 'var(--accent)',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                padding: '2px 8px',
                borderRadius: '12px',
                border: '1px solid rgba(99, 102, 241, 0.3)'
              }}
            >
              Legado 标准库
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            ✕
          </button>
        </div>

        {/* 选项卡 Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-layer2)',
            padding: '0 16px'
          }}
        >
          <button
            onClick={() => setActiveTab('replace')}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderBottom: activeTab === 'replace' ? '2px solid var(--accent)' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: activeTab === 'replace' ? 'var(--accent-light)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'replace' ? 600 : 400,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>🧹</span> 正文替换净化规则
            <span style={{ fontSize: '11px', opacity: 0.7 }}>({replaceRules.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('txtToc')}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderBottom: activeTab === 'txtToc' ? '2px solid var(--accent)' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: activeTab === 'txtToc' ? 'var(--accent-light)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'txtToc' ? 600 : 400,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>📑</span> TXT 目录分章规则
            <span style={{ fontSize: '11px', opacity: 0.7 }}>({txtTocRules.length})</span>
          </button>
        </div>

        {/* Tab 1: 正文替换规则 */}
        {activeTab === 'replace' && (
          <>
            {/* 搜索与操作条 */}
            <div
              style={{
                padding: '10px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: 'rgba(0, 0, 0, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
              }}
            >
              <div style={{ flex: 1, maxWidth: '280px' }}>
                <input
                  type="text"
                  placeholder="🔍 搜索规则名称、正则或书名..."
                  value={replaceSearch}
                  onChange={e => setReplaceSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--bg-layer1)',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setShowImportModal(true)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--bg-layer2)',
                    color: 'var(--text-primary)',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  📥 导入阅读3.0 JSON
                </button>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: 'none',
                    backgroundColor: 'var(--accent)',
                    color: '#fff',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontWeight: 500
                  }}
                >
                  {showAddForm ? '取消新增' : '➕ 新增规则'}
                </button>
              </div>
            </div>

            {/* 新增表单 */}
            {showAddForm && (
              <form
                onSubmit={handleAddReplaceSubmit}
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border-subtle)',
                  backgroundColor: 'rgba(99, 102, 241, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="规则名称"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    style={{ flex: 1, padding: '5px 8px', borderRadius: '5px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-layer1)', color: 'var(--text-primary)', fontSize: '12px' }}
                  />
                  <input
                    type="text"
                    placeholder="范围 (留空全局)"
                    value={newScope}
                    onChange={e => setNewScope(e.target.value)}
                    style={{ width: '180px', padding: '5px 8px', borderRadius: '5px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-layer1)', color: 'var(--text-primary)', fontSize: '12px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    required
                    placeholder="匹配正则或文本 (例如：天才一秒记住.*?|最新网址.*)"
                    value={newPattern}
                    onChange={e => setNewPattern(e.target.value)}
                    style={{ flex: 2, padding: '5px 8px', borderRadius: '5px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-layer1)', color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'monospace' }}
                  />
                  <input
                    type="text"
                    placeholder="替换为 (留空清空)"
                    value={newReplacement}
                    onChange={e => setNewReplacement(e.target.value)}
                    style={{ flex: 1, padding: '5px 8px', borderRadius: '5px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-layer1)', color: 'var(--text-primary)', fontSize: '12px' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={newIsRegex} onChange={e => setNewIsRegex(e.target.checked)} />
                    正则模式 (RegExp)
                  </label>
                  <button type="submit" style={{ padding: '4px 12px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--accent)', color: '#fff', fontSize: '11px', cursor: 'pointer' }}>
                    保存规则
                  </button>
                </div>
              </form>
            )}

            {/* 导入弹窗 */}
            {showImportModal && (
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-layer2)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>粘贴阅读 3.0 replaceRules.json 内容：</div>
                <textarea
                  rows={4}
                  placeholder='[ { "name": "去除广告", "pattern": "广告.*", "replacement": "" } ]'
                  value={importJsonText}
                  onChange={e => setImportJsonText(e.target.value)}
                  style={{ width: '100%', padding: '6px', borderRadius: '5px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-layer1)', color: 'var(--text-primary)', fontSize: '11px', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
                {importError && <div style={{ fontSize: '11px', color: '#ef4444' }}>{importError}</div>}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowImportModal(false)} style={{ padding: '3px 10px', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>取消</button>
                  <button onClick={handleImportSubmit} style={{ padding: '3px 12px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--accent)', color: '#fff', fontSize: '11px', cursor: 'pointer' }}>确认导入</button>
                </div>
              </div>
            )}

            {/* 规则列表 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
              {replaceLoading && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>正在载入规则库...</div>
              )}
              {!replaceLoading && filteredReplaceRules.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>未匹配到替换净化规则</div>
              )}
              {!replaceLoading && visibleReplaceRules.map(r => (
                <div
                  key={r.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: r.isEnabled ? 'var(--bg-layer2)' : 'rgba(0,0,0,0.1)',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    opacity: r.isEnabled ? 1 : 0.6
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: 1, overflow: 'hidden' }}>
                    <input
                      type="checkbox"
                      checked={r.isEnabled}
                      onChange={() => handleToggleReplace(r.id, r.isEnabled)}
                      style={{ marginTop: '3px', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</span>
                        {r.scope && (
                          <span style={{ fontSize: '10px', color: 'var(--accent-light)', backgroundColor: 'rgba(99,102,241,0.12)', padding: '1px 4px', borderRadius: '3px' }}>
                            {r.scope}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.pattern}>
                        {r.pattern}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '11px', color: r.replacement ? 'var(--accent-light)' : 'var(--text-muted)' }}>
                      {r.replacement ? `换为「${r.replacement}」` : '清空'}
                    </span>
                    <button onClick={() => handleDeleteReplace(r.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>🗑️</button>
                  </div>
                </div>
              ))}
              {!replaceLoading && filteredReplaceRules.length > 100 && (
                <div style={{ textAlign: 'center', padding: '8px 0', fontSize: '11px', color: 'var(--text-muted)' }}>
                  已展示前 100 条（共 {filteredReplaceRules.length} 条），可使用上方搜索框缩小范围
                </div>
              )}
            </div>
          </>
        )}

        {/* Tab 2: TXT 目录分章规则 */}
        {activeTab === 'txtToc' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
            <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              以下为阅读 3.0 (Legado) 官方内置的 TXT 目录分章正则规则库。导入本地 TXT 小说时将按以下规则精准切分章节目录：
            </div>

            {txtTocLoading && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>正在载入 TXT 目录规则...</div>
            )}

            {!txtTocLoading && txtTocRules.map((rule, idx) => (
              <div
                key={rule.id || idx}
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: rule.enable ? 'var(--bg-layer2)' : 'rgba(0,0,0,0.1)',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  opacity: rule.enable ? 1 : 0.65
                }}
              >
                <input
                  type="checkbox"
                  checked={rule.enable}
                  onChange={() => handleToggleTxtToc(idx)}
                  style={{ marginTop: '4px', cursor: 'pointer' }}
                  title={rule.enable ? '点击停用' : '点击启用'}
                />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {rule.name}
                    </span>
                    {rule.example && (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', backgroundColor: 'rgba(0,0,0,0.15)', padding: '1px 6px', borderRadius: '4px' }}>
                        例: {rule.example}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      fontFamily: 'monospace',
                      backgroundColor: 'rgba(0,0,0,0.2)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={rule.rule}
                  >
                    {rule.rule}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 底部按钮栏 */}
        <div
          style={{
            padding: '10px 20px',
            borderTop: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-layer2)',
            fontSize: '11px',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span>💡 替换净化与目录规则完全遵循开源阅读 3.0 标准，保障纯净排版</span>
          <button
            onClick={onClose}
            style={{
              padding: '4px 14px',
              borderRadius: '5px',
              border: 'none',
              backgroundColor: 'var(--accent)',
              color: '#ffffff',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
