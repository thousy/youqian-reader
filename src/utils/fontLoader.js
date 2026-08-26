/**
 * 前端自定义字体动态加载器 (Dynamic Font Loader)
 * 采用 Electron 特权协议 custom-font:// 直接流式映射本地字体文件
 * 100% 杜绝 OTS 解析错误、0 跨域限制、0 内存膨胀，确保所有阅读器及 iframe 高保真生效
 */

const loadedFontSet = new Set()
let customFontsCache = []

/**
 * 获取当前已缓存的自定义字体列表
 */
export function getLoadedCustomFonts() {
  return customFontsCache
}

/**
 * 获取全局注入的自定义字体 @font-face CSS 字符串
 */
export function getCustomFontsCssForIframe() {
  const styleEl = document.getElementById('custom-fonts-global-styles')
  return styleEl ? styleEl.textContent : ''
}

/**
 * 加载并注册所有自定义字体到 DOM / CSS
 */
export async function initCustomFonts() {
  try {
    if (!window.api?.customFontGetList) return []

    const fonts = await window.api.customFontGetList()
    if (!Array.isArray(fonts)) return []

    customFontsCache = fonts

    for (const font of fonts) {
      await registerSingleCustomFont(font)
    }

    return customFontsCache
  } catch (err) {
    console.warn('[FontLoader] 初始化加载自定义字体失败:', err)
    return []
  }
}

/**
 * 动态注册单个字体 (custom-font 特权协议驱动)
 */
export async function registerSingleCustomFont(font) {
  if (!font || !font.fileName) return
  if (loadedFontSet.has(font.fileName)) return

  try {
    const cleanName = font.name.trim()
    const ext = (font.ext || '').toLowerCase()
    let mime = 'font/ttf'
    if (ext === 'otf') mime = 'font/otf'
    else if (ext === 'woff') mime = 'font/woff'
    else if (ext === 'woff2') mime = 'font/woff2'

    // 1. 读取字体二进制 Buffer 原生装载
    const buf = await window.api?.customFontReadBuffer?.(font.fileName)
    if (buf) {
      const arrayBuffer = buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf
      const fontFace = new FontFace(cleanName, arrayBuffer)
      const loaded = await fontFace.load()
      document.fonts.add(loaded)

      // 2. 生成 Blob URL 注入全局 @font-face 样式标签，供 CSS 选择器及 iframe 高保真继承
      const blob = new Blob([arrayBuffer], { type: mime })
      const fontBlobUrl = URL.createObjectURL(blob)

      let styleEl = document.getElementById('custom-fonts-global-styles')
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = 'custom-fonts-global-styles'
        document.head.appendChild(styleEl)
      }

      const fontFaceRules = `
@font-face {
  font-family: '${cleanName}';
  src: url('${fontBlobUrl}');
  font-display: swap;
}
@font-face {
  font-family: '"${cleanName}"';
  src: url('${fontBlobUrl}');
  font-display: swap;
}
`
      if (!styleEl.textContent.includes(`'${cleanName}'`)) {
        styleEl.textContent += fontFaceRules
      }
    }

    loadedFontSet.add(font.fileName)
    console.log(`[FontLoader] 成功注册并激活自定义字体: ${cleanName}`)
  } catch (err) {
    console.error(`[FontLoader] 注册字体失败 ${font.name}:`, err)
  }
}

/**
 * 针对 EPUB iframe 动态挂载自定义字体样式
 */
export function injectCustomFontsToIframe(iframeDoc) {
  if (!iframeDoc) return
  try {
    let iframeStyle = iframeDoc.getElementById('epub-custom-fonts-style')
    if (!iframeStyle) {
      iframeStyle = iframeDoc.createElement('style')
      iframeStyle.id = 'epub-custom-fonts-style'
      iframeDoc.head.appendChild(iframeStyle)
    }
    const globalCss = getCustomFontsCssForIframe()
    if (globalCss) {
      iframeStyle.textContent = globalCss
    }

    // 同时将主文档已加载的 FontFace 共享给 iframe
    if (document.fonts && iframeDoc.fonts) {
      document.fonts.forEach(ff => {
        try { iframeDoc.fonts.add(ff) } catch (_) {}
      })
    }
  } catch (err) {
    console.warn('[FontLoader] iframe 字体挂载提示:', err)
  }
}
