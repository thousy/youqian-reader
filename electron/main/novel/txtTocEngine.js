import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getStore } from '../database.js'

/**
 * 加载阅读 3.0 内置默认 TXT 目录识别规则库
 */
export function loadBuiltinTxtTocRules() {
  try {
    const candidates = [
      join(__dirname, 'rules', 'defaultTxtTocRules.json'),
      join(process.cwd(), 'electron', 'main', 'novel', 'rules', 'defaultTxtTocRules.json'),
      'd:\\YouQian Reader\\electron\\main\\novel\\rules\\defaultTxtTocRules.json',
      'd:\\YouQian Reader\\Rule\\exportTxtTocRule.json'
    ]
    for (const p of candidates) {
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item, idx) => ({
            id: item.id !== undefined ? String(item.id) : `txt-toc-${idx}`,
            name: item.name || `TXT 目录规则 #${idx + 1}`,
            rule: item.rule || '',
            enable: item.enable !== false,
            example: item.example || '',
            serialNumber: item.serialNumber !== undefined ? item.serialNumber : idx
          }))
        }
      }
    }
  } catch (e) {
    console.warn('[TxtTocEngine] 加载内置 TXT 目录规则失败:', e.message)
  }
  return []
}

/**
 * 获取当前已配置的 TXT 目录规则列表
 */
export function getTxtTocRules() {
  const store = getStore()
  if (!store) return loadBuiltinTxtTocRules()
  let rules = store.get('novelTxtTocRules')
  if (!Array.isArray(rules) || rules.length === 0) {
    const builtins = loadBuiltinTxtTocRules()
    store.set('novelTxtTocRules', builtins)
    return builtins
  }
  return rules
}

/**
 * 保存 TXT 目录规则列表
 */
export function saveTxtTocRules(rules) {
  const store = getStore()
  if (!store) return false
  store.set('novelTxtTocRules', rules)
  return true
}

/**
 * 编译阅读 3.0 格式的 Java 正则为 JavaScript RegExp
 */
export function compileTxtTocRegex(ruleStr) {
  if (!ruleStr) return null
  let pat = ruleStr.trim()
  let flags = ''

  if (pat.startsWith('(?i)')) {
    pat = pat.slice(4)
    flags += 'i'
  }
  if (pat.startsWith('(?m)')) {
    pat = pat.slice(4)
    flags += 'm'
  }
  // 将 Java 水平空白符 \h 替换为 JS 集合
  pat = pat.replace(/\\h/g, '[ \\t\\u00A0\\u3000]')

  try {
    return new RegExp(pat, flags)
  } catch (err) {
    return null
  }
}

/**
 * 核心方法：使用阅读 3.0 规则解析段落数组构建 TXT 目录
 * @param {Array<string>} paragraphs TXT 全文章节段落数组
 * @returns {Array<{ title: string, paraIndex: number }>} 目录数组
 */
export function parseTxtChaptersWithRules(paragraphs) {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return []

  const rules = getTxtTocRules()
  const activeRules = rules
    .filter(r => r && r.enable && r.rule)
    .sort((a, b) => (a.serialNumber || 0) - (b.serialNumber || 0))

  // 预编译有效正则
  const compiledList = []
  for (const r of activeRules) {
    const reg = compileTxtTocRegex(r.rule)
    if (reg) {
      compiledList.push({ name: r.name, reg })
    }
  }

  // 经典兜底正则（若规则未匹配到时的保底）
  const FALLBACK_REGEX = /^\s*(第\s*[一二三四五六七八九十百千万零\d]+\s*[章节回卷折幕]|Chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万零\d]+)/i

  const chapters = []
  const len = paragraphs.length

  for (let i = 0; i < len; i++) {
    const rawPara = paragraphs[i]
    if (!rawPara || rawPara.length > 50) continue
    const para = rawPara.trim()
    if (!para || para.length > 40) continue

    // 过滤开头前 30 行内被误判为章节的书名/作者行（如《书名》、作者：xxx）
    if (i < 30) {
      if (/^[ 　\t]{0,4}《[^》\n]+》[ 　\t]{0,4}$/.test(para) && !/(?:第|章|卷|篇|部|序|前言|楔子)/.test(para)) {
        continue
      }
      if (/^[ 　\t]{0,4}(?:作\s*者|著者|编著)[：:]/.test(para)) {
        continue
      }
    }

    let matched = false

    // 优先尝试阅读 3.0 规则库
    for (const { reg } of compiledList) {
      try {
        if (reg.test(para) || reg.test(rawPara)) {
          chapters.push({
            title: para,
            paraIndex: i
          })
          matched = true
          break
        }
      } catch (_) {}
    }

    // 若未匹配，尝试经典兜底
    if (!matched && FALLBACK_REGEX.test(para)) {
      chapters.push({
        title: para,
        paraIndex: i
      })
    }
  }

  // 首部微量元数据与第一章智能融合：
  // 1. 若首项是书名/作者或伪前言，且内容极其微量，直接剔除
  const PREFACE_REGEX = /^[ 　\t]{0,4}(?:序[言章子]|前言|楔子|引子|自序|作品相关|内容简介|本书声明|作者的话)/i
  while (chapters.length > 1) {
    const first = chapters[0]
    const second = chapters[1]
    const isPrefaceLike = /^(前言|序|引言|序言|自序|楔子)$/i.test(first.title.trim()) ||
      (/^[ 　\t]{0,4}《[^》\n]+》/.test(first.title) && !/(?:第|章|卷|篇|部)/.test(first.title))
    const pStart = first.paraIndex || 0
    const pEnd = second.paraIndex || paragraphs.length
    const leadContent = paragraphs.slice(pStart, pEnd).join('').trim()
    const firstLine = (paragraphs[pStart] || '').trim()
    const isTruePreface = PREFACE_REGEX.test(firstLine)

    if (isPrefaceLike && (leadContent.length < 500 && !isTruePreface)) {
      chapters.shift()
      if (chapters.length > 0) {
        chapters[0].paraIndex = 0
      }
    } else {
      break
    }
  }

  // 2. 若第一章前面有少量书名作者行（< 500字且非明确独立序篇），首章起始位置直接置为0
  if (chapters.length > 0 && chapters[0].paraIndex > 0) {
    const leadContent = paragraphs.slice(0, chapters[0].paraIndex).join('').trim()
    const firstLine = (paragraphs[0] || '').trim()
    const isTruePreface = PREFACE_REGEX.test(firstLine)
    if (leadContent.length < 500 && !isTruePreface) {
      chapters[0].paraIndex = 0
    }
  }

  return chapters
}
