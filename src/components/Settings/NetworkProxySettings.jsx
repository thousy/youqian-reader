import React, { useState, useEffect } from 'react'

export function NetworkProxySettings({ showToast }) {
  const [mode, setMode] = useState('auto') // 'auto' | 'proxy' | 'direct'
  const [proxyUrl, setProxyUrl] = useState('http://127.0.0.1:1080')
  const [rules, setRules] = useState([
    '*.cool18.com',
    '*.99img.cc',
    '*.66img.cc',
    '*.githubusercontent.com'
  ])
  const [newRule, setNewRule] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 本地端口扫描与测试
  const [scanning, setScanning] = useState(false)
  const [detectedProxies, setDetectedProxies] = useState([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  // 加载初始配置
  const loadConfig = async () => {
    setLoading(true)
    try {
      if (window.api?.getProxyConfig) {
        const cfg = await window.api.getProxyConfig()
        if (cfg) {
          setMode(cfg.mode || 'auto')
          setProxyUrl(cfg.proxyUrl || 'http://127.0.0.1:1080')
          if (Array.isArray(cfg.rules) && cfg.rules.length > 0) {
            setRules(cfg.rules)
          }
        }
      }
    } catch (e) {
      console.error('加载代理设置失败:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  // 保存设置
  const handleSave = async (overrideMode = null, overrideRules = null, overrideUrl = null) => {
    setSaving(true)
    const payload = {
      mode: overrideMode || mode,
      proxyUrl: (overrideUrl !== null ? overrideUrl : proxyUrl).trim(),
      rules: overrideRules || rules
    }

    try {
      const res = await window.api?.saveProxyConfig?.(payload)
      if (res?.success) {
        showToast?.('代理分流配置已生效', 'success')
      } else {
        showToast?.('保存失败: ' + (res?.error || '未知错误'), 'error')
      }
    } catch (e) {
      showToast?.('保存出错: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // 模式切换
  const handleModeChange = (newMode) => {
    setMode(newMode)
    handleSave(newMode, rules, proxyUrl)
  }

  // 添加新规则
  const handleAddRule = (e) => {
    e?.preventDefault()
    const trimmed = newRule.trim().toLowerCase()
    if (!trimmed) return
    if (rules.includes(trimmed)) {
      showToast?.('该规则已存在', 'warning')
      return
    }
    const updated = [...rules, trimmed]
    setRules(updated)
    setNewRule('')
    handleSave(mode, updated, proxyUrl)
  }

  // 删除规则
  const handleDeleteRule = (targetRule) => {
    const updated = rules.filter(r => r !== targetRule)
    setRules(updated)
    handleSave(mode, updated, proxyUrl)
  }

  // 重置规则
  const handleResetDefaultRules = () => {
    const defaultRules = [
      '*.cool18.com',
      '*.99img.cc',
      '*.66img.cc',
      '*.githubusercontent.com',
      '*.googleapis.com',
      '*.google.com'
    ]
    setRules(defaultRules)
    handleSave(mode, defaultRules, proxyUrl)
    showToast?.('已恢复默认分流规则', 'info')
  }

  // 自动扫描本地代理端口
  const handleScanLocalProxies = async () => {
    setScanning(true)
    setDetectedProxies([])
    try {
      const list = await window.api?.detectLocalProxies?.()
      if (Array.isArray(list) && list.length > 0) {
        setDetectedProxies(list)
        showToast?.(`扫描到 ${list.length} 个本机开放代理端口！`, 'success')
      } else {
        setDetectedProxies([])
        showToast?.('未在常见端口探测到运行中的代理客户端', 'info')
      }
    } catch (e) {
      showToast?.('扫描本地代理失败: ' + e.message, 'error')
    } finally {
      setScanning(false)
    }
  }

  // 一键应用扫描到的端口
  const handleApplyDetected = (item) => {
    setProxyUrl(item.url)
    handleSave(mode, rules, item.url)
    showToast?.(`已套用代理服务器: ${item.url}`, 'success')
  }

  // 连通性测试
  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.api?.testProxyConnection?.('https://www.cool18.com', proxyUrl)
      setTestResult(res)
      if (res?.success) {
        showToast?.(`握手测试通过！延迟 ${res.latency}ms`, 'success')
      } else {
        showToast?.(`测试未通过: ${res?.error || '连接超时'}`, 'error')
      }
    } catch (e) {
      setTestResult({ success: false, error: e.message })
      showToast?.('测试异常: ' + e.message, 'error')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        正在读取网络代理配置...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
      {/* 1. 情景模式选择 (对标 Zero Omega) */}
      <div style={{
        background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
        padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚡</span> 情景模式 (Proxy Mode)
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            内置 Zero Omega 智能分流规则引擎
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {/* 模式 1: 智能分流 */}
          <div
            onClick={() => handleModeChange('auto')}
            style={{
              padding: '16px', borderRadius: '10px', cursor: 'pointer',
              border: mode === 'auto' ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: mode === 'auto' ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-layer2)',
              transition: 'all 0.2s', position: 'relative'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: mode === 'auto' ? 'var(--accent)' : 'var(--text-primary)' }}>
                🔀 智能分流 (推荐)
              </span>
              <span style={{
                fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                background: '#10b98120', color: '#10b981', fontWeight: 600
              }}>
                Auto Switch
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              仅海外站点与图床域名走代理，国内书源直连，兼顾速度与稳定性。
            </p>
          </div>

          {/* 模式 2: 全局代理 */}
          <div
            onClick={() => handleModeChange('proxy')}
            style={{
              padding: '16px', borderRadius: '10px', cursor: 'pointer',
              border: mode === 'proxy' ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: mode === 'proxy' ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-layer2)',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: mode === 'proxy' ? 'var(--accent)' : 'var(--text-primary)' }}>
                🌐 全局代理
              </span>
              <span style={{
                fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                background: '#3b82f620', color: '#3b82f6', fontWeight: 600
              }}>
                Proxy
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              所有网络请求强制经由指定代理通道，适用于直连受限极度严格的环境。
            </p>
          </div>

          {/* 模式 3: 直接连接 */}
          <div
            onClick={() => handleModeChange('direct')}
            style={{
              padding: '16px', borderRadius: '10px', cursor: 'pointer',
              border: mode === 'direct' ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: mode === 'direct' ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-layer2)',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: mode === 'direct' ? 'var(--accent)' : 'var(--text-primary)' }}>
                🚫 直接连接
              </span>
              <span style={{
                fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                background: '#9ca3af20', color: '#9ca3af', fontWeight: 600
              }}>
                Direct
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              不通过任何代理，所有请求均直连网络。海外站点可能会出现超时。
            </p>
          </div>
        </div>
      </div>

      {/* 2. 代理服务器配置 */}
      <div style={{
        background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
        padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🛠️</span> 代理服务器 (Proxy Server)
          </h3>
          <button
            onClick={handleScanLocalProxies}
            disabled={scanning}
            style={{
              padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--accent)',
              background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: '12px',
              display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500
            }}
          >
            {scanning ? '正在探测本机代理...' : '🔍 一键检测本机代理'}
          </button>
        </div>

        {/* 探测到的代理提示 */}
        {detectedProxies.length > 0 && (
          <div style={{
            background: 'rgba(16, 185, 129, 0.08)', border: '1px solid #10b98140',
            borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px'
          }}>
            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
              🎯 探测到以下正在运行的本机代理服务，点击可一键套用：
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {detectedProxies.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleApplyDetected(p)}
                  style={{
                    padding: '4px 10px', borderRadius: '6px', border: '1px solid #10b981',
                    background: proxyUrl === p.url ? '#10b981' : 'var(--bg-layer2)',
                    color: proxyUrl === p.url ? '#fff' : 'var(--text-primary)',
                    fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                  }}
                  title={p.desc}
                >
                  <span>⚡ 端口 {p.port}</span>
                  <span style={{ opacity: 0.75, fontSize: '11px' }}>({p.url})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="例如: http://127.0.0.1:1080 或 http://127.0.0.1:7890"
              style={{
                width: '100%', padding: '10px 14px', borderRadius: '8px',
                border: '1px solid var(--border)', background: 'var(--bg-layer2)',
                color: 'var(--text-primary)', fontSize: '13px', outline: 'none'
              }}
            />
          </div>
          <button
            onClick={handleTestConnection}
            disabled={testing || !proxyUrl}
            style={{
              padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border)',
              background: 'var(--bg-layer2)', color: 'var(--text-primary)', cursor: 'pointer',
              fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap'
            }}
          >
            {testing ? '测试中...' : '🔌 测试连通性'}
          </button>
          <button
            onClick={() => handleSave()}
            disabled={saving}
            style={{
              padding: '10px 20px', borderRadius: '8px', border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer',
              fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap'
            }}
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>

        {/* 测试结果提示 */}
        {testResult && (
          <div style={{
            padding: '10px 14px', borderRadius: '8px', fontSize: '12px',
            background: testResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${testResult.success ? '#10b981' : '#ef4444'}`,
            color: testResult.success ? '#10b981' : '#ef4444'
          }}>
            {testResult.success
              ? `✅ ${testResult.message}`
              : `❌ 连接失败: ${testResult.error || '连接超时，请确认代理软件是否正常开启'}`
            }
          </div>
        )}
      </div>

      {/* 3. 智能分流规则列表 (Auto Switch Rules) */}
      <div style={{
        background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
        padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📋</span> 分流规则列表 (Auto Switch Rules)
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              匹配以下域名的网络请求将自动走代理，其余网站保持直接连接（支持通配符如 *.cool18.com）
            </p>
          </div>
          <button
            onClick={handleResetDefaultRules}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px'
            }}
          >
            恢复默认规则
          </button>
        </div>

        {/* 添加新规则表单 */}
        <form onSubmit={handleAddRule} style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            placeholder="输入域名通配符 (例如: *.cool18.com 或 *.99img.cc)"
            style={{
              flex: 1, padding: '8px 12px', borderRadius: '6px',
              border: '1px solid var(--border)', background: 'var(--bg-layer2)',
              color: 'var(--text-primary)', fontSize: '13px', outline: 'none'
            }}
          />
          <button
            type="submit"
            style={{
              padding: '8px 16px', borderRadius: '6px', border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer',
              fontSize: '13px', fontWeight: 600
            }}
          >
            ➕ 添加规则
          </button>
        </form>

        {/* 规则条目列表 */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px',
          overflowY: 'auto', paddingRight: '4px'
        }}>
          {rules.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>
              暂无规则，建议点击上方“恢复默认规则”
            </div>
          ) : (
            rules.map((rule, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 14px', borderRadius: '6px', background: 'var(--bg-layer2)',
                  border: '1px solid var(--border)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    fontSize: '11px', padding: '2px 6px', borderRadius: '4px',
                    background: '#10b98120', color: '#10b981', fontWeight: 600
                  }}>
                    代理分流
                  </span>
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                    {rule}
                  </span>
                  {rule.includes('cool18') && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>（酷18禁忌书屋）</span>
                  )}
                  {(rule.includes('99img') || rule.includes('66img')) && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>（图片插图图床）</span>
                  )}
                </div>

                <button
                  onClick={() => handleDeleteRule(rule)}
                  style={{
                    background: 'transparent', border: 'none', color: '#f87171',
                    cursor: 'pointer', fontSize: '14px', padding: '2px 6px', borderRadius: '4px'
                  }}
                  title="删除该规则"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
