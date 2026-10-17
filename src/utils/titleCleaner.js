/**
 * 纯净化展示书名（彻底剥离所有论坛分卷/章节后缀，如 (30-43), (114-115), (29.22--29.30) 等）
 */
export function cleanDisplayTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return ''
  let t = rawTitle.replace(/[【】\[\]]/g, '').trim()
  // 移除各类分卷、章节范围括号：如 (30-43), （114-115）, (29.22--29.30), （01-28.26）, （第1-217章）等
  t = t.replace(/[（\(][^0-9（\)]*?\d+(?:\.\d+)?(?:[－\-~～、.]+\d+(?:\.\d+)?)*[^）\)]*[）\)]/g, '').trim()
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
