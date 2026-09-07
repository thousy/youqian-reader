import React, { useState, useEffect } from 'react'

export function OfflineCacheModal({ isOpen, onClose, book, currentChapterIndex = 0, totalChapters = 0, onCacheUpdated }) {
  const [cacheStatus, setCacheStatus] = useState({ cachedCount: 0, cachedIndices: [], totalBytes: 0 })
  const [isCaching, setIsCaching] = useState(false)
  const [progressInfo, setProgressInfo] = useState(null)
  const [isClearing, setIsClearing] = useState(false)
  const [rangeStart, setRangeStart] = useState(currentChapterIndex + 1)
  const [rangeEnd, setRangeEnd] = useState(totalChapters ? Math.min(totalChapters, currentChapterIndex + 50) : (currentChapterIndex + 50))

  // 当弹窗打开或章节索引变动时同步默认范围
  useEffect(() => {
    if (isOpen) {
      setRangeStart(currentChapterIndex + 1)
      setRangeEnd(totalChapters ? Math.min(totalChapters, currentChapterIndex + 50) : (currentChapterIndex + 50))
    }
  }, [isOpen, currentChapterIndex, totalChapters])

  // 加载当前书籍的缓存统计
  const loadCacheStatus = async () => {
    if (!book?.id) return
    try {
      const res = await window.api.novelCacheStatus(book.id)
      setCacheStatus(res || { cachedCount: 0, cachedIndices: [], totalBytes: 0 })
      onCacheUpdated?.(res)
    } catch (_) {}
  }

  useEffect(() => {
    if (isOpen && book?.id) {
      loadCacheStatus()
    }
  }, [isOpen, book?.id])

  // 监听后台缓存进度推送
  useEffect(() => {
    if (!isOpen || !book?.id) return
    const removeListener = window.api.onBatchCacheProgress(book.id, (data) => {
      setProgressInfo(data)
      if (data.finished || data.cancelled) {
        setIsCaching(false)
        loadCacheStatus()
      }
    })
    return () => {
      removeListener?.()
    }
  }, [isOpen, book?.id])

  // 启动固定数量离线预下载
  const handleStartCache = async (count) => {
    const startIdx = currentChapterIndex
    const actualCount = count === -1 ? totalChapters - startIdx : count
    setRangeStart(startIdx + 1)
    setRangeEnd(count === -1 ? totalChapters : Math.min(totalChapters, startIdx + actualCount))

    setIsCaching(true)
    setProgressInfo({ done: 0, total: actualCount, currentTitle: '准备开始...' })
    try {
      await window.api.novelStartBatchCache(book.id, startIdx, count)
    } catch (e) {
      alert('启动离线缓存失败: ' + e.message)
      setIsCaching(false)
    }
  }

  // 启动自定义范围离线下载 (从第 rangeStart 章到第 rangeEnd 章)
  const handleStartCustomRangeCache = async () => {
    let start = Math.max(1, parseInt(rangeStart) || 1)
    let end = Math.min(totalChapters || 99999, parseInt(rangeEnd) || 1)
    if (start > end) {
      alert('起始章节不能大于结束章节！')
      return
    }

    const startIndex = start - 1
    const count = end - start + 1

    setIsCaching(true)
    setProgressInfo({ done: 0, total: count, currentTitle: `准备缓存第 ${start} 至 ${end} 章...` })
    try {
      await window.api.novelStartBatchCache(book.id, startIndex, count)
    } catch (e) {
      alert('启动范围离线缓存失败: ' + e.message)
      setIsCaching(false)
    }
  }

  // 取消下载
  const handleCancelCache = async () => {
    try {
      await window.api.novelCancelBatchCache(book.id)
      setIsCaching(false)
    } catch (_) {}
  }

  // 清除离线缓存
  const handleClearCache = async () => {
    if (!window.confirm(`确定要清空《${book.title}》的所有已离线缓存章节吗？（不会影响书籍进度与书签）`)) return
    setIsClearing(true)
    try {
      await window.api.novelClearCache(book.id)
      await loadCacheStatus()
    } catch (_) {}
    finally {
      setIsClearing(false)
    }
  }

  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 KB'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
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
        className="offline-cache-modal"
        style={{
          width: '520px',
          maxWidth: '92vw',
          backgroundColor: 'var(--bg-layer1)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px 24px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          color: 'var(--text-primary)',
          fontFamily: 'inherit'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>📥</span>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              离线缓存 - 《{book?.title}》
            </h3>
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

        {/* 当前书籍缓存状态统计 */}
        <div
          style={{
            backgroundColor: 'var(--bg-layer2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px'
          }}
        >
          <div>
            已缓存：<strong style={{ color: 'var(--accent-light)' }}>{cacheStatus.cachedCount}</strong> / {totalChapters} 章
            <span style={{ marginLeft: '12px', color: 'var(--text-muted)', fontSize: '12px' }}>
              占用体积: {formatSize(cacheStatus.totalBytes)}
            </span>
          </div>
          {cacheStatus.cachedCount > 0 && (
            <button
              onClick={handleClearCache}
              disabled={isClearing || isCaching}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#ef4444',
                fontSize: '12px',
                cursor: 'pointer',
                textDecoration: 'underline'
              }}
            >
              {isClearing ? '正在清理...' : '清除缓存'}
            </button>
          )}
        </div>

        {/* 批量预下载范围选择器 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>
            从当前章节（第 {currentChapterIndex + 1} 章）开始预下载：
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            <button
              onClick={() => handleStartCache(50)}
              disabled={isCaching}
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-layer3)',
                color: 'var(--text-primary)',
                cursor: isCaching ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                transition: 'var(--transition)'
              }}
              onMouseEnter={(e) => { if (!isCaching) e.currentTarget.style.borderColor = 'var(--accent)' }}
              onMouseLeave={(e) => { if (!isCaching) e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <div style={{ fontWeight: 600, fontSize: '14px' }}>⚡ 缓存后 50 章</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>适合短时日常通勤无网阅读</div>
            </button>

            <button
              onClick={() => handleStartCache(100)}
              disabled={isCaching}
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-layer3)',
                color: 'var(--text-primary)',
                cursor: isCaching ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                transition: 'var(--transition)'
              }}
              onMouseEnter={(e) => { if (!isCaching) e.currentTarget.style.borderColor = 'var(--accent)' }}
              onMouseLeave={(e) => { if (!isCaching) e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <div style={{ fontWeight: 600, fontSize: '14px' }}>📚 缓存后 100 章</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>深度追书备选体验</div>
            </button>

            <button
              onClick={() => handleStartCache(200)}
              disabled={isCaching}
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-layer3)',
                color: 'var(--text-primary)',
                cursor: isCaching ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                transition: 'var(--transition)'
              }}
              onMouseEnter={(e) => { if (!isCaching) e.currentTarget.style.borderColor = 'var(--accent)' }}
              onMouseLeave={(e) => { if (!isCaching) e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <div style={{ fontWeight: 600, fontSize: '14px' }}>🚀 缓存后 200 章</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>长途差旅或飞行模式无忧</div>
            </button>

            <button
              onClick={() => handleStartCache(-1)}
              disabled={isCaching}
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--accent)',
                backgroundColor: 'var(--bg-layer3)',
                color: 'var(--accent-light)',
                cursor: isCaching ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                transition: 'var(--transition)'
              }}
              onMouseEnter={(e) => { if (!isCaching) e.currentTarget.style.backgroundColor = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { if (!isCaching) e.currentTarget.style.backgroundColor = 'var(--bg-layer3)' }}
            >
              <div style={{ fontWeight: 600, fontSize: '14px' }}>🌟 缓存全本未下载</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>下载后续所有尚未缓存章节</div>
            </button>
          </div>
        </div>

        {/* 💡 操作方式提示与分界 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            margin: '4px 0 6px',
            padding: '9px 16px',
            borderRadius: '8px',
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
            border: '1px dashed rgba(56, 189, 248, 0.35)',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            lineHeight: 1.6
          }}
        >
          <span style={{ fontSize: '15px', marginTop: '1px' }}>💡</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div>1、按上面相应的按钮直接开始缓存；</div>
            <div>2、或者在下面填入要实际缓存的章节，并按「<strong style={{ color: 'var(--text-primary)' }}>开始缓存</strong>」</div>
          </div>
        </div>

        {/* 🎯 自定义章节范围预下载模块 */}
        <div
          style={{
            backgroundColor: 'var(--bg-layer2)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🎯</span> 自定义章节范围
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                disabled={isCaching}
                onClick={() => {
                  setRangeStart(currentChapterIndex + 1)
                  setRangeEnd(totalChapters ? Math.min(totalChapters, currentChapterIndex + 50) : currentChapterIndex + 50)
                }}
                style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-layer3)', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                后50章
              </button>
              <button
                disabled={isCaching}
                onClick={() => {
                  setRangeStart(1)
                  setRangeEnd(totalChapters || 1)
                }}
                style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-layer3)', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                全本(1~{totalChapters || '末'})
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <span>从第</span>
              <input
                type="number"
                min={1}
                max={totalChapters || 9999}
                value={rangeStart}
                disabled={isCaching}
                onChange={(e) => setRangeStart(parseInt(e.target.value) || 1)}
                style={{
                  width: '72px',
                  padding: '5px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-layer1)',
                  color: 'var(--text-primary)',
                  textAlign: 'center',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              />
              <span>章</span>
            </div>

            <span style={{ color: 'var(--text-muted)' }}>至</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <span>第</span>
              <input
                type="number"
                min={1}
                max={totalChapters || 9999}
                value={rangeEnd}
                disabled={isCaching}
                onChange={(e) => setRangeEnd(parseInt(e.target.value) || 1)}
                style={{
                  width: '72px',
                  padding: '5px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-layer1)',
                  color: 'var(--text-primary)',
                  textAlign: 'center',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              />
              <span>章</span>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                共 <strong>{Math.max(0, (rangeEnd || 0) - (rangeStart || 0) + 1)}</strong> 章
              </span>
              <button
                onClick={handleStartCustomRangeCache}
                disabled={isCaching || !rangeStart || !rangeEnd || rangeStart > rangeEnd}
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: isCaching || !rangeStart || !rangeEnd || rangeStart > rangeEnd ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)'
                }}
              >
                {isCaching ? '下载中...' : '开始缓存'}
              </button>
            </div>
          </div>
        </div>

        {/* 正在下载进度条 */}
        {isCaching && progressInfo && (
          <div
            style={{
              backgroundColor: 'var(--bg-hover)',
              borderRadius: '8px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span>后台下载中: <strong>{progressInfo.done} / {progressInfo.total}</strong> 章</span>
              <button
                onClick={handleCancelCache}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: '11px',
                  textDecoration: 'underline'
                }}
              >
                取消任务
              </button>
            </div>
            {/* 进度条轨道 */}
            <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--bg-layer3)', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progressInfo.total > 0 ? (progressInfo.done / progressInfo.total) * 100 : 0}%`,
                  backgroundColor: 'var(--accent)',
                  transition: 'width 0.2s ease'
                }}
              />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              正在处理：{progressInfo.currentTitle || '...'}
            </div>
          </div>
        )}

        {/* 底部贴心提示 */}
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          💡 说明：离线缓存任务在后台静默运行，不会影响您当前正常翻页阅读。已缓存的章节在目录中带有「已缓存」标记，断网时亦可秒开。
        </div>
      </div>
    </div>
  )
}
