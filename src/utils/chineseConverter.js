import * as OpenCC from 'opencc-js'

let t2cn = null
let cn2t = null

/**
 * 获取繁转简转换器（单例惰性加载）
 */
function getT2CnConverter() {
  if (!t2cn) {
    try {
      t2cn = OpenCC.Converter({ from: 't', to: 'cn' })
    } catch (e) {
      console.error('初始化 OpenCC 繁转简失败:', e)
      t2cn = (s) => s
    }
  }
  return t2cn
}

/**
 * 获取简转繁转换器（单例惰性加载）
 */
function getCn2TConverter() {
  if (!cn2t) {
    try {
      cn2t = OpenCC.Converter({ from: 'cn', to: 't' })
    } catch (e) {
      console.error('初始化 OpenCC 简转繁失败:', e)
      cn2t = (s) => s
    }
  }
  return cn2t
}

/**
 * 繁体转简体
 * @param {string} text 待转换文本
 * @returns {string} 简体中文文本
 */
export function toSimplified(text) {
  if (!text || typeof text !== 'string') return text
  try {
    return getT2CnConverter()(text)
  } catch (err) {
    console.error('繁体转简体出错:', err)
    return text
  }
}

/**
 * 简体转繁体
 * @param {string} text 待转换文本
 * @returns {string} 繁体中文文本
 */
export function toTraditional(text) {
  if (!text || typeof text !== 'string') return text
  try {
    return getCn2TConverter()(text)
  } catch (err) {
    console.error('简体转繁体出错:', err)
    return text
  }
}

/**
 * 根据阅读排版设置统一转换文本
 * @param {string} text 待转换文本
 * @param {string} mode 模式：'none' | 't2s' | 's2t'
 * @returns {string} 转换后文本
 */
export function convertChinese(text, mode = 'none') {
  if (!text || typeof text !== 'string') return text
  if (mode === 't2s') {
    return toSimplified(text)
  }
  if (mode === 's2t') {
    return toTraditional(text)
  }
  return text
}

/**
 * 安全地对 HTML 内容中的可见文本节点进行繁简转换，不破坏标签属性
 * @param {string} html 待转换的 HTML 字符串
 * @param {string} mode 模式：'none' | 't2s' | 's2t'
 * @returns {string} 转换后的 HTML 字符串
 */
export function convertHtmlChinese(html, mode = 'none') {
  if (!html || typeof html !== 'string' || mode === 'none') return html
  return html.replace(/>([^<]+)</g, (_match, text) => {
    return '>' + convertChinese(text, mode) + '<'
  })
}
