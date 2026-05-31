import { readFileSync } from 'fs'
import { basename, extname } from 'path'

export async function extractPdfMeta(filePath) {
  try {
    const buf = readFileSync(filePath)
    const meta = parsePdfMetadata(buf)
    return {
      title: meta.title || basename(filePath, extname(filePath)),
      author: meta.author || '未知',
      cover: null,
      description: meta.subject || ''
    }
  } catch (e) {
    return { title: basename(filePath, extname(filePath)), author: '未知', cover: null }
  }
}

function parsePdfMetadata(buf) {
  const str = buf.slice(0, Math.min(buf.length, 65536)).toString('latin1')
  
  // 解析 PDF Info 字典
  const infoMatch = str.match(/\/Info\s+(\d+)\s+(\d+)\s+R/)
  if (!infoMatch) return {}

  // 查找 Info 对象
  const objNum = infoMatch[1]
  const objRe = new RegExp(`${objNum}\\s+\\d+\\s+obj[\\s\\S]*?endobj`)
  const objMatch = str.match(objRe)
  if (!objMatch) return {}

  const objContent = objMatch[0]
  const meta = {}

  const fields = ['Title', 'Author', 'Subject', 'Creator', 'Producer']
  for (const field of fields) {
    // 匹配 /Field (value) 或 /Field <hex>
    const re = new RegExp(`\\/${field}\\s*\\(([^)]+)\\)`)
    const m = objContent.match(re)
    if (m) {
      meta[field.toLowerCase()] = decodePdfString(m[1])
    }
  }
  return meta
}

function decodePdfString(str) {
  // 简单处理 PDF 字符串转义
  return str.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\(.)/g, '$1')
    .replace(/\xfe\xff/g, '') // BOM
    .trim()
}
