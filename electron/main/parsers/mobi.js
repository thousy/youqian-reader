import { readFileSync } from 'fs'
import { basename, extname } from 'path'
import { createRequire } from 'module'
import { performance } from 'perf_hooks'

// 使用 require 加载 iconv-lite（CommonJS 模块）
const require = createRequire(import.meta.url)
let iconv = null
try { iconv = require('iconv-lite') } catch {}

/**
 * MOBI/AZW3 解析器
 * 基于 Palm Database (.pdb) 结构
 * 支持 UTF-8、Windows-1252、GBK 等编码
 * 支持 Huffman/CDIC (17480) 及 PalmDoc (2) 解密与垃圾字节剥离
 */

// ===== Palm Database 读取 =====

function readPalmHeader(buf) {
  if (buf.length < 78) throw new Error('文件太小，不是有效的 MOBI 文件')
  const name = buf.slice(0, 32).toString('ascii').replace(/\0/g, '').trim()
  const numRecords = buf.readUInt16BE(76)
  if (numRecords === 0) throw new Error('无记录的 MOBI 文件')
  const records = []
  for (let i = 0; i < numRecords; i++) {
    const off = 78 + i * 8
    if (off + 4 > buf.length) break
    records.push(buf.readUInt32BE(off))
  }
  return { name, numRecords, records }
}

function safeReadUInt32BE(buf, offset) {
  if (offset < 0 || offset + 4 > buf.length) return 0
  return buf.readUInt32BE(offset)
}

function safeReadUInt16BE(buf, offset) {
  if (offset < 0 || offset + 2 > buf.length) return 0
  return buf.readUInt16BE(offset)
}

// ===== MOBI Header 解析 =====

function parseMobiHeader(buf, record0Offset) {
  // 直接以绝对安全、自 record0Offset 开始的固定相对偏移量读取
  // 相对偏移 +16: "MOBI" 或者是 "BOOK"
  const magic = buf.slice(record0Offset + 16, record0Offset + 20).toString('ascii')
  if (magic !== 'MOBI' && magic !== 'BOOK') {
    return null
  }

  const headerLen = safeReadUInt32BE(buf, record0Offset + 20)
  const encoding  = safeReadUInt32BE(buf, record0Offset + 28)  // 1252=Win1252, 65001=UTF-8

  // Full Name（书名）
  const titleRelOffset = safeReadUInt32BE(buf, record0Offset + 84)
  const titleLen       = safeReadUInt32BE(buf, record0Offset + 88)
  let title = null
  if (titleRelOffset > 0 && titleLen > 0) {
    const absOffset = record0Offset + titleRelOffset
    if (absOffset + titleLen <= buf.length) {
      const rawTitle = buf.slice(absOffset, absOffset + titleLen)
      title = decodeBuffer(rawTitle, encoding).trim()
    }
  }

  // EXTH records（作者、出版社等）
  const exthFlag = safeReadUInt32BE(buf, record0Offset + 128)
  let author = null, description = null, publisher = null

  if (exthFlag & 0x40) {
    const exthStart = record0Offset + 16 + headerLen
    if (exthStart + 12 <= buf.length &&
        buf.slice(exthStart, exthStart + 4).toString('ascii') === 'EXTH') {
      const numExth = safeReadUInt32BE(buf, exthStart + 8)
      let pos = exthStart + 12
      for (let i = 0; i < numExth && pos + 8 <= buf.length; i++) {
        const recType = safeReadUInt32BE(buf, pos)
        const recLen  = safeReadUInt32BE(buf, pos + 4)
        if (recLen < 8 || pos + recLen > buf.length) break
        const raw = buf.slice(pos + 8, pos + recLen)
        switch (recType) {
          case 100: 
            author = decodeBuffer(raw, encoding).trim()
            break
          case 101: 
            publisher = decodeBuffer(raw, encoding).trim()
            break
          case 103: 
            description = decodeBuffer(raw, encoding).trim()
            break
        }
        pos += recLen
      }
    }
  }

  const huffcdic = safeReadUInt32BE(buf, record0Offset + 112)
  const numHuffcdic = safeReadUInt32BE(buf, record0Offset + 116)
  const trailingFlags = safeReadUInt32BE(buf, record0Offset + 240)

  return { title, author, description, publisher, encoding, huffcdic, numHuffcdic, trailingFlags }
}

