import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'

export function BookInfoModal({ book, onClose }) {
  const { books, setBooks } = useStore()
  const [wordCount, setWordCount] = useState(book.wordCount || null)
  const [loading, setLoading] = useState(!book.wordCount && book.format === 'TXT')

  useEffect(() => {
    let active = true
    async function calculateWordCount() {
      if (book.wordCount) {
        setWordCount(book.wordCount)
        return
      }

      if (book.format === 'TXT') {
        try {
          setLoading(true)
          const text = await window.api.readTxtFile(book.filePath)
          if (!active) return
          const count = text.length
          setWordCount(count)
          
          // 写入本地数据库以缓存
          await window.api.updateBook(book.id, { wordCount: count })
          // 同步更新 Zustand store，保持 UI 状态一致
          const updatedBooks = books.map(b => b.id === book.id ? { ...b, wordCount: count } : b)
          setBooks(updatedBooks)
        } catch (e) {
          console.error('计算字数失败:', e)
          if (active) setWordCount('计算失败')
        } finally {
          if (active) setLoading(false)
        }
      } else if (['EPUB', 'MOBI', 'AZW3'].includes(book.format)) {
        // 对于其它结构化电子书，采用物理大小高速折算
        const count = book.format === 'EPUB' 
          ? Math.round(book.fileSize * 0.35) 
          : Math.round(book.fileSize * 0.4)
        
        if (active) {
          setWordCount(count)
          // 写入数据库以缓存
          window.api.updateBook(book.id, { wordCount: count })
          const updatedBooks = books.map(b => b.id === book.id ? { ...b, wordCount: count } : b)
          setBooks(updatedBooks)
        }
      } else {
        if (active) setWordCount(null)
      }
    }
    calculateWordCount()
    return () => { active = false }
  }, [book.id])

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 KB'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const formatWordCount = (count) => {
    if (count === null || count === undefined) return null
    if (typeof count === 'string') return count
    if (count < 10000) return `${count} 字`
    return `约 ${(count / 10000).toFixed(1)} 万字`
  }

  // 提取物理文件名
  const fileName = book.filePath ? book.filePath.split(/[/\\]/).pop() : book.title

  // 磨砂毛玻璃渐变卡片内联样式定义
  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(6, 6, 10, 0.65)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    animation: 'fadeIn 0.25s ease-out'
  }

  const panelStyle = {
    width: '450px',
    backgroundColor: 'var(--bg-layer2, rgba(24, 24, 37, 0.9))',
    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
    borderRadius: '16px',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    color: 'var(--text-primary, #d4d4e8)',
    boxSizing: 'border-box'
  }

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
    paddingBottom: '12px'
  }

  const titleStyle = {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-primary, #ffffff)'
  }

  const closeBtnStyle = {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted, #8888a8)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    transition: 'all 0.2s'
  }

  const contentStyle = {
    display: 'flex',
    gap: '18px',
    alignItems: 'flex-start',
    padding: '8px 0'
  }

  const coverContainerStyle = {
    width: '100px',
    height: '135px',
    position: 'relative',
    flexShrink: 0,
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
    boxShadow: '0 8px 16px rgba(0,0,0,0.25)'
  }

  const coverStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  }

  const placeholderCoverStyle = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '32px',
    backgroundColor: 'var(--bg-layer3, rgba(255, 255, 255, 0.05))',
    color: 'var(--text-muted)'
  }

  const bookBadgeStyle = (format) => {
    const formatColors = {
      EPUB: '#4ade80', PDF: '#f87171', AZW3: '#fb923c', MOBI: '#a78bfa', TXT: '#60a5fa'
    }
    return {
      position: 'absolute',
      bottom: '6px',
      right: '6px',
      fontSize: '9px',
      fontWeight: 'bold',
      padding: '2px 5px',
      borderRadius: '4px',
      color: '#fff',
      backgroundColor: formatColors[format] || 'var(--accent, #a78bfa)',
      boxShadow: '0 2px 4px rgba(0,0,0,0.15)'
    }
  }

  const detailsStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flex: 1,
    minWidth: 0 // 防止文本溢出容器
  }

  const rowStyle = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
    fontSize: '13px',
    lineHeight: '1.4'
  }

  const labelStyle = {
    color: 'var(--text-secondary, #8888a8)',
    width: '75px',
    flexShrink: 0
  }

  const valueStyle = {
    color: 'var(--text-primary, #d4d4e8)',
    wordBreak: 'break-all'
  }

  const pathValueStyle = {
    color: 'var(--text-primary, #d4d4e8)',
    wordBreak: 'break-all',
    fontSize: '12px',
    maxHeight: '4.2em',
    overflowY: 'auto',
    cursor: 'text',
    userSelect: 'text',
    WebkitUserSelect: 'text'
  }

  const footerStyle = {
    display: 'flex',
    justifyContent: 'flex-end',
    borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
    paddingTop: '14px'
  }

  const confirmBtnStyle = {
    padding: '7px 18px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'var(--accent, #6366f1)',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
    transition: 'all 0.2s'
  }

  return (
    <div className="book-info-modal-overlay" onClick={onClose} style={overlayStyle}>
      <div className="book-info-modal-panel" onClick={e => e.stopPropagation()} style={panelStyle}>
        <div style={headerStyle}>
          <h3 style={titleStyle}>书籍详细信息</h3>
          <button 
            onClick={onClose} 
            style={closeBtnStyle}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={contentStyle}>
          <div style={coverContainerStyle}>
            {book.cover ? (
              <img src={book.cover} alt={book.title} style={coverStyle} />
            ) : (
              <div style={placeholderCoverStyle}>📚</div>
            )}
            <div style={bookBadgeStyle(book.format)}>{book.format}</div>
          </div>

          <div style={detailsStyle}>
            <div style={rowStyle}>
              <span style={labelStyle}>书名：</span>
              <span style={{ ...valueStyle, fontWeight: '600' }}>{book.title}</span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>作者：</span>
              <span style={valueStyle}>{book.author || '未知'}</span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>文件名：</span>
              <span style={valueStyle}>{fileName}</span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>文件大小：</span>
              <span style={valueStyle}>{formatFileSize(book.fileSize)}</span>
            </div>
            {book.format !== 'PDF' && (
              <div style={rowStyle}>
                <span style={labelStyle}>总字数：</span>
                <span style={valueStyle}>
                  {loading ? (
                    <span style={{color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px'}}>
                      <span className="loading-spinner" style={{width:'10px',height:'10px',borderWidth:'1.5px',display:'inline-block'}}/>
                      正在计算字数...
                    </span>
                  ) : (
                    formatWordCount(wordCount) || '未知'
                  )}
                </span>
              </div>
            )}
            {book.format === 'PDF' && (
              <div style={rowStyle}>
                <span style={labelStyle}>类型：</span>
                <span style={valueStyle}>PDF 电子文档</span>
              </div>
            )}
            <div style={rowStyle}>
              <span style={labelStyle}>位置：</span>
              <span style={pathValueStyle} title="点击选择或长按复制路径">{book.filePath}</span>
            </div>
          </div>
        </div>

        <div style={footerStyle}>
          <button 
            onClick={onClose} 
            style={confirmBtnStyle}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(99, 102, 241, 0.45)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.35)'
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
