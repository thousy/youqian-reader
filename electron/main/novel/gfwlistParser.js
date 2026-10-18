import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { URL } from 'url'
import { getPortableDataDir } from '../portablePath.js'
import { fetchWithRetry } from './utils.js'

let cachedRules = null
let cachedMeta = null

/**
 * 获取本地缓存文件路径
 */
function getCacheFilePath() {
  const dir = getPortableDataDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'gfwlist_cache.json')
}

/**
 * 内置基础离线规则 (兜底保障在断网或无法连通 GitHub 时依然拥有完善的常见规则)
 */
const BUILTIN_RULES = [
  'cool18.com',
  '99img.cc',
  '66img.cc',
  'xoimg.com',
  'redircdn.com',
  'github.com',
  'githubusercontent.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'twitter.com',
  'x.com',
  'wikipedia.org',
  'archive.org'
]

/**
 * 解析 AutoProxy / gfwlist 格式规则文本 (Base64 或纯文本)
 */
export function parseAutoProxyText(rawText) {
  let content = rawText
  // 尝试 Base64 解码
  try {
    const cleaned = rawText.replace(/\s+/g, '')
    const decoded = Buffer.from(cleaned, 'base64').toString('utf-8')
    // 如果解码后包含通常的标记行如 [AutoProxy 或 !，则采用解码后内容
    if (decoded.includes('[AutoProxy') || decoded.includes('!')) {
      content = decoded
    }
  } catch (_) {}

  const lines = content.split(/\r?\n/)
  const whitelist = []
  const domainRules = []
  const regexRules = []

  for (let line of lines) {
    line = line.trim()
    if (!line || line.startsWith('!') || line.startsWith('[')) {
      continue // 注释或标记
    }

    // 白名单规则: @@||example.com 或 @@http...
    if (line.startsWith('@@')) {
      const target = line.slice(2).replace(/^\|\|/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
      if (target) whitelist.push(target)
      continue
    }

    // 正则规则: /pattern/
    if (line.startsWith('/') && line.endsWith('/') && line.length > 2) {
      try {
        const pattern = line.slice(1, -1)
        regexRules.push(new RegExp(pattern, 'i'))
      } catch (_) {}
      continue
    }

    // 域名规则: ||example.com
    if (line.startsWith('||')) {
      const domain = line.slice(2).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
      if (domain) domainRules.push(domain)
      continue
    }

    // 前缀匹配: |http:// 或 |https://
    if (line.startsWith('|')) {
      const domain = line.slice(1).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
      if (domain) domainRules.push(domain)
      continue
    }

    // 普通关键词或域名规则
    const clean = line.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
    if (clean) {
      domainRules.push(clean)
    }
  }

  return {
    whitelist: Array.from(new Set(whitelist)),
    domainRules: Array.from(new Set(domainRules)),
    regexRules
  }
}

/**
 * 从本地加载缓存的规则
 */
export function loadLocalGfwlist() {
  if (cachedRules) {
    return cachedRules
  }

  const filePath = getCacheFilePath()
  if (existsSync(filePath)) {
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'))
      cachedRules = {
        whitelist: new Set(data.whitelist || []),
        domainRules: data.domainRules || [],
        regexRules: (data.regexRules || []).map(r => new RegExp(r, 'i'))
      }
      cachedMeta = {
        lastUpdated: data.lastUpdated || null,
        ruleCount: (data.domainRules?.length || 0) + (data.whitelist?.length || 0)
      }
      console.log(`[GFWList] 已从本地缓存载入规则库: ${cachedMeta.ruleCount} 条`)
      return cachedRules
    } catch (e) {
      console.warn('[GFWList] 读取本地规则缓存异常:', e.message)
    }
  }

  // 使用内置规则
  cachedRules = {
    whitelist: new Set(),
    domainRules: [...BUILTIN_RULES],
    regexRules: []
  }
  cachedMeta = {
    lastUpdated: null,
    ruleCount: BUILTIN_RULES.length
  }
  return cachedRules
}

/**
 * 获取规则列表的当前状态
 */
export function getGfwlistStatus() {
  loadLocalGfwlist()
  return cachedMeta || { lastUpdated: null, ruleCount: BUILTIN_RULES.length }
}

/**
 * 校验目标 URL 是否命中 GFWList
 * 返回: 'whitelist' | 'blacklist' | null
 */
export function matchGfwlist(urlStr) {
  const rules = loadLocalGfwlist()
  let hostname = ''
  try {
    hostname = new URL(urlStr).hostname.toLowerCase()
  } catch (_) {
    hostname = String(urlStr).toLowerCase()
  }

  // 1. 白名单检查
  if (rules.whitelist.has(hostname)) {
    return 'whitelist'
  }
  for (const w of rules.whitelist) {
    if (hostname.endsWith('.' + w)) {
      return 'whitelist'
    }
  }

  // 2. 域名黑名单检查
  for (const d of rules.domainRules) {
    if (hostname === d || hostname.endsWith('.' + d)) {
      return 'blacklist'
    }
  }

  // 3. 正则检查
  for (const reg of rules.regexRules) {
    if (reg.test(urlStr)) {
      return 'blacklist'
    }
  }

  return null
}

/**
 * 在线更新 GFWList 规则列表
 */
export async function updateGfwlistOnline(url = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt') {
  console.log('[GFWList] 正在从目标网址下载规则列表:', url)
  try {
    // 强制超时设为 25 秒，使用带重试的网络抓取（优先走代理通道）
    const rawData = await fetchWithRetry(url, {}, 3, 25000)
    if (!rawData || rawData.length < 50) {
      throw new Error('下载的内容为空或数据异常')
    }

    const parsed = parseAutoProxyText(rawData)
    const ruleCount = parsed.domainRules.length + parsed.whitelist.length + parsed.regexRules.length
    if (ruleCount === 0) {
      throw new Error('未能从下载内容中解析出有效规则')
    }

    const now = new Date().toISOString()
    const payloadToSave = {
      lastUpdated: now,
      ruleCount,
      whitelist: parsed.whitelist,
      domainRules: parsed.domainRules,
      regexRules: parsed.regexRules.map(r => r.source)
    }

    const filePath = getCacheFilePath()
    writeFileSync(filePath, JSON.stringify(payloadToSave, null, 2), 'utf-8')

    // 更新内存缓存
    cachedRules = {
      whitelist: new Set(parsed.whitelist),
      domainRules: parsed.domainRules,
      regexRules: parsed.regexRules
    }
    cachedMeta = {
      lastUpdated: now,
      ruleCount
    }

    console.log(`[GFWList] 规则列表更新完成！成功解析 ${ruleCount} 条规则`)
    return {
      success: true,
      lastUpdated: now,
      ruleCount,
      message: `成功更新并加载 ${ruleCount} 条规则`
    }
  } catch (err) {
    console.error('[GFWList] 更新规则列表失败:', err)
    return {
      success: false,
      error: `更新失败: ${err.message}`
    }
  }
}