// ===== 编码解码 =====

/**
 * 将 Buffer 按指定 MOBI encoding 值解码为字符串
 * encoding: 65001=UTF-8, 1252=Windows-1252, 其他尝试 GBK
 */
function decodeBuffer(buf, encoding) {
  if (encoding === 65001) {
    return buf.toString('utf8')
  }
  if (iconv) {
    const charsetName = encoding === 1252 ? 'cp1252' : 'gbk'
    try { return iconv.decode(buf, charsetName) } catch {}
  }
  // 回退：尝试 UTF-8，然后 latin1
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  return buf.toString('latin1')
}

// ===== PalmDoc 解压 =====

/**
 * PalmDoc LZ77 解压，返回原始字节 Buffer
 */
function decompressPalmDocToBuffer(compressed) {
  const output = []
  let i = 0
  const buf = compressed

  while (i < buf.length) {
    const c = buf[i++]

    if (c === 0x00) {
      output.push(0x00)
    } else if (c <= 0x08) {
      for (let j = 0; j < c && i < buf.length; j++) {
        output.push(buf[i++])
      }
    } else if (c <= 0x7f) {
      output.push(c)
    } else if (c <= 0xbf) {
      if (i >= buf.length) break
      const next = buf[i++]
      const word     = ((c & 0x3f) << 8) | next
      const distance = word >> 3
      const length   = (word & 0x07) + 3

      if (distance > 0) {
        for (let j = 0; j < length; j++) {
          const srcIdx = output.length - distance
          output.push(srcIdx >= 0 ? output[srcIdx] : 0x20)
        }
      }
    } else {
      output.push(0x20)  // space
      output.push(c ^ 0x80)
    }
  }

  return Buffer.from(output)
}

// ===== Huffman/CDIC (17480) 同步解密器 =====

