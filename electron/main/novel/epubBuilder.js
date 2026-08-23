/**
 * EPUB 3.0 生成器
 * 将小说章节内容打包为标准 EPUB 电子书
 */

import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
// adm-zip 是纯 CJS 模块，可以安全 require
const AdmZip = require('adm-zip')

/**
 * 将小说数据打包为 EPUB 文件
 * @param {object} novelInfo  { title, author, description, cover(base64 或 null) }
 * @param {Array}  chapters   [{ title, content(纯文本) }]
 * @param {string} outputPath 输出文件完整路径（.epub）
 * @param {function} onProgress  进度回调 (done, total)
 */
export async function buildEpub(novelInfo, chapters, outputPath, onProgress) {
  const tmpDir = join(tmpdir(), `yq_epub_${randomUUID()}`)

  try {
    // 1. 创建目录结构
    mkdirSync(join(tmpDir, 'META-INF'), { recursive: true })
    mkdirSync(join(tmpDir, 'OEBPS', 'Text'), { recursive: true })
    mkdirSync(join(tmpDir, 'OEBPS', 'Styles'), { recursive: true })
    if (novelInfo.cover) {
      mkdirSync(join(tmpDir, 'OEBPS', 'Images'), { recursive: true })
    }

    // 2. mimetype（必须第一个且不压缩）
    writeFileSync(join(tmpDir, 'mimetype'), 'application/epub+zip', 'utf-8')

    // 3. META-INF/container.xml
    writeFileSync(join(tmpDir, 'META-INF', 'container.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`, 'utf-8')

    // 4. 基础 CSS
    writeFileSync(join(tmpDir, 'OEBPS', 'Styles', 'main.css'), `
body { font-family: "Noto Serif SC", "Source Han Serif", "宋体", serif; font-size: 1em; line-height: 1.8; margin: 1.5em; color: #222; }
h1 { font-size: 1.4em; font-weight: bold; text-align: center; margin: 2em 0 1em; border-bottom: 1px solid #ccc; padding-bottom: 0.5em; }
p { text-indent: 2em; margin: 0.4em 0; }
`, 'utf-8')

    // 5. 处理封面
    let coverItem = ''
    let coverMeta = ''
    if (novelInfo.cover) {
      try {
        let coverData
        let ext = 'jpeg'
        if (novelInfo.cover.startsWith('data:image/')) {
          const [header, b64] = novelInfo.cover.split(',')
          ext = header.match(/image\/(\w+)/)?.[1] || 'jpeg'
          coverData = Buffer.from(b64, 'base64')
        } else if (novelInfo.cover.startsWith('http')) {
          // 尝试下载封面（可能失败，失败则忽略）
          const { fetchWithRetry } = await import('./utils.js')
          const res = await Promise.race([
            fetchBinary(novelInfo.cover),
            new Promise((_, rej) => setTimeout(() => rej(new Error('封面下载超时')), 5000))
          ])
          coverData = res
          ext = novelInfo.cover.split('.').pop().toLowerCase() || 'jpeg'
        }
        if (coverData) {
          writeFileSync(join(tmpDir, 'OEBPS', 'Images', `cover.${ext}`), coverData)
          coverItem = `<item id="cover-img" href="Images/cover.${ext}" media-type="image/${ext === 'jpg' ? 'jpeg' : ext}"/>`
          coverMeta = '<meta name="cover" content="cover-img"/>'
        }
      } catch (e) {
        console.warn('[EPUB Builder] 封面处理失败:', e.message)
      }
    }

    // 6. 生成各章节 XHTML
    const chapterItems = []
    const spineItems = []

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i]
      const filename = `chapter_${String(i).padStart(4, '0')}.xhtml`
      const xhtml = buildChapterXhtml(ch.title, ch.content)
      writeFileSync(join(tmpDir, 'OEBPS', 'Text', filename), xhtml, 'utf-8')

      chapterItems.push(`<item id="ch${i}" href="Text/${filename}" media-type="application/xhtml+xml"/>`)
      spineItems.push(`<itemref idref="ch${i}"/>`)

      if (onProgress) onProgress(i + 1, chapters.length)
    }

    // 7. content.opf
    const uid = randomUUID()
    const now = new Date().toISOString().slice(0, 19) + 'Z'
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="uid">urn:uuid:${uid}</dc:identifier>
    <dc:title>${escXml(novelInfo.title)}</dc:title>
    <dc:creator>${escXml(novelInfo.author || '未知')}</dc:creator>
    <dc:description>${escXml(novelInfo.description || '')}</dc:description>
    <dc:language>zh-CN</dc:language>
    <dc:date>${now}</dc:date>
    <meta property="dcterms:modified">${now}</meta>
    ${coverMeta}
  </metadata>
  <manifest>
    <item id="css" href="Styles/main.css" media-type="text/css"/>
    ${coverItem}
    ${chapterItems.join('\n    ')}
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`
    writeFileSync(join(tmpDir, 'OEBPS', 'content.opf'), opf, 'utf-8')

    // 8. toc.ncx
    const navPoints = chapters.map((ch, i) => `
    <navPoint id="np${i}" playOrder="${i + 1}">
      <navLabel><text>${escXml(ch.title)}</text></navLabel>
      <content src="Text/chapter_${String(i).padStart(4, '0')}.xhtml"/>
    </navPoint>`).join('')
    const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escXml(novelInfo.title)}</text></docTitle>
  <navMap>${navPoints}
  </navMap>
</ncx>`
    writeFileSync(join(tmpDir, 'OEBPS', 'toc.ncx'), ncx, 'utf-8')

    // 9. 打包为 ZIP（EPUB）
    packEpub(tmpDir, outputPath)

  } finally {
    // 清理临时目录
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  }
}

function buildChapterXhtml(title, content) {
  // 将纯文本转换为 XHTML 段落
  const paragraphs = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => `  <p>${escXml(line)}</p>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head>
  <title>${escXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../Styles/main.css"/>
</head>
<body>
  <h1>${escXml(title)}</h1>
${paragraphs}
</body>
</html>`
}

function escXml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function packEpub(srcDir, outputPath) {
  const zip = new AdmZip()

  // EPUB 规范：mimetype 必须不压缩（STORED）且是第一个文件
  const mimetypeContent = readFileSync(join(srcDir, 'mimetype'))
  zip.addFile('mimetype', mimetypeContent, '', 0) // 0 = STORED (no compression)

  // 递归添加其他所有文件（压缩）
  function addDir(dir, zipPath) {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const zipEntry = zipPath ? `${zipPath}/${entry}` : entry
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        addDir(fullPath, zipEntry)
      } else {
        if (entry === 'mimetype' && !zipPath) continue // 已单独添加
        zip.addFile(zipEntry, readFileSync(fullPath))
      }
    }
  }
  addDir(srcDir, '')

  zip.writeZip(outputPath)
}

async function fetchBinary(url) {
  const { net } = await import('electron')
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    const chunks = []
    req.on('response', res => {
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}
