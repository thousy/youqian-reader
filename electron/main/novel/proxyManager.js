import net from 'net'
import http from 'http'
import https from 'https'
import { URL } from 'url'
import * as httpsProxyAgentModule from 'https-proxy-agent'
const HttpsProxyAgent = httpsProxyAgentModule.default || httpsProxyAgentModule.HttpsProxyAgent || httpsProxyAgentModule
import { getStore } from '../database.js'
import { matchGfwlist, updateGfwlistOnline, getGfwlistStatus } from './gfwlistParser.js'

export const DEFAULT_PROXY_CONFIG = {
  mode: 'auto', // 'auto' (智能分流) | 'proxy' (全局代理) | 'direct' (直接连接)
  proxyUrl: 'http://127.0.0.1:1080',
  defaultProfile: 'direct', // 默认情景模式: 'direct' | 'proxy'
  rules: [
    { id: 'r1', pattern: '*.baidu.com', profile: 'direct' },
    { id: 'r2', pattern: '*.cool18.com', profile: 'proxy' },
    { id: 'r3', pattern: '*.xoimg.com', profile: 'proxy' },
    { id: 'r4', pattern: '2023.redircdn.com', profile: 'proxy' },
    { id: 'r5', pattern: '*.99img.cc', profile: 'proxy' },
    { id: 'r6', pattern: '*.66img.cc', profile: 'proxy' },
    { id: 'r7', pattern: '*.githubusercontent.com', profile: 'proxy' }
  ],
  ruleList: {
    enabled: true,
    profile: 'proxy',
    format: 'AutoProxy',
    url: 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt',
    lastUpdated: null,
    ruleCount: 0
  }
}

const COMMON_PORTS = [1080, 7890, 10808, 10809, 8888, 8080, 2080]

// 缓存 Agent 实例
let cachedAgent = null
let cachedAgentUrl = null

/**
 * 标准化规则对象数组，并做向下兼容
 */
function normalizeRules(rawRules) {
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    return [...DEFAULT_PROXY_CONFIG.rules]
  }

  return rawRules.map((r, idx) => {
    if (typeof r === 'string') {
      return {
        id: `r_${idx}_${Date.now()}`,
        pattern: r.trim(),
        profile: 'proxy'
      }
    }
    return {
      id: r.id || `r_${idx}_${Date.now()}`,
      pattern: (r.pattern || '').trim(),
      profile: r.profile === 'direct' ? 'direct' : 'proxy'
    }
  }).filter(r => Boolean(r.pattern))
}

// 内存配置缓存 (在无store或测试环境下兜底)
let memoryConfig = null

/**
 * 获取当前网络代理配置
 */
export function getProxyConfig() {
  try {
    const store = getStore()
    const stored = store ? store.get('proxyConfig', null) : memoryConfig
    
    // 若尚未配置，优先尝试从环境变量读取
    const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY
    const defaultUrl = envProxy ? (envProxy.startsWith('http') ? envProxy : `http://${envProxy}`) : DEFAULT_PROXY_CONFIG.proxyUrl

    const gfwMeta = getGfwlistStatus()

    if (!stored) {
      return {
        ...DEFAULT_PROXY_CONFIG,
        proxyUrl: defaultUrl,
        ruleList: {
          ...DEFAULT_PROXY_CONFIG.ruleList,
          lastUpdated: gfwMeta.lastUpdated,
          ruleCount: gfwMeta.ruleCount
        }
      }
    }

    const rules = normalizeRules(stored.rules)
    const ruleList = {
      enabled: stored.ruleList?.enabled ?? DEFAULT_PROXY_CONFIG.ruleList.enabled,
      profile: stored.ruleList?.profile || DEFAULT_PROXY_CONFIG.ruleList.profile,
      format: stored.ruleList?.format || DEFAULT_PROXY_CONFIG.ruleList.format,
      url: stored.ruleList?.url || DEFAULT_PROXY_CONFIG.ruleList.url,
      lastUpdated: gfwMeta.lastUpdated || stored.ruleList?.lastUpdated || null,
      ruleCount: gfwMeta.ruleCount || stored.ruleList?.ruleCount || 0
    }

    return {
      mode: stored.mode || DEFAULT_PROXY_CONFIG.mode,
      proxyUrl: stored.proxyUrl || defaultUrl,
      defaultProfile: stored.defaultProfile || DEFAULT_PROXY_CONFIG.defaultProfile,
      rules,
      ruleList
    }
  } catch (err) {
    console.error('[ProxyManager] 读取代理配置失败，回退到默认设置:', err)
    return { ...DEFAULT_PROXY_CONFIG }
  }
}

