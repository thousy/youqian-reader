import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'

export function WebdavModal({ isOpen, onClose }) {
  const { showToast, setBooks, setCategories, currentBook, setReadingProgress, setBookmarks, setAnnotations } = useStore()

  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [autoSync, setAutoSync] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState(null)

  const [isTesting, setIsTesting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // 打开弹窗时加载已有配置
  useEffect(() => {
    if (isOpen) {
      window.api?.webdavGetConfig?.().then((cfg) => {
        if (cfg) {
          setUrl(cfg.url || '')
          setUsername(cfg.username || '')
          setPassword(cfg.password || '')
          setAutoSync(!!cfg.autoSync)
          setLastSyncTime(cfg.lastSyncTime || null)
        }
      })
    }
  }, [isOpen])

  if (!isOpen) return null

  // 保存配置
  const handleSave = async (silent = false) => {
    const cfg = {
      url: url.trim(),
      username: username.trim(),
      password: password.trim(),
      autoSync
    }
    await window.api.webdavSaveConfig(cfg)
    if (!silent) {
      showToast('WebDAV 配置已保存', 'success')
    }
    return cfg
  }

  // 测试连接
  const handleTest = async () => {
    if (!url.trim()) {
      showToast('请输入 WebDAV 服务器地址', 'error')
      return
    }
    setIsTesting(true)
    try {
      const cfg = await handleSave(true)
      const res = await window.api.webdavTestConnection(cfg)
      if (res.success) {
        showToast('WebDAV 连接成功！/YouQianReader 目录已就绪', 'success')
      } else {
        showToast(`连接失败: ${res.error}`, 'error')
      }
    } catch (e) {
      showToast('测试连接异常: ' + e.message, 'error')
    } finally {
      setIsTesting(false)
    }
  }

  // 上传备份至云端
  const handleUpload = async () => {
    if (!url.trim()) {
      showToast('请先配置并保存 WebDAV 信息', 'error')
      return
    }
    setIsUploading(true)
    try {
      const cfg = await handleSave(true)
      const res = await window.api.webdavSyncUpload(cfg)
      if (res.success) {
        setLastSyncTime(res.uploadedAt)
        showToast('全量数据已成功上传同步至 WebDAV 云端', 'success')
      } else {
        showToast(`上传失败: ${res.error}`, 'error')
      }
    } catch (e) {
      showToast('上传同步异常: ' + e.message, 'error')
    } finally {
      setIsUploading(false)
    }
  }

  // 从云端下载合并
  const handleDownload = async () => {
    if (!url.trim()) {
      showToast('请先配置并保存 WebDAV 信息', 'error')
      return
    }
    setIsDownloading(true)
    try {
      const cfg = await handleSave(true)
      const res = await window.api.webdavSyncDownload(cfg)
      if (res.success) {
        setLastSyncTime(new Date().toISOString())
        // 刷新本地数据
        const allBooks = await window.api.getAllBooks()
        setBooks(allBooks)
        const cats = await window.api.getCategories()
        if (cats) setCategories(cats)

        if (currentBook) {
          const progress = await window.api.getReadingProgress(currentBook.id)
          const bookmarks = await window.api.getBookmarks(currentBook.id)
          const annotations = await window.api.getAnnotations(currentBook.id)
          if (progress) setReadingProgress(progress)
          if (bookmarks) setBookmarks(bookmarks)
          if (annotations) setAnnotations(annotations)
        }

        showToast('已成功从 WebDAV 下载并智能合并云端数据', 'success')
      } else {
        showToast(`恢复失败: ${res.error}`, 'error')
      }
    } catch (e) {
      showToast('下载恢复异常: ' + e.message, 'error')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      style={{
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={onClose}
    >
      <div
        className="modal"
        style={{
          width: '520px',
          maxWidth: 'calc(100vw - 32px)',
          backgroundColor: 'var(--bg-layer1)',
          border: '1px solid var(--border)',
          borderRadius: '14px',
          padding: '22px 24px',
          color: 'var(--text-primary)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题与关闭按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>☁️</span>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
              WebDAV 云端无感同步
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
              transition: 'var(--transition)'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 介绍与指南折叠 */}
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          支持坚果云、Nextcloud、群晖/自建 NAS，在多台电脑间无缝同步阅读进度、书签、划线笔记与分类。
          <span
            onClick={() => setShowHelp(!showHelp)}
            style={{ color: 'var(--accent)', cursor: 'pointer', marginLeft: '6px', textDecoration: 'underline' }}
          >
            {showHelp ? '收起配置指南' : '查看坚果云配置指南'}
          </span>
        </div>

        {showHelp && (
          <div
            style={{
              backgroundColor: 'var(--bg-hover)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '10px 14px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              lineHeight: 1.7
            }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>坚果云设置步骤：</strong><br />
            1. 登录坚果云官网 ➔ 账户信息 ➔ 安全选项 ➔ 第三方应用管理；<br />
            2. 点击「添加应用密码」，名称填写 <code style={{ color: 'var(--accent)', background: 'var(--bg-layer2)', padding: '1px 4px', borderRadius: '3px' }}>YouQianReader</code>；<br />
            3. 服务器地址填写：<code style={{ color: 'var(--accent)', background: 'var(--bg-layer2)', padding: '1px 4px', borderRadius: '3px' }}>https://dav.jianguoyun.com/dav/</code>；<br />
            4. 密码请填写生成的 16 位专门「应用密码」（非登录密码）。
          </div>
        )}

        {/* 表单输入区 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              服务器地址 (URL)
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="例如: https://dav.jianguoyun.com/dav/"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                backgroundColor: 'var(--bg-layer2)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '9px 12px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
                transition: 'var(--transition)'
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                账户 / 用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="坚果云注册邮箱或账号"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: 'var(--bg-layer2)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '9px 12px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  transition: 'var(--transition)'
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                应用密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="生成的应用专用密码"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: 'var(--bg-layer2)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '9px 12px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  transition: 'var(--transition)'
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
            </div>
          </div>

          {/* 自动同步开关 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            <input
              type="checkbox"
              id="webdav-auto-sync"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
              style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            <label htmlFor="webdav-auto-sync" style={{ fontSize: '12px', cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)' }}>
              启动时自动从云端拉取、阅读进度更新时定期自动静默备份
            </label>
          </div>
        </div>

        {/* 状态展示与连通性测试 */}
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px' }}>
          <span>
            {lastSyncTime ? `上次同步：${new Date(lastSyncTime).toLocaleString()}` : '尚未进行过云端同步'}
          </span>
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="btn btn-secondary"
            style={{
              padding: '4px 10px',
              fontSize: '12px',
              borderRadius: '6px',
              opacity: isTesting ? 0.6 : 1
            }}
          >
            {isTesting ? '正在测试...' : '🧪 测试连接'}
          </button>
        </div>

        {/* 底部按钮栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => handleSave(false)}
            className="btn btn-secondary"
            style={{ padding: '8px 16px', fontSize: '13px' }}
          >
            💾 保存配置
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="btn btn-secondary"
              style={{
                padding: '8px 14px',
                fontSize: '13px',
                color: 'var(--accent)',
                borderColor: 'var(--border)',
                opacity: isDownloading ? 0.6 : 1
              }}
            >
              {isDownloading ? '正在恢复...' : '⬇️ 从云端拉取'}
            </button>
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="btn btn-primary"
              style={{
                padding: '8px 18px',
                fontSize: '13px',
                opacity: isUploading ? 0.6 : 1
              }}
            >
              {isUploading ? '正在上传...' : '⬆️ 立即上传'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
