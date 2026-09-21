import React, { useState, useEffect, useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { registerSingleCustomFont } from '../../utils/fontLoader'

export function GlobalSettingsModal({ isOpen, onClose }) {
  const {
    settings, updateSettings, showToast, showConfirm,
    setBooks, setCategories, currentBook, setReadingProgress, setBookmarks, setAnnotations
  } = useStore()

  // 导航分类: 'rules' | 'webdav' | 'backup' | 'appearance' | 'about'
  const [currentTab, setCurrentTab] = useState('rules')

  // ==========================================
  // 1. 书源与净化规则模块状态
  // ==========================================
  const [ruleSubTab, setRuleSubTab] = useState('sources') // 'sources' | 'replace' | 'txtToc'
  const [replaceRules, setReplaceRules] = useState([])
  const [replaceLoading, setReplaceLoading] = useState(false)
  const [replaceSearch, setReplaceSearch] = useState('')
  const [ruleDisplayLimit, setRuleDisplayLimit] = useState(60)

  // 书源模块状态 (阅读 3.0 Legado 规则引擎)
  const [sourcesList, setSourcesList] = useState([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesSearch, setSourcesSearch] = useState('')
  const [testingSourceId, setTestingSourceId] = useState(null)
  const [showImportSourceModal, setShowImportSourceModal] = useState(false)
  const [sourceImportMode, setSourceImportMode] = useState('url') // 'url' | 'paste' | 'file'
  const [sourceImportUrl, setSourceImportUrl] = useState('')
  const [sourceImportPasteText, setSourceImportPasteText] = useState('')
  const [sourceImporting, setSourceImporting] = useState(false)
  const [sourceImportResult, setSourceImportResult] = useState(null)

  // 新增/导入弹层状态
  const [showAddModal, setShowAddModal] = useState(false)
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

  // ==========================================
  // 2. WebDAV 模块状态
  // ==========================================
  const [webdavUrl, setWebdavUrl] = useState('')
  const [webdavUser, setWebdavUser] = useState('')
  const [webdavPass, setWebdavPass] = useState('')
  const [webdavAutoSync, setWebdavAutoSync] = useState(false)
  const [webdavLastSync, setWebdavLastSync] = useState(null)
  const [webdavTesting, setWebdavTesting] = useState(false)
  const [webdavSyncing, setWebdavSyncing] = useState(false)

  // ==========================================
  // 3. 外观与字体模块状态
  // ==========================================
  const [customFonts, setCustomFonts] = useState([])
  const [importingFont, setImportingFont] = useState(false)

  // ==========================================
  // 4. 关于与更新
  // ==========================================
  const [appVersion, setAppVersion] = useState('2.1.3')

  // 数据加载
  const loadSourcesData = async () => {
    setSourcesLoading(true)
    try {
      if (window.api?.novelGetSourcesDetail) {
        const list = await window.api.novelGetSourcesDetail()
        setSourcesList(Array.isArray(list) ? list : [])
      }
    } catch (e) {
      console.error('加载书源失败:', e)
    } finally {
      setSourcesLoading(false)
    }
  }

  const loadRulesData = async () => {
    loadSourcesData()

    setReplaceLoading(true)
    try {
      if (window.api?.novelGetReplaceRules) {
        const rules = await window.api.novelGetReplaceRules()
        setReplaceRules(Array.isArray(rules) ? rules : [])
      }
    } catch (_) {}
    finally { setReplaceLoading(false) }

    setTxtTocLoading(true)
    try {
      if (window.api?.novelGetTxtTocRules) {
        const tocs = await window.api.novelGetTxtTocRules()
        setTxtTocRules(Array.isArray(tocs) ? tocs : [])
      }
    } catch (_) {}
    finally { setTxtTocLoading(false) }
  }

  const loadWebdavData = async () => {
    try {
      const cfg = await window.api?.webdavGetConfig?.()
      if (cfg) {
        setWebdavUrl(cfg.url || '')
        setWebdavUser(cfg.username || '')
        setWebdavPass(cfg.password || '')
        setWebdavAutoSync(!!cfg.autoSync)
        setWebdavLastSync(cfg.lastSyncTime || null)
      }
    } catch (_) {}
  }

  const loadFontsData = async () => {
    try {
      if (window.api?.customFontGetList) {
        const list = await window.api.customFontGetList()
        setCustomFonts(list || [])
      }
    } catch (_) {}
  }

  useEffect(() => {
    if (isOpen) {
      loadRulesData()
      loadWebdavData()
      loadFontsData()
      window.api?.getAppVersion?.().then(v => { if (v) setAppVersion(v) })
    }
  }, [isOpen])

  // 过滤书源列表
  const filteredSources = useMemo(() => {
    if (!sourcesSearch.trim()) return sourcesList
    const kw = sourcesSearch.trim().toLowerCase()
    return sourcesList.filter(s =>
      (s.name && s.name.toLowerCase().includes(kw)) ||
      (s.url && s.url.toLowerCase().includes(kw)) ||
      (s.id && s.id.toLowerCase().includes(kw))
    )
  }, [sourcesList, sourcesSearch])

  const sourcesEnabledCount = useMemo(() => {
    return sourcesList.filter(s => s.enabled !== false).length
  }, [sourcesList])

  // 搜索过滤替换规则
  const filteredReplaceRules = useMemo(() => {
    if (!replaceSearch.trim()) return replaceRules
    const kw = replaceSearch.trim().toLowerCase()
    return replaceRules.filter(r =>
      (r.name && r.name.toLowerCase().includes(kw)) ||
      (r.pattern && r.pattern.toLowerCase().includes(kw)) ||
      (r.scope && r.scope.toLowerCase().includes(kw))
    )
  }, [replaceRules, replaceSearch])

  const visibleReplaceRules = useMemo(() => {
    return filteredReplaceRules.slice(0, ruleDisplayLimit)
  }, [filteredReplaceRules, ruleDisplayLimit])

  // 统计计数
  const replaceEnabledCount = useMemo(() => {
    return replaceRules.filter(r => r.isEnabled !== false).length
  }, [replaceRules])

  const txtTocEnabledCount = useMemo(() => {
    return txtTocRules.filter(r => r.enable !== false).length
  }, [txtTocRules])

  if (!isOpen) return null

  // ----------------- 书源操作 (阅读 3.0) -----------------
  const handleToggleSource = async (id, enabled) => {
    try {
      const res = await window.api?.novelToggleSource?.(id, enabled)
      if (res?.success) {
        setSourcesList(prev => prev.map(s => s.id === id ? { ...s, enabled } : s))
        showToast(`书源已${enabled ? '启用' : '停用'}`, 'info')
      }
    } catch (e) {
      showToast('切换失败: ' + e.message, 'error')
    }
  }

  const handleDeleteSource = async (src) => {
    const ok = await showConfirm('删除书源', `确定要删除书源「${src.name}」吗？\n删除后全网搜书和换源将不再包含此书源。`)
    if (!ok) return
    try {
      const res = await window.api?.novelDeleteSource?.(src.id)
      if (res?.success) {
        showToast(`已删除书源「${src.name}」`, 'success')
        await loadSourcesData()
      } else {
        showToast('删除失败: ' + (res?.error || '未知错误'), 'error')
      }
    } catch (e) {
      showToast('删除失败: ' + e.message, 'error')
    }
  }

  const handleTestSource = async (src) => {
    setTestingSourceId(src.id)
    try {
      const res = await window.api?.novelTestSingleSource?.(src.id, '剑来')
      if (res?.success) {
        showToast(`✓ 书源「${src.name}」连通正常！耗时 ${res.duration || 0}ms，搜索到 ${res.count || 0} 条书籍`, 'success')
      } else {
        showToast(`书源测试失败: ${res?.error || '站点超时或规则失效'}`, 'error')
      }
    } catch (e) {
      showToast('测试出错: ' + e.message, 'error')
    } finally {
      setTestingSourceId(null)
    }
  }

  const handleResetDefaultSources = async () => {
    const ok = await showConfirm('恢复默认书源', '确定重置为系统预置的精选书源吗？\n这将补齐缺失的默认高质量源。')
    if (!ok) return
    try {
      await window.api?.novelResetDefaultSources?.()
      showToast('已成功恢复预置书源', 'success')
      await loadSourcesData()
    } catch (e) {
      showToast('重置出错: ' + e.message, 'error')
    }
  }

  const handleExportSources = async () => {
    try {
      const res = await window.api?.novelExportSourcesJson?.()
      if (res?.success) {
        showToast(`已成功导出书源文件至: ${res.filePath}`, 'success')
      } else if (!res?.canceled) {
        showToast('导出失败: ' + (res?.error || '未知错误'), 'error')
      }
    } catch (e) {
      showToast('导出出错: ' + e.message, 'error')
    }
  }

  const handleImportSourceUrlSubmit = async () => {
    if (!sourceImportUrl.trim()) {
      showToast('请输入有效的书源订阅 URL 地址', 'warning')
      return
    }
    setSourceImporting(true)
    setSourceImportResult(null)
    try {
      const res = await window.api?.novelImportSourceFromUrl?.(sourceImportUrl.trim())
      if (res?.success) {
        setSourceImportResult({ success: true, message: `🎉 成功导入 ${res.count} 个书源！已入库并立即生效。` })
        showToast(`成功导入 ${res.count} 个书源！`, 'success')
        await loadSourcesData()
        setTimeout(() => {
          setShowImportSourceModal(false)
          setSourceImportUrl('')
          setSourceImportResult(null)
        }, 1200)
      } else {
        setSourceImportResult({ success: false, message: `导入失败: ${res?.error || '无法解析此书源地址'}` })
      }
    } catch (e) {
      setSourceImportResult({ success: false, message: `网络请求异常: ${e.message}` })
    } finally {
      setSourceImporting(false)
    }
  }

  const handleImportSourceFileSubmit = async () => {
    try {
      const res = await window.api?.novelImportSource?.()
      if (res?.canceled) return
      if (res?.success) {
        showToast(`🎉 成功导入 ${res.count} 个书源！`, 'success')
        await loadSourcesData()
        setShowImportSourceModal(false)
      } else {
        showToast('导入失败: ' + (res?.error || '解析文件失败'), 'error')
      }
    } catch (e) {
      showToast('导入出错: ' + e.message, 'error')
    }
  }

  const handleImportSourcePasteSubmit = async () => {
    if (!sourceImportPasteText.trim()) {
      showToast('请粘贴书源 JSON 规则内容', 'warning')
      return
    }
    setSourceImporting(true)
    setSourceImportResult(null)
    try {
      const res = await window.api?.novelImportCustomSource?.(sourceImportPasteText.trim())
      if (res?.success) {
        setSourceImportResult({ success: true, message: `🎉 成功解析并导入 ${res.count} 个书源！` })
        showToast(`成功导入 ${res.count} 个书源！`, 'success')
        await loadSourcesData()
        setTimeout(() => {
          setShowImportSourceModal(false)
          setSourceImportPasteText('')
          setSourceImportResult(null)
        }, 1200)
      } else {
        setSourceImportResult({ success: false, message: `解析失败: ${res?.error || '格式不符合阅读 3.0 标准'}` })
      }
    } catch (e) {
      setSourceImportResult({ success: false, message: `JSON 解析异常: ${e.message}` })
    } finally {
      setSourceImporting(false)
    }
  }

  // ----------------- 替换规则操作 -----------------
  const handleToggleReplace = async (id, currentEnabled) => {
    try {
      await window.api.novelToggleReplaceRule(id, !currentEnabled)
      setReplaceRules(prev => prev.map(r => r.id === id ? { ...r, isEnabled: !currentEnabled } : r))
    } catch (e) {
      showToast('切换失败: ' + e.message, 'error')
    }
  }

  const handleDeleteReplace = async (id, name) => {
    const ok = await showConfirm('删除净化规则', `确定删除规则「${name || '自定义规则'}」吗？`)
    if (!ok) return
    try {
      await window.api.novelDeleteReplaceRule(id)
      setReplaceRules(prev => prev.filter(r => r.id !== id))
      showToast('已删除规则', 'success')
    } catch (e) {
      showToast('删除失败: ' + e.message, 'error')
    }
  }

  const handleAddRuleSubmit = async (e) => {
    e.preventDefault()
    if (!newPattern.trim()) {
      showToast('请填写匹配正则或关键词！', 'warning')
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
      await loadRulesData()
      setShowAddModal(false)
      setNewName('')
      setNewPattern('')
      setNewReplacement('')
      setNewScope('')
      showToast('添加规则成功！', 'success')
    } catch (err) {
      showToast('添加失败: ' + err.message, 'error')
    }
  }

  const handleImportSubmit = async () => {
    if (!importJsonText.trim()) return
    setImportError('')
    try {
      const res = await window.api.novelImportReplaceRules(importJsonText)
      if (res.success) {
        showToast(`🎉 成功导入 ${res.count} 条阅读 3.0 替换规则！`, 'success')
        setShowImportModal(false)
        setImportJsonText('')
        await loadRulesData()
      } else {
        setImportError(res.error || '导入失败')
      }
    } catch (err) {
      setImportError('JSON 解析错误: ' + err.message)
    }
  }

  // ----------------- TXT 目录规则操作 -----------------
  const handleToggleTxtToc = async (idx) => {
    const updated = [...txtTocRules]
    updated[idx] = { ...updated[idx], enable: !updated[idx].enable }
    setTxtTocRules(updated)
    try {
      await window.api.novelSaveTxtTocRules(updated)
    } catch (e) {
      showToast('保存目录规则失败: ' + e.message, 'error')
    }
  }

  // ----------------- WebDAV 操作 -----------------
  const handleSaveWebdav = async (silent = false) => {
    const cfg = {
      url: webdavUrl.trim(),
      username: webdavUser.trim(),
      password: webdavPass.trim(),
      autoSync: webdavAutoSync
    }
    await window.api?.webdavSaveConfig?.(cfg)
    if (!silent) showToast('WebDAV 配置已保存', 'success')
    return cfg
  }

  const handleTestWebdav = async () => {
    setWebdavTesting(true)
    try {
      const cfg = await handleSaveWebdav(true)
      const res = await window.api?.webdavTestConnection?.(cfg)
      if (res?.success) {
        showToast('✓ WebDAV 服务器连接成功！', 'success')
      } else {
        showToast(`连接失败: ${res?.error || '网络超时'}`, 'error')
      }
    } catch (e) {
      showToast('测试出错: ' + e.message, 'error')
    } finally {
      setWebdavTesting(false)
    }
  }

  const handleSyncUpload = async () => {
    setWebdavSyncing(true)
    try {
      const cfg = await handleSaveWebdav(true)
      const res = await window.api?.webdavSyncUpload?.(cfg)
      if (res?.success) {
        const now = new Date().toISOString()
        setWebdavLastSync(now)
        showToast('✓ 已成功将书架数据与阅读进度上传备份至 WebDAV', 'success')
      } else {
        showToast(`备份失败: ${res?.error}`, 'error')
      }
    } catch (e) {
      showToast('上传出错: ' + e.message, 'error')
    } finally {
      setWebdavSyncing(false)
    }
  }

  const handleSyncDownload = async () => {
    const ok = await showConfirm(
      '云端同步恢复',
      '确定从 WebDAV 下载并智能合并云端书架与阅读进度吗？'
    )
    if (!ok) return
    setWebdavSyncing(true)
    try {
      const cfg = await handleSaveWebdav(true)
      const res = await window.api?.webdavSyncDownload?.(cfg)
      if (res?.success) {
        setWebdavLastSync(new Date().toISOString())
        const allBooks = await window.api?.getAllBooks?.()
        if (allBooks) setBooks(allBooks)
        const cats = await window.api?.getCategories?.()
        if (cats) setCategories(cats)

        if (currentBook) {
          const progress = await window.api.getReadingProgress(currentBook.id)
          const bookmarks = await window.api.getBookmarks(currentBook.id)
          const annotations = await window.api.getAnnotations(currentBook.id)
          if (progress) setReadingProgress(progress)
          if (bookmarks) setBookmarks(bookmarks)
          if (annotations) setAnnotations(annotations)
        }
        showToast('✓ 已成功从 WebDAV 下载并智能合并云端数据', 'success')
      } else {
        showToast(`恢复失败: ${res?.error}`, 'error')
      }
    } catch (e) {
      showToast('下载出错: ' + e.message, 'error')
    } finally {
      setWebdavSyncing(false)
    }
  }

  // ----------------- 备份与恢复 -----------------
  const handleExportBackup = async () => {
    try {
      const result = await window.api?.exportBackup?.()
      if (result?.success) {
        showToast('🎉 数据备份文件导出成功！', 'success')
      } else if (result?.error && result.error !== '用户取消了保存') {
        showToast('备份导出失败: ' + result.error, 'error')
      }
    } catch (e) {
      showToast('备份出错: ' + e.message, 'error')
    }
  }

  const handleImportBackup = async () => {
    try {
      const result = await window.api?.importBackup?.()
      if (result?.success) {
        const books = await window.api.getAllBooks()
        setBooks(books)
        const categories = await window.api.getCategories()
        setCategories(categories)
        const s = await window.api.getSettings()
        updateSettings(s)
        showToast('🎉 数据已成功恢复！', 'success')
      } else if (result?.error && result.error !== '用户取消了选择') {
        showToast('恢复失败: ' + result.error, 'error')
      }
    } catch (e) {
      showToast('导入出错: ' + e.message, 'error')
    }
  }

  const handleResetDatabase = async () => {
    const action = await showConfirm(
      '一键还原初始状态',
      '警告：确定要还原初始状态吗？此操作将清空所有书籍、分类、阅读进度和书签数据，且不可逆！\n\n建议您在还原前备份当前配置。',
      {
        buttons: [
          { label: '备份并还原', value: 'backup-and-reset', className: 'btn btn-primary' },
          { label: '直接还原', value: 'reset-only', className: 'btn btn-danger' },
          { label: '取消', value: 'cancel', className: 'btn btn-secondary' }
        ]
      }
    )
    if (!action || action === 'cancel') return

    const performReset = async () => {
      try {
        const result = await window.api.resetDatabase()
        if (result.success) {
          setBooks([])
          setCategories([])
          const defaultSettings = await window.api.getSettings()
          updateSettings(defaultSettings)
          showToast('已还原为初始状态', 'success')
        }
      } catch (e) {
        showToast('还原失败: ' + e.message, 'error')
      }
    }

    if (action === 'backup-and-reset') {
      try {
        const result = await window.api.exportBackup()
        if (result.success) {
          showToast('备份导出成功，正在还原...', 'success')
          await performReset()
        }
      } catch (_) {}
    } else if (action === 'reset-only') {
      await performReset()
    }
  }

  // ----------------- 字体管理 -----------------
  const handleImportFont = async () => {
    if (importingFont) return
    setImportingFont(true)
    try {
      const res = await window.api?.customFontImport?.()
      if (res?.success) {
        showToast(`🎉 成功导入 ${res.count} 个自定义字体！`, 'success')
        if (Array.isArray(res.fonts)) {
          for (const f of res.fonts) {
            await registerSingleCustomFont(f)
          }
          setCustomFonts(res.fonts)
        }
      } else if (!res?.canceled && res?.error) {
        showToast('导入字体失败: ' + res.error, 'error')
      }
    } catch (err) {
      showToast('导入出错: ' + err.message, 'error')
    } finally {
      setImportingFont(false)
    }
  }

  const handleDeleteFont = async (font) => {
    const ok = await showConfirm('删除自定义字体', `确定删除字体「${font.name}」吗？`)
    if (!ok) return
    try {
      const res = await window.api?.customFontDelete?.(font.fileName)
      if (res?.success) {
        showToast(`已删除字体「${font.name}」`, 'success')
        setCustomFonts(res.fonts || [])
        if (settings.fontFamily === font.name) {
          updateSettings({ fontFamily: 'Noto Serif SC' })
        }
      }
    } catch (e) {
      showToast('删除字体出错: ' + e.message, 'error')
    }
  }

  return (
    <div className="global-settings-overlay" onClick={onClose}>
      <div className="global-settings-window" onClick={e => e.stopPropagation()}>
        {/* 左侧导航栏 */}
        <div className="global-settings-sidebar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px 20px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '20px' }}>⚙️</span>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)' }}>全局设置</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>系统级配置与管理中心</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '16px', flex: 1 }}>
            <button
              className={`global-settings-nav-btn ${currentTab === 'rules' ? 'active' : ''}`}
              onClick={() => setCurrentTab('rules')}
            >
              <span style={{ fontSize: '16px' }}>📚</span>
              <span>书源与净化规则</span>
            </button>

            <button
              className={`global-settings-nav-btn ${currentTab === 'webdav' ? 'active' : ''}`}
              onClick={() => setCurrentTab('webdav')}
            >
              <span style={{ fontSize: '16px' }}>☁️</span>
              <span>云端同步 (WebDAV)</span>
            </button>

            <button
              className={`global-settings-nav-btn ${currentTab === 'backup' ? 'active' : ''}`}
              onClick={() => setCurrentTab('backup')}
            >
              <span style={{ fontSize: '16px' }}>💾</span>
              <span>数据备份与维护</span>
            </button>

            <button
              className={`global-settings-nav-btn ${currentTab === 'appearance' ? 'active' : ''}`}
              onClick={() => setCurrentTab('appearance')}
            >
              <span style={{ fontSize: '16px' }}>🎨</span>
              <span>外观与字体库</span>
            </button>

            <button
              className={`global-settings-nav-btn ${currentTab === 'about' ? 'active' : ''}`}
              onClick={() => setCurrentTab('about')}
            >
              <span style={{ fontSize: '16px' }}>ℹ️</span>
              <span>关于软件</span>
            </button>
          </div>

          {/* 底部版本 */}
          <div style={{ padding: '12px 8px 0', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center' }}>
            YouQian Reader v{appVersion}
          </div>
        </div>

        {/* 右侧主工作区 */}
        <div className="global-settings-main">
          {/* 头部标题与关闭 */}
          <div className="global-settings-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '16px', fontWeight: 600 }}>
                {currentTab === 'rules' && '📚 书源与净化规则管理'}
                {currentTab === 'webdav' && '☁️ WebDAV 多端云同步'}
                {currentTab === 'backup' && '💾 数据备份、恢复与重置'}
                {currentTab === 'appearance' && '🎨 外观主题与系统字体库'}
                {currentTab === 'about' && 'ℹ️ 关于 YouQian Reader'}
              </span>
              {currentTab === 'rules' && (
                <span className="global-settings-badge badge-cyan">
                  阅读 3.0 (Legado) 规则体系兼容
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '6px'
              }}
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>

          {/* 内容区 */}
          <div className="global-settings-content-body">
            {/* =========================================================
                TAB 1: 书源与净化规则 (高颜值、现代化卡片排版)
               ========================================================= */}
            {currentTab === 'rules' && (
              <div>
                {/* 概览统计面板卡片 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '20px' }}>
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(6, 182, 212, 0.04))',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      borderRadius: '12px',
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px'
                    }}
                  >
                    <div style={{ fontSize: '28px', background: 'rgba(16, 185, 129, 0.15)', padding: '10px', borderRadius: '10px' }}>
                      🌐
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '2px' }}>阅读 3.0 在线网络书源</div>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                        已载入 {sourcesList.length} 个
                        <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#34d399', marginLeft: '6px' }}>
                          (已启用 {sourcesEnabledCount} 个)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08), rgba(99, 102, 241, 0.04))',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      borderRadius: '12px',
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px'
                    }}
                  >
                    <div style={{ fontSize: '28px', background: 'rgba(56, 189, 248, 0.15)', padding: '10px', borderRadius: '10px' }}>
                      🧹
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '2px' }}>正文广告净化替换规则</div>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                        已载入 {replaceRules.length.toLocaleString()} 条
                        <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--accent-light)', marginLeft: '6px' }}>
                          (已启用 {replaceEnabledCount.toLocaleString()} 条)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(236, 72, 153, 0.04))',
                      border: '1px solid rgba(168, 85, 247, 0.25)',
                      borderRadius: '12px',
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px'
                    }}
                  >
                    <div style={{ fontSize: '28px', background: 'rgba(168, 85, 247, 0.15)', padding: '10px', borderRadius: '10px' }}>
                      📑
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '2px' }}>TXT 智能目录分章规则</div>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                        精选 {txtTocRules.length} 条
                        <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#c084fc', marginLeft: '6px' }}>
                          (已启用 {txtTocEnabledCount} 条)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 二级药丸选项卡 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setRuleSubTab('sources')}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '20px',
                        border: ruleSubTab === 'sources' ? '1px solid #10b981' : '1px solid var(--border-subtle)',
                        background: ruleSubTab === 'sources' ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-layer2)',
                        color: ruleSubTab === 'sources' ? '#34d399' : 'var(--text-secondary)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      🌐 在线书源管理 ({filteredSources.length})
                    </button>
                    <button
                      onClick={() => setRuleSubTab('replace')}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '20px',
                        border: ruleSubTab === 'replace' ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                        background: ruleSubTab === 'replace' ? 'var(--accent-glow)' : 'var(--bg-layer2)',
                        color: ruleSubTab === 'replace' ? 'var(--accent-light)' : 'var(--text-secondary)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      🧹 正文替换净化规则 ({filteredReplaceRules.length})
                    </button>
                    <button
                      onClick={() => setRuleSubTab('txtToc')}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '20px',
                        border: ruleSubTab === 'txtToc' ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                        background: ruleSubTab === 'txtToc' ? 'var(--accent-glow)' : 'var(--bg-layer2)',
                        color: ruleSubTab === 'txtToc' ? 'var(--accent-light)' : 'var(--text-secondary)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      📑 TXT 目录分章规则 ({txtTocRules.length})
                    </button>
                  </div>

                  {ruleSubTab === 'sources' && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        onClick={() => {
                          setSourceImportMode('url')
                          setShowImportSourceModal(true)
                        }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #10b981, #059669)',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'
                        }}
                      >
                        <span>+</span> 导入阅读 3.0 书源
                      </button>
                      <button
                        onClick={handleResetDefaultSources}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-layer2)',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        title="恢复系统预置精选书源"
                      >
                        <span>🔄</span> 恢复默认源
                      </button>
                      <button
                        onClick={handleExportSources}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-layer2)',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        title="导出当前所有书源规则为 JSON 文件 (阅读 3.0 标准格式)"
                      >
                        <span>📤</span> 导出书源
                      </button>
                    </div>
                  )}

                  {ruleSubTab === 'replace' && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => setShowAddModal(true)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--accent)',
                          background: 'rgba(56, 189, 248, 0.12)',
                          color: 'var(--accent-light)',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span>+</span> 新增规则
                      </button>
                      <button
                        onClick={() => setShowImportModal(true)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-layer2)',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span>📥</span> 导入阅读 3.0 JSON
                      </button>
                    </div>
                  )}
                </div>

                {/* 子视图 0：阅读 3.0 书源管理视图 */}
                {ruleSubTab === 'sources' && (
                  <div>
                    {/* 搜索与筛选工具条 */}
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', alignItems: 'center' }}>
                      <div style={{ position: 'relative', flex: 1 }}>
                        <input
                          type="text"
                          placeholder="🔍 搜索书源名称、域名或标识..."
                          value={sourcesSearch}
                          onChange={e => setSourcesSearch(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '10px 14px 10px 36px',
                            borderRadius: '10px',
                            border: '1px solid var(--border)',
                            backgroundColor: 'var(--bg-layer2)',
                            color: 'var(--text-primary)',
                            fontSize: '13px',
                            outline: 'none',
                            boxSizing: 'border-box'
                          }}
                        />
                        <span style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }}>
                          🔍
                        </span>
                        {sourcesSearch && (
                          <button
                            onClick={() => setSourcesSearch('')}
                            style={{
                              position: 'absolute',
                              right: '12px',
                              top: '10px',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer'
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <button
                        onClick={loadSourcesData}
                        style={{
                          padding: '10px 14px',
                          borderRadius: '10px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-layer2)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          flexShrink: 0
                        }}
                        title="刷新书源列表"
                      >
                        <span>🔄</span> 刷新
                      </button>
                    </div>

                    {/* 书源列表内容 */}
                    {sourcesLoading ? (
                      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                        <div style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: '24px', marginBottom: '8px' }}>
                          ⏳
                        </div>
                        <div>正在加载书源规则...</div>
                      </div>
                    ) : filteredSources.length === 0 ? (
                      <div
                        style={{
                          textAlign: 'center',
                          padding: '50px 20px',
                          background: 'var(--bg-layer2)',
                          borderRadius: '12px',
                          border: '1px dashed var(--border)'
                        }}
                      >
                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>🌐</div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                          {sourcesSearch ? '未匹配到符合条件的书源' : '暂无书源规则'}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                          {sourcesSearch ? '请尝试更换搜索关键字' : '您可以导入阅读 3.0 网络订阅链接或本地 JSON 文件，或恢复预置源'}
                        </div>
                        <button
                          onClick={() => {
                            setSourceImportMode('url')
                            setShowImportSourceModal(true)
                          }}
                          style={{
                            padding: '8px 18px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'var(--accent)',
                            color: '#fff',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          + 立即导入书源
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '12px' }}>
                        {filteredSources.map((src) => {
                          const isEnabled = src.enabled !== false
                          const isTesting = testingSourceId === src.id
                          return (
                            <div
                              key={src.id}
                              className="global-settings-card"
                              style={{
                                padding: '14px 16px',
                                margin: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                border: isEnabled ? '1px solid var(--border)' : '1px solid rgba(255, 255, 255, 0.05)',
                                opacity: isEnabled ? 1 : 0.65,
                                transition: 'all 0.2s ease'
                              }}
                            >
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                    <span style={{ fontSize: '15px' }}>📖</span>
                                    <span
                                      style={{
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        color: isEnabled ? 'var(--text-primary)' : 'var(--text-muted)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                      }}
                                      title={src.name}
                                    >
                                      {src.name || '未知书源'}
                                    </span>
                                  </div>
                                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '6px', fontSize: '11px', color: isEnabled ? '#34d399' : 'var(--text-muted)', flexShrink: 0 }}>
                                    <span>{isEnabled ? '已启用' : '已停用'}</span>
                                    <input
                                      type="checkbox"
                                      checked={isEnabled}
                                      onChange={(e) => handleToggleSource(src.id, e.target.checked)}
                                      style={{ cursor: 'pointer', accentColor: '#10b981' }}
                                    />
                                  </label>
                                </div>

                                <div
                                  style={{
                                    fontSize: '11px',
                                    color: 'var(--text-muted)',
                                    marginBottom: '10px',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}
                                  title={src.url}
                                >
                                  🔗 {src.url || '内置规则驱动'}
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginTop: '4px' }}>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  权重: {src.weight || 0}
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    disabled={isTesting}
                                    onClick={() => handleTestSource(src)}
                                    style={{
                                      padding: '3px 8px',
                                      borderRadius: '4px',
                                      border: '1px solid var(--border)',
                                      background: 'var(--bg-layer3, #222230)',
                                      color: 'var(--text-secondary)',
                                      fontSize: '11px',
                                      cursor: isTesting ? 'wait' : 'pointer'
                                    }}
                                    title="快速搜索测试此书源连通性与内容响应"
                                  >
                                    {isTesting ? '⏳ 测速中...' : '⚡ 测速'}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteSource(src)}
                                    style={{
                                      padding: '3px 8px',
                                      borderRadius: '4px',
                                      border: '1px solid rgba(239, 68, 68, 0.3)',
                                      background: 'rgba(239, 68, 68, 0.08)',
                                      color: '#ef4444',
                                      fontSize: '11px',
                                      cursor: 'pointer'
                                    }}
                                    title="删除此书源"
                                  >
                                    🗑 删除
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 子视图 1：正文替换规则列表 */}
                {ruleSubTab === 'replace' && (
                  <div>
                    {/* 搜索栏 */}
                    <div style={{ position: 'relative', marginBottom: '14px' }}>
                      <input
                        type="text"
                        placeholder="🔍 搜索规则名称、正则模式、作用范围..."
                        value={replaceSearch}
                        onChange={e => {
                          setReplaceSearch(e.target.value)
                          setRuleDisplayLimit(60)
                        }}
                        style={{
                          width: '100%',
                          padding: '10px 14px 10px 36px',
                          borderRadius: '10px',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--bg-layer2)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                      <span style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }}>
                        🔍
                      </span>
                      {replaceSearch && (
                        <button
                          onClick={() => setReplaceSearch('')}
                          style={{
                            position: 'absolute',
                            right: '12px',
                            top: '8px',
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '14px'
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* 规则卡片列表 */}
                    {replaceLoading ? (
                      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        正在载入规则库...
                      </div>
                    ) : visibleReplaceRules.length === 0 ? (
                      <div style={{ padding: '50px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        未找到匹配的替换净化规则
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {visibleReplaceRules.map(rule => (
                          <div
                            key={rule.id}
                            className="global-settings-card"
                            style={{
                              padding: '14px 18px',
                              marginBottom: '0',
                              opacity: rule.isEnabled !== false ? 1 : 0.6
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                  {rule.name || '未命名净化规则'}
                                </span>
                                <span className={`global-settings-badge ${rule.isRegex ? 'badge-cyan' : 'badge-gray'}`}>
                                  {rule.isRegex ? '正则' : '普通文本'}
                                </span>
                                {rule.scope ? (
                                  <span className="global-settings-badge badge-purple" title={`仅对指定书名/书源生效: ${rule.scope}`}>
                                    范围: {rule.scope}
                                  </span>
                                ) : (
                                  <span className="global-settings-badge badge-green">
                                    全网通用
                                  </span>
                                )}
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <label className="modern-switch" title={rule.isEnabled !== false ? '点击停用' : '点击启用'}>
                                  <input
                                    type="checkbox"
                                    checked={rule.isEnabled !== false}
                                    onChange={() => handleToggleReplace(rule.id, rule.isEnabled !== false)}
                                  />
                                  <span className="modern-switch-slider" />
                                </label>
                                <button
                                  onClick={() => handleDeleteReplace(rule.id, rule.name)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--text-muted)',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    padding: '4px'
                                  }}
                                  title="删除该规则"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>

                            {/* 模式与替换展示 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                <span style={{ color: 'var(--text-muted)', width: '48px', flexShrink: 0 }}>匹配:</span>
                                <code
                                  style={{
                                    flex: 1,
                                    background: 'var(--bg-layer3, #222230)',
                                    padding: '3px 8px',
                                    borderRadius: '5px',
                                    fontFamily: 'Consolas, monospace',
                                    color: '#f43f5e',
                                    wordBreak: 'break-all',
                                    maxHeight: '40px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}
                                  title={rule.pattern}
                                >
                                  {rule.pattern}
                                </code>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ color: 'var(--text-muted)', width: '48px', flexShrink: 0 }}>替换为:</span>
                                {rule.replacement ? (
                                  <code
                                    style={{
                                      background: 'var(--bg-layer3, #222230)',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      fontFamily: 'Consolas, monospace',
                                      color: '#10b981'
                                    }}
                                  >
                                    {rule.replacement}
                                  </code>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                    (清空删除广告)
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* 分页加载更多 */}
                        {visibleReplaceRules.length < filteredReplaceRules.length && (
                          <button
                            onClick={() => setRuleDisplayLimit(prev => prev + 60)}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              border: '1px dashed var(--border)',
                              background: 'transparent',
                              color: 'var(--accent-light)',
                              cursor: 'pointer',
                              fontSize: '13px',
                              marginTop: '8px'
                            }}
                          >
                            加载更多规则 (当前展示 {visibleReplaceRules.length} / 共 {filteredReplaceRules.length} 条)...
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 子视图 2：TXT 目录分章规则 */}
                {ruleSubTab === 'txtToc' && (
                  <div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                      当您导入本地 TXT 小说时，系统将使用以下阅读 3.0 正则规则自动扫描并提取章节目录：
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {txtTocRules.map((rule, idx) => (
                        <div key={idx} className="global-settings-card" style={{ padding: '14px 18px', marginBottom: '0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                {rule.name}
                              </span>
                              {rule.example && (
                                <span className="global-settings-badge badge-green">
                                  示例: {rule.example}
                                </span>
                              )}
                            </div>
                            <label className="modern-switch" title={rule.enable !== false ? '点击停用' : '点击启用'}>
                              <input
                                type="checkbox"
                                checked={rule.enable !== false}
                                onChange={() => handleToggleTxtToc(idx)}
                              />
                              <span className="modern-switch-slider" />
                            </label>
                          </div>
                          <code
                            style={{
                              display: 'block',
                              background: 'var(--bg-layer3, #222230)',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              fontFamily: 'Consolas, monospace',
                              fontSize: '12px',
                              color: '#a78bfa',
                              wordBreak: 'break-all'
                            }}
                          >
                            {rule.rule}
                          </code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* =========================================================
                TAB 2: 云端同步 (WebDAV)
               ========================================================= */}
            {currentTab === 'webdav' && (
              <div>
                <div className="global-settings-card">
                  <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>WebDAV 账号配置</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    支持坚果云、Nextcloud、群晖 NAS、WebDAV 搭建的私有云存储。支持多设备无缝同步书架与阅读进度。
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                        服务器地址 (WebDAV URL)
                      </label>
                      <input
                        type="text"
                        placeholder="例如: https://dav.jianguoyun.com/dav/YouQianReader/"
                        value={webdavUrl}
                        onChange={e => setWebdavUrl(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--bg-layer3)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                          用户名 / 账号
                        </label>
                        <input
                          type="text"
                          placeholder="账号或邮箱"
                          value={webdavUser}
                          onChange={e => setWebdavUser(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            backgroundColor: 'var(--bg-layer3)',
                            color: 'var(--text-primary)',
                            fontSize: '13px',
                            outline: 'none',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                          密码 / 应用授权码
                        </label>
                        <input
                          type="password"
                          placeholder="密码或专用授权密码"
                          value={webdavPass}
                          onChange={e => setWebdavPass(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            backgroundColor: 'var(--bg-layer3)',
                            color: 'var(--text-primary)',
                            fontSize: '13px',
                            outline: 'none',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>自动静默云端同步</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          开启后，在启动软件与阅读完退出时将自动在后台进行多端同步
                        </div>
                      </div>
                      <label className="modern-switch">
                        <input
                          type="checkbox"
                          checked={webdavAutoSync}
                          onChange={e => setWebdavAutoSync(e.target.checked)}
                        />
                        <span className="modern-switch-slider" />
                      </label>
                    </div>

                    {webdavLastSync && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        上次成功同步时间: {new Date(webdavLastSync).toLocaleString()}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                      <button
                        onClick={handleTestWebdav}
                        disabled={webdavTesting}
                        style={{
                          padding: '8px 16px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--bg-layer3)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          cursor: 'pointer'
                        }}
                      >
                        {webdavTesting ? '正在测试...' : '测试连接'}
                      </button>
                      <button
                        onClick={() => handleSaveWebdav(false)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: 'var(--accent)',
                          color: '#fff',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer'
                        }}
                      >
                        保存配置
                      </button>
                    </div>
                  </div>
                </div>

                {/* 立即操作卡片 */}
                <div className="global-settings-card">
                  <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>手动同步操作</div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                    <button
                      onClick={handleSyncUpload}
                      disabled={webdavSyncing}
                      style={{
                        flex: 1,
                        padding: '12px',
                        borderRadius: '10px',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        background: 'rgba(56, 189, 248, 0.08)',
                        color: 'var(--accent-light)',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>⬆️</span> 立即备份上传到云端
                    </button>
                    <button
                      onClick={handleSyncDownload}
                      disabled={webdavSyncing}
                      style={{
                        flex: 1,
                        padding: '12px',
                        borderRadius: '10px',
                        border: '1px solid rgba(168, 85, 247, 0.3)',
                        background: 'rgba(168, 85, 247, 0.08)',
                        color: '#c084fc',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>⬇️</span> 从云端拉取恢复并合并
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* =========================================================
                TAB 3: 数据备份与维护
               ========================================================= */}
            {currentTab === 'backup' && (
              <div>
                <div className="global-settings-card">
                  <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>本地离线数据备份</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    导出包含书籍信息、书签、高亮划线、分类与阅读记录的完整加密备份文件（.json）。
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                      onClick={handleExportBackup}
                      style={{
                        padding: '10px 18px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-layer3)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>💾</span> 导出全量备份文件
                    </button>
                    <button
                      onClick={handleImportBackup}
                      style={{
                        padding: '10px 18px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-layer3)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>📥</span> 从备份文件恢复数据
                    </button>
                  </div>
                </div>

                <div className="global-settings-card" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#ef4444', marginBottom: '6px' }}>
                    危险区域 (Danger Zone)
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    清空书库中的所有书籍、进度和个人配置，恢复到初次安装软件时的原始状态。
                  </div>
                  <button
                    onClick={handleResetDatabase}
                    style={{
                      padding: '10px 18px',
                      borderRadius: '8px',
                      border: '1px solid #ef4444',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    ⚠️ 还原初始状态
                  </button>
                </div>
              </div>
            )}

            {/* =========================================================
                TAB 4: 外观与字体库
               ========================================================= */}
            {currentTab === 'appearance' && (
              <div>
                <div className="global-settings-card">
                  <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>软件界面全局主题</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                    控制应用主界面、书架及全局视窗的主色调：
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {[
                      { key: 'dark', label: '暗黑极客 (Dark)', icon: '🌙' },
                      { key: 'light', label: '简约明亮 (Light)', icon: '☀️' }
                    ].map(t => (
                      <button
                        key={t.key}
                        onClick={() => updateSettings({ globalTheme: t.key })}
                        style={{
                          flex: 1,
                          padding: '12px',
                          borderRadius: '10px',
                          border: (settings.globalTheme || 'dark') === t.key ? '2px solid var(--accent)' : '1px solid var(--border)',
                          background: (settings.globalTheme || 'dark') === t.key ? 'var(--accent-glow)' : 'var(--bg-layer3)',
                          color: (settings.globalTheme || 'dark') === t.key ? 'var(--accent-light)' : 'var(--text-primary)',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px'
                        }}
                      >
                        <span>{t.icon}</span> {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="global-settings-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 600 }}>自定义字体库管理</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        导入您喜爱的中英文字体（支持 TTF, OTF, WOFF, WOFF2）
                      </div>
                    </div>
                    <button
                      onClick={handleImportFont}
                      disabled={importingFont}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '8px',
                        border: '1px solid var(--accent)',
                        background: 'rgba(56, 189, 248, 0.12)',
                        color: 'var(--accent-light)',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                    >
                      {importingFont ? '正在导入...' : '+ 导入本地字体文件'}
                    </button>
                  </div>

                  {customFonts.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      尚未导入任何自定义字体，点击右上角按钮即可添加
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' }}>
                      {customFonts.map(cf => (
                        <div
                          key={cf.fileName}
                          style={{
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--bg-layer3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}
                        >
                          <span style={{ fontSize: '13px', fontFamily: `"${cf.name}", sans-serif` }}>
                            {cf.name}
                          </span>
                          <button
                            onClick={() => handleDeleteFont(cf)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '2px 6px'
                            }}
                            title="删除字体"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* =========================================================
                TAB 5: 关于软件
               ========================================================= */}
            {currentTab === 'about' && (
              <div>
                <div className="global-settings-card" style={{ textAlign: 'center', padding: '30px 20px' }}>
                  <div style={{ fontSize: '42px', marginBottom: '10px' }}>📖</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    YouQian Reader (有前阅读器)
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--accent-light)', marginBottom: '16px' }}>
                    版本: v{appVersion} (现代化纯粹阅读与全网书源追更神器)
                  </div>
                  <div style={{ maxWidth: '480px', margin: '0 auto', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    深度对齐阅读 3.0 (Legado) 规则生态，支持 EPUB, MOBI, AZW3, PDF, TXT 及全网流式小说追更，内置 1.5 万条正文广告净化规则与 TXT 目录智能提取引擎。
                  </div>
                </div>

                <div className="global-settings-card">
                  <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>技术特性</div>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    <li>前端框架：React 18 + Vite 5 + 响应式双栏高颜值设计</li>
                    <li>核心能力：WebDAV 多端同步、智能连续换源基准锁定、拼音错字反向还原</li>
                    <li>版权规范：纯本地客户端工具与规则解析，符合技术中立协议</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---------------- 新增规则子弹窗 ---------------- */}
        {showAddModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100000
            }}
            onClick={() => setShowAddModal(false)}
          >
            <div
              style={{
                width: '460px',
                background: 'var(--bg-layer1)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '20px',
                color: 'var(--text-primary)'
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '14px' }}>新增自定义净化替换规则</div>
              <form onSubmit={handleAddRuleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>规则名称</label>
                  <input
                    type="text"
                    placeholder="如：去除某站点尾巴广告"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer3)', color: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>匹配模式 (正则或文本) *</label>
                  <input
                    type="text"
                    placeholder="如：天才一秒记住.*?"
                    value={newPattern}
                    onChange={e => setNewPattern(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer3)', color: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>替换为 (留空即删除广告)</label>
                  <input
                    type="text"
                    placeholder="留空表示直接剔除"
                    value={newReplacement}
                    onChange={e => setNewReplacement(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer3)', color: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="newIsRegex"
                    checked={newIsRegex}
                    onChange={e => setNewIsRegex(e.target.checked)}
                  />
                  <label htmlFor="newIsRegex" style={{ fontSize: '12px', cursor: 'pointer' }}>作为正则表达式处理</label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    style={{ padding: '6px 16px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                  >
                    确定添加
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ---------------- 导入 JSON 子弹窗 ---------------- */}
        {showImportModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100000
            }}
            onClick={() => setShowImportModal(false)}
          >
            <div
              style={{
                width: '520px',
                background: 'var(--bg-layer1)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '20px',
                color: 'var(--text-primary)'
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>导入阅读 3.0 替换规则 JSON</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                请将阅读 3.0 导出的规则 JSON 数组内容粘贴到下方文本框中：
              </div>
              <textarea
                rows={10}
                placeholder={`[\n  {\n    "name": "规则名称",\n    "pattern": "待净化关键词",\n    "replacement": ""\n  }\n]`}
                value={importJsonText}
                onChange={e => setImportJsonText(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-layer3)',
                  color: '#fff',
                  fontFamily: 'Consolas, monospace',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                  outline: 'none',
                  resize: 'vertical'
                }}
              />
              {importError && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>{importError}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleImportSubmit}
                  style={{ padding: '6px 16px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                >
                  确认导入
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- 导入书源子弹窗 (阅读 3.0 / Legado 全功能导入) ---------------- */}
        {showImportSourceModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.68)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100000
            }}
            onClick={() => !sourceImporting && setShowImportSourceModal(false)}
          >
            <div
              style={{
                width: '560px',
                maxWidth: '92vw',
                background: 'var(--bg-layer1, #1e1e2d)',
                border: '1px solid var(--border)',
                borderRadius: '14px',
                padding: '24px',
                color: 'var(--text-primary)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>🌐</span>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 600 }}>导入阅读 3.0 (Legado) 书源</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>全网海量开源小说源规则全开放导入引擎</div>
                  </div>
                </div>
                <button
                  disabled={sourceImporting}
                  onClick={() => setShowImportSourceModal(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '18px',
                    cursor: 'pointer'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* 三种导入模式切换 */}
              <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-layer2, #181824)', padding: '4px', borderRadius: '8px', marginBottom: '18px' }}>
                <button
                  onClick={() => { setSourceImportMode('url'); setSourceImportResult(null) }}
                  style={{
                    flex: 1,
                    padding: '7px',
                    borderRadius: '6px',
                    border: 'none',
                    background: sourceImportMode === 'url' ? 'var(--accent)' : 'transparent',
                    color: sourceImportMode === 'url' ? '#fff' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  🔗 网络订阅 URL
                </button>
                <button
                  onClick={() => { setSourceImportMode('paste'); setSourceImportResult(null) }}
                  style={{
                    flex: 1,
                    padding: '7px',
                    borderRadius: '6px',
                    border: 'none',
                    background: sourceImportMode === 'paste' ? 'var(--accent)' : 'transparent',
                    color: sourceImportMode === 'paste' ? '#fff' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  📋 剪贴板 / 粘贴 JSON
                </button>
                <button
                  onClick={() => { setSourceImportMode('file'); setSourceImportResult(null) }}
                  style={{
                    flex: 1,
                    padding: '7px',
                    borderRadius: '6px',
                    border: 'none',
                    background: sourceImportMode === 'file' ? 'var(--accent)' : 'transparent',
                    color: sourceImportMode === 'file' ? '#fff' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  📄 本地 JSON 文件
                </button>
              </div>

              {/* 模式 1：网络订阅 URL */}
              {sourceImportMode === 'url' && (
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    输入阅读 3.0 书源远程网络订阅链接 (支持直接粘贴 GitHub、Gitee、自建服务器等 Raw JSON 链接)：
                  </div>
                  <input
                    type="text"
                    placeholder="https://.../bookSource.json"
                    value={sourceImportUrl}
                    onChange={e => setSourceImportUrl(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-layer3)',
                      color: '#fff',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box',
                      marginBottom: '10px'
                    }}
                  />

                  {/* 快捷示范填入标签 */}
                  <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>快速填入参考:</span>
                    <button
                      type="button"
                      onClick={() => setSourceImportUrl('https://raw.githubusercontent.com/gedoor/legado/master/bookSource.json')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--accent-light)',
                        fontSize: '11px',
                        cursor: 'pointer'
                      }}
                    >
                      开源阅读精选源 (GitHub)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceImportUrl('https://testingcf.jsdelivr.net/gh/yeyulingfeng01/yuedu.github.io@1.1/202003.json')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--accent-light)',
                        fontSize: '11px',
                        cursor: 'pointer'
                      }}
                    >
                      国内 CDN 镜像源
                    </button>
                  </div>
                </div>
              )}

              {/* 模式 2：剪贴板 / 粘贴 JSON */}
              {sourceImportMode === 'paste' && (
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    请直接将阅读 3.0 导出的书源 JSON（单个书源或数组）粘贴到下方：
                  </div>
                  <textarea
                    rows={8}
                    placeholder={`[\n  {\n    "bookSourceName": "xx笔趣阁",\n    "bookSourceUrl": "https://...",\n    "ruleSearch": { ... },\n    "ruleToc": { ... },\n    "ruleContent": { ... }\n  }\n]`}
                    value={sourceImportPasteText}
                    onChange={e => setSourceImportPasteText(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-layer3)',
                      color: '#fff',
                      fontFamily: 'Consolas, monospace',
                      fontSize: '12px',
                      boxSizing: 'border-box',
                      outline: 'none',
                      resize: 'vertical',
                      marginBottom: '10px'
                    }}
                  />
                </div>
              )}

              {/* 模式 3：本地文件选取 */}
              {sourceImportMode === 'file' && (
                <div style={{ textAlign: 'center', padding: '30px 20px', background: 'var(--bg-layer2)', borderRadius: '10px', border: '1px dashed var(--border)', marginBottom: '14px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>📁</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    从电脑本地选取书源 JSON 文件
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                    支持标准 .json、.json5 格式的阅读 3.0 书源备份文件
                  </div>
                  <button
                    type="button"
                    onClick={handleImportSourceFileSubmit}
                    style={{
                      padding: '8px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'var(--accent)',
                      color: '#fff',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    📂 浏览本地文件并导入
                  </button>
                </div>
              )}

              {/* 导入结果提示反馈 */}
              {sourceImportResult && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    marginBottom: '12px',
                    fontSize: '12px',
                    backgroundColor: sourceImportResult.success ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    border: sourceImportResult.success ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                    color: sourceImportResult.success ? '#10b981' : '#ef4444'
                  }}
                >
                  {sourceImportResult.message}
                </div>
              )}

              {/* 底部按钮栏 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  disabled={sourceImporting}
                  onClick={() => setShowImportSourceModal(false)}
                  style={{
                    padding: '7px 16px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  取消
                </button>
                {sourceImportMode === 'url' && (
                  <button
                    type="button"
                    disabled={sourceImporting}
                    onClick={handleImportSourceUrlSubmit}
                    style={{
                      padding: '7px 20px',
                      borderRadius: '6px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      color: '#fff',
                      fontWeight: 600,
                      cursor: sourceImporting ? 'wait' : 'pointer'
                    }}
                  >
                    {sourceImporting ? '⏳ 正在拉取并解析...' : '立即导入网络源'}
                  </button>
                )}
                {sourceImportMode === 'paste' && (
                  <button
                    type="button"
                    disabled={sourceImporting}
                    onClick={handleImportSourcePasteSubmit}
                    style={{
                      padding: '7px 20px',
                      borderRadius: '6px',
                      border: 'none',
                      background: 'var(--accent)',
                      color: '#fff',
                      fontWeight: 600,
                      cursor: sourceImporting ? 'wait' : 'pointer'
                    }}
                  >
                    {sourceImporting ? '⏳ 正在解析写入...' : '解析并导入'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
