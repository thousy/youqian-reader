/**
 * 在 Node.js 端从 EPUB（ZIP）文件中提取元数据
 * EPUB 本质上是 ZIP 压缩包，我们用纯 JS 解析 ZIP 结构
 */

// 解析 ZIP 本地文件头
function parseZipLocalHeader(buf, offset) {
  if (buf.readUInt32LE(offset) !== 0x04034b50) return null
  const fileNameLen = buf.readUInt16LE(offset + 26)
  const extraLen = buf.readUInt16LE(offset + 28)
  const compressedSize = buf.readUInt32LE(offset + 18)
  const uncompressedSize = buf.readUInt32LE(offset + 22)
  const compressionMethod = buf.readUInt16LE(offset + 8)
  const fileName = buf.slice(offset + 30, offset + 30 + fileNameLen).toString('utf8')
  const dataStart = offset + 30 + fileNameLen + extraLen
  return { fileName, dataStart, compressedSize, uncompressedSize, compressionMethod, nextOffset: dataStart + compressedSize }
}

// 简单的 deflate 解压（使用 Node.js 内置的 zlib）
import { inflateRawSync } from 'zlib'

function extractZipEntries(buf) {
  const entries = {}
  let offset = 0
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset)
    if (sig === 0x04034b50) {
      const entry = parseZipLocalHeader(buf, offset)
      if (!entry) break
      let data
      if (entry.compressionMethod === 0) {
        data = buf.slice(entry.dataStart, entry.dataStart + entry.uncompressedSize)
      } else if (entry.compressionMethod === 8) {
        try {
          data = inflateRawSync(buf.slice(entry.dataStart, entry.dataStart + entry.compressedSize))
        } catch { data = Buffer.alloc(0) }
      }
      if (data) entries[entry.fileName] = data
      offset = entry.nextOffset
    } else if (sig === 0x02014b50) {
      break // central directory
    } else {
      offset++
    }
  }
  return entries
}

// 从 OPF XML 提取元数据
function parseOpfMeta(opfXml) {
  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)
  const authorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i)
  const descMatch = opfXml.match(/<dc:description[^>]*>([^<]+)<\/dc:description>/i)
  const publisherMatch = opfXml.match(/<dc:publisher[^>]*>([^<]+)<\/dc:publisher>/i)
  const langMatch = opfXml.match(/<dc:language[^>]*>([^<]+)<\/dc:language>/i)
  
  // 查找封面 item
  const coverIdMatch = opfXml.match(/name=["']cover["'][^>]*content=["']([^"']+)["']/i)
    || opfXml.match(/content=["']([^"']+)["'][^>]*name=["']cover["']/i)
  let coverId = coverIdMatch ? coverIdMatch[1] : null

  // 从 manifest 找封面文件路径
  let coverHref = null
  if (coverId) {
    const re = new RegExp(`id=["']${coverId}["'][^>]*href=["']([^"']+)["']`, 'i')
    const m = opfXml.match(re) || opfXml.match(new RegExp(`href=["']([^"']+)["'][^>]*id=["']${coverId}["']`, 'i'))
    if (m) coverHref = m[1]
  }
  // 尝试直接查找图片类 item
  if (!coverHref) {
    const imgMatch = opfXml.match(/id=["'][^"']*cover[^"']*["'][^>]*href=["']([^"']+\.(jpg|jpeg|png|gif|webp))["']/i)
      || opfXml.match(/href=["']([^"']+\.(jpg|jpeg|png|gif|webp))["'][^>]*id=["'][^"']*cover[^"']*["']/i)
    if (imgMatch) coverHref = imgMatch[1]
  }

  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    author: authorMatch ? authorMatch[1].trim() : null,
    description: descMatch ? descMatch[1].trim() : null,
    publisher: publisherMatch ? publisherMatch[1].trim() : null,
    language: langMatch ? langMatch[1].trim() : null,
    coverHref
  }
}

export async function extractEpubMetaFromBuffer(buf) {
  try {
    const entries = extractZipEntries(buf)
    
    // 找 container.xml
    const containerBuf = entries['META-INF/container.xml']
    if (!containerBuf) return { title: null, author: null, cover: null }
    
    const containerXml = containerBuf.toString('utf8')
    const opfPathMatch = containerXml.match(/full-path=["']([^"']+)["']/i)
    if (!opfPathMatch) return { title: null, author: null, cover: null }
    
    const opfPath = opfPathMatch[1]
    const opfBuf = entries[opfPath]
    if (!opfBuf) return { title: null, author: null, cover: null }
    
    const opfXml = opfBuf.toString('utf8')
    const meta = parseOpfMeta(opfXml)
    
    // 提取封面图片
    let cover = null
    if (meta.coverHref) {
      // 封面路径相对于 OPF 文件
      const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : ''
      const coverFullPath = opfDir + meta.coverHref
      const coverBuf = entries[coverFullPath] || entries[meta.coverHref]
      if (coverBuf) {
        const ext = meta.coverHref.split('.').pop().toLowerCase()
        const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
        cover = `data:${mime};base64,${coverBuf.toString('base64')}`
      }
    }

    return {
      title: meta.title,
      author: meta.author,
      cover,
      description: meta.description,
      publisher: meta.publisher,
      language: meta.language
    }
  } catch (e) {
    console.error('EPUB meta parse error:', e)
    return { title: null, author: null, cover: null }
  }
}
