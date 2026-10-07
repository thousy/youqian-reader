import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import { speakWord, parsePosLine } from '../../services/dictionaryService'

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function VocabularyPanel({ bookTitle }) {
  const [filterKeyword, setFilterKeyword] = useState('')
  const {
    currentBook,
    vocabulary,
    allVocabulary,
    vocabularyScope,
    setVocabularyScope,
    loadAllVocabulary,
    removeVocabularyFromStore,
    updateVocabularyInStore,
    showToast
  } = useStore()

  // 挂载时自动加载跨书籍全量生词库
  React.useEffect(() => {
    loadAllVocabulary()
  }, [])

  const handleSpeak = (word, lang = 'en-US') => {
    speakWord(word, lang)
  }

  const handleDelete = async (wordItem, e) => {
    e.stopPropagation()
    await window.api?.removeVocabularyWordGlobal?.(wordItem.id)
    if (currentBook?.id) {
      await window.api?.removeVocabularyWord?.(currentBook.id, wordItem.id)
    }
    removeVocabularyFromStore(wordItem.id)
    showToast(`已删除生词: ${wordItem.word}`, 'info')
  }

  const handleToggleMastered = async (wordItem, e) => {
    e.stopPropagation()
    const newMastered = !wordItem.mastered
    await window.api?.updateVocabularyWordGlobal?.(wordItem.id, { mastered: newMastered })
    if (currentBook?.id) {
      await window.api?.updateVocabularyWord?.(currentBook.id, wordItem.id, { mastered: newMastered })
    }
    updateVocabularyInStore(wordItem.id, { mastered: newMastered })
    showToast(newMastered ? `已掌握: ${wordItem.word}` : `标记为未掌握: ${wordItem.word}`, 'success')
  }

  const activeVocabList = vocabularyScope === 'all' ? (allVocabulary.length > 0 ? allVocabulary : vocabulary) : vocabulary

  const filteredList = activeVocabList.filter(w => {
    if (!filterKeyword.trim()) return true
    const kw = filterKeyword.toLowerCase()
    return (
      (w.word && w.word.toLowerCase().includes(kw)) ||
      (w.definition && w.definition.toLowerCase().includes(kw)) ||
      (w.bookTitle && w.bookTitle.toLowerCase().includes(kw))
    )
  })

  const masteredCount = activeVocabList.filter(w => w.mastered).length

  return (
    <div
      className="bookmark-panel"
      style={{
        width: '320px',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-layer1)',
        color: 'var(--text-primary)',
        height: '100%',
        boxSizing: 'border-box'
      }}
    >
      {/* 顶部标题 */}
      <div
        className="bookmark-panel-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <span className="bookmark-panel-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            <line x1="12" y1="6" x2="16" y2="6"/>
            <line x1="12" y1="10" x2="16" y2="10"/>
          </svg>
          生词本 ({activeVocabList.length})
        </span>

        {activeVocabList.length > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            已掌握 {masteredCount}/{activeVocabList.length}
          </span>
        )}
      </div>

      {/* 范围切换栏：全部生词 vs 本书生词 */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '6px 10px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-layer2)'
      }}>
        <button
          onClick={() => setVocabularyScope('all')}
          style={{
            flex: 1,
            padding: '4px 6px',
            fontSize: '11.5px',
            fontWeight: '600',
            borderRadius: '5px',
            border: 'none',
            background: vocabularyScope === 'all' ? 'var(--accent)' : 'transparent',
            color: vocabularyScope === 'all' ? '#ffffff' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          全量生词 ({allVocabulary.length})
        </button>
        <button
          onClick={() => setVocabularyScope('book')}
          style={{
            flex: 1,
            padding: '4px 6px',
            fontSize: '11.5px',
            fontWeight: '600',
            borderRadius: '5px',
            border: 'none',
            background: vocabularyScope === 'book' ? 'var(--accent)' : 'transparent',
            color: vocabularyScope === 'book' ? '#ffffff' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          本书生词 ({vocabulary.length})
        </button>
      </div>

      {/* 搜索过滤框 */}
      {vocabulary.length > 3 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <input
            type="text"
            placeholder="搜索生词或中文释义..."
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            style={{
              width: '100%',
              padding: '5px 8px',
              fontSize: '12px',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-layer2)',
              color: 'var(--text-primary)',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
        </div>
      )}

      {/* 生词列表区 */}
      <div className="bookmark-panel-list" style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {filteredList.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-muted)',
            fontSize: '13px',
            textAlign: 'center',
            gap: '8px',
            padding: '30px 10px'
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4"/>
              <path d="M12 16h.01"/>
            </svg>
            <div>{filterKeyword ? '未找到匹配生词' : '暂无收藏的生词'}</div>
            <div style={{ fontSize: '11px', opacity: 0.75, maxWidth: '200px', lineHeight: 1.5 }}>
              阅读英文书籍时，用鼠标划选或双击单词，点击“⭐ 加入生词本”即可随时在此复习
            </div>
          </div>
        ) : (
          filteredList.map((item) => (
            <div
              key={item.id}
              style={{
                backgroundColor: 'var(--bg-layer2)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px 12px',
                marginBottom: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                transition: 'all 0.15s ease',
                opacity: item.mastered ? 0.65 : 1
              }}
            >
              {/* 单词标题与发音按钮 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '15px',
                    fontWeight: 'bold',
                    color: item.mastered ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: item.mastered ? 'line-through' : 'none'
                  }}>
                    {item.word}
                  </span>

                  {/* 英音 */}
                  {item.ukPhonetic ? (
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '2px',
                      backgroundColor: 'rgba(56, 189, 248, 0.1)',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>英</span>
                      <span style={{ color: 'var(--accent)' }}>{item.ukPhonetic}</span>
                      <button
                        onClick={() => handleSpeak(item.word, 'en-GB')}
                        title="英式发音"
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, display: 'flex' }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      </button>
                    </div>
                  ) : null}

                  {/* 美音 */}
                  {item.usPhonetic ? (
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '2px',
                      backgroundColor: 'rgba(56, 189, 248, 0.1)',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>美</span>
                      <span style={{ color: 'var(--accent)' }}>{item.usPhonetic}</span>
                      <button
                        onClick={() => handleSpeak(item.word, 'en-US')}
                        title="美式发音"
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, display: 'flex' }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      </button>
                    </div>
                  ) : null}

                  {/* 通用发音兜底 */}
                  {!item.ukPhonetic && !item.usPhonetic && (
                    <>
                      {item.phonetic && (
                        <span style={{ fontSize: '12px', color: 'var(--accent)', fontFamily: 'Lucida Sans, Arial, sans-serif' }}>
                          {item.phonetic}
                        </span>
                      )}
                      <button
                        onClick={() => handleSpeak(item.word, 'en-US')}
                        title="播放发音"
                        style={{
                          background: 'rgba(56, 189, 248, 0.12)',
                          color: 'var(--accent)',
                          border: 'none',
                          borderRadius: '50%',
                          width: '20px',
                          height: '20px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          padding: 0
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>

                {/* 操作组：掌握勾选 / 删除 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    onClick={(e) => handleToggleMastered(item, e)}
                    title={item.mastered ? '标记为未掌握' : '已掌握该单词'}
                    style={{
                      background: item.mastered ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                      color: item.mastered ? '#10b981' : 'var(--text-muted)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      padding: '3px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </button>
                  <button
                    onClick={(e) => handleDelete(item, e)}
                    title="删除生词"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      padding: '3px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* 中文释义（多词性清晰分行） */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', lineHeight: 1.4 }}>
                {item.definition ? (
                  item.definition.split(/;\s*(?=(?:[a-zA-Z]{1,5}\.|\【))/i).map((line, lIdx) => {
                    const { pos, meaning } = parsePosLine(line)
                    return (
                      <div key={lIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                        {pos && (
                          <span style={{
                            display: 'inline-block',
                            padding: '1px 4px',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            borderRadius: '3px',
                            backgroundColor: 'rgba(56, 189, 248, 0.15)',
                            color: 'var(--accent)',
                            fontFamily: 'monospace, system-ui',
                            flexShrink: 0,
                            marginTop: '1px'
                          }}>
                            {pos}
                          </span>
                        )}
                        <span style={{ color: 'var(--text-secondary)', flex: 1, wordBreak: 'break-word' }}>
                          {meaning || line}
                        </span>
                      </div>
                    )
                  })
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>点击小喇叭收听发音</span>
                )}
              </div>

              {/* 原句上下文（如果记录了） */}
              {item.context && item.context.length > item.word.length && (
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                  borderLeft: '2px solid var(--border)',
                  paddingLeft: '6px',
                  marginTop: '2px',
                  lineHeight: 1.35
                }}>
                  “{item.context.length > 80 ? item.context.substring(0, 80) + '...' : item.context}”
                </div>
              )}

              {/* 来源书籍与记录时间 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '10px',
                color: 'var(--text-muted)',
                marginTop: '4px',
                paddingTop: '3px',
                borderTop: '1px dashed var(--border)'
              }}>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '190px',
                    opacity: 0.85
                  }}
                  title={item.bookTitle || '通用词汇'}
                >
                  📖 {item.bookTitle ? `《${item.bookTitle}》` : '通用词汇'}
                </span>
                <span style={{ flexShrink: 0 }}>{formatTime(item.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
