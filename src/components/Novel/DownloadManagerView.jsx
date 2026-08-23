import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'

const STATUS_COLOR = {
  running: '#60a5fa',
  packaging: '#a78bfa',
  done: '#4ade80',
  error: '#f87171',
  cancelled: '#9ca3af'
}

const STATUS_LABEL = {
  running: '正在下载',
  packaging: '正在打包',
  done: '下载完成',
  error: '下载失败',
  cancelled: '已取消'
}

export function DownloadManagerView() {
  const { showToast, showConfirm, setBooks, openBook } = useStore()

  // 顶部 Tab: 'tasks' (任务列表) 或 'settings' (下载配置)
  const [activeTab, setActiveTab] = useState('tasks')

  // 任务状态
  const [tasks, setTasks] = useState([])
  const [filter, setFilter] = useState('all') // 'all', 'running', 'done'

  // config.ini 下载配置状态
  const [config, setConfig] = useState({
    concurrency: 4,
    batchInterval: 500,
    timeout: 10,
    maxRetries: 3,
    outputFormat: 'EPUB',
    saveDir: '',
    autoImport: true,
    cleanAd: true,
    toSimplified: false,
    proxyEnabled: false,
    proxyType: 'http',
    proxyHost: '127.0.0.1',
    proxyPort: 7890,
    cfBypassUrl: ''
  })
  const [saving, setSaving] = useState(false)

  // 读取任务列表
  const fetchTasks = async () => {
    try {
      const list = await window.api.novelGetTasks?.()
      if (Array.isArray(list)) {
        setTasks(list)
      }
    } catch (e) {
      console.error('获取任务列表失败:', e)
    }
  }

  // 读取下载配置
  const fetchConfig = async () => {
    try {
      const cfg = await window.api.novelGetDownloadConfig?.()
      if (cfg) {
        setConfig(prev => ({ ...prev, ...cfg }))
      }
    } catch (e) {
      console.error('获取下载配置失败:', e)
    }
  }

  useEffect(() => {
    fetchTasks()
    fetchConfig()
    const interval = setInterval(fetchTasks, 1000)

    const onProgress = (data) => {
      setTasks(prev => {
        const idx = prev.findIndex(t => t.taskId === data.taskId)
        if (idx !== -1) {
          const updated = [...prev]
          updated[idx] = { ...updated[idx], ...data }
          return updated
        } else {
          return [...prev, data]
        }
      })
    }

    window.api.onDownloadProgress?.(onProgress)

    return () => {
      clearInterval(interval)
      window.api.offDownloadProgress?.(onProgress)
    }
  }, [])

  // 保存下载配置
  const handleSaveConfig = async () => {
    setSaving(true)
    try {
      const res = await window.api.novelSaveDownloadConfig?.(config)
      if (res?.success) {
        showToast('下载配置已成功保存并即时生效！', 'success')
      } else {
        showToast('保存失败: ' + (res?.error || '未知错误'), 'error')
      }
    } catch (e) {
      showToast('保存出错: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // 恢复默认配置
  const handleResetConfig = async () => {
    const ok = await showConfirm('恢复默认设置', '确定要将下载参数重置为原项目默认值吗？')
    if (!ok) return
    const defaultCfg = {
      concurrency: 4,
      batchInterval: 500,
      timeout: 10,
      maxRetries: 3,
      outputFormat: 'EPUB',
      saveDir: '',
      autoImport: true,
      cleanAd: true,
      toSimplified: false,
      proxyEnabled: false,
      proxyType: 'http',
      proxyHost: '127.0.0.1',
      proxyPort: 7890,
      cfBypassUrl: ''
    }
    setConfig(defaultCfg)
    await window.api.novelSaveDownloadConfig?.(defaultCfg)
    showToast('已恢复默认下载配置！', 'success')
  }

  // 选择下载保存目录
  const handleSelectDir = async () => {
    try {
      const dir = await window.api.novelSelectDownloadDir?.()
      if (dir) {
        setConfig(prev => ({ ...prev, saveDir: dir }))
      }
    } catch (e) {
      showToast('选择目录失败: ' + e.message, 'error')
    }
  }

  // 在文件夹中打开下载目录
  const handleOpenDir = async () => {
    try {
      await window.api.novelOpenDownloadDir?.(config.saveDir)
    } catch (e) {
      showToast('打开目录失败: ' + e.message, 'error')
    }
  }

  const handleCancel = async (taskId) => {
    try {
      await window.api.novelCancelDownload(taskId)
      showToast('已取消下载任务', 'info')
      fetchTasks()
    } catch (e) {
      showToast('取消失败: ' + e.message, 'error')
    }
  }

  const handleRead = async (task) => {
    if (!task.outputPath) return
    const allBooks = await window.api.getAllBooks()
    const target = allBooks.find(b => b.filePath === task.outputPath)
    if (target) {
      openBook(target)
    } else {
      const result = await window.api.novelImportAfterDownload(task.outputPath)
      if (result.success) {
        const updatedBooks = await window.api.getAllBooks()
        setBooks(updatedBooks)
        const newlyAdded = updatedBooks.find(b => b.filePath === task.outputPath)
        if (newlyAdded) openBook(newlyAdded)
      } else {
        showToast('找不到打开的书籍: ' + result.error, 'error')
      }
    }
  }

  const filteredTasks = tasks.filter(t => {
    if (filter === 'running') return t.status === 'running' || t.status === 'packaging'
    if (filter === 'done') return t.status === 'done'
    return true
  })

  return (
    <div className="download-manager-view" style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
      {/* 头部区 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '22px' }}>⬇️</span> 下载管理器
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 0 0' }}>
            监控下载任务、配置下载并发与爬虫防封参数 (原 config.ini 核心设置)
          </p>
        </div>

        {/* 顶部主 Tab 切换 */}
        <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-layer2)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <button
            onClick={() => setActiveTab('tasks')}
            style={{
              padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px',
              background: activeTab === 'tasks' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'tasks' ? '#fff' : 'var(--text-secondary)',
              fontWeight: activeTab === 'tasks' ? 600 : 400
            }}
          >
            📋 下载任务 ({tasks.length})
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px',
              background: activeTab === 'settings' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'settings' ? '#fff' : 'var(--text-secondary)',
              fontWeight: activeTab === 'settings' ? 600 : 400
            }}
          >
            ⚙️ 下载与爬取设置
          </button>
        </div>
      </div>

      {/* TAB 1: 任务列表 */}
      {activeTab === 'tasks' && (
        <div>
          {/* 筛选标签 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-layer1)', padding: '3px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
              <button
                onClick={() => setFilter('all')}
                style={{
                  padding: '4px 12px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '12px',
                  background: filter === 'all' ? 'var(--accent)' : 'transparent',
                  color: filter === 'all' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                全部 ({tasks.length})
              </button>
              <button
                onClick={() => setFilter('running')}
                style={{
                  padding: '4px 12px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '12px',
                  background: filter === 'running' ? 'var(--accent)' : 'transparent',
                  color: filter === 'running' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                进行中 ({tasks.filter(t => t.status === 'running' || t.status === 'packaging').length})
              </button>
              <button
                onClick={() => setFilter('done')}
                style={{
                  padding: '4px 12px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '12px',
                  background: filter === 'done' ? 'var(--accent)' : 'transparent',
                  color: filter === 'done' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                已完成 ({tasks.filter(t => t.status === 'done').length})
              </button>
            </div>
          </div>

          {/* 列表渲染 */}
          {filteredTasks.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '80px 0', color: 'var(--text-muted)'
            }}>
              <span style={{ fontSize: '48px', marginBottom: '16px' }}>📦</span>
              <p style={{ fontSize: '15px', margin: 0 }}>暂无下载任务</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '14px' }}>
              {filteredTasks.map(task => {
                const percent = task.total ? Math.round((task.progress / task.total) * 100) : 0
                return (
                  <div
                    key={task.taskId}
                    style={{
                      background: 'var(--bg-layer1)',
                      borderRadius: '12px',
                      border: '1px solid var(--border-subtle)',
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px'
                    }}
                  >
                    <div style={{
                      width: '44px', height: '44px', borderRadius: '10px',
                      background: `${STATUS_COLOR[task.status] || '#9ca3af'}20`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '20px', color: STATUS_COLOR[task.status] || '#9ca3af'
                    }}>
                      {task.status === 'done' ? '✓' : task.status === 'running' ? '⬇' : task.status === 'packaging' ? '📦' : '✕'}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>
                          《{task.novelTitle || '网络小说'}》
                        </span>
                        <span style={{
                          fontSize: '12px', padding: '2px 8px', borderRadius: '10px',
                          background: `${STATUS_COLOR[task.status] || '#9ca3af'}20`,
                          color: STATUS_COLOR[task.status] || '#9ca3af', fontWeight: 600
                        }}>
                          {STATUS_LABEL[task.status] || task.status}
                        </span>
                      </div>

                      {(task.status === 'running' || task.status === 'packaging') && (
                        <div>
                          <div style={{
                            height: '6px', background: 'var(--bg-layer2)', borderRadius: '3px',
                            overflow: 'hidden', margin: '8px 0 4px 0'
                          }}>
                            <div style={{
                              height: '100%', width: `${percent}%`,
                              background: 'var(--accent)', transition: 'width 0.3s'
                            }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
                            <span>已抓取 {task.progress} / {task.total} 章 ({percent}%)</span>
                            {task.status === 'packaging' && <span>{task.text || '正在打包中...'}</span>}
                          </div>
                        </div>
                      )}

                      {task.status === 'done' && (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          已保存：{task.outputPath}
                        </div>
                      )}

                      {task.status === 'error' && (
                        <div style={{ fontSize: '12px', color: '#f87171', marginTop: '4px' }}>
                          错误：{task.error || '下载失败'}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      {(task.status === 'running' || task.status === 'packaging') && (
                        <button
                          onClick={() => handleCancel(task.taskId)}
                          style={{
                            padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)',
                            background: 'var(--bg-layer2)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px'
                          }}
                        >
                          取消下载
                        </button>
                      )}

                      {task.status === 'done' && (
                        <button
                          onClick={() => handleRead(task)}
                          style={{
                            padding: '6px 14px', borderRadius: '6px', border: 'none',
                            background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600
                          }}
                        >
                          立即阅读
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: config.ini 下载设置 */}
      {activeTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 1. 并发与限速参数 */}
          <div style={{
            background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
            padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🚀</span> 1. 并发与限速控制 (concurrency & crawl)
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 500 }}>
                  并发下载线程数 ({config.concurrency} 线程)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <input
                    type="range"
                    min="1"
                    max="16"
                    value={config.concurrency}
                    onChange={e => setConfig({ ...config, concurrency: parseInt(e.target.value) || 1 })}
                    style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', color: 'var(--accent-light)', minWidth: '32px' }}>
                    {config.concurrency}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                  {[
                    { count: 2, label: '防封 2' },
                    { count: 4, label: '推荐 4' },
                    { count: 8, label: '极速 8' },
                    { count: 16, label: '狂飙 16' }
                  ].map(item => (
                    <button
                      key={item.count}
                      type="button"
                      onClick={() => setConfig({ ...config, concurrency: item.count })}
                      style={{
                        padding: '3px 8px', borderRadius: '4px',
                        border: `1px solid ${config.concurrency === item.count ? 'var(--accent)' : 'var(--border)'}`,
                        background: config.concurrency === item.count ? 'var(--accent)' : 'var(--bg-layer2)',
                        color: config.concurrency === item.count ? '#fff' : 'var(--text-secondary)',
                        cursor: 'pointer', fontSize: '11px', fontWeight: config.concurrency === item.count ? 600 : 400
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>建议设为 3~6 线程，过高可能触发部分小说站反爬封禁 IP</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 500 }}>
                  批次防封间隔时间 ({config.batchInterval} ms)
                </label>
                <input
                  type="number"
                  min="100"
                  max="5000"
                  step="100"
                  value={config.batchInterval}
                  onChange={e => setConfig({ ...config, batchInterval: parseInt(e.target.value) || 500 })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>每抓取一批章节后的休眠间隔，默认 500ms</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 500 }}>
                  单章请求超时时间 (秒)
                </label>
                <input
                  type="number"
                  min="3"
                  max="60"
                  value={config.timeout}
                  onChange={e => setConfig({ ...config, timeout: parseInt(e.target.value) || 10 })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 500 }}>
                  章节抓取失败重试次数
                </label>
                <input
                  type="number"
                  min="0"
                  max="5"
                  value={config.maxRetries}
                  onChange={e => setConfig({ ...config, maxRetries: parseInt(e.target.value) || 3 })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                />
              </div>
            </div>
          </div>

          {/* 2. 导出与格式化选项 */}
          <div style={{
            background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
            padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📚</span> 2. 电子书导出与正文处理 (ebook & format)
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 500 }}>
                  默认输出文件格式
                </label>
                <select
                  value={config.outputFormat}
                  onChange={e => setConfig({ ...config, outputFormat: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                >
                  <option value="EPUB">EPUB 格式 (标准电子书，含目录与封面)</option>
                  <option value="PDF">PDF 格式 (高清排版电子书，带目录与分页)</option>
                  <option value="TXT">TXT 纯文本格式</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={config.autoImport}
                    onChange={e => setConfig({ ...config, autoImport: e.target.checked })}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  下载完成后自动入库加入书架
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={config.cleanAd}
                    onChange={e => setConfig({ ...config, cleanAd: e.target.checked })}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  自动净化广告与引流网址 (clean-ad)
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={config.toSimplified}
                    onChange={e => setConfig({ ...config, toSimplified: e.target.checked })}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  繁体中文正文自动转换为简体中文 (to-simplified)
                </label>
              </div>
            </div>
          </div>

          {/* 3. 输出目录配置 */}
          <div style={{
            background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
            padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📁</span> 3. 小说下载存放目录 (save-dir)
            </h3>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                当前保存路径（留空则默认保存在软件本体目录下的“downloads”文件夹中，纯绿色便携）
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  placeholder="默认：软件本体 / downloads 目录"
                  value={config.saveDir}
                  onChange={e => setConfig({ ...config, saveDir: e.target.value })}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                />
                <button
                  onClick={handleSelectDir}
                  style={{
                    padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border)',
                    background: 'var(--bg-layer2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'
                  }}
                >
                  📂 浏览选择
                </button>
                <button
                  onClick={handleOpenDir}
                  style={{
                    padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border)',
                    background: 'var(--bg-layer2)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px'
                  }}
                >
                  在文件夹中打开
                </button>
              </div>
            </div>
          </div>

          {/* 4. 网络代理与 Cloudflare 穿透 */}
          <div style={{
            background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
            padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🌐</span> 4. 网络代理与 Cloudflare 穿透设置 (proxy & bypass)
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', marginBottom: '10px' }}>
                  <input
                    type="checkbox"
                    checked={config.proxyEnabled}
                    onChange={e => setConfig({ ...config, proxyEnabled: e.target.checked })}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  启用自定义网络代理 (针对海外源与限速节点)
                </label>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <select
                    value={config.proxyType}
                    disabled={!config.proxyEnabled}
                    onChange={e => setConfig({ ...config, proxyType: e.target.value })}
                    style={{ width: '100px', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                  >
                    <option value="http">HTTP</option>
                    <option value="socks5">SOCKS5</option>
                  </select>

                  <input
                    type="text"
                    placeholder="127.0.0.1"
                    disabled={!config.proxyEnabled}
                    value={config.proxyHost}
                    onChange={e => setConfig({ ...config, proxyHost: e.target.value })}
                    style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                  />

                  <input
                    type="number"
                    placeholder="7890"
                    disabled={!config.proxyEnabled}
                    value={config.proxyPort}
                    onChange={e => setConfig({ ...config, proxyPort: parseInt(e.target.value) || 7890 })}
                    style={{ width: '90px', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 500 }}>
                  Cloudflare 绕过服务地址 (cf-bypass)
                </label>
                <input
                  type="text"
                  placeholder="http://127.0.0.1:8000 (可选)"
                  value={config.cfBypassUrl}
                  onChange={e => setConfig({ ...config, cfBypassUrl: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>若部署了 FlareSolverr 等绕盾服务，可填入此地址</span>
              </div>
            </div>
          </div>

          {/* 底部保存按钮 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
            <button
              onClick={handleResetConfig}
              style={{
                padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--border)',
                background: 'var(--bg-layer1)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px'
              }}
            >
              🔄 恢复默认设置
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={saving}
              style={{
                padding: '10px 24px', borderRadius: '8px', border: 'none',
                background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '14px'
              }}
            >
              {saving ? '正在保存...' : '💾 保存下载配置'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
