import { getStore } from '../database.js'
import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 极简兜底备用规则（仅在无法读取内置文件时使用）
 */
export const DEFAULT_FALLBACK_RULES = [
  {
    id: 'rule-builtin-site-promo',
    name: '【阅读3.0】去除站点宣传与最新网址',
    pattern: '(天才一秒记住.*?|最新网址[：:]\\s*.*|本站首发.*?|一秒记住.*?|请记住本书首发.*?|最快更新.*?|无广告.*?|手机版网址：.*?)(?:\\n|$)',
    replacement: '',
    isRegex: true,
    scope: '',
    isEnabled: true,
    order: 1
  },
  {
    id: 'rule-builtin-urls',
    name: '【阅读3.0】去除纯网址与协议域名',
    pattern: 'https?:\\/\\/[^\\n\\s\\u4e00-\\u9fa5]+|www\\.[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_.-]+',
    replacement: '',
    isRegex: true,
    scope: '',
    isEnabled: true,
    order: 2
  },
  {
    id: 'rule-builtin-watermark',
    name: '【阅读3.0】去除常见小说站尾缀与水印',
    pattern: '(爱曲小说|笔趣阁|顶点小说|飘天文学|69书吧|书海阁|飞卢小说).*?(最快更新|手机阅读|最新章节|首发|无弹窗).*',
    replacement: '',
    isRegex: true,
    scope: '',
    isEnabled: true,
    order: 3
  },
  {
    id: 'rule-builtin-beg-tickets',
    name: '【阅读3.0】去除求月票/求打赏/加群废话',
    pattern: '^(求月票|求推荐票|求收藏|请大家支持正版|求打赏|读者群[：:]\\s*\\d+).*$',
    replacement: '',
    isRegex: true,
    scope: '',
    isEnabled: true,
    order: 4
  },
  {
    id: 'rule-builtin-compress-newlines',
    name: '【阅读3.0】多余连续空行压缩规范化',
    pattern: '\\n{3,}',
    replacement: '\n\n',
    isRegex: true,
    scope: '',
    isEnabled: true,
    order: 99
  }
]

/**
 * 加载阅读 3.0 内置豪华替换规则库 (exportReplaceRule.json 1.5万行)
 */
export function loadBuiltinReplaceRules() {
  try {
    const candidates = [
      join(__dirname, 'rules', 'defaultReplaceRules.json'),
      join(process.cwd(), 'electron', 'main', 'novel', 'rules', 'defaultReplaceRules.json'),
      'd:\\YouQian Reader\\electron\\main\\novel\\rules\\defaultReplaceRules.json',
      'd:\\YouQian Reader\\Rule\\exportReplaceRule.json'
    ]
    for (const p of candidates) {
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item, idx) => ({
            id: item.id !== undefined ? String(item.id) : `rule-builtin-${idx}`,
            name: item.name || `内置规则 #${idx + 1}`,
            pattern: item.pattern || item.regex || '',
            replacement: item.replacement !== undefined ? item.replacement : '',
            isRegex: item.isRegex !== undefined ? Boolean(item.isRegex) : true,
            scope: item.scope || '',
            isEnabled: item.isEnabled !== undefined ? Boolean(item.isEnabled) : true,
            order: item.order !== undefined ? item.order : (idx + 1)
          }))
        }
      }
    }
  } catch (e) {
    console.warn('[ReplaceRule] 读取内置替换规则异常:', e.message)
  }
  return DEFAULT_FALLBACK_RULES
}

/**
 * 获取所有替换净化规则（若未设置则自动填充阅读 3.0 豪华规则库）
 */
export function getReplaceRules() {
  const store = getStore()
  if (!store) return loadBuiltinReplaceRules()
  let rules = store.get('novelReplaceRules')
  if (!Array.isArray(rules) || rules.length === 0) {
    const builtins = loadBuiltinReplaceRules()
    store.set('novelReplaceRules', builtins)
    return builtins
  }

  // 纠偏历史写入 store 的旧压缩空行规则与字面量换行
  let changed = false
  const updated = rules.map(r => {
    if (r.id === 'rule-builtin-compress-newlines' && r.replacement === '\\n\\n') {
      changed = true
      return { ...r, replacement: '\n\n' }
    }
    return r
  })
  if (changed) {
    store.set('novelReplaceRules', updated)
    return updated
  }

  return rules
}

/**
 * 保存替换净化规则列表
 */
export function saveReplaceRules(rules) {
  const store = getStore()
  if (!store) return false
  store.set('novelReplaceRules', rules)
  return true
}

/**
 * 新增单条替换规则
 */
export function addReplaceRule(rule) {
  const rules = getReplaceRules()
  const newRule = {
    id: rule.id || `rule-${randomUUID().slice(0, 8)}`,
    name: rule.name || '新建替换规则',
    pattern: rule.pattern || '',
    replacement: rule.replacement !== undefined ? rule.replacement : '',
    isRegex: rule.isRegex !== false,
    scope: rule.scope || '',
    isEnabled: rule.isEnabled !== false,
    order: rule.order || (rules.length + 1)
  }
  rules.push(newRule)
  saveReplaceRules(rules)
  return newRule
}

/**
 * 修改单条替换规则
 */
export function updateReplaceRule(id, updates) {
  const rules = getReplaceRules()
  const idx = rules.findIndex(r => r.id === id)
  if (idx !== -1) {
    rules[idx] = { ...rules[idx], ...updates }
    saveReplaceRules(rules)
    return rules[idx]
  }
  return null
}

