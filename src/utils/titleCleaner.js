function toDBC(str) {
  if (!str) return ''
  return str
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

/**
 * 纯净化展示书名（彻底剥离所有论坛分卷/章节后缀，如 (30-43), (114-115), (29.22--29.30), （００－１０）, 第194章 姐妹情深 等）
 */
export function cleanDisplayTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return ''
  let t = toDBC(rawTitle).replace(/[【】\[\]]/g, ' ').trim()
  // 移除各类分卷、章节范围括号：如 (30-43), (114-115), (29.22--29.30), (00-10), (第1-217章) 等
  t = t.replace(/[（\(][^0-9（\)]*?\d+(?:\.\d+)?(?:[－\-~～、.]+\d+(?:\.\d+)?)*[^）\)]*[）\)]/g, ' ').trim()
  // 移除无括号包围的独立单章小标题后缀：如 "第194章 姐妹情深"、"第10章"、"第一卷" 等
  t = t.replace(/\s+(?:第\s*)?[0-9一二三四五六七八九十百千万\d]+(?:\.\d+)?\s*[章节卷].*$/, '').trim()
  // 移除尾随的“作者：xxx”、来源标记与分部后缀
  t = t.replace(/\s*作[者著][：:][^\s]+.*$/, '').trim()
  t = t.replace(/_来源：.*$/, '').trim()
  t = t.replace(/\s*-\s*禁忌书屋.*$/, '').trim()
  t = t.replace(/(?:上部|下部|第一部|第二部|续集|后传|续)$/g, '').trim()
  if (t.startsWith('《') && !t.endsWith('》')) t = t.slice(1)
  if (t.endsWith('》') && !t.startsWith('《')) t = t.slice(0, -1)
  t = t.replace(/^[《<]/, '').replace(/[》>]$/, '').trim()
  return t || rawTitle
}

/**
 * 格式化作者展示（统一添加“作者：”前缀，并智能过滤误当作者的书名/分卷脏数据）
 */
export function formatDisplayAuthor(author, title = '') {
  if (!author) return '作者：未知'
  let raw = String(author).trim()

  // 1. 如果 author 包含了分卷标记（如 【159-167】、第194章）或与当前书名高度相同，提取真实作者或置为未知
  const cleanTitle = title ? title.replace(/[《》【】\[\]\s]/g, '') : ''
  const cleanAuth = raw.replace(/[《》【】\[\]\s]/g, '')
  if (cleanTitle && (cleanAuth === cleanTitle || cleanAuth.startsWith(cleanTitle) || raw.includes('【') || raw.includes('(') || raw.includes('（') || /第\s*[一二三四五六七八九十\d]+[章节卷]/.test(raw))) {
    const authorMatch = raw.match(/[作|原][者|著][：:]\s*([^\s\[【<]+)/)
    if (authorMatch && authorMatch[1]) {
      return `作者：${authorMatch[1].trim()}`
    }
    return '作者：未知'
  }

  // 2. 规范化“作者：”前缀
  if (raw.startsWith('作者') || raw.startsWith('原著')) {
    return raw.replace(/^[作|原][者|著][：:]\s*/, '作者：')
  }

  return `作者：${raw}`
}

