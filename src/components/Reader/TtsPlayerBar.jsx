import React, { useState, useEffect, useRef } from 'react'
import { ambientSoundEngine } from '../../utils/ambientSoundEngine'

const SPEED_OPTIONS = [0.8, 1.0, 1.2, 1.5, 2.0]
const SLEEP_OPTIONS = [
  { label: '定时关闭', value: 0 },
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '45 分钟', value: 45 },
  { label: '60 分钟', value: 60 }
]

const AMBIENT_OPTIONS = [
  { label: '无伴奏', value: 'none', icon: '🔇' },
  { label: '窗外夜雨', value: 'rain', icon: '🌧️' },
  { label: '温暖壁炉', value: 'fireplace', icon: '🔥' },
  { label: '深林微风', value: 'breeze', icon: '🍃' },
  { label: '静心和弦', value: 'zen', icon: '🎵' },
]

export function TtsPlayerBar({ isOpen, onClose, getTextBlocks, getTtsContext, readingProgress, onParagraphChange }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [rate, setRate] = useState(1.0)
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(null)
  const [sleepMinutes, setSleepMinutes] = useState(0)
  const [sleepRemainingSec, setSleepRemainingSec] = useState(0)
  const [isMinimized, setIsMinimized] = useState(false)

  // 听书伴奏背景音状态
  const [ambientType, setAmbientType] = useState(() => localStorage.getItem('tts_ambient_type') || 'none')
  const [ambientVolume, setAmbientVolume] = useState(() => {
    const saved = localStorage.getItem('tts_ambient_volume')
    return saved ? Number(saved) : 0.2
  })

  const paragraphsRef = useRef([])
  const currentIndexRef = useRef(0)
  const isPlayingRef = useRef(false)
  const sleepTimerRef = useRef(null)
  const pausedPageStartRef = useRef(null)

  useEffect(() => {
    currentIndexRef.current = currentIndex
  }, [currentIndex])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  // 初始化音色列表
  useEffect(() => {
    const updateVoices = () => {
      if (!window.speechSynthesis) return
      const allVoices = window.speechSynthesis.getVoices()
      // 优先筛选中文声音
      const zhVoices = allVoices.filter(v => v.lang.includes('zh') || v.lang.includes('cmn') || v.name.includes('Chinese') || v.name.includes('晓晓') || v.name.includes('云希') || v.name.includes('Natural'))
      const displayVoices = zhVoices.length > 0 ? zhVoices : allVoices
      setVoices(displayVoices)

      if (displayVoices.length > 0 && !selectedVoice) {
        const preferred = displayVoices.find(v => v.name.includes('Natural') || v.name.includes('晓晓') || v.name.includes('Xiaoxiao') || v.name.includes('云希')) || displayVoices[0]
        setSelectedVoice(preferred.name)
      }
    }

    updateVoices()
    if (window.speechSynthesis?.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices
    }
  }, [])

  // 伴奏类型与音量持久化及平滑响应
  useEffect(() => {
    localStorage.setItem('tts_ambient_type', ambientType)
    ambientSoundEngine.setVolume(ambientVolume)
    if (isPlaying && ambientType !== 'none') {
      ambientSoundEngine.play(ambientType)
    } else {
      ambientSoundEngine.pause()
    }
  }, [ambientType, isPlaying])

  useEffect(() => {
    localStorage.setItem('tts_ambient_volume', String(ambientVolume))
    ambientSoundEngine.setVolume(ambientVolume)
  }, [ambientVolume])

  // 监听打开/关闭
  useEffect(() => {
    if (isOpen) {
      refreshParagraphs()
    } else {
      stopSpeaking()
    }
    return () => {
      stopSpeaking()
    }
  }, [isOpen])

  // 监听翻页事件联动：若读者在暂停中或未播放时翻了页，自动重置暂停状态，并将句序号和内容直达新页面！
  useEffect(() => {
    if (!isOpen) return
    if (!isPlayingRef.current) {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
      setIsPaused(false)
      pausedPageStartRef.current = null
      refreshParagraphs(false)
    }
  }, [isOpen, readingProgress?.pageIndex, readingProgress?.chapterIndex, readingProgress?.cfi, readingProgress?.page])

  // 智能嗅探当前视口内可见的第一个段落索引（精准定位当前展示页）
  const scanParagraphsAndFindVisible = () => {
    let pElements = Array.from(
      document.querySelectorAll('.reader-content-area p, #txt-content p, #mobi-scroll-content p, #mobi-container p')
    )

    let container = document.querySelector('.reader-content-area') || 
                    document.querySelector('#txt-content')?.parentElement || 
                    document.querySelector('#mobi-scroll-content')?.parentElement ||
                    document.body

    // 穿透检查 EPUB 的 iframe 视口
    const epubIframe = document.querySelector('.epub-container iframe')
    if (epubIframe?.contentDocument) {
      const iframeP = Array.from(epubIframe.contentDocument.querySelectorAll('p'))
      if (iframeP.length > 0) {
        pElements = iframeP
        container = epubIframe
      }
    }

    if (!pElements || pElements.length === 0) {
      return { paras: [], visibleIdx: 0 }
    }

    const cRect = container.getBoundingClientRect()
    const paras = []
    let visibleIdx = -1

    pElements.forEach((el) => {
      const text = el.textContent?.trim()
      if (!text || text.length < 2) return

      const idx = paras.length
      paras.push(text)

      // 寻找首个落在当前屏幕视口内的段落作为“当前页首段”
      if (visibleIdx === -1) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          // 水平方向落在视口内（兼容横向翻页与多栏排版）
          const inHorizontal = r.right > cRect.left + 15 && r.left < cRect.right - 15
          // 垂直方向落在视口内
          const inVertical = r.bottom > cRect.top + 10 && r.top < cRect.bottom - 10

          if (inHorizontal && inVertical) {
            visibleIdx = idx
          }
        }
      }
    })

    return {
      paras,
      visibleIdx: visibleIdx >= 0 ? visibleIdx : 0
    }
  }

  // 收集段落并定位当前页
  const refreshParagraphs = (autoStart = false) => {
    let paras = []
    let startIdx = 0

    // 优先从阅读器专用接口获取当前正在展示的精确页段落与起始索引
    if (getTtsContext) {
      try {
        const ctx = getTtsContext()
        if (ctx && ctx.paragraphs && ctx.paragraphs.length > 0) {
          paras = ctx.paragraphs
          startIdx = Math.max(0, Math.min(ctx.startIndex || 0, paras.length - 1))
        }
      } catch (e) {
        console.warn('获取阅读器TTS上下文异常:', e)
      }
    }

    if ((!paras || paras.length === 0) && getTextBlocks) {
      paras = getTextBlocks()
    }

    if (!paras || paras.length === 0) {
      const result = scanParagraphsAndFindVisible()
      paras = result.paras
      startIdx = result.visibleIdx
    }

    paragraphsRef.current = paras
    setCurrentIndex(startIdx)

    if (autoStart && paras.length > 0) {
      setIsPlaying(true)
      setIsPaused(false)
      speakCurrentParagraph(startIdx)
    }
  }

  // 朗读指定段落
  const speakCurrentParagraph = (idx) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()

    const paras = paragraphsRef.current
    if (!paras || paras.length === 0 || idx < 0 || idx >= paras.length) {
      setIsPlaying(false)
      setIsPaused(false)
      return
    }

    const textToSpeak = paras[idx]
    const utterance = new SpeechSynthesisUtterance(textToSpeak)

    utterance.rate = rate

    if (selectedVoice) {
      const v = window.speechSynthesis.getVoices().find(item => item.name === selectedVoice)
      if (v) utterance.voice = v
    }

    utterance.onstart = () => {
      setIsPlaying(true)
      setIsPaused(false)
      if (ambientType !== 'none') {
        ambientSoundEngine.play(ambientType)
      }
      onParagraphChange?.(idx, textToSpeak)
    }

    utterance.onend = () => {
      if (currentIndexRef.current + 1 < paragraphsRef.current.length && isPlayingRef.current) {
        const nextIdx = currentIndexRef.current + 1
        setCurrentIndex(nextIdx)
        speakCurrentParagraph(nextIdx)
      } else {
        setIsPlaying(false)
        setIsPaused(false)
      }
    }

    utterance.onerror = (e) => {
      if (e.error !== 'canceled' && e.error !== 'interrupted') {
        console.warn('TTS 朗读遇到非阻断中断:', e)
      }
    }

    window.speechSynthesis.speak(utterance)
  }

  // 播放与恢复
  const handlePlay = () => {
    // 探测当前屏幕展示页的起始段落索引
    let currentStartIdx = null
    if (getTtsContext) {
      try {
        const ctx = getTtsContext()
        if (ctx && ctx.startIndex !== undefined) {
          currentStartIdx = ctx.startIndex
        }
      } catch (_) {}
    }

    if (isPaused) {
      // 检查当前页是否与暂停时不同（读者是否在暂停期间翻过页）
      const hasPageChanged = (
        pausedPageStartRef.current !== null &&
        currentStartIdx !== null &&
        pausedPageStartRef.current !== currentStartIdx
      )

      if (hasPageChanged) {
        // 读者翻页了！废弃旧句缓存，立刻从新翻到的当前页首句开始朗读！
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel()
        }
        setIsPaused(false)
        pausedPageStartRef.current = null
        refreshParagraphs(true)
        return
      }

      // 未翻页，继续朗读刚才暂停的句子
      window.speechSynthesis.resume()
      setIsPaused(false)
      setIsPlaying(true)
      return
    }

    if (!isPlaying) {
      refreshParagraphs(true)
      return
    }

    setIsPlaying(true)
    speakCurrentParagraph(currentIndex)
  }

  // 暂停
  const handlePause = () => {
    if (window.speechSynthesis?.speaking) {
      window.speechSynthesis.pause()
      setIsPaused(true)
      setIsPlaying(false)
      ambientSoundEngine.pause()
      // 记录暂停时当前页面的起始段落索引
      if (getTtsContext) {
        try {
          const ctx = getTtsContext()
          pausedPageStartRef.current = ctx?.startIndex ?? null
        } catch (_) {}
      }
    }
  }

  // 彻底停止
  const stopSpeaking = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    ambientSoundEngine.pause()
    setIsPlaying(false)
    setIsPaused(false)
    if (sleepTimerRef.current) {
      clearInterval(sleepTimerRef.current)
      sleepTimerRef.current = null
    }
    setSleepRemainingSec(0)
  }

  // 上一句
  const handlePrev = () => {
    const prevIdx = Math.max(0, currentIndex - 1)
    setCurrentIndex(prevIdx)
    if (isPlaying || isPaused) {
      speakCurrentParagraph(prevIdx)
    }
  }

  // 下一句
  const handleNext = () => {
    const nextIdx = Math.min(paragraphsRef.current.length - 1, currentIndex + 1)
    setCurrentIndex(nextIdx)
    if (isPlaying || isPaused) {
      speakCurrentParagraph(nextIdx)
    }
  }

  // 语速调整
  const handleSpeedChange = (newRate) => {
    setRate(newRate)
    if (isPlaying) {
      speakCurrentParagraph(currentIndex)
    }
  }

  // 定时休眠设置
  const handleSleepChange = (minutes) => {
    setSleepMinutes(minutes)
    if (sleepTimerRef.current) {
      clearInterval(sleepTimerRef.current)
      sleepTimerRef.current = null
    }

    if (minutes > 0) {
      const totalSec = minutes * 60
      setSleepRemainingSec(totalSec)
      sleepTimerRef.current = setInterval(() => {
        setSleepRemainingSec(prev => {
          if (prev <= 1) {
            clearInterval(sleepTimerRef.current)
            sleepTimerRef.current = null
            stopSpeaking()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      setSleepRemainingSec(0)
    }
  }

  if (!isOpen) return null

  // 最小化浮窗
  if (isMinimized) {
    return (
      <div
        onClick={() => setIsMinimized(false)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 1000,
          backgroundColor: 'var(--bg-layer2)',
          border: '1px solid var(--border)',
          borderRadius: '30px',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          backdropFilter: 'blur(12px)',
          transition: 'var(--transition)'
        }}
      >
        <span style={{ fontSize: '16px' }}>🎧</span>
        <span style={{ fontSize: '12px', fontWeight: 500 }}>
          {isPlaying ? '正在听书...' : '听书已暂停'}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          #{currentIndex + 1}
        </span>
      </div>
    )
  }

  const total = paragraphsRef.current.length

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        width: '620px',
        maxWidth: 'calc(100vw - 32px)',
        backgroundColor: 'var(--bg-layer1)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.25)',
        padding: '12px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        color: 'var(--text-primary)',
        backdropFilter: 'blur(16px)',
        animation: 'slideUpPop 0.2s ease-out'
      }}
    >
      {/* 顶部标题与收起/关闭按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '15px' }}>🎧</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>听书模式</span>
          {total > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', background: 'var(--bg-layer2)', padding: '1px 6px', borderRadius: '4px' }}>
              第 {currentIndex + 1} / {total} 段
            </span>
          )}
          {sleepRemainingSec > 0 && (
            <span style={{ fontSize: '11px', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.1)', padding: '1px 6px', borderRadius: '4px' }}>
              ⏱ {Math.floor(sleepRemainingSec / 60)}:{(sleepRemainingSec % 60).toString().padStart(2, '0')} 后休眠
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* 最小化 */}
          <button
            onClick={() => setIsMinimized(true)}
            title="最小化为胶囊"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '3px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
              transition: 'var(--transition)'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>

          {/* 关闭 */}
          <button
            onClick={onClose}
            title="退出听书模式"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '3px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
              transition: 'var(--transition)'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 核心控制栏：上一段、播放/暂停、下一段 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', margin: '4px 0' }}>
        {/* 上一段 */}
        <button
          onClick={handlePrev}
          disabled={currentIndex <= 0}
          title="上一段"
          style={{
            background: 'transparent',
            border: 'none',
            color: currentIndex <= 0 ? 'var(--text-muted)' : 'var(--text-primary)',
            cursor: currentIndex <= 0 ? 'default' : 'pointer',
            padding: '6px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            opacity: currentIndex <= 0 ? 0.35 : 1
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="19 20 9 12 19 4 19 20"/>
            <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2"/>
          </svg>
        </button>

        {/* 播放 / 暂停 主按钮 */}
        <button
          onClick={isPlaying ? handlePause : handlePlay}
          title={isPlaying ? '暂停朗读' : '开始朗读'}
          style={{
            width: '46px',
            height: '46px',
            borderRadius: '50%',
            backgroundColor: 'var(--accent)',
            border: 'none',
            color: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px var(--accent-glow)',
            transition: 'transform 0.15s ease'
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          )}
        </button>

        {/* 下一段 */}
        <button
          onClick={handleNext}
          disabled={currentIndex >= total - 1}
          title="下一段"
          style={{
            background: 'transparent',
            border: 'none',
            color: currentIndex >= total - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
            cursor: currentIndex >= total - 1 ? 'default' : 'pointer',
            padding: '6px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            opacity: currentIndex >= total - 1 ? 0.35 : 1
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 4 15 12 5 20 5 4"/>
            <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2"/>
          </svg>
        </button>
      </div>

      {/* 底部参数设置：语速、音色、定时休眠 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '11px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
        {/* 语速档位 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>语速:</span>
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => handleSpeedChange(s)}
              style={{
                background: rate === s ? 'var(--accent)' : 'var(--bg-layer2)',
                color: rate === s ? '#ffffff' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '2px 5px',
                cursor: 'pointer',
                fontSize: '11px',
                transition: 'var(--transition)'
              }}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* 音色下拉 */}
        {voices.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '170px' }}>
            <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>音色:</span>
            <select
              value={selectedVoice || ''}
              onChange={(e) => {
                setSelectedVoice(e.target.value)
                if (isPlaying) speakCurrentParagraph(currentIndex)
              }}
              style={{
                background: 'var(--bg-layer2)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                color: 'var(--text-primary)',
                fontSize: '11px',
                padding: '2px 4px',
                outline: 'none',
                maxWidth: '130px',
                textOverflow: 'ellipsis'
              }}
            >
              {voices.map((v) => (
                <option key={v.name} value={v.name} style={{ background: 'var(--bg-layer1)', color: 'var(--text-primary)' }}>
                  {v.name.replace(/Microsoft|Online|Natural/g, '').trim() || v.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 沉浸背景伴奏选择与音量微调 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>伴奏:</span>
          <select
            value={ambientType}
            onChange={(e) => setAmbientType(e.target.value)}
            style={{
              background: 'var(--bg-layer2)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '11px',
              padding: '2px 4px',
              outline: 'none',
              cursor: 'pointer'
            }}
            title="选择听书背景伴奏声景"
          >
            {AMBIENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ background: 'var(--bg-layer1)', color: 'var(--text-primary)' }}>
                {opt.icon} {opt.label}
              </option>
            ))}
          </select>

          {/* 伴奏独立音量滑块 (仅在开启伴奏时展开显示) */}
          {ambientType !== 'none' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '2px' }} title={`伴奏音量: ${Math.round(ambientVolume * 100)}%`}>
              <input
                type="range"
                min="0.05"
                max="0.8"
                step="0.05"
                value={ambientVolume}
                onChange={(e) => setAmbientVolume(Number(e.target.value))}
                style={{
                  width: '50px',
                  accentColor: 'var(--accent)',
                  cursor: 'pointer',
                  height: '4px'
                }}
              />
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', minWidth: '22px' }}>
                {Math.round(ambientVolume * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* 定时休眠下拉 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>休眠:</span>
          <select
            value={sleepMinutes}
            onChange={(e) => handleSleepChange(Number(e.target.value))}
            style={{
              background: 'var(--bg-layer2)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '11px',
              padding: '2px 4px',
              outline: 'none'
            }}
          >
            {SLEEP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ background: 'var(--bg-layer1)', color: 'var(--text-primary)' }}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
