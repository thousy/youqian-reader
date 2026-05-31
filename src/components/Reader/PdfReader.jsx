import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { useStore } from '../../store/useStore'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export function PdfReader({ book, savedProgress, settings, onProgressChange, registerGetPosition }) {
  const [pdf, setPdf] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [scale, setScale] = useState(1.2)
  const [jumpPage, setJumpPage] = useState('')
  const containerRef = useRef(null)
  const renderTaskRef = useRef(null)
  const canvasRef = useRef(null)
  const { showToast } = useStore()

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        const fileData = await window.api.readFile(book.filePath)
        let arrayBuffer
        if (fileData instanceof ArrayBuffer) {
          arrayBuffer = fileData
        } else if (fileData instanceof Uint8Array) {
          arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength)
        } else if (ArrayBuffer.isView(fileData)) {
          arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength)
        } else if (fileData && fileData.type === 'Buffer' && Array.isArray(fileData.data)) {
          arrayBuffer = new Uint8Array(fileData.data).buffer
        } else {
          throw new Error('无法识别文件数据格式')
        }
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
        const pdfDoc = await loadingTask.promise
        if (!mounted) return
        setPdf(pdfDoc)
        setTotalPages(pdfDoc.numPages)
        const startPage = savedProgress?.page || 1
        setCurrentPage(Math.min(startPage, pdfDoc.numPages))
        setLoading(false)
      } catch (e) {
        console.error('PDF 加载失败:', e)
        if (mounted) { setLoading(false); showToast('PDF 加载失败: ' + e.message, 'error') }
      }
    }
    load()
    return () => { mounted = false }
  }, [book.id])

  useEffect(() => {
    if (!pdf || !canvasRef.current) return
    renderPage(pdf, currentPage)
  }, [pdf, currentPage, scale])

  useEffect(() => {
    registerGetPosition(() => ({
      label: `第 ${currentPage} 页`,
      page: currentPage
    }))
  }, [currentPage])

  useEffect(() => {
    if (totalPages > 0) {
      onProgressChange({ page: currentPage, percentage: currentPage / totalPages })
    }
  }, [currentPage, totalPages])

  async function renderPage(pdfDoc, pageNum) {
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel() } catch {}
    }
    const page = await pdfDoc.getPage(pageNum)
    const canvas = canvasRef.current
    if (!canvas) return
    const viewport = page.getViewport({ scale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    const task = page.render({ canvasContext: ctx, viewport })
    renderTaskRef.current = task
    try {
      await task.promise
    } catch (e) {
      if (e.name !== 'RenderingCancelledException') console.error(e)
    }
  }

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setCurrentPage(p => Math.min(p + 1, totalPages))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setCurrentPage(p => Math.max(p - 1, 1))
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [totalPages])

  const handleJump = (e) => {
    e.preventDefault()
    const n = parseInt(jumpPage)
    if (n >= 1 && n <= totalPages) { setCurrentPage(n); setJumpPage('') }
  }

  const navButtonStyle = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '80px',
    display: 'flex',
    alignItems: 'center',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    zIndex: 10,
    opacity: 0,
    transition: 'opacity 0.2s',
  }

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'var(--bg-base)'}}>
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner"/>
          <span>正在加载 PDF...</span>
        </div>
      )}
      <div style={{position:'relative',flex:1,overflow:'hidden'}}>
        <div ref={containerRef} className="pdf-container">
          <canvas ref={canvasRef} className="pdf-page-canvas" id="pdf-canvas"/>
        </div>
        {!loading && currentPage > 1 && (
          <button
            style={{...navButtonStyle, left: 0, paddingLeft: '12px', justifyContent: 'flex-start'}}
            onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0}
            aria-label="上一页"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}
        {!loading && currentPage < totalPages && (
          <button
            style={{...navButtonStyle, right: 0, paddingRight: '12px', justifyContent: 'flex-end'}}
            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0}
            aria-label="下一页"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}
      </div>
      {!loading && (
        <div className="pdf-controls">
          <button className="pdf-page-btn" id="pdf-prev-btn"
            onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
            disabled={currentPage <= 1}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <form onSubmit={handleJump} style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <input type="number" value={jumpPage || currentPage}
              onChange={e => setJumpPage(e.target.value)}
              onFocus={e => setJumpPage(String(currentPage))}
              style={{
                width:'48px', textAlign:'center',
                background:'var(--bg-hover)', border:'1px solid var(--border)',
                borderRadius:'6px', color:'var(--text-primary)',
                fontSize:'13px', padding:'4px', outline:'none'
              }}
              min={1} max={totalPages}
            />
            <span className="pdf-page-info">/ {totalPages}</span>
          </form>
          <button className="pdf-page-btn" id="pdf-next-btn"
            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
            disabled={currentPage >= totalPages}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <div style={{width:'1px',height:'20px',background:'var(--border-subtle)'}}/>
          <button className="pdf-page-btn" onClick={() => setScale(s => Math.max(0.5, s - 0.2))} title="缩小">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <span className="pdf-page-info">{Math.round(scale * 100)}%</span>
          <button className="pdf-page-btn" onClick={() => setScale(s => Math.min(3, s + 0.2))} title="放大">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
