import React, { useState, useEffect } from 'react'

export function NetworkProxySettings({ showToast }) {
  const [mode, setMode] = useState('auto') // 'auto' | 'proxy' | 'direct'
  const [proxyUrl, setProxyUrl] = useState('http://127.0.0.1:1080')
  const [defaultProfile, setDefaultProfile] = useState('direct') // 'direct' | 'proxy'
  const [rules, setRules] = useState([
    { id: 'r1', pattern: '*.baidu.com', profile: 'direct' },
    { id: 'r2', pattern: '*.cool18.com', profile: 'proxy' },
    { id: 'r3', pattern: '*.xoimg.com', profile: 'proxy' },
    { id: 'r4', pattern: '2023.redircdn.com', profile: 'proxy' },
    { id: 'r5', pattern: '*.99img.cc', profile: 'proxy' },
    { id: 'r6', pattern: '*.66img.cc', profile: 'proxy' },
    { id: 'r7', pattern: '*.githubusercontent.com', profile: 'proxy' }
  ])

  // 规则列表设置 (gfwlist)
  const [ruleListEnabled, setRuleListEnabled] = useState(true)
  const [ruleListProfile, setRuleListProfile] = useState('proxy')
  const [ruleListFormat, setRuleListFormat] = useState('AutoProxy')
  const [ruleListUrl, setRuleListUrl] = useState('https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt')
  const [ruleListLastUpdated, setRuleListLastUpdated] = useState(null)
  const [ruleListCount, setRuleListCount] = useState(0)
  const [updatingRuleList, setUpdatingRuleList] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 本地端口扫描与测试
  const [scanning, setScanning] = useState(false)
  const [detectedProxies, setDetectedProxies] = useState([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  // 格式化时间
  const formatTime = (isoStr) => {
    if (!isoStr) return '尚未更新'
    try {
      const d = new Date(isoStr)
      return d.toLocaleString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      })
    } catch (_) {
      return isoStr
    }
  }

  // 加载初始配置
  const loadConfig = async () => {
    setLoading(true)
    try {
      if (window.api?.getProxyConfig) {
        const cfg = await window.api.getProxyConfig()
        if (cfg) {
          setMode(cfg.mode || 'auto')
          setProxyUrl(cfg.proxyUrl || 'http://127.0.0.1:1080')
          setDefaultProfile(cfg.defaultProfile || 'direct')
          if (Array.isArray(cfg.rules) && cfg.rules.length > 0) {
            setRules(cfg.rules)
          }
          if (cfg.ruleList) {
            setRuleListEnabled(cfg.ruleList.enabled ?? true)
            setRuleListProfile(cfg.ruleList.profile || 'proxy')
            setRuleListFormat(cfg.ruleList.format || 'AutoProxy')
            setRuleListUrl(cfg.ruleList.url || 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt')
            setRuleListLastUpdated(cfg.ruleList.lastUpdated || null)
            setRuleListCount(cfg.ruleList.ruleCount || 0)
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
  const handleSave = async (override = {}) => {
    setSaving(true)
    const payload = {
      mode: override.mode !== undefined ? override.mode : mode,
      proxyUrl: (override.proxyUrl !== undefined ? override.proxyUrl : proxyUrl).trim(),
      defaultProfile: override.defaultProfile !== undefined ? override.defaultProfile : defaultProfile,
      rules: override.rules !== undefined ? override.rules : rules,
      ruleList: {
        enabled: override.ruleListEnabled !== undefined ? override.ruleListEnabled : ruleListEnabled,
        profile: override.ruleListProfile !== undefined ? override.ruleListProfile : ruleListProfile,
        format: override.ruleListFormat !== undefined ? override.ruleListFormat : ruleListFormat,
        url: (override.ruleListUrl !== undefined ? override.ruleListUrl : ruleListUrl).trim(),
        lastUpdated: ruleListLastUpdated,
        ruleCount: ruleListCount
      }
    }

    try {
      const res = await window.api?.saveProxyConfig?.(payload)
      if (res?.success) {
        showToast?.('分流规则与情景配置已生效', 'success')
      } else {
        showToast?.('保存失败: ' + (res?.error || '未知错误'), 'error')
      }
    } catch (e) {
      showToast?.('保存出错: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // 1. 规则顺序上移
  const handleMoveUp = (index) => {
    if (index === 0) return
    const updated = [...rules]
    const temp = updated[index - 1]
    updated[index - 1] = updated[index]
    updated[index] = temp
    setRules(updated)
    handleSave({ rules: updated })
  }

  // 2. 规则顺序下移
  const handleMoveDown = (index) => {
    if (index >= rules.length - 1) return
    const updated = [...rules]
    const temp = updated[index + 1]
    updated[index + 1] = updated[index]
    updated[index] = temp
    setRules(updated)
    handleSave({ rules: updated })
  }

  // 3. 修改规则内容
  const handleRulePatternChange = (index, newPattern) => {
    const updated = [...rules]
    updated[index] = { ...updated[index], pattern: newPattern }
    setRules(updated)
  }

  // 4. 修改单条规则的情景模式 (proxy / direct)
  const handleRuleProfileChange = (index, newProfile) => {
    const updated = [...rules]
    updated[index] = { ...updated[index], profile: newProfile }
    setRules(updated)
    handleSave({ rules: updated })
  }

  // 5. 删除规则
  const handleDeleteRule = (index) => {
    const updated = rules.filter((_, idx) => idx !== index)
    setRules(updated)
    handleSave({ rules: updated })
  }

  // 6. 添加新条件规则
  const handleAddCondition = () => {
    const newRuleItem = {
      id: `r_${Date.now()}`,
      pattern: '',
      profile: 'proxy'
    }
    const updated = [...rules, newRuleItem]
    setRules(updated)
  }

  // 7. 在线更新规则列表 (gfwlist)
  const handleUpdateRuleListOnline = async () => {
    setUpdatingRuleList(true)
    try {
      const res = await window.api?.updateRuleList?.(ruleListUrl)
      if (res?.success) {
        setRuleListLastUpdated(res.lastUpdated)
        setRuleListCount(res.ruleCount)
        showToast?.(`规则列表更新成功！已加载 ${res.ruleCount} 条规则`, 'success')
      } else {
        showToast?.(res?.error || '更新规则列表失败，请确认网络或代理正常', 'error')
      }
    } catch (e) {
      showToast?.('更新异常: ' + e.message, 'error')
    } finally {
      setUpdatingRuleList(false)
    }
  }

  // 8. 自动扫描本地代理端口
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

  // 9. 一键应用扫描到的端口
  const handleApplyDetected = (item) => {
    setProxyUrl(item.url)
    handleSave({ proxyUrl: item.url })
    showToast?.(`已套用代理服务器: ${item.url}`, 'success')
  }

  // 10. 连通性测试
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
        正在读取 Zero Omega 分流与代理配置...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', paddingBottom: '30px' }}>
      
      {/* 顶部标题与情景模式选择 */}
      <div style={{
        background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
        padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              display: 'inline-block', width: '14px', height: '14px',
              borderRadius: '3px', background: mode === 'auto' ? '#10b981' : '#6366f1'
            }} />
            <h2 style={{ fontSize: '17px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
              情景模式：<span style={{ color: 'var(--accent)' }}>{mode === 'auto' ? 'auto switch' : mode}</span>
            </h2>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            规则自上而下匹配，支持移动排序与独立情景指定
          </span>
        </div>

        {/* 模式选择三按钮 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div
            onClick={() => { setMode('auto'); handleSave({ mode: 'auto' }) }}
            style={{
              padding: '12px 16px', borderRadius: '8px', cursor: 'pointer',
              border: mode === 'auto' ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: mode === 'auto' ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-layer2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: mode === 'auto' ? 'var(--accent)' : 'var(--text-primary)' }}>
                🔀 自动切换 (auto switch)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                按规则逐行匹配分流，优先走白名单与黑名单
              </div>
            </div>
            <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: '#10b98120', color: '#10b981', fontWeight: 600 }}>
              推荐
            </span>
          </div>

          <div
            onClick={() => { setMode('proxy'); handleSave({ mode: 'proxy' }) }}
            style={{
              padding: '12px 16px', borderRadius: '8px', cursor: 'pointer',
              border: mode === 'proxy' ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: mode === 'proxy' ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-layer2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: mode === 'proxy' ? 'var(--accent)' : 'var(--text-primary)' }}>
                🌐 全局代理 (proxy)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                所有请求强制经由本地代理通道
              </div>
            </div>
          </div>

          <div
            onClick={() => { setMode('direct'); handleSave({ mode: 'direct' }) }}
            style={{
              padding: '12px 16px', borderRadius: '8px', cursor: 'pointer',
              border: mode === 'direct' ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: mode === 'direct' ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-layer2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: mode === 'direct' ? 'var(--accent)' : 'var(--text-primary)' }}>
                🚫 直接连接 (direct)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                关闭代理，所有网络请求完全直连
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 核心分流规则列表 (Auto Switch 表格 - 完全对标截图) */}
      <div style={{
        background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
        overflow: 'hidden'
      }}>
        {/* 表格标题栏 */}
        <div style={{
          padding: '14px 20px', background: 'var(--bg-layer2)', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚡</span> 条件匹配规则 (逐条向上向下匹配)
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            点击 ↑ / ↓ 即可实时调整规则执行优先级
          </span>
        </div>

        {/* 规则条目行 */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rules.map((rule, idx) => (
            <div
              key={rule.id || idx}
              style={{
                display: 'grid', gridTemplateColumns: '70px 140px 1fr 140px 50px',
                alignItems: 'center', gap: '10px', padding: '10px 16px',
                borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-layer1)'
              }}
            >
              {/* 1. 上下移动排序按钮 */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => handleMoveUp(idx)}
                  disabled={idx === 0}
                  style={{
                    padding: '4px 7px', borderRadius: '4px', border: '1px solid var(--border)',
                    background: idx === 0 ? 'transparent' : 'var(--bg-layer2)',
                    color: idx === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: idx === 0 ? 'not-allowed' : 'pointer', fontSize: '11px'
                  }}
                  title="上移此规则 (提高优先级)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveDown(idx)}
                  disabled={idx === rules.length - 1}
                  style={{
                    padding: '4px 7px', borderRadius: '4px', border: '1px solid var(--border)',
                    background: idx === rules.length - 1 ? 'transparent' : 'var(--bg-layer2)',
                    color: idx === rules.length - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: idx === rules.length - 1 ? 'not-allowed' : 'pointer', fontSize: '11px'
                  }}
                  title="下移此规则 (降低优先级)"
                >
                  ↓
                </button>
              </div>

              {/* 2. 条件类型 */}
              <div>
                <select
                  disabled
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: '6px',
                    border: '1px solid var(--border)', background: 'var(--bg-layer2)',
                    color: 'var(--text-primary)', fontSize: '12px'
                  }}
                >
                  <option value="wildcard">域名通配符</option>
                </select>
              </div>

              {/* 3. 匹配模式/域名输入 */}
              <div>
                <input
                  type="text"
                  value={rule.pattern}
                  onChange={(e) => handleRulePatternChange(idx, e.target.value)}
                  onBlur={() => handleSave()}
                  placeholder="例如: *.cool18.com 或 *.baidu.com"
                  style={{
                    width: '100%', padding: '6px 10px', borderRadius: '6px',
                    border: '1px solid var(--border)', background: 'var(--bg-layer2)',
                    color: 'var(--text-primary)', fontSize: '13px', fontFamily: 'Consolas, monospace',
                    outline: 'none'
                  }}
                />
              </div>

              {/* 4. 情景模式下拉选择 (proxy / direct) */}
              <div>
                <select
                  value={rule.profile}
                  onChange={(e) => handleRuleProfileChange(idx, e.target.value)}
                  style={{
                    width: '100%', padding: '6px 10px', borderRadius: '6px',
                    border: rule.profile === 'proxy' ? '1px solid #3b82f6' : '1px solid var(--border)',
                    background: rule.profile === 'proxy' ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-layer2)',
                    color: rule.profile === 'proxy' ? '#3b82f6' : 'var(--text-primary)',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  <option value="proxy">🌐 proxy</option>
                  <option value="direct">⇄ [直接连接]</option>
                </select>
              </div>

              {/* 5. 删除操作 */}
              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => handleDeleteRule(idx)}
                  style={{
                    padding: '6px', borderRadius: '6px', border: 'none',
                    background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444',
                    cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                  }}
                  title="删除此规则"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}

          {/* + 添加条件 按钮行 */}
          <div style={{ padding: '12px 16px', background: 'var(--bg-layer1)', borderBottom: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={handleAddCondition}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: '1px dashed var(--accent)',
                background: 'transparent', color: 'var(--accent)', cursor: 'pointer',
                fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px'
              }}
            >
              <span>➕</span> 添加条件
            </button>
          </div>

          {/* 规则列表规则行 (对标截图) */}
          <div style={{
            display: 'grid', gridTemplateColumns: '220px 1fr 140px 50px',
            alignItems: 'center', gap: '10px', padding: '12px 16px',
            background: 'var(--bg-layer2)', borderBottom: '1px solid var(--border)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="chk-rule-list"
                checked={ruleListEnabled}
                onChange={(e) => {
                  setRuleListEnabled(e.target.checked)
                  handleSave({ ruleListEnabled: e.target.checked })
                }}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="chk-rule-list" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: 'var(--text-primary)' }}>
                ☑ 规则列表规则
              </label>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              (按照规则列表 gfwlist 匹配请求)
            </div>
            <div>
              <select
                value={ruleListProfile}
                onChange={(e) => {
                  setRuleListProfile(e.target.value)
                  handleSave({ ruleListProfile: e.target.value })
                }}
                style={{
                  width: '100%', padding: '6px 10px', borderRadius: '6px',
                  border: '1px solid #3b82f6', background: 'rgba(59, 130, 246, 0.1)',
                  color: '#3b82f6', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
                }}
              >
                <option value="proxy">🌐 proxy</option>
                <option value="direct">⇄ [直接连接]</option>
              </select>
            </div>
            <div />
          </div>

          {/* 默认情景模式行 (对标截图) */}
          <div style={{
            display: 'grid', gridTemplateColumns: '220px 1fr 140px 50px',
            alignItems: 'center', gap: '10px', padding: '12px 16px',
            background: 'var(--bg-layer1)'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              默认情景模式
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              (以上规则均未命中时的兜底处理)
            </div>
            <div>
              <select
                value={defaultProfile}
                onChange={(e) => {
                  setDefaultProfile(e.target.value)
                  handleSave({ defaultProfile: e.target.value })
                }}
                style={{
                  width: '100%', padding: '6px 10px', borderRadius: '6px',
                  border: '1px solid var(--border)', background: 'var(--bg-layer2)',
                  color: 'var(--text-primary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
                }}
              >
                <option value="direct">⇄ [直接连接]</option>
                <option value="proxy">🌐 proxy</option>
              </select>
            </div>
            <div />
          </div>
        </div>
      </div>

      {/* 规则列表设置 (完全对标截图下半部分) */}
      <div style={{
        background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
        padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
      }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
          规则列表设置
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>规则列表格式</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="ruleListFormat"
              value="Switchy"
              checked={ruleListFormat === 'Switchy'}
              onChange={() => setRuleListFormat('Switchy')}
            />
            <span>Switchy</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="ruleListFormat"
              value="AutoProxy"
              checked={ruleListFormat === 'AutoProxy'}
              onChange={() => setRuleListFormat('AutoProxy')}
            />
            <span>AutoProxy (gfwlist)</span>
          </label>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 500 }}>
            规则列表网址
          </label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={ruleListUrl}
              onChange={(e) => setRuleListUrl(e.target.value)}
              onBlur={() => handleSave()}
              placeholder="https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt"
              style={{
                flex: 1, padding: '8px 12px', borderRadius: '6px',
                border: '1px solid var(--border)', background: 'var(--bg-layer2)',
                color: 'var(--text-primary)', fontSize: '13px', outline: 'none'
              }}
            />
            <button
              type="button"
              onClick={() => {
                const def = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt'
                setRuleListUrl(def)
                handleSave({ ruleListUrl: def })
              }}
              style={{
                padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)',
                background: 'var(--bg-layer2)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px'
              }}
            >
              恢复默认
            </button>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '6px 0 0 0' }}>
            应用将从此网址下载规则列表。更新时将自动通过代理通道下载并解析 Base64 规则。
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={handleUpdateRuleListOnline}
            disabled={updatingRuleList}
            style={{
              padding: '8px 18px', borderRadius: '6px', border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer',
              fontSize: '13px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px'
            }}
          >
            <span>📥</span> {updatingRuleList ? '正在更新情景模式与规则库...' : '立即更新情景模式'}
          </button>
        </div>

        {/* 规则列表正文展示条 (对标截图中的绿色提示条) */}
        <div>
          <h4 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>
            规则列表正文
          </h4>
          <div style={{
            background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b98160',
            borderRadius: '6px', padding: '12px 16px', color: '#047857',
            fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            <span>🌱</span>
            <span>
              规则列表下载时间 {formatTime(ruleListLastUpdated)}（已加载 {ruleListCount.toLocaleString()} 条规则）
            </span>
          </div>
        </div>
      </div>

      {/* 代理服务器与端口配置卡片 */}
      <div style={{
        background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
        padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🛠️</span> 代理服务器 (Proxy Server)
          </h3>
          <button
            type="button"
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
                  type="button"
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
              onBlur={() => handleSave()}
              placeholder="例如: http://127.0.0.1:1080 或 http://127.0.0.1:7890"
              style={{
                width: '100%', padding: '10px 14px', borderRadius: '8px',
                border: '1px solid var(--border)', background: 'var(--bg-layer2)',
                color: 'var(--text-primary)', fontSize: '13px', outline: 'none'
              }}
            />
          </div>
          <button
            type="button"
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
            type="button"
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

    </div>
  )
}