function initHuffmanDecoder(buf, palm, huffcdicIndex, numHuffcdic) {
  if (huffcdicIndex === 0 || numHuffcdic === 0 || huffcdicIndex >= palm.records.length) {
    return null
  }
  
  const huffOffset = palm.records[huffcdicIndex]
  const huffEnd = (huffcdicIndex + 1 < palm.records.length) ? palm.records[huffcdicIndex + 1] : buf.length
  const huffRecord = buf.slice(huffOffset, huffEnd)
  
  if (huffRecord.length < 16) return null
  const magic = huffRecord.slice(0, 4).toString('ascii')
  if (magic !== 'HUFF') {
    return null
  }
  
  const offset1 = huffRecord.readUInt32BE(8)
  const offset2 = huffRecord.readUInt32BE(12)
  
  const table1 = []
  for (let i = 0; i < 256; i++) {
    const off = offset1 + i * 4
    if (off + 4 > huffRecord.length) break
    const x = huffRecord.readUInt32BE(off)
    const found = x & 0x80
    const codeLength = x & 0x1f
    const value = x >>> 8
    table1.push([found, codeLength, value])
  }
  
  const table2 = [null]
  for (let i = 0; i < 32; i++) {
    const off = offset2 + i * 8
    if (off + 8 > huffRecord.length) break
    const val1 = huffRecord.readUInt32BE(off)
    const val2 = huffRecord.readUInt32BE(off + 4)
    table2.push([val1, val2])
  }
  
  const dictionary = []
  for (let i = 1; i < numHuffcdic; i++) {
    const recIndex = huffcdicIndex + i
    if (recIndex >= palm.records.length) break
    
    const cdicOffset = palm.records[recIndex]
    const cdicEnd = (recIndex + 1 < palm.records.length) ? palm.records[recIndex + 1] : buf.length
    const record = buf.slice(cdicOffset, cdicEnd)
    
    if (record.length < 16) continue
    const cdicMagic = record.slice(0, 4).toString('ascii')
    if (cdicMagic !== 'CDIC') {
      continue
    }
    
    const cdicLength = record.readUInt32BE(4)
    const numEntries = record.readUInt32BE(8)
    const codeLength = record.readUInt32BE(12)
    
    const buffer = record.slice(cdicLength)
    const n = Math.min(1 << codeLength, numEntries - dictionary.length)
    
    for (let j = 0; j < n; j++) {
      if (j * 2 + 2 > buffer.length) break
      const offset = buffer.readUInt16BE(j * 2)
      if (offset + 2 > buffer.length) break
      const x = buffer.readUInt16BE(offset)
      const length = x & 0x7fff
      const decompressed = x & 0x8000
      if (offset + 2 + length > buffer.length) break
      const value = buffer.slice(offset + 2, offset + 2 + length)
      dictionary.push([value, decompressed])
    }
  }
  
  const read32Bits = (byteArray, fromBit) => {
    const startByte = fromBit >> 3
    const shift = 8 - (fromBit & 7)
    
    const b0 = byteArray[startByte] !== undefined ? byteArray[startByte] : 0
    const b1 = byteArray[startByte + 1] !== undefined ? byteArray[startByte + 1] : 0
    const b2 = byteArray[startByte + 2] !== undefined ? byteArray[startByte + 2] : 0
    const b3 = byteArray[startByte + 3] !== undefined ? byteArray[startByte + 3] : 0
    const b4 = byteArray[startByte + 4] !== undefined ? byteArray[startByte + 4] : 0
    
    const bits = (b0 * 4294967296) + (b1 * 16777216) + (b2 * 65536) + (b3 * 256) + b4
    return Math.floor(bits / (1 << shift)) >>> 0
  }
  
  const decompress = (byteArray) => {
    let output = []
    const bitLength = byteArray.length * 8
    
    for (let i = 0; i < bitLength; ) {
      const bits = read32Bits(byteArray, i)
      let [found, codeLength, value] = table1[bits >>> 24] || [false, 0, 0]
      
      if (!found) {
        while (table2[codeLength] && (bits >>> (32 - codeLength)) < table2[codeLength][0]) {
          codeLength += 1
          if (codeLength > 32) break
        }
        if (codeLength > 32 || !table2[codeLength]) break
        value = table2[codeLength][1]
      }
      
      i += codeLength
      if (i > bitLength) break
      
      const code = value - (bits >>> (32 - codeLength))
      if (code < 0 || code >= dictionary.length) break
      
      let [result, decompressed] = dictionary[code]
      if (!decompressed) {
        result = decompress(result)
        dictionary[code] = [result, true]
      }
      
      for (let k = 0; k < result.length; k++) {
        output.push(result[k])
      }
    }
    return Buffer.from(output)
  }
  
  return decompress
}

// ===== 尾部垃圾字节截断 =====

function getVarLenFromEnd(buf) {
  let value = 0
  const start = Math.max(0, buf.length - 4)
  for (let i = start; i < buf.length; i++) {
    const byte = buf[i]
    if (byte & 0x80) {
      value = 0
    }
    value = (value << 7) | (byte & 0x7f)
  }
  return value
}

function stripTrailingBytes(recBuf, trailingFlags) {
  if (!trailingFlags) return recBuf
  let data = recBuf
  let flags = trailingFlags >> 1
  
  while (flags > 0) {
    if (flags & 1) {
      const extraLen = getVarLenFromEnd(data)
      if (extraLen <= 0 || extraLen > data.length) break
      data = data.subarray(0, data.length - extraLen)
    }
    flags >>= 1
  }
  
  if (trailingFlags & 1) {
    if (data.length > 0) {
      const lastByte = data[data.length - 1]
      const extraLen = (lastByte & 3) + 1
      if (extraLen <= data.length) {
        data = data.subarray(0, data.length - extraLen)
      }
    }
  }
  
  return data
}

// ===== 公开 API =====

