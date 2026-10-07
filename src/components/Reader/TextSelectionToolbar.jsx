import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import {
  isSingleEnglishWord,
  canTranslateText,
  detectTextLanguage,
  speakWord,
  speakSentence,
  lookupWord,
  translateSentence,
  parsePosLine
} from '../../services/dictionaryService'
import { detectGrammarPatterns } from '../../services/grammarPatternService'
import { useStore } from '../../store/useStore'

const HIGHLIGHT_COLORS = [
  { name: '阳光黄', color: '#f59e0b', textBg: 'rgba(245, 158, 11, 0.3)' },
  { name: '薄荷绿', color: '#10b981', textBg: 'rgba(16, 185, 129, 0.3)' },
  { name: '樱花粉', color: '#f43f5e', textBg: 'rgba(244, 63, 94, 0.3)' },
  { name: '天空蓝', color: '#38bdf8', textBg: 'rgba(56, 189, 248, 0.3)' },
  { name: '经典紫', color: '#a855f7', textBg: 'rgba(168, 85, 247, 0.3)' }
]

export function TextSelectionToolbar({ position, selectedText, onHighlight, onSaveNote, onCopy, onAddBookmark, onClose, existingAnnotation, onDeleteAnnotation }) {
  const { currentBook, vocabulary, allVocabulary, vocabularyScope, addVocabularyToStore, removeVocabularyFromStore, showToast } = useStore()
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [noteText, setNoteText] = useState(existingAnnotation?.note || '')
  const [coords, setCoords] = useState(null)
  const [dictInfo, setDictInfo] = useState(null)
  const [isLoadingDict, setIsLoadingDict] = useState(false)
  const [translationInfo, setTranslationInfo] = useState(null)
  const [isLoadingTrans, setIsLoadingTrans] = useState(false)
  const [grammarPatterns, setGrammarPatterns] = useState([])
  const noteInputRef = useRef(null)
  const toolbarRef = useRef(null)

  const cleanText = (selectedText || '').trim()
  const textLang = detectTextLanguage(cleanText)
  const isEnglishWord = isSingleEnglishWord(cleanText)
  const shouldTranslate = !isEnglishWord && canTranslateText(cleanText)
  const currentWordClean = cleanText.replace(/^[^\w]+|[^\w]+$/g, '')
  
  // 全量比对是否已加入生词本
  const checkVocabList = allVocabulary.length > 0 ? allVocabulary : vocabulary
  const isWordStarred = checkVocabList.some(w => (w.word || '').toLowerCase() === currentWordClean.toLowerCase())

  useEffect(() => {
    if (isAddingNote) {
      setTimeout(() => {
        noteInputRef.current?.focus()
      }, 50)
    }
  }, [isAddingNote])

  // 1. 单个英文生词自动异步查询微词典
  useEffect(() => {
    let active = true
    if (isEnglishWord && currentWordClean) {
      setIsLoadingDict(true)
      lookupWord(currentWordClean).then((info) => {
        if (active) {
          setDictInfo(info)
          setIsLoadingDict(false)
        }
      }).catch(() => {
        if (active) setIsLoadingDict(false)
      })
    } else {
      setDictInfo(null)
    }
    return () => { active = false }
  }, [isEnglishWord, currentWordClean])

  // 2. 选区翻译（支持英中互译）与核心用法分析
  useEffect(() => {
    let active = true
    if (shouldTranslate && cleanText) {
      // 提取核心句型/固定搭配 (如 sb to do sth)
      if (textLang === 'en') {
        const patterns = detectGrammarPatterns(cleanText)
        setGrammarPatterns(patterns)
      } else {
        setGrammarPatterns([])
      }

      setIsLoadingTrans(true)
      const srcLang = textLang === 'zh' ? 'zh-CN' : 'en'
      const tgtLang = textLang === 'zh' ? 'en' : 'zh-CN'

      translateSentence(cleanText, srcLang, tgtLang).then((info) => {
        if (active) {
          setTranslationInfo(info)
          setIsLoadingTrans(false)
        }
      }).catch(() => {
        if (active) setIsLoadingTrans(false)
      })
    } else {
      setTranslationInfo(null)
      setGrammarPatterns([])
    }
    return () => { active = false }
  }, [shouldTranslate, cleanText, textLang])

  // 收藏/移除生词本（支持全量跨书绑定与来源追溯）
  const handleToggleStarWord = async () => {
    if (!currentWordClean) return
    const targetBookId = currentBook?.id || 'common'
    const targetBookTitle = currentBook?.title || '通用词汇'

    if (isWordStarred) {
      const existing = checkVocabList.find(w => (w.word || '').toLowerCase() === currentWordClean.toLowerCase())
      if (existing) {
        await window.api?.removeVocabularyWordGlobal?.(existing.id)
        removeVocabularyFromStore(existing.id)
        showToast(`已从生词本移除: ${currentWordClean}`, 'info')
      }
    } else {
      const item = {
        word: dictInfo?.word || currentWordClean,
        phonetic: dictInfo?.phonetic || '',
        ukPhonetic: dictInfo?.ukPhonetic || '',
        usPhonetic: dictInfo?.usPhonetic || '',
        definition: dictInfo?.definition || '',
        context: selectedText,
        bookId: targetBookId,
        bookTitle: targetBookTitle
      }
      const saved = await window.api?.addVocabularyWord?.(targetBookId, item)
      if (saved) {
        addVocabularyToStore({ ...saved, bookTitle: targetBookTitle })
        showToast(`已加入全量生词本: ${currentWordClean}`, 'success')
      }
    }
  }

  // 精准整数像素测量定位：彻底避免 CSS translate(-50%, -100%) 产生的 0.5px 亚像素插值文字重影/发虚
  useLayoutEffect(() => {
    if (!toolbarRef.current || !position) return
    const rect = toolbarRef.current.getBoundingClientRect()
    const targetX = Math.round(position.x - rect.width / 2)
    const targetY = Math.round(position.y - rect.height - 12)

    // 屏幕安全边界约束（留出 12px 边距）
    const padding = 12
    const safeX = Math.max(padding, Math.min(window.innerWidth - rect.width - padding, targetX))
    // 顶部空间不足时自动翻转至选区下方
    const safeY = targetY < padding ? Math.round(position.y + 24) : targetY

    setCoords({ x: safeX, y: safeY })
  }, [position, isAddingNote, dictInfo, translationInfo, grammarPatterns])

  // 点击外部关闭与键盘 Esc 退出（捕获阶段拦截，同时主动清除文本选区，彻底杜绝 mouseup 残留重新唤醒）
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        try {
          window.getSelection()?.removeAllRanges()
        } catch (_) {}
        onClose?.()
      }
    }

    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        try {
          window.getSelection()?.removeAllRanges()
        } catch (_) {}
        onClose?.()
      }
    }

    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick, true)
      document.addEventListener('pointerdown', handleOutsideClick, true)
      window.addEventListener('keydown', handleGlobalKeyDown, true)
    }, 180)

    return () => {
      clearTimeout(timerId)
      document.removeEventListener('mousedown', handleOutsideClick, true)
      document.removeEventListener('pointerdown', handleOutsideClick, true)
      window.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [onClose])

  if (!position) return null

  const handleColorClick = (colorObj) => {
    onHighlight?.(colorObj)
  }

  const handleSaveNoteSubmit = () => {
    onSaveNote?.(noteText.trim())
    setIsAddingNote(false)
  }

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSaveNoteSubmit()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setIsAddingNote(false)
    }
  }

  // 初始未测算时先隐藏，测量完毕后显示在完全对齐的整数坐标上，杜绝闪烁和模糊
  const toolbarStyle = {
    position: 'fixed',
    left: coords ? `${coords.x}px` : `${Math.round(position.x - 165)}px`,
    top: coords ? `${coords.y}px` : `${Math.round(position.y - 65)}px`,
    visibility: coords ? 'visible' : 'hidden',
    zIndex: 9999,
    backgroundColor: 'var(--bg-layer1)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.12)',
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    fontSize: '15px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", "PingFang SC", sans-serif',
    color: 'var(--text-primary)',
    minWidth: '360px',
    maxWidth: '470px',
    boxSizing: 'border-box',
    textRendering: 'geometricPrecision'
  }

  return (
    <div
      ref={toolbarRef}
      className="text-selection-toolbar"
      style={toolbarStyle}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 英文少儿微词典卡片（选中文本为单个英文生词时展示） */}
      {isEnglishWord && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '9px 11px',
          backgroundColor: 'var(--bg-layer2)',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          marginBottom: '2px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            {/* 单词与英美发音组 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                {dictInfo?.word || currentWordClean}
              </span>

              {/* 英式发音与音标 */}
              {dictInfo?.ukPhonetic ? (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                  padding: '2px 6px',
                  borderRadius: '5px'
                }}>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 'bold' }}>英</span>
                  <span style={{ fontSize: '12px', color: 'var(--accent)', fontFamily: 'Lucida Sans, Arial, sans-serif' }}>
                    {dictInfo.ukPhonetic}
                  </span>
                  <button
                    onClick={() => speakWord(dictInfo?.word || currentWordClean, 'en-GB')}
                    title="播放英式发音 (British English)"
                    style={{
                      background: 'transparent',
                      color: 'var(--accent)',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '1px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'transform 0.15s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.2)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                  </button>
                </div>
              ) : null}

              {/* 美式发音与音标 */}
              {dictInfo?.usPhonetic ? (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                  padding: '2px 6px',
                  borderRadius: '5px'
                }}>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 'bold' }}>美</span>
                  <span style={{ fontSize: '12px', color: 'var(--accent)', fontFamily: 'Lucida Sans, Arial, sans-serif' }}>
                    {dictInfo.usPhonetic}
                  </span>
                  <button
                    onClick={() => speakWord(dictInfo?.word || currentWordClean, 'en-US')}
                    title="播放美式发音 (American English)"
                    style={{
                      background: 'transparent',
                      color: 'var(--accent)',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '1px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'transform 0.15s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.2)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                  </button>
                </div>
              ) : null}

              {/* 若无区分，展示通用音标与发音按钮 */}
              {!dictInfo?.ukPhonetic && !dictInfo?.usPhonetic && (
                <>
                  {dictInfo?.phonetic && (
                    <span style={{ fontSize: '13px', color: 'var(--accent)', fontFamily: 'Lucida Sans, Arial, sans-serif' }}>
                      {dictInfo.phonetic}
                    </span>
                  )}
                  <button
                    onClick={() => speakWord(dictInfo?.word || currentWordClean, 'en-US')}
                    title="播放发音"
                    style={{
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: 'var(--accent)',
                      border: 'none',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.15)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                  </button>
                </>
              )}
            </div>

            {/* ⭐ 生词本收藏按钮 */}
            <button
              onClick={handleToggleStarWord}
              title={isWordStarred ? '已在生词本中 (点击移除)' : '加入本书生词本'}
              style={{
                background: isWordStarred ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                color: isWordStarred ? '#f59e0b' : 'var(--text-muted)',
                border: isWordStarred ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid transparent',
                borderRadius: '6px',
                padding: '3px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={isWordStarred ? '#f59e0b' : 'none'} stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span>{isWordStarred ? '已收藏' : '生词本'}</span>
            </button>
          </div>

          {/* 多词性清晰分行释义区 */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            maxHeight: '125px',
            overflowY: 'auto',
            paddingRight: '2px'
          }}>
            {isLoadingDict ? (
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>正在获取完整释义...</span>
            ) : (
              (dictInfo?.definitions && dictInfo.definitions.length > 0) ? (
                dictInfo.definitions.map((defLine, idx) => {
                  const { pos, meaning } = parsePosLine(defLine)
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '13px', lineHeight: 1.45 }}>
                      {pos && (
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 5px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(56, 189, 248, 0.15)',
                          color: 'var(--accent)',
                          fontFamily: 'monospace, system-ui',
                          flexShrink: 0,
                          marginTop: '1px'
                        }}>
                          {pos}
                        </span>
                      )}
                      <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-word', flex: 1 }}>
                        {meaning || defLine}
                      </span>
                    </div>
                  )
                })
              ) : (
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  {dictInfo?.definition || '点击小喇叭收听发音'}
                </span>
              )
            )}
          </div>

          {/* 💡 经典英美用词/拼写差异提示徽章 */}
          {dictInfo?.ukUsDiff && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              backgroundColor: 'rgba(56, 189, 248, 0.08)',
              border: '1px dashed rgba(56, 189, 248, 0.3)',
              padding: '3px 8px',
              borderRadius: '5px',
              fontSize: '11.5px',
              marginTop: '2px'
            }}>
              <span style={{ fontWeight: 'bold', color: 'var(--accent)', flexShrink: 0 }}>💡 英美差异:</span>
              <span style={{ color: 'var(--text-secondary)' }}>{dictInfo.ukUsDiff.text}</span>
            </div>
          )}
        </div>
      )}

      {/* 双向翻译与核心用法卡片（无论是短句、长句、段落还是中文，全选区100%覆盖） */}
      {shouldTranslate && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '7px',
          padding: '10px 12px',
          backgroundColor: 'var(--bg-layer2)',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          marginBottom: '2px'
        }}>
          {/* 标题栏与操作按钮 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                fontSize: '11.5px',
                fontWeight: '600',
                color: 'var(--accent)',
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                padding: '2px 7px',
                borderRadius: '4px',
                letterSpacing: '0.3px'
              }}>
                {textLang === 'zh' ? '汉英翻译 (中 ➔ 英)' : '整句意译 (英 ➔ 中)'}
              </span>

              {/* 🔊 语音朗读小喇叭按钮（中译英时朗读英文译文，英译中时朗读英文原句） */}
              <button
                onClick={() => {
                  if (textLang === 'zh') {
                    if (translationInfo?.translation) speakSentence(translationInfo.translation, 'en-US')
                  } else {
                    speakSentence(cleanText, 'en-US')
                  }
                }}
                title={textLang === 'zh' ? '朗读英文翻译结果 (练习地道口语与听力)' : '标准语速朗读原句 (少儿跟读磨耳朵)'}
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: 'var(--accent)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.15)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              </button>
            </div>

            {/* 💭 将译文存为想法笔记 */}
            <button
              onClick={() => {
                if (translationInfo?.translation) {
                  const prefix = textLang === 'zh' ? '【英文】' : '【译文】'
                  setNoteText(prev => prev ? `${prev}\n${prefix}${translationInfo.translation}` : `${prefix}${translationInfo.translation}`)
                }
                setIsAddingNote(true)
              }}
              title="将译文填入想法笔记"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '3px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)'
                e.currentTarget.style.color = 'var(--accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>存为笔记</span>
            </button>
          </div>

          {/* 译文内容展示区 */}
          <div style={{
            fontSize: '13.5px',
            lineHeight: 1.55,
            color: 'var(--text-primary)',
            maxHeight: '110px',
            overflowY: 'auto',
            paddingRight: '2px',
            wordBreak: 'break-word'
          }}>
            {isLoadingTrans ? (
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>正在翻译内容...</span>
            ) : (
              translationInfo?.translation || (
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  {translationInfo?.error ? '翻译服务暂不可用，请稍后重试' : '暂无译文'}
                </span>
              )
            )}
          </div>

          {/* 💡 核心用法 / 句型结构（当检测到固定搭配、动宾不定式如 sb to do sth 时智能展示） */}
          {grammarPatterns.length > 0 && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              paddingTop: '6px',
              borderTop: '1px dashed var(--border)',
              marginTop: '1px'
            }}>
              <span style={{
                fontSize: '11px',
                fontWeight: '600',
                color: 'var(--accent)',
                letterSpacing: '0.3px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span>💡 核心用法 / 句型结构</span>
              </span>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                maxHeight: '90px',
                overflowY: 'auto',
                paddingRight: '2px'
              }}>
                {grammarPatterns.map((gp, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '6px',
                    fontSize: '12px',
                    lineHeight: 1.45,
                    backgroundColor: 'rgba(56, 189, 248, 0.08)',
                    padding: '3px 7px',
                    borderRadius: '5px'
                  }}>
                    <span style={{
                      fontWeight: 'bold',
                      color: 'var(--accent)',
                      fontFamily: 'monospace, system-ui',
                      flexShrink: 0
                    }}>
                      {gp.pattern}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', flex: 1 }}>
                      {gp.meaning}
                    </span>
                    {gp.matchedText && (
                      <span style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        fontStyle: 'italic',
                        flexShrink: 0
                      }}>
                        ({gp.matchedText})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 顶部主工具条（等比放大20%） */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        {/* 色彩划线圆点组（放大至 24px） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.color}
              onClick={() => handleColorClick(c)}
              title={`划线标注: ${c.name}`}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: c.color,
                border: existingAnnotation?.color === c.color ? '2px solid #ffffff' : '1.5px solid rgba(0,0,0,0.18)',
                boxShadow: existingAnnotation?.color === c.color ? '0 0 0 2px var(--accent)' : '0 1px 3px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                padding: 0,
                transition: 'transform 0.12s ease',
                transform: 'scale(1)'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            />
          ))}
        </div>

        <div style={{ width: '1px', height: '22px', backgroundColor: 'var(--border)' }} />

        {/* 功能按钮组（图标放大至 18px） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* 想法批注 */}
          <button
            onClick={() => setIsAddingNote(!isAddingNote)}
            title={existingAnnotation?.note ? '编辑想法笔记' : '写想法批注'}
            style={{
              background: isAddingNote || existingAnnotation?.note ? 'var(--accent)' : 'transparent',
              color: isAddingNote || existingAnnotation?.note ? '#ffffff' : 'var(--text-primary)',
              border: 'none',
              borderRadius: '6px',
              padding: '5px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'var(--transition)'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>

          {/* 复制 */}
          <button
            onClick={onCopy}
            title="复制选中文本"
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              border: 'none',
              borderRadius: '6px',
              padding: '5px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'var(--transition)'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>

          {/* 加入书签 */}
          {onAddBookmark && (
            <button
              onClick={onAddBookmark}
              title="在此处添加书签"
              style={{
                background: 'transparent',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: '6px',
                padding: '5px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'var(--transition)'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
          )}

          {/* 删除标注 */}
          {existingAnnotation && (
            <button
              onClick={onDeleteAnnotation}
              title="删除此划线标注"
              style={{
                background: 'transparent',
                color: '#ef4444',
                border: 'none',
                borderRadius: '6px',
                padding: '5px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'var(--transition)'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 展开的想法输入框（等比放大20%，字号15px，无重影） */}
      {isAddingNote && (
        <div style={{ marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '10px' }} onKeyDown={handleKeyDown}>
          <textarea
            ref={noteInputRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="记录你的思考与想法 (Ctrl+Enter保存)..."
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--bg-layer2)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              padding: '10px 12px',
              fontSize: '15px',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", "PingFang SC", sans-serif',
              lineHeight: 1.55,
              resize: 'none',
              outline: 'none',
              transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)'
              e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-glow)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              onClick={() => setIsAddingNote(false)}
              className="btn btn-secondary"
              style={{
                padding: '6px 14px',
                fontSize: '14px',
                borderRadius: '7px',
                fontWeight: 500
              }}
            >
              取消
            </button>
            <button
              onClick={handleSaveNoteSubmit}
              className="btn btn-primary"
              style={{
                padding: '6px 18px',
                fontSize: '14px',
                borderRadius: '7px',
                fontWeight: 500
              }}
            >
              保存想法
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
