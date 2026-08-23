import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'

export function SourceEditorView() {
  const {
    showToast, showConfirm,
    batchTesting, setBatchTesting,
    batchProgress, setBatchProgress,
    stopBatchRef, stopBatchTest: handleStopBatchTest,
    selectedSourceIds: selectedIds, setSelectedSourceIds: setSelectedIds,
    invalidSourceIds: invalidIds, setInvalidSourceIds: setInvalidIds
  } = useStore()

  // 选项卡：'list' (书源列表管理) 或 'create' (制作与调试工坊)
  const [activeTab, setActiveTab] = useState('list')

  // 书源列表状态
  const [sources, setSources] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)

  // 弹窗状态：查看 JSON / 编辑
  const [viewDetailModal, setViewDetailModal] = useState(null) // source item
  const [editModal, setEditModal] = useState(null) // editing rule object

  // 工坊向导表单状态
  const [sourceName, setSourceName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [encoding, setEncoding] = useState('utf-8')
  const [searchUrl, setSearchUrl] = useState('')
  const [searchMethod, setSearchMethod] = useState('GET')
  const [resultSelector, setResultSelector] = useState('')
  const [bookNameSelector, setBookNameSelector] = useState('')
  const [authorSelector, setAuthorSelector] = useState('')
  const [chapterSelector, setChapterSelector] = useState('')
  const [contentSelector, setContentSelector] = useState('')
  const [cleanRules, setCleanRules] = useState('')

  // 测试沙盒状态
  const [testUrl, setTestUrl] = useState('')
  const [testing, setTesting] = useState(false)
  const [sniffing, setSniffing] = useState(false)
  const [logs, setLogs] = useState([
    '[系统] 可视化书源工坊与沙盒控制台已就绪。',
    '[提示] 可填写入参后点击【测试解析正文】或【导出规则 JSON】。'
  ])

  const addLog = (msg) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  // 加载全量书源详情
  const reloadSources = async () => {
    setLoading(true)
    try {
      const list = await window.api?.novelGetSourcesDetail?.()
      if (Array.isArray(list)) {
        setSources(list)
      }
    } catch (e) {
      console.error('获取书源失败:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadSources()
  }, [])

  // 启停书源
  const handleToggle = async (src, e) => {
    e.stopPropagation()
    const nextState = !src.enabled
    try {
      await window.api?.novelToggleSource?.(src.id, nextState)
      setSources(prev => prev.map(s => s.id === src.id ? { ...s, enabled: nextState } : s))
      showToast(`${src.name} 已${nextState ? '启用' : '停用'}`, 'success')
    } catch (err) {
      showToast('操作失败: ' + err.message, 'error')
    }
  }

  // 删除书源
  const handleDelete = async (src, e) => {
    e.stopPropagation()
    const ok = await showConfirm('删除书源', `确定要删除/停用书源“${src.name}”吗？`)
    if (!ok) return
    try {
      const res = await window.api?.novelDeleteSource?.(src.id)
      if (res?.success) {
        showToast(`书源“${src.name}”已${res.disabledOnly ? '停用' : '删除'}`, 'success')
        reloadSources()
      } else {
        showToast('删除失败: ' + (res?.error || '未知错误'), 'error')
      }
    } catch (err) {
      showToast('删除出错: ' + err.message, 'error')
    }
  }

  // 打开编辑书源
  const handleEdit = (src, e) => {
    e?.stopPropagation()
    const rule = src.rule || {
      name: src.name,
      url: src.baseUrl,
      search: { url: src.baseUrl, method: 'GET' },
      toc: {},
      chapter: {}
    }
    setEditModal({
      id: src.id,
      name: rule.name || src.name,
      url: rule.url || src.baseUrl,
      encoding: rule.encoding || rule.charset || 'utf-8',
      searchUrl: rule.search?.url || '',
      searchMethod: rule.search?.method?.toUpperCase() || 'GET',
      resultSelector: rule.search?.result || '',
      bookNameSelector: rule.search?.bookName || '',
      authorSelector: rule.search?.author || '',
      chapterSelector: rule.toc?.item || '',
      contentSelector: rule.chapter?.content || '',
      cleanRules: rule.chapter?.filterTxt || ''
    })
  }

  // 保存修改后的书源
  const handleSaveEdit = async () => {
    if (!editModal.name.trim() || !editModal.url.trim()) {
      showToast('书源名称和主站网址不能为空', 'error')
      return
    }
    const ruleObj = {
      name: editModal.name.trim(),
      url: editModal.url.trim(),
      encoding: editModal.encoding,
      search: {
        url: editModal.searchUrl.trim(),
        method: editModal.searchMethod,
        result: editModal.resultSelector.trim(),
        bookName: editModal.bookNameSelector.trim(),
        author: editModal.authorSelector.trim()
      },
      toc: {
        item: editModal.chapterSelector.trim()
      },
      chapter: {
        content: editModal.contentSelector.trim(),
        filterTxt: editModal.cleanRules
      }
    }
    try {
      const res = await window.api?.novelSaveSource?.(ruleObj)
      if (res?.success) {
        showToast(`书源“${editModal.name}”保存成功！`, 'success')
        setEditModal(null)
        reloadSources()
      } else {
        showToast('保存失败: ' + (res?.error || '未知错误'), 'error')
      }
    } catch (e) {
      showToast('保存出错: ' + e.message, 'error')
    }
  }

  // 导入书源
  const handleImportFile = async () => {
    try {
      const res = await window.api?.novelImportSource?.()
      if (res?.canceled) return
      if (res?.success) {
        showToast(`成功导入 ${res.count || 1} 个书源！`, 'success')
        reloadSources()
      } else {
        showToast(`导入失败: ${res?.error}`, 'error')
      }
    } catch (e) {
      showToast('导入出错: ' + e.message, 'error')
    }
  }

  // 导出书源为 JSON (优先导出勾选的项，无勾选则导出全量)
  const handleExportAll = async () => {
    try {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : null
      const res = await window.api?.novelExportSourcesJson?.(ids)
      if (res?.canceled) return
      if (res?.success) {
        showToast(`已成功导出 ${ids ? ids.length : sources.length} 个书源文件到：${res.filePath}`, 'success')
      } else {
        showToast(`导出失败: ${res?.error}`, 'error')
      }
    } catch (e) {
      showToast('导出出错: ' + e.message, 'error')
    }
  }

  // 导出单个书源为 Legado 3.0 标准 JSON
  const handleExportSingle = async (src, e) => {
    e?.stopPropagation()
    try {
      const res = await window.api?.novelExportSourcesJson?.([src.id])
      if (res?.canceled) return
      if (res?.success) {
        showToast(`书源“${src.name}”已成功导出为阅读 3.0 格式！`, 'success')
      } else {
        showToast('导出失败: ' + (res?.error || '未知错误'), 'error')
      }
    } catch (err) {
      showToast('导出出错: ' + err.message, 'error')
    }
  }

  // 🤖 智能一键探测与推导规则（填入主站 URL 或 搜索 URL 后全自动分析并抓取全部选择器）
  const handleAutoSniff = async () => {
    const targetBase = baseUrl.trim()
    const targetSearch = searchUrl.trim()
    const targetSample = testUrl.trim()

    if (!targetBase && !targetSearch && !targetSample) {
      showToast('请先输入【主站基准 URL】或【搜索 URL 模板】', 'warning')
      return
    }

    setSniffing(true)
    addLog(`[智能探测] 启动全自动 DOM 结构分析与选择器推断...`)
    addLog(`[入参探测] 主站: "${targetBase || '(待推导)'}" | 搜索模板: "${targetSearch || '(待推导)'}"`)

    try {
      const res = await window.api?.novelAutoSniffRule?.({
        baseUrl: targetBase,
        searchUrl: targetSearch,
        sampleUrl: targetSample
      })

      if (res && res.success && res.rule) {
        const r = res.rule
        if (r.sourceName) setSourceName(r.sourceName)
        if (r.baseUrl) setBaseUrl(r.baseUrl)
        if (r.searchUrl) setSearchUrl(r.searchUrl)
        if (r.searchMethod) setSearchMethod(r.searchMethod)
        if (r.encoding) setEncoding(r.encoding)
        if (r.resultSelector) setResultSelector(r.resultSelector)
        if (r.chapterSelector) setChapterSelector(r.chapterSelector)
        if (r.contentSelector) setContentSelector(r.contentSelector)
        if (r.cleanRules) setCleanRules(r.cleanRules)
        if (r.sampleChapterUrl) setTestUrl(r.sampleChapterUrl)

        if (Array.isArray(res.logs)) {
          res.logs.forEach(l => addLog(l))
        }

        showToast(`🎉 智能预断成功！已自动填充全套选择器与书源规则！`, 'success')
      } else {
        addLog(`[智能探测失败] ${res?.error || '未识别到有效小说结构'}`)
        showToast('智能预断未识别到完整结构: ' + (res?.error || '请检查网站地址是否可访问'), 'error')
      }
    } catch (err) {
      addLog(`[智能探测异常] ${err.message}`)
      showToast('智能预断出错: ' + err.message, 'error')
    } finally {
      setSniffing(false)
    }
  }

  // 真实单章/目录抓取测试沙盒
  const handleTestContent = async () => {
    if (!testUrl.trim()) {
      showToast('请在下方输入框中填入测试网页 URL', 'error')
      return
    }
    setTesting(true)
    addLog(`[沙盒测试] 发起真实网络请求: ${testUrl}`)
    try {
      const urlLower = testUrl.toLowerCase()
      // 判断是正文页面还是目录页面
      if (urlLower.includes('.html') || urlLower.includes('chapter') || urlLower.includes('read') || urlLower.includes('page')) {
        addLog(`[沙盒测试] 正在应用选择器 "${contentSelector || '#content'}" 进行正文提取...`)
        const res = await window.api.novelGetContent(testUrl, baseUrl || testUrl)
        if (res && res.success && res.content && res.content.length > 30 && !res.content.includes('【获取')) {
          addLog(`[SUCCESS] 正文解析成功！共抓取 ${res.content.length} 字！`)
          addLog(`[正文前100字] ${res.content.substring(0, 100)}...`)
          showToast('✅ 正文抓取测试成功！', 'success')
        } else {
          addLog(`[WARN] 抓取反馈: ${res?.content || res?.error || '返回文本过短或匹配失败'}`)
          showToast('抓取内容为空或未匹配到容器，请检查选择器', 'warning')
        }
      } else {
        addLog(`[沙盒测试] 正在应用选择器 "${chapterSelector || '#list a'}" 进行目录提取...`)
        const res = await window.api.novelGetChapters(testUrl, baseUrl || testUrl)
        if (res && res.success && res.chapters && res.chapters.length > 0) {
          addLog(`[SUCCESS] 目录解析成功！成功抓取到 ${res.chapters.length} 个章节目录！`)
          addLog(`[首章示例] ${res.chapters[0].title}`)
          showToast(`✅ 目录解析成功 (共 ${res.chapters.length} 章)！`, 'success')
        } else {
          addLog(`[WARN] 目录解析失败: ${res?.error || '未捕获到章节链接'}`)
          showToast('目录解析失败，请检查目录选择器', 'warning')
        }
      }
    } catch (e) {
      addLog(`[ERROR] 沙盒网络请求失败: ${e.message}`)
      showToast('测试出错: ' + e.message, 'error')
    } finally {
      setTesting(false)
    }
  }

  // 专门的书源测试诊断弹窗状态
  const [testSourceModal, setTestSourceModal] = useState(null) // { src, running, logs, result }

  // 运行全流程书源可用性诊断测试 (搜索 -> 目录 -> 正文)
  const handleRunSourceTest = async (src) => {
    if (!src) return
    const modalState = {
      src,
      running: true,
      logs: [`[测试启动] 正在对书源《${src.name}》进行全链路诊断...`, `[域名基准] ${src.baseUrl || s.rule?.url || '原生接口'}`],
      result: null
    }
    setTestSourceModal(modalState)

    const appendModalLog = (msg) => {
      setTestSourceModal(prev => prev ? ({ ...prev, logs: [...prev.logs, `[${new Date().toLocaleTimeString()}] ${msg}`] }) : null)
    }

    const startTime = Date.now()
    try {
      appendModalLog('🚀 阶段 1/3: 正在发起【搜书测试】(关键词: 修仙)...')
      const searchRes = await window.api.novelTestSingleSource(src.id, '修仙')
      const searchTime = Date.now() - startTime

      if (!searchRes || !searchRes.success || !Array.isArray(searchRes.results) || searchRes.results.length === 0) {
        appendModalLog(`❌ [搜书失败] 未搜到任何结果或连接超时 (${searchTime}ms)`)
        setTestSourceModal(prev => prev ? ({ ...prev, running: false, result: { success: false, reason: '搜索无响应或超时' } }) : null)
        return
      }

      appendModalLog(`✅ [搜书成功] 耗时 ${searchTime}ms，共搜到 ${searchRes.results.length} 条相关结果！`)
      const firstBook = searchRes.results[0]
      appendModalLog(`   示例图书: 《${firstBook.title}》 (${firstBook.author})`)

      // 阶段 2: 测试章节目录
      appendModalLog('📖 阶段 2/3: 正在请求解析【章节目录】...')
      const chapStartTime = Date.now()
      const chapRes = await window.api.novelGetChapters(firstBook.url, src.id)
      const chapTime = Date.now() - chapStartTime

      if (!chapRes || !chapRes.success || !Array.isArray(chapRes.chapters) || chapRes.chapters.length === 0) {
        appendModalLog(`❌ [目录失败] 无法提取章节目录 (${chapTime}ms): ${chapRes?.error || '目录为空'}`)
        setTestSourceModal(prev => prev ? ({ ...prev, running: false, result: { success: false, reason: '章节目录解析失败' } }) : null)
        return
      }

      appendModalLog(`✅ [目录成功] 耗时 ${chapTime}ms，成功提取到 ${chapRes.chapters.length} 个章节！`)
      const firstChap = chapRes.chapters[0]
      appendModalLog(`   首章标题: ${firstChap.title}`)

      // 阶段 3: 测试正文提取
      appendModalLog('📄 阶段 3/3: 正在抓取【首章正文】...')
      const contentStartTime = Date.now()
      const contentRes = await window.api.novelGetContent(firstChap.url, src.id)
      const contentTime = Date.now() - contentStartTime

      if (contentRes && contentRes.success && contentRes.content && contentRes.content.length > 30 && !contentRes.content.includes('【获取')) {
        const totalTime = Date.now() - startTime
        appendModalLog(`✅ [正文成功] 耗时 ${contentTime}ms，成功抓取到 ${contentRes.content.length} 字正文！`)
        appendModalLog(`🎉 [诊断完毕] 该书源状态优秀，总响应时长 ${totalTime}ms！`)
        setTestSourceModal(prev => prev ? ({
          ...prev,
          running: false,
          result: { success: true, totalTime, count: searchRes.results.length, chapters: chapRes.chapters.length, contentLen: contentRes.content.length, sample: contentRes.content.substring(0, 120) }
        }) : null)
      } else {
        appendModalLog(`⚠️ [正文预警] 正文获取异常或文本为空: ${contentRes?.error || contentRes?.content || '内容为空'}`)
        setTestSourceModal(prev => prev ? ({ ...prev, running: false, result: { success: false, reason: '正文容器解析为空' } }) : null)
      }
    } catch (e) {
      appendModalLog(`❌ [异常终止] 发生错误: ${e.message}`)
      setTestSourceModal(prev => prev ? ({ ...prev, running: false, result: { success: false, reason: e.message } }) : null)
    }
  }

  // 一键检测全量/当前书源可用性
  const handleBatchTestSources = async () => {
    if (batchTesting) return
    const targetList = filteredSources.length > 0 ? filteredSources : sources
    if (targetList.length === 0) {
      showToast('当前书源列表为空', 'warning')
      return
    }

    const ok = await showConfirm('一键检测书源', `即将在后台并发检测当前 ${targetList.length} 个书源的连通性。\n检测完毕后将【自动勾选所有无法搜到图书的失效书源】，方便您一键批量清理！`)
    if (!ok) return

    setBatchTesting(true)
    stopBatchRef.current = false
    setBatchProgress({ current: 0, total: targetList.length, validCount: 0, invalidCount: 0 })

    const nextSelected = new Set(selectedIds)
    const nextInvalid = new Set(invalidIds)

    const CONCURRENCY = 10 // 10 线程并发跑测试，非常迅速
    let currentDone = 0
    let validCnt = 0
    let invalidCnt = 0

    showToast(`正在启动 ${CONCURRENCY} 线程全量检测书源中...`, 'info')

    for (let i = 0; i < targetList.length; i += CONCURRENCY) {
      if (stopBatchRef.current) {
        showToast('已中断一键书源检测', 'info')
        break
      }

      const batch = targetList.slice(i, i + CONCURRENCY)
      await Promise.allSettled(
        batch.map(async (src) => {
          if (stopBatchRef.current) return
          try {
            const searchRes = await window.api.novelTestSingleSource(src.id, '修仙')
            if (searchRes && searchRes.success && Array.isArray(searchRes.results) && searchRes.results.length > 0) {
              validCnt++
            } else {
              // 搜不到书或超时/报错 ➔ 判定为失效，自动勾选起来！
              invalidCnt++
              nextInvalid.add(src.id)
              nextSelected.add(src.id)
            }
          } catch (_) {
            invalidCnt++
            nextInvalid.add(src.id)
            nextSelected.add(src.id)
          } finally {
            currentDone++
            setBatchProgress({ current: currentDone, total: targetList.length, validCount: validCnt, invalidCount: invalidCnt })
          }
        })
      )
    }

    setSelectedIds(new Set(nextSelected))
    setInvalidIds(new Set(nextInvalid))
    setBatchTesting(false)

    if (!stopBatchRef.current) {
      showToast(`🎉 一键检测完成！可用: ${validCnt} 个，失效: ${invalidCnt} 个！已自动勾选所有失效书源！`, invalidCnt > 0 ? 'warning' : 'success')
    }
  }



  // 批量删除进度状态
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0, successCount: 0 })

  // 一键批量删除/清理已勾选的书源（带实时进度条）
  const handleBatchDeleteSelected = async () => {
    if (batchDeleting || batchTesting) return
    if (selectedIds.size === 0) {
      showToast('当前没有勾选任何书源', 'warning')
      return
    }
    const count = selectedIds.size
    const ok = await showConfirm('一键清除勾选书源', `确定要一键彻底删除当前已勾选的 ${count} 个书源吗？\n该操作不可撤销！`)
    if (!ok) return

    setBatchDeleting(true)
    setDeleteProgress({ current: 0, total: count, successCount: 0 })

    const idList = Array.from(selectedIds)
    const BATCH_SIZE = 10
    let successCnt = 0

    for (let i = 0; i < idList.length; i += BATCH_SIZE) {
      const slice = idList.slice(i, i + BATCH_SIZE)
      try {
        const res = await window.api?.novelDeleteSource?.(slice)
        if (res?.success) {
          successCnt += slice.length
        }
      } catch (_) {}

      const currentDone = Math.min(idList.length, i + BATCH_SIZE)
      setDeleteProgress({ current: currentDone, total: count, successCount: successCnt })
      // 稍微给 UI 渲染一帧的时间，平滑展示进度条动画
      await new Promise(r => setTimeout(r, 40))
    }

    setSelectedIds(new Set())
    setInvalidIds(new Set())
    setBatchDeleting(false)
    showToast(`✅ 成功清除 ${successCnt} 个失效书源！`, 'success')
    reloadSources()
  }

  // 多维度、不区分大小写的书源搜索过滤逻辑（剔除内部时间戳ID匹配，精准搜名称与网址）
  const filteredSources = sources.filter(s => {
    if (!searchQuery || !searchQuery.trim()) return true
    const q = searchQuery.trim().toLowerCase()
    const nameMatch = (s.name || '').toLowerCase().includes(q)
    const urlMatch = (s.baseUrl || s.rule?.url || '').toLowerCase().includes(q)
    const searchUrlMatch = (s.rule?.search?.url || '').toLowerCase().includes(q)
    return nameMatch || urlMatch || searchUrlMatch
  })

  // 彻底清空所有书源（打造纯净模式，支持只用自己导入的书源）
  const handleClearAllSources = async () => {
    const ok = await showConfirm('清空所有书源', `⚠️ 警告：确定要清空书源库中的所有书源吗？\n清空后书源库将完全置空（0 个书源），方便您后续完全只使用自己导入的 JSON / 开源阅读 3.0 书源。`)
    if (!ok) return

    try {
      const res = await window.api?.novelClearAllSources?.()
      if (res?.success) {
        showToast('已成功清空所有书源！当前处于纯净空书源模式。', 'success')
        setSelectedIds(new Set())
        setInvalidIds(new Set())
        reloadSources()
      } else {
        showToast('清空失败: ' + (res?.error || '未知错误'), 'error')
      }
    } catch (e) {
      showToast('清空出错: ' + e.message, 'error')
    }
  }

  // 多选辅助函数
  const handleSelectAll = (checked) => {
    if (checked) {
      const allIds = new Set(filteredSources.map(s => s.id))
      setSelectedIds(allIds)
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleSelectOnlyInvalid = () => {
    setSelectedIds(new Set(invalidIds))
  }

  return (
    <div className="source-manager-view" style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
      {/* 头部区 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '22px' }}>⚙️</span> 书源管理与工坊
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 0 0' }}>
            查看、启停、修改、删除及导入导出全网小说书源规则
          </p>
        </div>

        {/* 顶部 Tab 切换 */}
        <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-layer2)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <button
            onClick={() => setActiveTab('list')}
            style={{
              padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px',
              background: activeTab === 'list' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'list' ? '#fff' : 'var(--text-secondary)',
              fontWeight: activeTab === 'list' ? 600 : 400
            }}
          >
            📚 书源列表 ({sources.length})
          </button>
          <button
            onClick={() => setActiveTab('create')}
            style={{
              padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px',
              background: activeTab === 'create' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'create' ? '#fff' : 'var(--text-secondary)',
              fontWeight: activeTab === 'create' ? 600 : 400
            }}
          >
            🛠️ 制作新书源
          </button>
        </div>
      </div>

      {/* TAB 1: 书源列表管理 */}
      {activeTab === 'list' && (
        <div>
          {/* 工具栏与一键检测/批量清除控制 */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索书源名称或域名..."
                style={{
                  width: '100%', padding: '8px 12px 8px 32px', borderRadius: '8px',
                  border: '1px solid var(--border)', background: 'var(--bg-layer1)', color: 'var(--text-primary)',
                  fontSize: '13px'
                }}
              />
              <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                🔍
              </span>
            </div>

            {searchQuery.trim() && (
              <span style={{ fontSize: '12px', color: 'var(--accent-light)', whiteSpace: 'nowrap' }}>
                找到 <strong>{filteredSources.length}</strong> / {sources.length} 个
              </span>
            )}

            {/* 🔥 一键检测全量书源按钮 */}
            {batchTesting ? (
              <button
                onClick={handleStopBatchTest}
                style={{
                  padding: '8px 16px', borderRadius: '8px', border: '1px solid #f87171',
                  background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}
              >
                🛑 中断检测 ({batchProgress.current}/{batchProgress.total})
              </button>
            ) : (
              <button
                onClick={handleBatchTestSources}
                style={{
                  padding: '8px 16px', borderRadius: '8px', border: 'none',
                  background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}
                title="一键并发检测全量/当前搜出书源的连通性，并自动勾选搜不到书的失效书源"
              >
                🧪 一键检测书源
              </button>
            )}

            {/* 🔥 一键清除已勾选失效书源按钮 */}
            <button
              onClick={handleBatchDeleteSelected}
              disabled={selectedIds.size === 0 || batchDeleting || batchTesting}
              style={{
                padding: '8px 16px', borderRadius: '8px',
                border: selectedIds.size > 0 ? '1px solid #f87171' : '1px solid var(--border)',
                background: selectedIds.size > 0 ? '#ef4444' : 'var(--bg-layer1)',
                color: selectedIds.size > 0 ? '#fff' : 'var(--text-muted)',
                cursor: (selectedIds.size === 0 || batchDeleting || batchTesting) ? 'not-allowed' : 'pointer',
                fontSize: '13px', fontWeight: selectedIds.size > 0 ? 600 : 400,
                display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s'
              }}
              title="一键清理所有被勾选的失效/废弃书源"
            >
              {batchDeleting ? (
                <>🗑️ 正在删除 ({deleteProgress.current}/{deleteProgress.total})...</>
              ) : (
                <>🗑️ 清除已勾选 ({selectedIds.size})</>
              )}
            </button>

            <button
              onClick={handleImportFile}
              disabled={batchDeleting || batchTesting}
              style={{
                padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border)',
                background: 'var(--bg-layer1)', color: 'var(--text-primary)', cursor: (batchDeleting || batchTesting) ? 'not-allowed' : 'pointer', fontSize: '13px',
                display: 'flex', alignItems: 'center', gap: '6px'
              }}
            >
              📥 导入 JSON
            </button>

            <button
              onClick={handleExportAll}
              disabled={batchDeleting || batchTesting}
              title={selectedIds.size > 0 ? `导出选中的 ${selectedIds.size} 个书源为开源阅读 3.0 格式 JSON` : "导出全量书源配置 JSON"}
              style={{
                padding: '8px 14px', borderRadius: '8px',
                border: selectedIds.size > 0 ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: selectedIds.size > 0 ? 'var(--bg-layer2)' : 'var(--bg-layer1)',
                color: selectedIds.size > 0 ? 'var(--accent-light)' : 'var(--text-primary)',
                cursor: (batchDeleting || batchTesting) ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: selectedIds.size > 0 ? 600 : 400,
                display: 'flex', alignItems: 'center', gap: '6px'
              }}
            >
              {selectedIds.size > 0 ? `📤 导出已勾选 (${selectedIds.size})` : '📤 导出书源'}
            </button>

            <button
              onClick={handleClearAllSources}
              disabled={batchDeleting || batchTesting}
              style={{
                padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(248, 113, 113, 0.4)',
                background: 'var(--bg-layer2)', color: '#f87171', cursor: (batchDeleting || batchTesting) ? 'not-allowed' : 'pointer', fontSize: '13px',
                display: 'flex', alignItems: 'center', gap: '4px'
              }}
              title="彻底清空当前所有书源规则，打造纯净空书源模式"
            >
              🗑️ 清空所有
            </button>
          </div>

          {/* 一键批量删除中的实时进度条 */}
          {batchDeleting && (
            <div style={{
              background: 'var(--bg-layer1)', padding: '12px 16px', borderRadius: '10px',
              border: '1px solid #f87171', marginBottom: '16px', fontSize: '12px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: 'var(--text-primary)', fontWeight: 500 }}>
                <span>🗑️ 正在批量清理已勾选的书源...</span>
                <span style={{ color: '#f87171', fontFamily: 'monospace', fontWeight: 600 }}>
                  {deleteProgress.current} / {deleteProgress.total} ({Math.round((deleteProgress.current / (deleteProgress.total || 1)) * 100)}%)
                </span>
              </div>
              <div style={{ height: '6px', background: 'var(--bg-layer2)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ height: '100%', width: `${(deleteProgress.current / (deleteProgress.total || 1)) * 100}%`, background: '#f87171', transition: 'width 0.2s' }} />
              </div>
              <div style={{ display: 'flex', gap: '16px', color: 'var(--text-muted)' }}>
                <span style={{ color: '#4ade80' }}>已成功清理: {deleteProgress.successCount} 个</span>
                <span>剩余待处理: {Math.max(0, deleteProgress.total - deleteProgress.current)} 个</span>
              </div>
            </div>
          )}

          {/* 一键检测中的实时进度条 */}
          {batchTesting && (
            <div style={{
              background: 'var(--bg-layer1)', padding: '12px 16px', borderRadius: '10px',
              border: '1px solid var(--accent)', marginBottom: '16px', fontSize: '12px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: 'var(--text-primary)', fontWeight: 500 }}>
                <span>⚡ 正在 10 线程并发跑自动化连通性诊断...</span>
                <span style={{ color: 'var(--accent-light)', fontFamily: 'monospace' }}>
                  {batchProgress.current} / {batchProgress.total} ({Math.round((batchProgress.current / (batchProgress.total || 1)) * 100)}%)
                </span>
              </div>
              <div style={{ height: '6px', background: 'var(--bg-layer2)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ height: '100%', width: `${(batchProgress.current / (batchProgress.total || 1)) * 100}%`, background: 'var(--accent)', transition: 'width 0.2s' }} />
              </div>
              <div style={{ display: 'flex', gap: '16px', color: 'var(--text-muted)' }}>
                <span style={{ color: '#4ade80' }}>✅ 正常可用: {batchProgress.validCount} 个</span>
                <span style={{ color: '#f87171' }}>❌ 失效/已自动勾选: {batchProgress.invalidCount} 个</span>
              </div>
            </div>
          )}

          {/* 复选框快捷操作条 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={filteredSources.length > 0 && filteredSources.every(s => selectedIds.has(s.id))}
                onChange={e => handleSelectAll(e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: '15px', height: '15px', cursor: 'pointer' }}
              />
              {searchQuery.trim() ? `全选搜索结果 (${filteredSources.length})` : `全选所有书源 (${sources.length})`}
            </label>

            {invalidIds.size > 0 && (
              <button
                onClick={handleSelectOnlyInvalid}
                style={{
                  padding: '2px 8px', borderRadius: '4px', border: '1px solid #f87171',
                  background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', cursor: 'pointer', fontSize: '11px'
                }}
              >
                ⚠️ 仅勾选检测出的 {invalidIds.size} 个失效书源
              </button>
            )}

            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px' }}
              >
                取消勾选
              </button>
            )}
          </div>

          {/* 列表渲染 */}
          {sources.length === 0 ? (
            <div style={{ padding: '70px 20px', textAlign: 'center', background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: '48px', display: 'block', marginBottom: '14px' }}>📚</span>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '17px', color: 'var(--text-primary)' }}>当前未导入任何书源</h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', marginInline: 'auto', lineHeight: '1.6' }}>
                本软件原始不内置任何预置书源。您可以点击下方【📥 导入 JSON 书源】添加您自己的自定义书源或开源阅读 3.0 (Legado) 规则文件。
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handleImportFile}
                  style={{
                    padding: '8px 20px', borderRadius: '8px', border: 'none',
                    background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600
                  }}
                >
                  📥 导入 JSON 书源文件
                </button>
                <button
                  onClick={() => setActiveTab('create')}
                  style={{
                    padding: '8px 18px', borderRadius: '8px', border: '1px solid var(--border)',
                    background: 'var(--bg-layer2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'
                  }}
                >
                  🛠️ 在工坊中手动新建书源
                </button>
              </div>
            </div>
          ) : filteredSources.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: '42px', display: 'block', marginBottom: '12px' }}>🔍</span>
              <p style={{ margin: '0 0 8px 0', fontSize: '15px', color: 'var(--text-primary)' }}>未搜索到包含“{searchQuery}”的书源规则</p>
              <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: 'var(--text-muted)' }}>您可以尝试搜索书源名称或域名关键词</p>
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  padding: '6px 16px', borderRadius: '6px', border: '1px solid var(--accent)',
                  background: 'var(--bg-layer2)', color: 'var(--accent-light)', cursor: 'pointer', fontSize: '12px'
                }}
              >
                🔄 清空搜索词并显示全部
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {filteredSources.map((src, idx) => {
                const isSelected = selectedIds.has(src.id)
                const isInvalid = invalidIds.has(src.id)
                return (
                  <div
                    key={src.id || idx}
                    style={{
                      background: isSelected ? 'var(--bg-layer2)' : 'var(--bg-layer1)',
                      borderRadius: '10px',
                      border: `1px solid ${isInvalid ? '#f87171' : (isSelected ? 'var(--accent)' : 'var(--border-subtle)')}`,
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      opacity: src.enabled ? 1 : 0.6,
                      transition: 'all 0.2s'
                    }}
                  >
                    {/* 序号与多选勾选复选框 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '12px', width: '20px' }}>{idx + 1}</span>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          const next = new Set(selectedIds)
                          if (e.target.checked) next.add(src.id)
                          else next.delete(src.id)
                          setSelectedIds(next)
                        }}
                        title={isSelected ? '取消勾选' : '勾选此书源以便一键删除/清除'}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent)' }}
                      />
                    </div>

                    {/* 书源信息 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                          {src.name}
                        </span>
                        {isInvalid && (
                          <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: '#f8717120', color: '#f87171', fontWeight: 600 }}>
                            ⚠️ 检测到失效/搜不到书
                          </span>
                        )}
                        <span style={{
                          fontSize: '11px', padding: '1px 6px', borderRadius: '4px',
                          background: src.isCustom ? '#8b5cf620' : (src.isBuiltin ? '#3b82f620' : '#10b98120'),
                          color: src.isCustom ? '#a78bfa' : (src.isBuiltin ? '#60a5fa' : '#34d399'),
                          fontWeight: 500
                        }}>
                          {src.isCustom ? '自定义' : (src.isBuiltin ? '核心源' : '规则源')}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {src.baseUrl || '内置处理'}
                      </div>
                    </div>

                {/* 操作按钮组 */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleRunSourceTest(src)}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--accent)',
                      background: 'var(--bg-layer2)', color: 'var(--accent-light)', cursor: 'pointer', fontSize: '12px', fontWeight: 600
                    }}
                    title="对该书源发起全链路连通性与可用性真实测试"
                  >
                    🧪 测试
                  </button>
                  <button
                    onClick={() => setViewDetailModal(src)}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)',
                      background: 'var(--bg-layer2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '12px'
                    }}
                  >
                    查看内容
                  </button>
                  <button
                    onClick={(e) => handleEdit(src, e)}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)',
                      background: 'var(--bg-layer2)', color: 'var(--accent-light)', cursor: 'pointer', fontSize: '12px'
                    }}
                  >
                    修改
                  </button>
                  <button
                    onClick={(e) => handleExportSingle(src, e)}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)',
                      background: 'var(--bg-layer2)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px'
                    }}
                  >
                    导出
                  </button>
                  <button
                    onClick={(e) => handleDelete(src, e)}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(248, 113, 113, 0.3)',
                      background: 'var(--bg-layer2)', color: '#f87171', cursor: 'pointer', fontSize: '12px'
                    }}
                  >
                    {src.isCustom ? '删除' : '停用'}
                  </button>
                </div>
              </div>
            )})}
          </div>
          )}
        </div>
      )}

      {/* TAB 2: 制作与沙盒工坊 */}
      {activeTab === 'create' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '24px' }}>
          {/* 左栏：制作表单 */}
          <div style={{
            background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
            padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--accent)' }}>新建小说书源规则</h3>
              <button
                onClick={handleAutoSniff}
                disabled={sniffing}
                title="填入主站 URL 或搜索 URL 模板后，全自动抓取并推导结果列表、目录列表、正文容器等全部选择器规则"
                style={{
                  padding: '7px 14px', borderRadius: '6px', border: '1px solid var(--accent)',
                  background: sniffing ? 'var(--bg-layer2)' : 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(59, 130, 246, 0.15))',
                  color: 'var(--accent)', cursor: sniffing ? 'not-allowed' : 'pointer',
                  fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.2s ease', opacity: sniffing ? 0.7 : 1
                }}
              >
                <span>{sniffing ? '⚡' : '🤖'}</span>
                <span>{sniffing ? '正在智能探测与分析 DOM...' : '智能一键预断'}</span>
              </button>
            </div>

            {/* 帮助卡片说明 */}
            <div style={{
              background: 'var(--bg-layer2)', padding: '12px 16px', borderRadius: '8px',
              border: '1px solid var(--accent-light)', fontSize: '12px', lineHeight: '1.6', color: 'var(--text-secondary)'
            }}>
              <div style={{ fontWeight: 600, color: 'var(--accent-light)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                💡 智能一键生成与上手指南：
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                <li><strong>✨ 全自动智能嗅探</strong>：输入【主站基准 URL】或【搜索 URL 模板】后，点击右上角【🤖 智能一键预断】，系统会自动请求并分析 DOM，全自动填充<strong>结果列表、目录列表、正文容器、编码与名称</strong>！</li>
                <li><strong>URL 中的 <code>%s</code></strong>：代表搜索关键词占位符，会自动替换为输入的书名或作者名。</li>
                <li><strong>选择器语法</strong>：支持标准 CSS 选择器（如 <code>#content</code>、<code>.read-content</code>、<code>tr</code>、<code>h3 &gt; a</code>）。</li>
                <li><strong>广告清洗</strong>：支持用竖线 <code>|</code> 分隔或多行写正则表达式，自动擦除正文中的防爬文字与引流网址。</li>
              </ul>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  书源名称 <span style={{ color: '#f87171' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：笔趣阁365、书海阁小说"
                  value={sourceName}
                  onChange={e => setSourceName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>方便在搜书下拉菜单中识别此书源</span>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  主站基准 URL <span style={{ color: '#f87171' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：https://www.biquge.com"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>用于自动拼接相对路径图片和章节网址</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  搜索 URL 模板 (用 %s 代替关键词)
                </label>
                <input
                  type="text"
                  placeholder="例如：https://www.biquge.com/s.php?q=%s"
                  value={searchUrl}
                  onChange={e => setSearchUrl(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>发送搜索请求的网址，<code>%s</code> 会被替换为输入的书名</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>请求方式</label>
                <select
                  value={searchMethod}
                  onChange={e => setSearchMethod(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                >
                  <option value="GET">GET 请求</option>
                  <option value="POST">POST 请求</option>
                </select>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>多数为 GET</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>编码格式</label>
                <select
                  value={encoding}
                  onChange={e => setEncoding(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="gbk">GBK / GB2312</option>
                </select>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>老旧站选 GBK</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  搜索结果列表项选择器
                </label>
                <input
                  type="text"
                  placeholder="例如：.result_list > li 或 tr 或 .bookbox"
                  value={resultSelector}
                  onChange={e => setResultSelector(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
                <div style={{ marginTop: '5px', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', lineHeight: '1.5' }}>
                  <div style={{ color: 'var(--text-muted)' }}>源码范例：<code>&lt;ul class="book-list"&gt; &lt;li&gt;&lt;a&gt;书名&lt;/a&gt;&lt;/li&gt; &lt;/ul&gt;</code></div>
                  <div style={{ color: '#34d399', fontWeight: 500 }}>👉 填写：<code>.book-list &gt; li</code> 或 <code>tr</code> 或 <code>.result-item</code></div>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  目录列表项选择器
                </label>
                <input
                  type="text"
                  placeholder="例如：#list > dl > dd > a 或 .catalog a"
                  value={chapterSelector}
                  onChange={e => setChapterSelector(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
                <div style={{ marginTop: '5px', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', lineHeight: '1.5' }}>
                  <div style={{ color: 'var(--text-muted)' }}>源码范例：<code>&lt;div id="list"&gt; &lt;dd&gt;&lt;a href="1.html"&gt;第一章&lt;/a&gt;&lt;/dd&gt; &lt;/div&gt;</code></div>
                  <div style={{ color: '#34d399', fontWeight: 500 }}>👉 填写：<code>#list dd a</code> 或 <code>dl &gt; dd &gt; a</code> 或 <code>.catalog a</code></div>
                </div>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                正文内容 DOM 选择器
              </label>
              <input
                type="text"
                placeholder="例如：#content 或 .read-content 或 #txtContent 或 .showtxt"
                value={contentSelector}
                onChange={e => setContentSelector(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
              />
              <div style={{ marginTop: '5px', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', lineHeight: '1.5' }}>
                <div style={{ color: 'var(--text-muted)' }}>源码范例：<code>&lt;div id="content"&gt;正文文字...&lt;/div&gt;</code> 或 <code>&lt;div class="read-content"&gt;...&lt;/div&gt;</code></div>
                <div style={{ color: '#34d399', fontWeight: 500 }}>👉 填写：<code>#content</code> 或 <code>.read-content</code> 或 <code>#txtContent</code> 或 <code>.showtxt</code></div>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                广告与引流文本清洗正则 (每行一个或用 | 分隔)
              </label>
              <textarea
                rows={2}
                placeholder="例如：请记住本书首发.* | 天才一秒记住.* | https?://[\w./]+"
                value={cleanRules}
                onChange={e => setCleanRules(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontFamily: 'monospace' }}
              />
              <div style={{ marginTop: '4px', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', lineHeight: '1.5' }}>
                <div style={{ color: 'var(--text-muted)' }}>净化说明：支持正则表达式，在抓取并保存小说正文时自动擦除引流域名、防盗文字和弹窗内容。</div>
              </div>
            </div>

            <button
              onClick={async () => {
                if (!sourceName.trim() || !baseUrl.trim()) {
                  showToast('请填写书源名称和网址', 'error')
                  return
                }
                const ruleObj = {
                  name: sourceName.trim(),
                  url: baseUrl.trim(),
                  encoding,
                  search: { url: searchUrl.trim(), method: searchMethod, result: resultSelector.trim() },
                  toc: { item: chapterSelector.trim() },
                  chapter: { content: contentSelector.trim(), filterTxt: cleanRules }
                }
                const res = await window.api?.novelSaveSource?.(ruleObj)
                if (res?.success) {
                  showToast(`书源“${sourceName}”创建成功！`, 'success')
                  setActiveTab('list')
                  reloadSources()
                } else {
                  showToast('创建失败: ' + (res?.error || '未知错误'), 'error')
                }
              }}
              style={{
                padding: '10px', borderRadius: '8px', border: 'none',
                background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '14px',
                marginTop: '10px'
              }}
            >
              💾 保存并加入书源库
            </button>
          </div>

          {/* 右栏：测试控制台 */}
          <div style={{
            background: 'var(--bg-layer1)', borderRadius: '12px', border: '1px solid var(--border)',
            padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px'
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>🧪 即时测试沙盒</h3>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
              填入目标网站的任意一个具体章节网址，点击测试校验规则配置是否正确。
            </p>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>测试章节 URL</label>
              <input
                type="text"
                placeholder="例如：https://www.biquge.com/book/123/456.html"
                value={testUrl}
                onChange={e => setTestUrl(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
              />
            </div>

            <button
              onClick={handleTestContent}
              disabled={testing}
              style={{
                padding: '8px', borderRadius: '6px', border: 'none',
                background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '13px'
              }}
            >
              {testing ? '正在解析...' : '🧪 测试抓取效果'}
            </button>

            <div style={{ flex: 1, minHeight: '260px', background: 'var(--bg-base)', color: '#38bdf8', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '12px', overflowY: 'auto', border: '1px solid var(--border)' }}>
              {logs.map((log, i) => (
                <div key={i} style={{ color: log.includes('SUCCESS') ? '#4ade80' : '#38bdf8' }}>{log}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 查看书源内容弹窗 */}
      {viewDetailModal && (
        <div
          className="source-manager-modal-overlay"
          onClick={() => setViewDetailModal(null)}
        >
          <div
            className="source-manager-modal"
            style={{
              width: '620px',
              maxHeight: '82vh',
              padding: '24px'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>📋</span> 书源规则配置：{viewDetailModal.name}
              </h3>
              <button
                onClick={() => setViewDetailModal(null)}
                style={{
                  background: 'var(--bg-layer2)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                  width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: '14px'
                }}
              >
                ✕
              </button>
            </div>

            <pre style={{
              flex: 1,
              overflowY: 'auto',
              backgroundColor: '#0d0d14',
              background: 'var(--bg-base)',
              padding: '16px',
              borderRadius: '8px',
              color: '#38bdf8',
              fontSize: '12px',
              lineHeight: 1.6,
              fontFamily: 'Consolas, monospace',
              border: '1px solid var(--border)'
            }}>
              {JSON.stringify(viewDetailModal.rule || viewDetailModal, null, 2)}
            </pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button
                onClick={(e) => {
                  handleEdit(viewDetailModal, e)
                  setViewDetailModal(null)
                }}
                style={{
                  padding: '8px 18px', borderRadius: '8px', background: 'var(--accent)', color: '#fff',
                  border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px'
                }}
              >
                编辑此书源
              </button>
              <button
                onClick={() => setViewDetailModal(null)}
                style={{
                  padding: '8px 18px', borderRadius: '8px', background: 'var(--bg-layer2)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', cursor: 'pointer', fontSize: '13px'
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 修改书源弹窗 - 带详细提示引导与示范占位 */}
      {editModal && (
        <div
          className="source-manager-modal-overlay"
          style={{ zIndex: 2100 }}
          onClick={() => setEditModal(null)}
        >
          <div
            className="source-manager-modal"
            style={{
              width: '640px',
              maxHeight: '85vh',
              padding: '24px',
              gap: '14px',
              overflowY: 'auto'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>✏️</span> 修改书源规则：{editModal.name}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={async () => {
                    if (!editModal) return
                    const targetBase = editModal.url?.trim()
                    const targetSearch = editModal.searchUrl?.trim()
                    if (!targetBase && !targetSearch) {
                      showToast('请先输入主站基准 URL 或搜索 URL 模板', 'warning')
                      return
                    }
                    setSniffing(true)
                    try {
                      const res = await window.api?.novelAutoSniffRule?.({
                        baseUrl: targetBase,
                        searchUrl: targetSearch
                      })
                      if (res && res.success && res.rule) {
                        const r = res.rule
                        setEditModal(prev => ({
                          ...prev,
                          name: r.sourceName || prev.name,
                          url: r.baseUrl || prev.url,
                          searchUrl: r.searchUrl || prev.searchUrl,
                          searchMethod: r.searchMethod || prev.searchMethod,
                          encoding: r.encoding || prev.encoding,
                          resultSelector: r.resultSelector || prev.resultSelector,
                          chapterSelector: r.chapterSelector || prev.chapterSelector,
                          contentSelector: r.contentSelector || prev.contentSelector,
                          cleanRules: r.cleanRules || prev.cleanRules
                        }))
                        showToast('🎉 智能预断成功！已自动更新当前编辑弹窗中的规则！', 'success')
                      } else {
                        showToast('智能预断未识别到完整结构: ' + (res?.error || '请检查网站是否可访问'), 'error')
                      }
                    } catch (err) {
                      showToast('智能预断出错: ' + err.message, 'error')
                    } finally {
                      setSniffing(false)
                    }
                  }}
                  disabled={sniffing}
                  style={{
                    padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--accent)',
                    background: 'var(--bg-layer2)', color: 'var(--accent)', cursor: sniffing ? 'not-allowed' : 'pointer',
                    fontSize: '11px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px'
                  }}
                >
                  <span>{sniffing ? '⚡' : '🤖'}</span>
                  <span>{sniffing ? '正在预断...' : '智能预断'}</span>
                </button>
                <button
                  onClick={() => setEditModal(null)}
                  style={{
                    background: 'var(--bg-layer2)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                    width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '14px'
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 顶栏说明 */}
            <div style={{
              background: 'var(--bg-layer2)', padding: '10px 14px', borderRadius: '6px',
              fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5'
            }}>
              💡 修改提示：您可以调整书源的名字、请求方式、编码格式、接口网址或 DOM 选择器。网址中支持使用 <code>%s</code> 作为搜书关键词占位符。
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  书源名称 <span style={{ color: '#f87171' }}>*</span>
                </label>
                <input
                  type="text"
                  value={editModal.name}
                  onChange={e => setEditModal({ ...editModal, name: e.target.value })}
                  placeholder="例如：笔趣阁365"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  主站基准 URL <span style={{ color: '#f87171' }}>*</span>
                </label>
                <input
                  type="text"
                  value={editModal.url}
                  onChange={e => setEditModal({ ...editModal, url: e.target.value })}
                  placeholder="例如：https://www.biquge.com"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  搜索请求 URL 模板 (用 %s 代替关键词)
                </label>
                <input
                  type="text"
                  value={editModal.searchUrl}
                  onChange={e => setEditModal({ ...editModal, searchUrl: e.target.value })}
                  placeholder="例如：https://www.biquge.com/s.php?q=%s"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>搜书时发送请求的接口网址</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>请求方式</label>
                <select
                  value={editModal.searchMethod || 'GET'}
                  onChange={e => setEditModal({ ...editModal, searchMethod: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                >
                  <option value="GET">GET 请求</option>
                  <option value="POST">POST 请求</option>
                </select>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>多数为 GET</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>编码格式</label>
                <select
                  value={editModal.encoding || 'utf-8'}
                  onChange={e => setEditModal({ ...editModal, encoding: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontSize: '13px' }}
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="gbk">GBK / GB2312</option>
                </select>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>老旧站选 GBK</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  搜索列表项选择器
                </label>
                <input
                  type="text"
                  value={editModal.resultSelector}
                  onChange={e => setEditModal({ ...editModal, resultSelector: e.target.value })}
                  placeholder="示例：.result_list > li 或 tr 或 .bookbox"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
                <div style={{ marginTop: '5px', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', lineHeight: '1.5' }}>
                  <div style={{ color: 'var(--text-muted)' }}>源码范例：<code>&lt;ul class="book-list"&gt; &lt;li&gt;&lt;a&gt;书名&lt;/a&gt;&lt;/li&gt; &lt;/ul&gt;</code></div>
                  <div style={{ color: '#34d399', fontWeight: 500 }}>👉 填写：<code>.book-list &gt; li</code> 或 <code>tr</code> 或 <code>.result-item</code></div>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  目录列表项选择器
                </label>
                <input
                  type="text"
                  value={editModal.chapterSelector}
                  onChange={e => setEditModal({ ...editModal, chapterSelector: e.target.value })}
                  placeholder="示例：#list > dl > dd > a 或 .catalog a"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
                />
                <div style={{ marginTop: '5px', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', lineHeight: '1.5' }}>
                  <div style={{ color: 'var(--text-muted)' }}>源码范例：<code>&lt;div id="list"&gt; &lt;dd&gt;&lt;a href="1.html"&gt;第一章&lt;/a&gt;&lt;/dd&gt; &lt;/div&gt;</code></div>
                  <div style={{ color: '#34d399', fontWeight: 500 }}>👉 填写：<code>#list dd a</code> 或 <code>dl &gt; dd &gt; a</code> 或 <code>.catalog a</code></div>
                </div>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                正文内容 DOM 选择器
              </label>
              <input
                type="text"
                value={editModal.contentSelector}
                onChange={e => setEditModal({ ...editModal, contentSelector: e.target.value })}
                placeholder="示例：#content 或 .read-content 或 #txtContent 或 .showtxt"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)' }}
              />
              <div style={{ marginTop: '5px', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', lineHeight: '1.5' }}>
                <div style={{ color: 'var(--text-muted)' }}>源码范例：<code>&lt;div id="content"&gt;正文文字...&lt;/div&gt;</code> 或 <code>&lt;div class="read-content"&gt;...&lt;/div&gt;</code></div>
                <div style={{ color: '#34d399', fontWeight: 500 }}>👉 填写：<code>#content</code> 或 <code>.read-content</code> 或 <code>#txtContent</code> 或 <code>.showtxt</code></div>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 500 }}>
                广告与引流清洗正则
              </label>
              <textarea
                rows={2}
                value={editModal.cleanRules}
                onChange={e => setEditModal({ ...editModal, cleanRules: e.target.value })}
                placeholder="例如：请记住本书首发.* | https?://[\w./]+"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-layer2)', color: 'var(--text-primary)', fontFamily: 'monospace' }}
              />
              <div style={{ marginTop: '4px', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', lineHeight: '1.5' }}>
                <div style={{ color: 'var(--text-muted)' }}>净化说明：支持正则表达式，在抓取并保存小说正文时自动擦除引流域名、防盗文字和弹窗内容。</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                onClick={() => {
                  const tempSrc = {
                    id: editModal.id || 'temp',
                    name: editModal.name,
                    baseUrl: editModal.url,
                    rule: { name: editModal.name, url: editModal.url }
                  }
                  handleRunSourceTest(tempSrc)
                }}
                style={{
                  padding: '8px 16px', borderRadius: '8px', background: 'var(--bg-layer2)', color: 'var(--accent-light)',
                  border: '1px solid var(--accent)', cursor: 'pointer', fontSize: '13px', fontWeight: 600
                }}
                title="即时发起对此书源的全链路可用性测试"
              >
                🧪 测试此书源
              </button>
              <button
                onClick={() => setEditModal(null)}
                style={{
                  padding: '8px 18px', borderRadius: '8px', background: 'var(--bg-layer2)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', cursor: 'pointer', fontSize: '13px'
                }}
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                style={{
                  padding: '8px 20px', borderRadius: '8px', background: 'var(--accent)', color: '#fff',
                  border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px'
                }}
              >
                💾 保存修改
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 全链路书源可用性诊断测试弹窗 */}
      {testSourceModal && (
        <div
          className="source-manager-modal-overlay"
          style={{ zIndex: 3000, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          onClick={() => setTestSourceModal(null)}
        >
          <div
            className="source-manager-modal"
            style={{
              width: '640px',
              maxHeight: '85vh',
              padding: '24px',
              background: 'var(--bg-layer1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🧪</span> 书源可用性全链路诊断 · {testSourceModal.src.name}
              </h3>
              <button
                onClick={() => setTestSourceModal(null)}
                style={{
                  background: 'var(--bg-layer2)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                  width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: '14px'
                }}
              >
                ✕
              </button>
            </div>

            {/* 诊断结果头部卡片 */}
            <div style={{
              background: 'var(--bg-layer2)', padding: '12px 16px', borderRadius: '8px',
              border: `1px solid ${testSourceModal.running ? 'var(--accent)' : (testSourceModal.result?.success ? '#4ade80' : '#f87171')}`
            }}>
              {testSourceModal.running ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent-light)', fontSize: '13px' }}>
                  <div className="novel-loading-spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                  <span>正在对书源做【搜索 ➔ 目录 ➔ 正文】全链路真实可用性检测...</span>
                </div>
              ) : testSourceModal.result?.success ? (
                <div>
                  <div style={{ color: '#4ade80', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                    🎉 诊断结果：该书源状态优秀，各项解析均正常！
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    总响应时间: {testSourceModal.result.totalTime}ms | 搜到图书: {testSourceModal.result.count} 本 | 首书目录: {testSourceModal.result.chapters} 章 | 提取正文: {testSourceModal.result.contentLen} 字
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ color: '#f87171', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                    ⚠️ 诊断结果：测试未完全通过 ({testSourceModal.result?.reason})
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    该书源目标站点当前可能不可用、响应超时或需要调整 DOM 选择器。
                  </div>
                </div>
              )}
            </div>

            {/* 实时控制台日志输出 */}
            <div style={{
              flex: 1, minHeight: '260px', maxHeight: '340px', background: 'var(--bg-base)',
              color: '#38bdf8', borderRadius: '8px', padding: '14px', fontFamily: 'Consolas, monospace',
              fontSize: '12px', lineHeight: '1.7', overflowY: 'auto', border: '1px solid var(--border)'
            }}>
              {testSourceModal.logs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    color: log.includes('✅') || log.includes('🎉') ? '#4ade80' : (log.includes('❌') ? '#f87171' : (log.includes('⚠️') ? '#facc15' : '#38bdf8'))
                  }}
                >
                  {log}
                </div>
              ))}
            </div>

            {/* 底部按钮 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => handleRunSourceTest(testSourceModal.src)}
                disabled={testSourceModal.running}
                style={{
                  padding: '8px 18px', borderRadius: '8px', background: 'var(--bg-layer2)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', cursor: testSourceModal.running ? 'not-allowed' : 'pointer', fontSize: '13px'
                }}
              >
                🔄 重新测试
              </button>
              <button
                onClick={() => setTestSourceModal(null)}
                style={{
                  padding: '8px 20px', borderRadius: '8px', background: 'var(--accent)', color: '#fff',
                  border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px'
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