export async function extractMobiMeta(filePath) {
  try {
    const buf = readFileSync(filePath)
    const palm = readPalmHeader(buf)
    const record0Offset = palm.records[0]
    const header = parseMobiHeader(buf, record0Offset)

    // 提取封面图片
    let cover = null
    const firstImageIndex = safeReadUInt32BE(buf, record0Offset + 108)

    if (firstImageIndex > 0 && firstImageIndex < palm.records.length) {
      // 尝试从 EXTH 记录 201 (CoverOffset) 获取封面偏移
      let coverOffset = 0
      const exthFlag = safeReadUInt32BE(buf, record0Offset + 128)
      const headerLen = safeReadUInt32BE(buf, record0Offset + 20)
      if (exthFlag & 0x40) {
        const exthStart = record0Offset + 16 + headerLen
        if (exthStart + 12 <= buf.length &&
            buf.slice(exthStart, exthStart + 4).toString('ascii') === 'EXTH') {
          const numExth = safeReadUInt32BE(buf, exthStart + 8)
          let pos = exthStart + 12
          for (let i = 0; i < numExth && pos + 8 <= buf.length; i++) {
            const recType = safeReadUInt32BE(buf, pos)
            const recLen  = safeReadUInt32BE(buf, pos + 4)
            if (recLen < 8 || pos + recLen > buf.length) break
            if (recType === 201) {
              coverOffset = safeReadUInt32BE(buf, pos + 8)
            }
            pos += recLen
          }
        }
      }

      const coverRecIdx = firstImageIndex + coverOffset
      if (coverRecIdx < palm.records.length) {
        const imgStart = palm.records[coverRecIdx]
        const imgEnd = (coverRecIdx + 1 < palm.records.length) ? palm.records[coverRecIdx + 1] : buf.length
        if (imgStart < buf.length && imgStart < imgEnd) {
          const imgBuf = buf.slice(imgStart, Math.min(imgEnd, buf.length))
          if (imgBuf.length >= 4) {
            let mimeType = null
            if (imgBuf[0] === 0xFF && imgBuf[1] === 0xD8) mimeType = 'image/jpeg'
            else if (imgBuf[0] === 0x89 && imgBuf[1] === 0x50) mimeType = 'image/png'
            else if (imgBuf[0] === 0x47 && imgBuf[1] === 0x49) mimeType = 'image/gif'
            if (mimeType) {
              cover = `data:${mimeType};base64,${imgBuf.toString('base64')}`
            }
          }
        }
      }
    }

    return {
      title:       header?.title       || basename(filePath, extname(filePath)),
      author:      header?.author      || '未知',
      cover:       cover,
      description: header?.description || '',
      publisher:   header?.publisher   || ''
    }
  } catch (e) {
    console.warn('MOBI meta extraction failed:', e.message)
    return { title: basename(filePath, extname(filePath)), author: '未知', cover: null }
  }
}

