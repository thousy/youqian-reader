import React, { useState, useEffect } from 'react'

export function SourceSwitcherModal({ isOpen, onClose, book, currentChapterTitle, currentChapterIndex = 0, onSourceSwitched }) {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(false)
  const [switchingSourceId, setSwitchingSourceId] = useState(null)
  const [searchError, setSearchError] = useState(null)
  const [blockedSources, setBlockedSources] = useState([])
  const [showBlockedManager, setShowBlockedManager] = useState(false)
  const [blockToast, setBlockToast] = useState(null)

  // 判定书源是否已被本书屏蔽
  const isSourceBlocked = (src, list = blockedSources) => {
    if (!src || !Array.isArray(list) || list.length === 0) return false
    return list.some(b => {
      if (typeof b === 'string') return b === src.sourceId || (src.novelUrl && b === src.novelUrl)
      if (b && typeof b === 'object') {
        if (b.sourceId && b.sourceId === src.sourceId) return true
        if (b.novelUrl && src.novelUrl && b.novelUrl === src.novelUrl) return true
      }
      return false
    })
  }

  useEffect(() => {
    if (isOpen && book) {
      const initBlocked = Array.isArray(book.blockedSources) ? book.blockedSources : []
      setBlockedSources(initBlocked)

      // 优先展示当前在用书源（若当前书源未被屏蔽）
      const isCurBlocked = book.novelSourceId && initBlocked.some(b => b.sourceId === book.novelSourceId || (book.novelUrl && b.novelUrl === book.novelUrl))
      const currentSourceItem = (book.novelSourceId && !isCurBlocked) ? [{
        sourceId: book.novelSourceId,
        sourceName: book.sourceName || '当前书源',
        novelUrl: book.novelUrl,
        title: book.title,
        author: book.author,
        latestChapter: book.latestChapter || '正在阅读',
        chapterCount: book.totalChapters || 0,
        isCurrent: true
      }] : []
      setSources(currentSourceItem)
      handleSearchSources(currentSourceItem, initBlocked)

      // 注册增量发现流式监听
      const cleanup = window.api?.onNovelAlternativeSourceFound?.((newSource) => {
        if (!newSource || !newSource.novelUrl) return
        if (isSourceBlocked(newSource, initBlocked)) return
        setSources(prev => {
          const key = `${newSource.sourceId}_${newSource.novelUrl}`
          const exists = prev.some(s => `${s.sourceId}_${s.novelUrl}` === key)
          if (exists) return prev
          return [...prev, newSource]
        })
      })

      return () => {
        if (typeof cleanup === 'function') cleanup()
      }
    }
  }, [isOpen, book])

  const handleSearchSources = async (initialSources = [], currentBlocked = blockedSources) => {
    setLoading(true)
    setSearchError(null)

    try {
      const res = await window.api.novelSearchAlternativeSources(
        book.title,
        book.author,
        currentChapterTitle,
        currentChapterIndex,
        currentBlocked
      )
      if (res.success) {
        const remoteSources = (res.sources || []).filter(s => !isSourceBlocked(s, currentBlocked))
        // 合并当前源与搜出的其他新源（严格按 sourceId + novelUrl 唯一校验）
        const currentId = book.novelSourceId
        const currentUrl = book.novelUrl
        const hasCurrentInRemote = remoteSources.some(s => s.sourceId === currentId && s.novelUrl === currentUrl)
        
        let merged = remoteSources
        if (!hasCurrentInRemote && initialSources.length > 0) {
          const safeInitial = initialSources.filter(s => !isSourceBlocked(s, currentBlocked))
          merged = [...safeInitial, ...remoteSources]
        }
        setSources(prev => {
          // 合并已有流式获取到的源和最终返回的源，并排除已屏蔽项
          const map = new Map()
          merged.forEach(s => {
            if (!isSourceBlocked(s, currentBlocked)) {
              map.set(`${s.sourceId}_${s.novelUrl}`, s)
            }
          })
          prev.forEach(s => {
            const k = `${s.sourceId}_${s.novelUrl}`
            if (!map.has(k) && !isSourceBlocked(s, currentBlocked)) map.set(k, s)
          })
          return Array.from(map.values())
        })
      } else {
        setSearchError(res.error || '检索可用书源失败')
      }
    } catch (e) {
      setSearchError('换源检索异常: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // 屏蔽问题书源（标记采集异常，下次换源不再展示）
  const handleBlockSource = async (src, e) => {
    e?.stopPropagation()
    const confirmBlock = window.confirm(`确定要屏蔽书源「${src.sourceName}」吗？\n\n屏蔽后，本书（《${book.title}》）在下次换源时将不再展示此书源。\n您可以在弹窗底部随时查看或恢复已屏蔽的书源。`)
    if (!confirmBlock) return

    const blockItem = {
      sourceId: src.sourceId,
      sourceName: src.sourceName,
      novelUrl: src.novelUrl,
      reason: '采集异常/正文缺失',
      blockedAt: new Date().toISOString()
    }

    const updated = [...blockedSources.filter(b => b.sourceId !== src.sourceId && b.novelUrl !== src.novelUrl), blockItem]
    setBlockedSources(updated)
    if (book) {
      book.blockedSources = updated
      try {
        await window.api.updateBook(book.id, { blockedSources: updated })
      } catch (_) {}
    }

    // 从当前列表中移除
    setSources(prev => prev.filter(s => s.sourceId !== src.sourceId && s.novelUrl !== src.novelUrl))

    setBlockToast(`已成功屏蔽「${src.sourceName}」，本书将不再展示此书源`)
    setTimeout(() => setBlockToast(null), 3500)
  }

  // 解除屏蔽恢复书源
  const handleUnblockSource = async (item) => {
    const updated = blockedSources.filter(b => b.sourceId !== item.sourceId && b.novelUrl !== item.novelUrl)
    setBlockedSources(updated)
    if (book) {
      book.blockedSources = updated
      try {
        await window.api.updateBook(book.id, { blockedSources: updated })
      } catch (_) {}
    }
    setBlockToast(`已解除对「${item.sourceName}」的屏蔽，正在重新检索...`)
    setTimeout(() => setBlockToast(null), 3500)
    handleSearchSources([], updated)
  }

  const handleSelectSource = async (src) => {
    if (src.sourceId === book.novelSourceId && src.novelUrl === book.novelUrl) {
      onClose()
      return
    }

    const switchKey = `${src.sourceId}_${src.novelUrl}`
    setSwitchingSourceId(switchKey)
    try {
      const res = await window.api.novelSwitchSource(
        book.id,
        src.sourceId,
        src.novelUrl,
        currentChapterTitle,
        currentChapterIndex
      )
      if (res.success) {
        onSourceSwitched?.({
          sourceId: src.sourceId,
          sourceName: src.sourceName,
          novelUrl: src.novelUrl,
          alignedIndex: res.alignedIndex,
          alignedTitle: res.alignedTitle
        })
        onClose()
      } else {
        alert('切换书源失败: ' + res.error)
      }
    } catch (e) {
      alert('切换书源异常: ' + e.message)
    } finally {
      setSwitchingSourceId(null)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        backdropFilter: 'blur(6px)'
      }}
      onClick={onClose}
    >
      <div
        className="source-switcher-modal"
        style={{
          width: '560px',
          maxWidth: '92vw',
          maxHeight: '80vh',
          backgroundColor: 'var(--bg-layer1)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px 24px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          color: 'var(--text-primary)',
          fontFamily: 'inherit'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px' }}>🔄</span>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              换源 - 《{book?.title}》
            </h3>
            {sources.length > 0 && (
              <span
                style={{
                  fontSize: '11px',
                  backgroundColor: loading ? 'rgba(99, 102, 241, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                  color: loading ? 'var(--accent-light)' : '#22c55e',
                  border: loading ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid rgba(34, 197, 94, 0.3)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                {loading ? (
                  <>
                    <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: '10px' }}>⏳</span>
                    <span>已检索到 {sources.length} 个书源...</span>
                  </>
                ) : (
                  <>
                    <span>✓</span>
                    <span>共找到 {sources.length} 个可用书源</span>
                  </>
                )}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: '18px',
              padding: '4px'
            }}
          >
            ✕
          </button>
        </div>

        {/* 提示与状态 */}
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            对齐基准章节：<strong style={{ color: 'var(--accent-light)' }}>{currentChapterTitle || '正在阅读'}</strong>
            {sources.length > 0 && (
              <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>
                (已搜到 <strong style={{ color: '#22c55e' }}>{sources.length}</strong> 个源)
              </span>
            )}
          </span>
          <button
            onClick={() => handleSearchSources()}
            disabled={loading}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '2px 8px',
              color: 'var(--accent-light)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '11px'
            }}
          >
            {loading ? '正在并发检索...' : '重新检测书源'}
          </button>
        </div>

        {/* 3要点严格匹配过滤条件栏 */}
        <div
          style={{
            padding: '6px 10px',
            backgroundColor: 'var(--bg-layer2)',
            borderRadius: '6px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          <span style={{ color: 'var(--accent-light)', fontWeight: 600 }}>🔍 严格筛选中:</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ color: '#22c55e' }}>✓</span> 书名一致 (《{book?.title}》)
          </span>
          {book?.author && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ color: '#22c55e' }}>✓</span> 作者一致或缺省 ({book.author})
            </span>
          )}
          {currentChapterTitle && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ color: '#22c55e' }}>✓</span> 章节存在 ({currentChapterTitle.length > 10 ? currentChapterTitle.slice(0, 10) + '...' : currentChapterTitle})
            </span>
          )}
        </div>

        {/* 书源列表 */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '180px', maxHeight: '420px' }}>
          {loading ? (
            <div style={{ padding: '7px 12px', background: 'var(--bg-layer2)', borderRadius: '6px', fontSize: '11px', color: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</div>
                <span>正在多源并发检索中... 已实时发现 <strong>{sources.length}</strong> 个可用书源</span>
              </div>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>流式发现中...</span>
            </div>
          ) : sources.length > 0 ? (
            <div style={{ padding: '5px 10px', background: 'var(--bg-layer2)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>✅ 全网检索完毕，已成功找到 <strong>{sources.length}</strong> 个可用同名书源</span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>点击即可智能对齐切换</span>
            </div>
          ) : null}

          {!loading && searchError && sources.length === 0 && (
            <div style={{ textAlign: 'center', padding: '30px 0', color: '#ef4444', fontSize: '13px' }}>
              {searchError}
            </div>
          )}

          {!loading && sources.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
              暂未搜索到其他可用同名书源，您可以前往「书源管理」导入更多阅读 3.0 书源规则。
            </div>
          )}

          {sources.map((src, idx) => {
            const switchKey = `${src.sourceId}_${src.novelUrl}`
            const isCurrent = src.sourceId === book.novelSourceId && (!src.novelUrl || !book.novelUrl || src.novelUrl === book.novelUrl)
            const isSwitching = switchingSourceId === switchKey

            return (
              <div
                key={`${src.sourceId}_${idx}`}
                onClick={() => !isSwitching && handleSelectSource(src)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  backgroundColor: isCurrent ? 'var(--bg-layer2)' : 'var(--bg-layer3)',
                  border: isCurrent ? '1.5px solid var(--accent)' : '1px solid var(--border-subtle)',
                  cursor: isSwitching ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  transition: 'var(--transition)'
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) e.currentTarget.style.backgroundColor = 'var(--bg-layer3)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, overflow: 'hidden' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      color: isCurrent ? 'var(--accent-light)' : 'var(--text-muted)',
                      fontWeight: 600,
                      minWidth: '22px',
                      textAlign: 'center',
                      backgroundColor: 'var(--bg-layer1)',
                      borderRadius: '4px',
                      padding: '2px 5px',
                      flexShrink: 0
                    }}
                  >
                    #{idx + 1}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px', color: isCurrent ? 'var(--accent-light)' : 'var(--text-primary)' }}>
                      {src.sourceName}
                    </span>
                    {isCurrent && (
                      <span style={{ fontSize: '10px', background: 'var(--accent)', color: '#fff', padding: '1px 6px', borderRadius: '4px' }}>
                        当前在用
                      </span>
                    )}
                    {src.authorConflict && (
                      <span
                        style={{
                          fontSize: '10px',
                          color: '#f59e0b',
                          backgroundColor: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                        title={`该源章节与书名完全匹配，但原站标注作者为「${src.author}」，与原作者「${book?.author}」不一致，可能为采集站录入偏差。`}
                      >
                        ⚠️ 标注作者: {src.author || '异议'} (章节匹配)
                      </span>
                    )}
                    {src.chapterCount && src.chapterCount > 0 ? (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        共 {src.chapterCount} 章
                      </span>
                    ) : (
                      <span style={{ fontSize: '10px', color: 'var(--accent-light)', background: 'rgba(99, 102, 241, 0.12)', padding: '1px 6px', borderRadius: '4px' }}>
                        连载中
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {src.author && <span style={{ color: src.authorConflict ? '#f59e0b' : 'var(--text-muted)', marginRight: '8px' }}>作者: {src.author}</span>}
                    最新：{src.latestChapter || '无最新章节标题'}
                  </div>
                </div>
              </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={(e) => handleBlockSource(src, e)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'transparent',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      transition: 'var(--transition)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#ef4444'
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)'
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.08)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-muted)'
                      e.currentTarget.style.borderColor = 'var(--border-subtle)'
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                    title="若该源采集异常、乱码或缺章，点击后本书下次换源将不再展示此源"
                  >
                    🚫 屏蔽
                  </button>

                  <button
                    disabled={isCurrent || isSwitching}
                    onClick={() => !isSwitching && handleSelectSource(src)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      border: 'none',
                      backgroundColor: isCurrent ? 'transparent' : 'var(--accent)',
                      color: isCurrent ? 'var(--text-muted)' : '#ffffff',
                      cursor: isCurrent || isSwitching ? 'default' : 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {isSwitching ? '对齐中...' : isCurrent ? '使用中' : '切换'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* 屏蔽状态提示条 */}
        {blockToast && (
          <div
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              backgroundColor: 'rgba(34, 197, 94, 0.15)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#22c55e',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>✓</span>
            <span>{blockToast}</span>
          </div>
        )}

        {/* 已屏蔽问题书源管理面板 */}
        {blockedSources.length > 0 && (
          <div style={{ backgroundColor: 'var(--bg-layer2)', borderRadius: '6px', padding: '8px 12px', fontSize: '11px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                🛡️ 本书已屏蔽 <strong style={{ color: '#ef4444' }}>{blockedSources.length}</strong> 个异常书源 (换源不再显示)
              </span>
              <button
                onClick={() => setShowBlockedManager(prev => !prev)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent-light)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '2px 6px'
                }}
              >
                {showBlockedManager ? '收起管理 ▲' : '查看/恢复 ▼'}
              </button>
            </div>

            {showBlockedManager && (
              <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '110px', overflowY: 'auto' }}>
                {blockedSources.map((item, bIdx) => (
                  <div key={bIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' }}>
                      🚫 <strong>{item.sourceName || item.sourceId}</strong>
                      {item.novelUrl && <span style={{ fontSize: '10px', marginLeft: '6px', opacity: 0.7 }}>({item.novelUrl})</span>}
                    </span>
                    <button
                      onClick={() => handleUnblockSource(item)}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        color: 'var(--accent-light)',
                        padding: '1px 8px',
                        fontSize: '10px',
                        cursor: 'pointer'
                      }}
                      title="恢复此书源，恢复后将重新允许本书换源展示"
                    >
                      恢复展示
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 底部说明 */}
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          💡 提示：换源时系统会自动根据当前正在阅读的章节标题，在新书源中智能对齐并跳转，不会丢失阅读进度。
        </div>
      </div>
    </div>
  )
}