/**
 * 删除替换规则
 */
export function deleteReplaceRule(id) {
  const rules = getReplaceRules()
  const filtered = rules.filter(r => r.id !== id)
  saveReplaceRules(filtered)
  return true
}

/**
 * 切换替换规则启用/停用状态
 */
export function toggleReplaceRule(id, isEnabled = null) {
  const rules = getReplaceRules()
  const idx = rules.findIndex(r => r.id === id)
  if (idx !== -1) {
    rules[idx].isEnabled = isEnabled !== null ? isEnabled : !rules[idx].isEnabled
    saveReplaceRules(rules)
    return rules[idx].isEnabled
  }
  return false
}

/**
 * 批量导入阅读 3.0 (Legado) 格式的 replaceRules.json
 */
export function importLegadoReplaceRules(rawContent) {
  try {
    let parsed = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent
    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rules)) {
        parsed = parsed.rules
      } else {
        return { success: false, error: '导入数据格式错误，须为阅读3.0规则数组' }
      }
    }

    const currentRules = getReplaceRules()
    let count = 0

    for (const item of parsed) {
      const pattern = item.pattern || item.regex || ''
      if (!pattern) continue

      const newRule = {
        id: `rule-legado-${randomUUID().slice(0, 8)}`,
        name: item.name || item.ruleName || `导入规则 #${count + 1}`,
        pattern: pattern,
        replacement: item.replacement !== undefined ? item.replacement : '',
        isRegex: item.isRegex !== undefined ? Boolean(item.isRegex) : true,
        scope: item.scope || item.bookScope || '',
        isEnabled: item.isEnabled !== undefined ? Boolean(item.isEnabled) : true,
        order: (currentRules.length + count + 1)
      }
      currentRules.push(newRule)
      count++
    }

    saveReplaceRules(currentRules)
    return { success: true, count, total: currentRules.length }
  } catch (err) {
    return { success: false, error: '解析 JSON 异常: ' + err.message }
  }
}

/**
 * 兼容编译阅读 3.0 的 Java 正则为 JS RegExp
 */
export function compileLegadoRegex(patternStr) {
  if (!patternStr) return null
  let pat = String(patternStr).trim()
  let flags = 'gm'

  if (pat.startsWith('(?i)')) {
    pat = pat.slice(4)
    flags += 'i'
  }
  if (pat.startsWith('(?m)')) {
    pat = pat.slice(4)
  }
  // 转换 Java 特有水平空白符 \h 为标准 JS 水平空格集合 [ \t\u00A0\u3000]
  pat = pat.replace(/\\h/g, '[ \\t\\u00A0\\u3000]')

  try {
    return new RegExp(pat, flags)
  } catch (err) {
    return null
  }
}

/**
 * 规范化替换内容：将未转义的字面量控制符还原为真正的换行符，并安全过滤 @js: 脚本
 */
export function normalizeReplacement(replacement) {
  if (!replacement || typeof replacement !== 'string') return ''
  // 若包含 @js: 开头的动态脚本，由于当前环境未接入完整 Rhino 沙盒，跳过以防源码直接污染正文
  if (replacement.startsWith('@js:')) return ''
  // 解码用户或规则 JSON 中的字面量转义控制字符：\n 换行，\r 回车，\t 制表符
  return replacement
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
}

/**
 * 核心执行流水线：应用所有已启用的替换规则清洗文本
 * @param {string} content 原始文本
 * @param {object} context 包含 { bookTitle, sourceName }
 */
export function applyReplaceRules(content, context = {}) {
  if (!content) return ''
  let text = String(content)
  const rules = getReplaceRules()
  const { bookTitle = '', sourceName = '' } = context

  // 按 order 升序排序执行
  const activeRules = rules
    .filter(r => r && r.isEnabled && r.pattern)
    .sort((a, b) => (a.order || 0) - (b.order || 0))

  for (const rule of activeRules) {
    // 检查 scope 适用范围 (支持留空全局生效，或正则/关键词匹配书名或源名)
    if (rule.scope && rule.scope.trim()) {
      const scopes = rule.scope.split(/[,;|]/).map(s => s.trim()).filter(Boolean)
      const matched = scopes.some(sc => {
        if (bookTitle && (bookTitle.includes(sc) || new RegExp(sc, 'i').test(bookTitle))) return true
        if (sourceName && (sourceName.includes(sc) || new RegExp(sc, 'i').test(sourceName))) return true
        return false
      })
      if (!matched) continue
    }

    // 规避 @js: 动态脚本注入文本
    if (rule.replacement && typeof rule.replacement === 'string' && rule.replacement.startsWith('@js:')) {
      continue
    }

    const rep = normalizeReplacement(rule.replacement)

    try {
      if (rule.isRegex) {
        const re = compileLegadoRegex(rule.pattern)
        if (re) {
          text = text.replace(re, rep)
        }
      } else {
        text = text.split(rule.pattern).join(rep)
      }
    } catch (e) {
      console.warn(`[ReplaceRule:${rule.name}] 替换异常:`, e.message)
    }
  }

  // 兜底保护：若正文中出现未解析的孤立字面量 "\n\n" 或 "\n"，自动转换为真正回车换行
  if (text.includes('\\n\\n')) {
    text = text.replace(/\\n\\n/g, '\n\n')
  }

  return text
}
