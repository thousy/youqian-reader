import { readFileSync } from 'fs'
import { basename, extname } from 'path'
// 使用 JSZip 在 Node 端解析 EPUB（epubjs 是浏览器端库）

export async function extractEpubMeta(filePath) {
  try {
    const data = readFileSync(filePath)
    // EPUB 是 ZIP 格式，用简单的 ZIP 解析提取元数据
    const { extractEpubMetaFromBuffer } = await import('./epubParser.js')
    return await extractEpubMetaFromBuffer(data)
  } catch (e) {
    console.error('EPUB meta extraction failed:', e)
    return {
      title: basename(filePath, extname(filePath)),
      author: '未知',
      cover: null
    }
  }
}
