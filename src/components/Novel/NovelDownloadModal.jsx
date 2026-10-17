import React, { useState, useEffect } from 'react'

const SOURCE_LABELS = {
  biquge: '笔趣阁',
  dingdian: '顶点小说',
  qimao: '七猫小说'
}

const getDomain = (url) => {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch (_) {
    return ''
  }
}

const getSourceName = (book) => {
  if (!book) return '未知书源'
  if (book.sourceName && book.sourceName.trim()) return book.sourceName.trim()
  if (SOURCE_LABELS[book.source]) return SOURCE_LABELS[book.source]
  if (book.url) {
    const domain = getDomain(book.url)
    if (domain) return domain
  }
  if (book.source) return book.source
  return '在线书源'
}

/**
 * 通用小说下载配置弹窗（支持全本/范围/最新章节选择，TXT/EPUB/PDF导出格式，1~16并发线程调节）
 */
export function NovelDownloadModal({
  novelInfo,
  chapters = [],
  sourceId,
  loading = false,
  onClose,
  onDownload,
  onOpenPreview
}) {
  // 下载模式: 'all' (1: 下载全本) | 'range' (2: 指定范围章节) | 'latest' (3: 下载最新章节)
  const [downloadMode, setDownloadMode] = useState('all')
  // 导出格式: 'EPUB' (默认推荐) | 'TXT' | 'PDF'
  const [downloadFormat, setDownloadFormat] = useState('EPUB')
  // 下载并发线程数 (1 ~ 16)
  const [downloadConcurrency, setDownloadConcurrency] = useState(4)

  const [startChapter, setStartChapter] = useState(1)
  const [endChapter, setEndChapter] = useState(1)
  const [latestCount, setLatestCount] = useState(20)

  useEffect(() => {
    if (chapters && chapters.length > 0) {
      setEndChapter(chapters.length)
    }
    // 读取系统默认下载并发配置
    window.api?.novelGetDownloadConfig?.().then(cfg => {
      if (cfg && cfg.concurrency) {
        setDownloadConcurrency(cfg.concurrency)
      }
    })
  }, [chapters?.length])

  // 计算要下载的具体章节列表
  let selectedChapters = []
  const safeChapters = chapters || []
  if (downloadMode === 'all') {
    selectedChapters = safeChapters.map((ch, idx) => ({ ...ch, originalIndex: idx }))
  } else if (downloadMode === 'range') {
    const s = Math.max(1, Math.min(safeChapters.length, startChapter)) - 1
    const e = Math.max(s + 1, Math.min(safeChapters.length, endChapter))
    selectedChapters = safeChapters.slice(s, e).map((ch, i) => ({ ...ch, originalIndex: s + i }))
  } else if (downloadMode === 'latest') {
    const count = Math.max(1, Math.min(safeChapters.length, latestCount))
    const startIdx = Math.max(0, safeChapters.length - count)
    selectedChapters = safeChapters.slice(startIdx).map((ch, i) => ({ ...ch, originalIndex: startIdx + i }))
  }

  // 智能净化弹窗前端展示书名与作者
  let displayTitle = (novelInfo?.title || '小说').trim()
  let displayAuthor = (novelInfo?.author || '').trim()
  const authorMatch = displayTitle.match(/(?:作\s*者|原\s*著|文\s*\/|文\s*[:：]|by)[:：\s]+([^\s,，;；)）\]】]+)/i)
  if (authorMatch && (!displayAuthor || displayAuthor === '未知' || displayAuthor === 'None' || displayAuthor === '网络作家')) {
    displayAuthor = authorMatch[1].trim()
  }
  displayTitle = displayTitle
    .replace(/(?:作\s*者|原\s*著|文\s*\/|文\s*[:：]|by)[:：\s]+[^\s,，;；)）\]】]+/gi, '')
    .replace(/[（\(]\s*\d+(?:\.\d+)?\s*(?:[－\-~～、—/]+|\s+至\s+|\s+到\s+)\s*\d+(?:\.\d+)?\s*(?:章|节|卷)?(?:\s*完)?\s*[）\)]/g, '')
    .replace(/^[【《\[\s]+|[】》\]\s]+$/g, '')
    .trim() || '小说'
  if (!displayAuthor) displayAuthor = '未知'

  const handleDownload = () => {
    if (selectedChapters.length === 0) return
    onDownload?.({
      ...novelInfo,
      title: displayTitle,
      author: displayAuthor
    }, selectedChapters, sourceId, downloadFormat, downloadConcurrency)
  }

  const currentBookTitle = displayTitle
  const currentBookAuthor = displayAuthor
  const currentSourceText = getSourceName(novelInfo)

  return (
    <div className="novel-modal-overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="novel-modal" style={{ maxWidth: '640px' }}>
        <div className="novel-modal-header">
          <div className="novel-modal-book-info">
            {novelInfo?.cover ? (
              <img src={novelInfo.cover} alt="" className="novel-modal-cover" />
            ) : (
              <div className="novel-modal-cover-ph">{currentBookTitle.slice(0, 2)}</div>
            )}
            <div>
              <div className="novel-modal-title">{currentBookTitle}</div>
              <div className="novel-modal-author">作者：{currentBookAuthor}</div>
              <div className="novel-modal-source-info">
                <span>来源书源：<strong>{currentSourceText}</strong></span>
                {novelInfo?.url && getDomain(novelInfo.url) && <span> ({getDomain(novelInfo.url)})</span>}
              </div>
              {novelInfo?.description && (
                <div className="novel-modal-desc">{novelInfo.description.slice(0, 120)}...</div>
              )}
            </div>
          </div>
          <button className="novel-modal-close" onClick={onClose} title="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="novel-modal-body">
          {loading ? (
            <div className="novel-modal-loading">
              <div className="novel-loading-spinner" />
              <span>正在解析章节目录...</span>
            </div>
          ) : safeChapters.length === 0 ? (
            <div className="novel-modal-loading">
              <span>未获取到章节，请尝试切换其他书源</span>
            </div>
          ) : (
            <>
              {/* 1. 选择下载范围 */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  📥 1. 选择下载范围 (共 {safeChapters.length} 章)：
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  <button
                    onClick={() => setDownloadMode('all')}
                    style={{
                      padding: '9px 8px', borderRadius: '8px', border: `1px solid ${downloadMode === 'all' ? 'var(--accent)' : 'var(--border)'}`,
                      background: downloadMode === 'all' ? 'var(--accent)' : 'var(--bg-layer2)',
                      color: downloadMode === 'all' ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer', fontSize: '13px', fontWeight: downloadMode === 'all' ? 600 : 400,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    🌟 下载全本
                    <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>全量 {safeChapters.length} 章</div>
                  </button>

                  <button
                    onClick={() => setDownloadMode('range')}
                    style={{
                      padding: '9px 8px', borderRadius: '8px', border: `1px solid ${downloadMode === 'range' ? 'var(--accent)' : 'var(--border)'}`,
                      background: downloadMode === 'range' ? 'var(--accent)' : 'var(--bg-layer2)',
                      color: downloadMode === 'range' ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer', fontSize: '13px', fontWeight: downloadMode === 'range' ? 600 : 400,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    🎯 指定范围章节
                    <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>自定义起始~结束</div>
                  </button>

                  <button
                    onClick={() => setDownloadMode('latest')}
                    style={{
                      padding: '9px 8px', borderRadius: '8px', border: `1px solid ${downloadMode === 'latest' ? 'var(--accent)' : 'var(--border)'}`,
                      background: downloadMode === 'latest' ? 'var(--accent)' : 'var(--bg-layer2)',
                      color: downloadMode === 'latest' ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer', fontSize: '13px', fontWeight: downloadMode === 'latest' ? 600 : 400,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    ⚡ 下载最新章节
                    <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>更新追更推荐</div>
                  </button>
                </div>
              </div>

              {/* 模式 2 详情：指定范围输入框 */}
              {downloadMode === 'range' && (
                <div style={{
                  background: 'var(--bg-layer2)', padding: '10px 14px', borderRadius: '8px',
                  border: '1px solid var(--border)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px'
                }}>
                  <span>从第</span>
                  <input
                    type="number"
                    min={1}
                    max={safeChapters.length}
                    value={startChapter}
                    onChange={e => setStartChapter(Math.max(1, Math.min(safeChapters.length, parseInt(e.target.value) || 1)))}
                    style={{ width: '65px', padding: '5px 6px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', textAlign: 'center' }}
                  />
                  <span>章 到 第</span>
                  <input
                    type="number"
                    min={startChapter}
                    max={safeChapters.length}
                    value={endChapter}
                    onChange={e => setEndChapter(Math.max(startChapter, Math.min(safeChapters.length, parseInt(e.target.value) || safeChapters.length)))}
                    style={{ width: '65px', padding: '5px 6px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', textAlign: 'center' }}
                  />
                  <span>章（已选 <strong>{selectedChapters.length}</strong> 章）</span>
                </div>
              )}

              {/* 模式 3 详情：下载最新章节 */}
              {downloadMode === 'latest' && (
                <div style={{
                  background: 'var(--bg-layer2)', padding: '10px 14px', borderRadius: '8px',
                  border: '1px solid var(--border)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px'
                }}>
                  <span>下载最新的</span>
                  <input
                    type="number"
                    min={1}
                    max={safeChapters.length}
                    value={latestCount}
                    onChange={e => setLatestCount(Math.max(1, Math.min(safeChapters.length, parseInt(e.target.value) || 20)))}
                    style={{ width: '65px', padding: '5px 6px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', textAlign: 'center' }}
                  />
                  <span>章</span>

                  {/* 快捷按钮 */}
                  <div style={{ display: 'flex', gap: '5px', marginLeft: 'auto' }}>
                    {[10, 20, 50, 100].map(cnt => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setLatestCount(cnt)}
                        style={{
                          padding: '3px 7px', borderRadius: '4px', border: '1px solid var(--border)',
                          background: latestCount === cnt ? 'var(--accent)' : 'var(--bg-base)',
                          color: latestCount === cnt ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px'
                        }}
                      >
                        最新{cnt}章
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. 选择导出格式 */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>📑 2. 选择导出格式：</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>当前格式：<strong>{downloadFormat}</strong></span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  {/* TXT 选项 */}
                  <button
                    type="button"
                    onClick={() => setDownloadFormat('TXT')}
                    style={{
                      padding: '8px 6px', borderRadius: '8px',
                      border: `1.5px solid ${downloadFormat === 'TXT' ? '#0284c7' : 'var(--border)'}`,
                      background: downloadFormat === 'TXT' ? 'rgba(2, 132, 199, 0.12)' : 'var(--bg-layer2)',
                      color: downloadFormat === 'TXT' ? '#38bdf8' : 'var(--text-primary)',
                      cursor: 'pointer', textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: downloadFormat === 'TXT' ? 700 : 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      📄 TXT
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.75 }}>纯文本 · 极速轻量</span>
                  </button>

                  {/* EPUB 选项 */}
                  <button
                    type="button"
                    onClick={() => setDownloadFormat('EPUB')}
                    style={{
                      padding: '8px 6px', borderRadius: '8px',
                      border: `1.5px solid ${downloadFormat === 'EPUB' ? '#8b5cf6' : 'var(--border)'}`,
                      background: downloadFormat === 'EPUB' ? 'rgba(139, 92, 246, 0.15)' : 'var(--bg-layer2)',
                      color: downloadFormat === 'EPUB' ? '#c084fc' : 'var(--text-primary)',
                      cursor: 'pointer', textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: downloadFormat === 'EPUB' ? 700 : 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      📚 EPUB <span style={{ fontSize: '10px', padding: '1px 4px', borderRadius: '3px', background: '#8b5cf6', color: '#fff', fontWeight: 600 }}>推荐</span>
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.75 }}>标准电子书 · 含完整排版</span>
                  </button>

                  {/* PDF 选项 */}
                  <button
                    type="button"
                    onClick={() => setDownloadFormat('PDF')}
                    style={{
                      padding: '8px 6px', borderRadius: '8px',
                      border: `1.5px solid ${downloadFormat === 'PDF' ? '#ef4444' : 'var(--border)'}`,
                      background: downloadFormat === 'PDF' ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-layer2)',
                      color: downloadFormat === 'PDF' ? '#f87171' : 'var(--text-primary)',
                      cursor: 'pointer', textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: downloadFormat === 'PDF' ? 700 : 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      📕 PDF
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.75 }}>精美排版 · 便于离线阅读</span>
                  </button>
                </div>
              </div>

              {/* 3. 并发下载线程数调节 */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>⚡ 3. 并发下载线程数：</span>
                  <span style={{ fontSize: '12px', color: 'var(--accent-light)', fontFamily: 'monospace', fontWeight: 600 }}>
                    {downloadConcurrency} 线程
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg-layer2)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <input
                    type="range"
                    min="1"
                    max="16"
                    value={downloadConcurrency}
                    onChange={e => setDownloadConcurrency(parseInt(e.target.value) || 4)}
                    style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[
                      { count: 2, label: '防封 2' },
                      { count: 4, label: '推荐 4' },
                      { count: 8, label: '极速 8' },
                      { count: 16, label: '狂飙 16' }
                    ].map(item => (
                      <button
                        key={item.count}
                        type="button"
                        onClick={() => setDownloadConcurrency(item.count)}
                        style={{
                          padding: '2px 7px', borderRadius: '4px',
                          border: `1px solid ${downloadConcurrency === item.count ? 'var(--accent)' : 'var(--border)'}`,
                          background: downloadConcurrency === item.count ? 'var(--accent)' : 'var(--bg-base)',
                          color: downloadConcurrency === item.count ? '#fff' : 'var(--text-secondary)',
                          cursor: 'pointer', fontSize: '11px', fontWeight: downloadConcurrency === item.count ? 600 : 400
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  💡 提示：建议设为 3~6 线程。线程数过高可能触发部分源站防爬限流。
                </div>
              </div>

              {/* 章节目录展示与直接预览入口 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>目录预览（点击任意章节可立即在线试读）：</span>
              </div>
              <div className="novel-chapter-preview" style={{ maxHeight: '160px' }}>
                {selectedChapters.slice(0, 10).map((ch, i) => (
                  <div
                    key={i}
                    className="novel-chapter-item"
                    onClick={() => onOpenPreview?.(safeChapters.indexOf(ch))}
                    style={{ cursor: onOpenPreview ? 'pointer' : 'default' }}
                    title={onOpenPreview ? '点击在线试读此章节' : ''}
                  >
                    <span className="novel-chapter-num">{safeChapters.indexOf(ch) + 1}</span>
                    <span className="novel-chapter-name" style={{ color: 'var(--accent-light)' }}>{ch.title}</span>
                    {onOpenPreview && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>📖 试读</span>}
                  </div>
                ))}
                {selectedChapters.length > 10 && (
                  <div className="novel-chapter-more">...已选 {selectedChapters.length} 章节</div>
                )}
              </div>
            </>
          )}
        </div>

        {!loading && safeChapters.length > 0 && (
          <div className="novel-modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <span className="novel-modal-tip" style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                下载完成后自动加入书库并生成 <strong>{downloadFormat}</strong> 文件 ({downloadConcurrency} 线程)
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                当前已选：<strong style={{ color: 'var(--accent-light)' }}>{selectedChapters.length}</strong> 章
              </span>
            </div>
            <div className="novel-modal-btns" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
              <button className="novel-modal-cancel-btn" onClick={onClose}>取消</button>
              <button
                onClick={handleDownload}
                disabled={selectedChapters.length === 0}
                style={{
                  padding: '8px 18px', borderRadius: '8px', border: 'none',
                  background: downloadFormat === 'EPUB'
                    ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)'
                    : downloadFormat === 'PDF'
                      ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                      : 'linear-gradient(135deg, #0284c7, #0369a1)',
                  color: '#fff', cursor: selectedChapters.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: '13px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)', transition: 'all 0.2s ease',
                  opacity: selectedChapters.length === 0 ? 0.6 : 1
                }}
                title={`按当前选择下载 ${selectedChapters.length} 章为 ${downloadFormat} 格式 (${downloadConcurrency} 线程)`}
              >
                <span>{downloadFormat === 'EPUB' ? '📚' : downloadFormat === 'PDF' ? '📕' : '📄'}</span>
                <span>立即下载 {downloadFormat} ({selectedChapters.length}章 · {downloadConcurrency}线程)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
