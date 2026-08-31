// 物理声学原生声景合成器 (基于 Web Audio API，零网络、零外部资源依赖、无限循环平滑音景)
class AmbientSoundEngine {
  constructor() {
    this.ctx = null
    this.currentType = 'none' // 'none', 'rain', 'fireplace', 'breeze', 'zen'
    this.volume = 0.2 // 0 ~ 1
    this.masterGain = null
    this.activeNodes = []
    this.isPlaying = false
  }

  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
        this.masterGain = this.ctx.createGain()
        this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime)
        this.masterGain.connect(this.ctx.destination)
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  // 设置音量 (0 ~ 1)
  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val))
    if (this.masterGain && this.ctx && this.isPlaying) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05)
    }
  }

  // 停止所有音频节点
  stopNodes() {
    this.activeNodes.forEach(item => {
      try {
        if (item.stop) item.stop()
        if (item.disconnect) item.disconnect()
        if (item.timer) clearInterval(item.timer)
      } catch (_) {}
    })
    this.activeNodes = []
  }

  // 播放指定声景
  play(type = this.currentType) {
    this.initContext()
    if (!this.ctx) return

    this.currentType = type
    if (type === 'none') {
      this.pause()
      return
    }

    this.stopNodes()
    this.isPlaying = true

    // 根据不同类型创建声学合成节点
    switch (type) {
      case 'rain':
        this.createRainSound()
        break
      case 'fireplace':
        this.createFireplaceSound()
        break
      case 'breeze':
        this.createBreezeSound()
        break
      case 'zen':
        this.createZenAmbientSound()
        break
      default:
        break
    }

    // 平滑淡入
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime)
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ctx.currentTime)
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.4)
    }
  }

  // 平滑暂停
  pause() {
    if (!this.ctx || !this.masterGain) return
    this.isPlaying = false
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ctx.currentTime)
    this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3)

    setTimeout(() => {
      if (!this.isPlaying) {
        this.stopNodes()
      }
    }, 450)
  }

  // 1. 窗外夜雨 (粉红噪音 + 低通滤波 + 柔和随机水滴粒子)
  createRainSound() {
    const bufferSize = this.ctx.sampleRate * 2
    const noiseBuffer = this.ctx.createBuffer(2, bufferSize, this.ctx.sampleRate)
    
    // 生成逼真的粉红噪音
    for (let channel = 0; channel < 2; channel++) {
      const output = noiseBuffer.getChannelData(channel)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.96900 * b2 + white * 0.1538520
        b3 = 0.86650 * b3 + white * 0.3104856
        b4 = 0.55000 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.0168980
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04
        b6 = white * 0.115926
      }
    }

    const whiteNoise = this.ctx.createBufferSource()
    whiteNoise.buffer = noiseBuffer
    whiteNoise.loop = true

    // 双二阶低通滤波
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(950, this.ctx.currentTime)

    whiteNoise.connect(filter)
    filter.connect(this.masterGain)
    whiteNoise.start()

    this.activeNodes.push(whiteNoise, filter)
  }

  // 2. 温暖壁炉 (低频暖噪 + 随机柴火轻微爆裂声)
  createFireplaceSound() {
    const bufferSize = this.ctx.sampleRate * 2
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate)
    const output = noiseBuffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * 0.06
    }

    const noise = this.ctx.createBufferSource()
    noise.buffer = noiseBuffer
    noise.loop = true

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(320, this.ctx.currentTime)

    noise.connect(filter)
    filter.connect(this.masterGain)
    noise.start()

    // 随机柴火噼啪声生成器
    const crackleInterval = setInterval(() => {
      if (!this.isPlaying || !this.ctx) return
      if (Math.random() > 0.45) return

      try {
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(600 + Math.random() * 800, this.ctx.currentTime)
        gain.gain.setValueAtTime(0.08 + Math.random() * 0.08, this.ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.035)

        osc.connect(gain)
        gain.connect(this.masterGain)
        osc.start()
        osc.stop(this.ctx.currentTime + 0.04)
      } catch (_) {}
    }, 120)

    this.activeNodes.push(noise, filter, { timer: crackleInterval })
  }

  // 3. 深林微风 (LFO 缓速调制的多级带通自然风声)
  createBreezeSound() {
    const bufferSize = this.ctx.sampleRate * 2
    const noiseBuffer = this.ctx.createBuffer(2, bufferSize, this.ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const out = noiseBuffer.getChannelData(c)
      for (let i = 0; i < bufferSize; i++) {
        out[i] = (Math.random() * 2 - 1) * 0.05
      }
    }

    const noise = this.ctx.createBufferSource()
    noise.buffer = noiseBuffer
    noise.loop = true

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(380, this.ctx.currentTime)
    filter.Q.setValueAtTime(1.2, this.ctx.currentTime)

    // LFO 慢周期微风摇曳调制
    const lfo = this.ctx.createOscillator()
    lfo.frequency.setValueAtTime(0.12, this.ctx.currentTime) // 约 8 秒起伏一次
    const lfoGain = this.ctx.createGain()
    lfoGain.gain.setValueAtTime(180, this.ctx.currentTime)

    lfo.connect(lfoGain)
    lfoGain.connect(filter.frequency)

    noise.connect(filter)
    filter.connect(this.masterGain)

    noise.start()
    lfo.start()

    this.activeNodes.push(noise, filter, lfo, lfoGain)
  }

  // 4. 静心和弦 (五度/九度和声长延音纯乐音景)
  createZenAmbientSound() {
    // 根音和弦音频：C3 (130.81Hz), G3 (196.00Hz), D4 (293.66Hz), E4 (329.63Hz)
    const freqs = [130.81, 196.00, 293.66, 329.63]
    const subGain = this.ctx.createGain()
    subGain.gain.setValueAtTime(0.045, this.ctx.currentTime)
    subGain.connect(this.masterGain)

    freqs.forEach(freq => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime)

      // 微颤调谐使和弦深沉空灵
      const detuneLfo = this.ctx.createOscillator()
      detuneLfo.frequency.setValueAtTime(0.2 + Math.random() * 0.1, this.ctx.currentTime)
      const detuneGain = this.ctx.createGain()
      detuneGain.gain.setValueAtTime(3.5, this.ctx.currentTime)

      detuneLfo.connect(detuneGain)
      detuneGain.connect(osc.detune)

      osc.connect(subGain)
      osc.start()
      detuneLfo.start()

      this.activeNodes.push(osc, detuneLfo, detuneGain)
    })

    this.activeNodes.push(subGain)
  }
}

export const ambientSoundEngine = new AmbientSoundEngine()