/**
 * 保存网络代理配置
 */
export function saveProxyConfig(config) {
  try {
    const store = getStore()
    const current = getProxyConfig()

    const updated = {
      mode: config.mode || current.mode,
      proxyUrl: (config.proxyUrl || current.proxyUrl).trim(),
      defaultProfile: config.defaultProfile === 'proxy' ? 'proxy' : 'direct',
      rules: normalizeRules(config.rules || current.rules),
      ruleList: {
        ...current.ruleList,
        ...(config.ruleList || {})
      }
    }

    memoryConfig = updated
    if (store) {
      store.set('proxyConfig', updated)
    }

    // 清理 agent 缓存
    cachedAgent = null
    cachedAgentUrl = null

    console.log('[ProxyManager] 代理配置已保存，当前规则条数:', updated.rules.length)
    return { success: true, config: updated }
  } catch (err) {
    console.error('[ProxyManager] 保存代理配置异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 校验通配符规则是否匹配 Host
 * 例如: *.cool18.com 匹配 cool18.com, www.cool18.com, img.cool18.com
 */
export function matchRule(hostname, rulePattern) {
  if (!hostname || !rulePattern) return false
  const host = hostname.toLowerCase().trim()
  const r = rulePattern.toLowerCase().trim()

  if (r === '*' || r === '*.*') return true
  if (r === host) return true

  if (r.startsWith('*.')) {
    const rootDomain = r.slice(2)
    return host === rootDomain || host.endsWith('.' + rootDomain)
  }

  if (r.startsWith('.')) {
    const rootDomain = r.slice(1)
    return host === rootDomain || host.endsWith('.' + rootDomain)
  }

  // 通配符替换为正则
  const regexPattern = '^' + r.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
  try {
    const reg = new RegExp(regexPattern)
    return reg.test(host)
  } catch (_) {
    return host.includes(r)
  }
}

/**
 * 判断指定 URL 是否应通过代理
 * 匹配链路: 自定义按序规则 -> gfwlist 规则列表 -> 默认情景模式
 */
export function shouldUseProxy(urlStr) {
  const config = getProxyConfig()
  if (config.mode === 'direct') return false
  if (config.mode === 'proxy') return true

  // 'auto' 模式进行规则匹配
  let hostname = ''
  try {
    hostname = new URL(urlStr).hostname
  } catch (_) {
    hostname = String(urlStr)
  }

  // 1. 第一层：自定义规则，自上而下逐条匹配 (排序敏感)
  for (const rule of config.rules) {
    if (matchRule(hostname, rule.pattern)) {
      // 命中自定义规则，直接采用该规则设定的 profile
      return rule.profile === 'proxy'
    }
  }

  // 2. 第二层：规则列表规则 (gfwlist)
  if (config.ruleList && config.ruleList.enabled) {
    const gfwMatch = matchGfwlist(urlStr)
    if (gfwMatch === 'whitelist') {
      return false // 命中白名单，直接连接
    }
    if (gfwMatch === 'blacklist') {
      return config.ruleList.profile === 'proxy' // 命中黑名单，按列表情景走
    }
  }

  // 3. 第三层：兜底默认情景模式
  return config.defaultProfile === 'proxy'
}

/**
 * 获取请求所需的代理 Agent
 */
export function getProxyAgent(urlStr) {
  if (!shouldUseProxy(urlStr)) return null

  const config = getProxyConfig()
  const proxyUrl = config.proxyUrl
  if (!proxyUrl) return null

  if (cachedAgent && cachedAgentUrl === proxyUrl) {
    return cachedAgent
  }

  try {
    const agent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: false,
      timeout: 15000
    })
    cachedAgent = agent
    cachedAgentUrl = proxyUrl
    return agent
  } catch (err) {
    console.error('[ProxyManager] 创建 HttpsProxyAgent 失败:', err)
    return null
  }
}

/**
 * 探测本机单个端口是否开放
 */
function probePort(port, host = '127.0.0.1', timeout = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let status = false

    socket.setTimeout(timeout)
    socket.once('connect', () => {
      status = true
      socket.destroy()
      resolve(true)
    })

    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })

    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })

    socket.connect(port, host)
  })
}

/**
 * 自动扫描探测本机常见代理端口
 */