export async function extractMobiContent(filePath) {
  const tStart = performance.now()
  try {
    const buf = readFileSync(filePath)
    const palm = readPalmHeader(buf)
    const record0Offset = palm.records[0]

    // PalmDoc header（位于 record0 起始）
    const compression    = safeReadUInt16BE(buf, record0Offset)       // 1=无 2=PalmDoc 17480=Huffdic
    const numTextRecords = safeReadUInt16BE(buf, record0Offset + 8)   // 文本记录数量

    const header = parseMobiHeader(buf, record0Offset)
    const encoding = header?.encoding || 65001  // 默认 UTF-8
    const huffcdicIndex = header?.huffcdic
    const numHuffcdic = header?.numHuffcdic
    const trailingFlags = header?.trailingFlags || 0

    const meta = {
      title:  header?.title  || basename(filePath, extname(filePath)),
      author: header?.author || '未知'
    }

    const tInit = performance.now()

    // 初始化 Huffman 解密器
    let decompress = null
    const tHuffInitStart = performance.now()
    if (compression === 17480) {
      if (huffcdicIndex !== undefined && numHuffcdic !== undefined && numHuffcdic > 0) {
        try {
          decompress = initHuffmanDecoder(buf, palm, huffcdicIndex, numHuffcdic)
        } catch (err) {
          console.error('初始化 Huffman 解密器失败:', err.message)
        }
      }
    }
    const tHuffInitEnd = performance.now()

    // 拼接所有文本记录（record 1 到 numTextRecords），结果为 Buffer
    const buffers = []
    const tDecompressStart = performance.now()
    for (let i = 1; i <= numTextRecords && i < palm.records.length; i++) {
      const start = palm.records[i]
      const end   = (i + 1 < palm.records.length) ? palm.records[i + 1] : buf.length
      if (start >= buf.length || start >= end) continue

      let recBuf = buf.slice(start, Math.min(end, buf.length))

      // 剥离尾部垃圾数据
      recBuf = stripTrailingBytes(recBuf, trailingFlags)

      if (compression === 17480 && decompress) {
        // Huffman/CDIC 解密
        try {
          buffers.push(decompress(recBuf))
        } catch (decErr) {
          console.error(`Record ${i} 解压失败:`, decErr.message)
          buffers.push(recBuf)
        }
      } else if (compression === 2) {
        // PalmDoc 压缩 → 解压为 Buffer
        buffers.push(decompressPalmDocToBuffer(recBuf))
      } else {
        // 无压缩或其他
        buffers.push(recBuf)
      }
    }
    const tDecompressEnd = performance.now()

    // 合并所有解压后的字节，再统一解码
    const rawCombined = Buffer.concat(buffers)
    const tempText = decodeBuffer(rawCombined, encoding)

    // ================== 【主进程字节级全量物理锚点植入引擎 🌟】 ==================
    const tAnchorStart = performance.now()
    const fileposMap = new Map()
    // 增强型 filepos 提取正则，兼容 filepos="12345", #filepos12345, filepos:12345 等多种变体
    const fileposRegex = /\bfilepos[-:=#"'/\\]*(\d+)\b/gi
    let fileposMatch
    while ((fileposMatch = fileposRegex.exec(tempText)) !== null) {
      const val = parseInt(fileposMatch[1])
      if (!isNaN(val)) fileposMap.set(val, true)
    }

    const sortedFilepos = Array.from(fileposMap.keys()).sort((a, b) => b - a)

    // 智能避开 HTML 标签内部的辅助函数，如果偏移落在 < 和 > 之间，则移动到 > 后面
    function adjustOffsetToAvoidTags(buf, offset) {
      let inTag = false
      for (let i = offset - 1; i >= 0; i--) {
        const byte = buf[i]
        if (byte === 0x3C) { // '<'
          inTag = true
          break
        }
        if (byte === 0x3E) { // '>'
          break
        }
      }
      if (inTag) {
        for (let i = offset; i < buf.length; i++) {
          if (buf[i] === 0x3E) { // '>'
            return i + 1
          }
        }
      }
      return offset
    }

    let combined = rawCombined
    // 使用 Map 归纳相同 adjustedOffset 位置需要插入的锚点，解决哈希碰撞并实现单次拼接
    const insertMap = new Map()

    for (const offset of sortedFilepos) {
      if (offset >= rawCombined.length) continue
      const adjustedOffset = adjustOffsetToAvoidTags(rawCombined, offset)
      if (adjustedOffset >= rawCombined.length) continue

      if (!insertMap.has(adjustedOffset)) {
        insertMap.set(adjustedOffset, [])
      }
      insertMap.get(adjustedOffset).push(
        Buffer.from(`<span id="filepos-${offset}" class="reader-filepos-anchor"></span>`, 'utf8')
      )
    }

    const sortedInsertOffsets = Array.from(insertMap.keys()).sort((a, b) => a - b)
    const chunks = []
    let lastIndex = 0

    for (const adjustedOffset of sortedInsertOffsets) {
      // 使用 subarray 做物理切片（零内存拷贝开销）
      chunks.push(rawCombined.subarray(lastIndex, adjustedOffset))
      
      const anchors = insertMap.get(adjustedOffset)
      for (const anchor of anchors) {
        chunks.push(anchor)
      }
      
      lastIndex = adjustedOffset
    }

    if (lastIndex < rawCombined.length) {
      chunks.push(rawCombined.subarray(lastIndex))
    }

    combined = Buffer.concat(chunks)
    const tAnchorEnd = performance.now()
    // ============================================================================

    let text = decodeBuffer(combined, encoding)

    // 清理 null 字节
    text = text.replace(/\x00/g, '')

    // ===== 提取嵌入式图片记录 =====
    const tImageStart = performance.now()
    // MOBI/AZW3 中，firstImageIndex 字段位于 record0Offset + 108
    const firstImageIndex = safeReadUInt32BE(buf, record0Offset + 108)
    const images = {}

    if (firstImageIndex > 0 && firstImageIndex < palm.records.length) {
      for (let i = firstImageIndex; i < palm.records.length; i++) {
        const imgStart = palm.records[i]
        const imgEnd = (i + 1 < palm.records.length) ? palm.records[i + 1] : buf.length
        if (imgStart >= buf.length || imgStart >= imgEnd) continue

        const imgBuf = buf.slice(imgStart, Math.min(imgEnd, buf.length))
        if (imgBuf.length < 4) continue

        // 通过 magic bytes 检测图片格式
        let mimeType = null
        if (imgBuf[0] === 0xFF && imgBuf[1] === 0xD8) {
          mimeType = 'image/jpeg'
        } else if (imgBuf[0] === 0x89 && imgBuf[1] === 0x50 && imgBuf[2] === 0x4E && imgBuf[3] === 0x47) {
          mimeType = 'image/png'
        } else if (imgBuf[0] === 0x47 && imgBuf[1] === 0x49 && imgBuf[2] === 0x46) {
          mimeType = 'image/gif'
        } else if (imgBuf[0] === 0x42 && imgBuf[1] === 0x4D) {
          mimeType = 'image/bmp'
        }

        if (mimeType) {
          const recIndex = i - firstImageIndex + 1
          const base64 = imgBuf.toString('base64')
          images[recIndex] = `data:${mimeType};base64,${base64}`
        }
      }
    }
    const tImageEnd = performance.now()

    // 构建 HTML
    const tHtmlStart = performance.now()
    let html = text
      .replace(/<mbp:pagebreak\s*\/>/gi, '<hr class="page-break"/>')
      .replace(/<[^>]*mobi[^>]*>/gi, '')
      .replace(/&nbsp;/g, '\u00a0')

    // 将 recindex 引用的图片替换为 base64 data URI
    html = html.replace(/<img([^>]*)recindex\s*=\s*["']?(\d+)["']?([^>]*)>/gi, (match, before, idx, after) => {
      const recIdx = parseInt(idx)
      if (images[recIdx]) {
        return `<img${before}src="${images[recIdx]}"${after} style="max-width:100%;height:auto;display:block;margin:8px auto;">`
      }
      return match
    })

    // 对于使用 src="kindle:embed:XXXX" 格式的图片也进行替换
    html = html.replace(/<img([^>]*)src\s*=\s*["']kindle:embed:([0-9A-Fa-f]+)(\?[^"']*)?["']([^>]*)>/gi, (match, before, hexIdx, query, after) => {
      const recIdx = parseInt(hexIdx, 16)
      if (images[recIdx]) {
        return `<img${before}src="${images[recIdx]}"${after} style="max-width:100%;height:auto;display:block;margin:8px auto;">`
      }
      return match
    })

    // 判断是否已是 HTML
    const isHtml = /<(p|div|html|body|h[1-6]|br)\b/i.test(html)
    if (!isHtml) {
      // 纯文本：按段落分割
      html = text
        .split(/\n{2,}/)
        .map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
        .join('\n')
    }
    const tHtmlEnd = performance.now()

    const tTotal = performance.now()
    console.log(`[MOBI Parser] 解析书籍 "${filePath}" 耗时统计:
  - 读取与头部解析: ${(tInit - tStart).toFixed(2)}ms
  - Huffman 解密器初始化: ${(tHuffInitEnd - tHuffInitStart).toFixed(2)}ms
  - 文本解压与解密: ${(tDecompressEnd - tDecompressStart).toFixed(2)}ms
  - 锚点物理植入: ${(tAnchorEnd - tAnchorStart).toFixed(2)}ms
  - 嵌入图片提取: ${(tImageEnd - tImageStart).toFixed(2)}ms
  - HTML正则转换: ${(tHtmlEnd - tHtmlStart).toFixed(2)}ms
  - 总耗时: ${(tTotal - tStart).toFixed(2)}ms`)

    return { html: `<div class="mobi-content">${html}</div>`, ...meta }
  } catch (e) {
    console.error('MOBI content extraction failed:', e.message)
    return {
      html: `<div class="mobi-content" style="padding:40px;text-align:center;color:var(--text-muted)">
        <p>⚠️ 无法解析文件内容</p><p><small>${e.message}</small></p></div>`,
      title: basename(filePath, extname(filePath)),
      author: '未知'
    }
  }
}