export async function detectLocalProxies() {
  const results = []
  for (const port of COMMON_PORTS) {
    const isOpen = await probePort(port)
    if (isOpen) {
      results.push({
        port,
        host: '127.0.0.1',
        url: `http://127.0.0.1:${port}`,
        desc: port === 1080 ? '常见 Shadowsocks/v2ray 本地代理'
            : port === 7890 ? '常见 Clash 默认 HTTP 端口'
            : port === 10808 || port === 10809 ? '常见 v2rayN/Xray HTTP 端口'
            : '本地开放代理端口'
      })
    }
  }
  return results
}

/**
 * 测试代理连通性并测量握手延迟 (ms)
 */
export function testProxyConnection(targetUrl = 'https://www.cool18.com', customProxyUrl = null) {
  return new Promise((resolve) => {
    const proxyUrl = customProxyUrl || getProxyConfig().proxyUrl
    if (!proxyUrl) {
      return resolve({ success: false, error: '未配置代理服务器地址' })
    }

    const startTime = Date.now()
    let parsedTarget
    try {
      parsedTarget = new URL(targetUrl)
    } catch (e) {
      return resolve({ success: false, error: '目标测试网址格式不正确' })
    }

    let agent
    try {
      agent = new HttpsProxyAgent(proxyUrl, {
        rejectUnauthorized: false,
        timeout: 10000
      })
    } catch (e) {
      return resolve({ success: false, error: `代理地址格式错误: ${e.message}` })
    }

    const isHttps = parsedTarget.protocol === 'https:'
    const client = isHttps ? https : http

    const req = client.request({
      protocol: parsedTarget.protocol,
      hostname: parsedTarget.hostname,
      port: parsedTarget.port || (isHttps ? 443 : 80),
      path: parsedTarget.pathname + parsedTarget.search,
      method: 'GET',
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
        'Accept': '*/*'
      },
      timeout: 10000
    }, (res) => {
      const latency = Date.now() - startTime
      res.resume() // 消费数据避免内存泄露
      resolve({
        success: true,
        statusCode: res.statusCode,
        latency,
        proxyUrl,
        message: `连接成功 (HTTP ${res.statusCode}, 延迟 ${latency}ms)`
      })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({ success: false, error: '连接超时 (10000ms)，请检查代理服务是否运行' })
    })

    req.on('error', (err) => {
      resolve({ success: false, error: `连接失败: ${err.message}` })
    })

    req.end()
  })
}

/**
 * 在线更新规则列表 (gfwlist)
 */
export async function updateRuleList(url) {
  const targetUrl = url || getProxyConfig().ruleList.url
  const res = await updateGfwlistOnline(targetUrl)
  if (res.success) {
    const store = getStore()
    if (store) {
      const current = getProxyConfig()
      store.set('proxyConfig.ruleList', {
        ...current.ruleList,
        lastUpdated: res.lastUpdated,
        ruleCount: res.ruleCount
      })
    }
  }
  return res
}

/**
 * 将分流规则同步应用到 Electron Session
 */
export async function applyToElectronSession(session) {
  if (!session) return
  const config = getProxyConfig()

  try {
    if (config.mode === 'direct') {
      await session.setProxy({ mode: 'direct' })
      console.log('[ProxyManager] Electron Session 已切换为直连模式')
      return
    }

    if (config.mode === 'proxy') {
      await session.setProxy({ proxyRules: config.proxyUrl })
      console.log('[ProxyManager] Electron Session 已切换为全局代理:', config.proxyUrl)
      return
    }

    if (config.mode === 'auto') {
      // 智能分流: 构造 PAC 脚本 (Proxy Auto-Config)
      const proxyUrlObj = new URL(config.proxyUrl)
      const pacProxyString = `PROXY ${proxyUrlObj.host}; DIRECT`
      
      const customRulesJson = JSON.stringify(config.rules)
      const defaultProfile = config.defaultProfile || 'direct'

      const pacScript = `
        function FindProxyForURL(url, host) {
          var rules = ${customRulesJson};
          for (var i = 0; i < rules.length; i++) {
            var r = rules[i];
            if (shExpMatch(host, r.pattern)) {
              return r.profile === 'proxy' ? "${pacProxyString}" : "DIRECT";
            }
          }
          ${defaultProfile === 'proxy' ? `return "${pacProxyString}";` : `return "DIRECT";`}
        }
      `
      await session.setProxy({
        pacScript: 'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(pacScript).toString('base64')
      })
      console.log('[ProxyManager] Electron Session 已应用 Auto Switch PAC 智能分流规则')
    }
  } catch (err) {
    console.error('[ProxyManager] 同步代理至 Electron Session 失败:', err)
  }
}
