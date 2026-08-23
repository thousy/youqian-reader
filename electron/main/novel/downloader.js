/**
 * 小说下载队列、并发控制与原项目 config.ini 核心配置管理
 * - 并发线程数 (concurrency / threads)
 * - 抓取延时与超时重试 (interval, timeout, maxRetries)
 * - 格式化选项 (EPUB / TXT, toSimplified 简繁转换, 广告清洗)
 * - 自定义下载存放目录与代理配置
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { getPortableDataDir, getPortableDownloadsDir } from '../portablePath.js'
import { getSourceById } from './sourceManager.js'
import { buildEpub } from './epubBuilder.js'
import { buildPdf } from './pdfBuilder.js'
import { sleep, toSimplified, stripDuplicateTitle } from './utils.js'
import { addBook, saveBookmarks } from '../database.js'

// 下载任务 Map: taskId -> { status, progress, total, cancel, novelInfo, sourceId }
const tasks = new Map()
let _mainWindow = null

export function setMainWindow(win) {
  _mainWindow = win
}

function pushProgress(taskId, data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('download-progress', { taskId, ...data })
  }
}

// 默认下载配置（对齐原项目 config.ini [download], [crawl], [ebook], [proxy]）
const DEFAULT_DOWNLOAD_CONFIG = {
  // 1. 并发与限速 (原 config.ini: concurrency / min-interval / max-interval / timeout / max-retries)
  concurrency: 4,               // 并发线程数 (1 ~ 16)
  batchInterval: 500,           // 批次间隔时间毫秒 (100 ~ 3000ms, 防封IP)
  timeout: 10,                  // 单章抓取超时秒数 (3 ~ 30s)
  maxRetries: 3,                // 失败重试次数 (0 ~ 5)

  // 2. 导出与格式化 (原 config.ini: format / clean-ad / to-simplified / auto-import)
  outputFormat: 'EPUB',         // 输出格式: 'EPUB' | 'TXT'
  saveDir: '',                  // 自定义保存目录 (为空则默认 文档/YouQian Reader/下载小说)
  autoImport: true,             // 下载完成后自动加入本地书库
  cleanAd: true,                // 自动执行广告过滤净化
  toSimplified: false,          // 繁体中文自动转换为简体中文

  // 3. 网络代理 (原 config.ini [proxy])
  proxyEnabled: false,          // 是否启用代理
  proxyType: 'http',            // 协议类型: 'http' | 'socks5'
  proxyHost: '127.0.0.1',       // 代理服务器主机
  proxyPort: 7890,              // 代理端口

  // 4. 高级穿透 (原 config.ini cf-bypass)
  cfBypassUrl: ''               // 外部 Cloudflare 穿透解析服务地址
}

/**
 * 中文数字转阿拉伯数字 helper
 */
function cnToNumber(str) {
  if (!str) return null
  if (/^\d+$/.test(str)) return parseInt(str, 10)

  const chnNumChar = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2 }
  const chnUnitChar = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 }

  let total = 0
  let section = 0
  let number = 0

  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    const num = chnNumChar[char]
    if (typeof num !== 'undefined') {
      number = num
      if (i === str.length - 1) {
        section += number
      }
    } else {
      const unit = chnUnitChar[char]
      if (typeof unit !== 'undefined') {
        if (unit === 10000 || unit === 100000000) {
          section = (section + number) * unit
          total += section
          section = 0
        } else {
          section += (number || 1) * unit
        }
        number = 0
      }
    }
  }
  const result = total + section
  return result > 0 ? result : null
}

/**
 * 解析计算章节范围字符串，输出统一精简的阿拉伯数字格式，如：（第1-25章）或（第1-500章）
 */
function getChapterRangeStr(chapters) {
  if (!chapters || chapters.length === 0) return ''

  const firstCh = chapters[0]
  const lastCh = chapters[chapters.length - 1]

  // 1. 优先使用用户选章时传递的全书目录物理序号 originalIndex (从 0 开始)
  if (firstCh?.originalIndex !== undefined && lastCh?.originalIndex !== undefined) {
    const startNum = firstCh.originalIndex + 1
    const endNum = lastCh.originalIndex + 1
    if (startNum === endNum) {
      return `（第${startNum}章）`
    }
    return `（第${startNum}-${endNum}章）`
  }

  // 2. 其次使用下载批次 index
  if (firstCh?.index !== undefined && lastCh?.index !== undefined) {
    const startNum = firstCh.index + 1
    const endNum = lastCh.index + 1
    if (startNum === endNum) {
      return `（第${startNum}章）`
    }
    return `（第${startNum}-${endNum}章）`
  }

  // 3. 兜底使用章节数组长度
  if (chapters.length === 1) {
    return `（第1章）`
  }
  return `（第1-${chapters.length}章）`
}

/**
 * 格式化下载书籍文件名: 《书籍名称》作者：作者名称（多少章到多少章）_来源：书源名称_书源网址_日期时间.ext
 */
function generateDownloadFileName(novelInfo, source, format, chapters = []) {
  const safeStr = (str) => (str || '未知').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim()

  const rawTitle = (novelInfo.title || '未知书籍').replace(/^《|》$/g, '').trim()
  const title = safeStr(rawTitle)
  const author = safeStr(novelInfo.author || '未知')
  const sourceName = safeStr(source?.name || novelInfo.sourceName || '未知书源')
  const rangeStr = safeStr(getChapterRangeStr(chapters))

  let rawUrl = source?.baseUrl || source?.rule?.url || novelInfo.url || ''
  try {
    if (rawUrl.startsWith('http')) {
      rawUrl = new URL(rawUrl).hostname
    }
  } catch (_) {}
  const sourceUrl = safeStr(rawUrl || 'unknown_site')

  const now = new Date()
  const YYYY = now.getFullYear()
  const MM = String(now.getMonth() + 1).padStart(2, '0')
  const DD = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const timeStr = `${YYYY}${MM}${DD}_${hh}${mm}${ss}`

  return `《${title}》作者：${author}${rangeStr}_来源：${sourceName}_${sourceUrl}_${timeStr}.${format.toLowerCase()}`
}

function getConfigFilePath() {
  return join(getPortableDataDir(), 'download_config.json')
}

/**
 * 获取当前下载配置
 */
export function getDownloadConfig() {
  const file = getConfigFilePath()
  try {
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8')
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_DOWNLOAD_CONFIG, ...parsed }
    }
  } catch (err) {
    console.warn('[Downloader] 读取下载配置失败, 使用默认配置:', err.message)
  }
  return { ...DEFAULT_DOWNLOAD_CONFIG }
}

/**
 * 保存下载配置
 */
export function saveDownloadConfig(newConfig) {
  try {
    const file = getConfigFilePath()
    const merged = { ...getDownloadConfig(), ...newConfig }
    writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8')
    return { success: true, config: merged }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * 开始下载小说
 * @param {string} taskId       唯一任务 ID
 * @param {object} novelInfo    { title, author, description, cover, url, source }
 * @param {Array}  chapters     [{ title, url }]  要下载的章节范围
 * @param {string} sourceId     书源 ID
 * @param {string} formatOverride 可选：指定下载格式 ('TXT' | 'EPUB' | 'PDF')
 * @param {number} concurrencyOverride 可选：指定下载并发线程数 (1 ~ 32)
 */
export async function startDownload(taskId, novelInfo, chapters, sourceId, formatOverride = null, concurrencyOverride = null) {
  const source = getSourceById(sourceId)
  if (!source) throw new Error(`未知书源: ${sourceId}`)

  const cfg = getDownloadConfig()
  const rawConcurrency = concurrencyOverride !== null && concurrencyOverride !== undefined && Number(concurrencyOverride) > 0
    ? Number(concurrencyOverride)
    : (cfg.concurrency || 4)
  const CONCURRENCY = Math.max(1, Math.min(32, rawConcurrency))
  const BATCH_INTERVAL = Math.max(100, Math.min(5000, cfg.batchInterval || 500))
  const MAX_RETRIES = Math.max(0, Math.min(5, cfg.maxRetries || 3))
  const targetFormat = (formatOverride || cfg.outputFormat || 'EPUB').toUpperCase()

  let cancelled = false
  tasks.set(taskId, {
    status: 'running',
    progress: 0,
    total: chapters.length,
    novelTitle: novelInfo.title,
    format: targetFormat,
    cancel: () => { cancelled = true }
  })

  pushProgress(taskId, { status: 'running', progress: 0, total: chapters.length, novelTitle: novelInfo.title, format: targetFormat })

  try {
    const completedChapters = []
    let done = 0

    // 分批并发下载
    for (let i = 0; i < chapters.length; i += CONCURRENCY) {
      if (cancelled) {
        pushProgress(taskId, { status: 'cancelled', progress: done, total: chapters.length })
        tasks.set(taskId, { ...tasks.get(taskId), status: 'cancelled' })
        return
      }

      const batch = chapters.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (ch, batchIdx) => {
          const globalIdx = i + batchIdx
          let content = ''
          let retries = MAX_RETRIES
          while (retries >= 0) {
            try {
              content = await source.getContent(ch.url)
              // 自动清洗正文开头与章节标题重复的行
              if (content && ch.title) {
                content = stripDuplicateTitle(content, ch.title)
              }
              // 简繁转换支持
              if (cfg.toSimplified && content) {
                content = toSimplified(content)
              }
              break
            } catch (e) {
              retries--
              if (retries < 0) {
                console.warn(`[下载] 章节下载失败: ${ch.title}`, e.message)
                content = `【本章节抓取失败，请稍后重试】`
              } else {
                await sleep(1000)
              }
            }
          }
          return { index: globalIdx, title: ch.title, content }
        })
      )

      for (const res of results) {
        if (res.status === 'fulfilled') {
          completedChapters.push(res.value)
        }
        done++
      }

      pushProgress(taskId, { status: 'running', progress: done, total: chapters.length })
      tasks.set(taskId, { ...tasks.get(taskId), progress: done })

      // 批次间休眠延时（对齐 config.ini 的防封 IP 机制）
      if (i + CONCURRENCY < chapters.length) {
        await sleep(BATCH_INTERVAL)
      }
    }

    // 按章节原始顺序排序
    completedChapters.sort((a, b) => a.index - b.index)

    // 输出保存路径处理 (优先用户自定义目录，默认使用软件本体下的 downloads/ 目录)
    let booksDir = cfg.saveDir && existsSync(cfg.saveDir)
      ? cfg.saveDir
      : getPortableDownloadsDir()

    if (!existsSync(booksDir)) {
      try { mkdirSync(booksDir, { recursive: true }) } catch (_) {}
    }

    const format = targetFormat
    const fileName = generateDownloadFileName(novelInfo, source, format, completedChapters)
    const outputPath = join(booksDir, fileName)

    let pdfRes = null
    if (format === 'PDF') {
      // 输出高清晰度排版 PDF 电子书
      pushProgress(taskId, { status: 'packaging', progress: done, total: chapters.length, text: '正在排版生成 PDF 电子书...' })
      pdfRes = await buildPdf(novelInfo, completedChapters, outputPath)
    } else if (format === 'TXT') {
      // 输出 TXT 纯文本小说
      pushProgress(taskId, { status: 'packaging', progress: done, total: chapters.length, text: '正在生成 TXT 文件...' })
      let txtContent = `${novelInfo.title}\n作者：${novelInfo.author || '未知'}\n\n简介：\n${novelInfo.description || ''}\n\n====================================\n\n`
      for (const ch of completedChapters) {
        txtContent += `\n\n${ch.title}\n\n${ch.content}\n`
      }
      writeFileSync(outputPath, txtContent, 'utf-8')
    } else {
      // 默认输出标准 EPUB
      pushProgress(taskId, { status: 'packaging', progress: done, total: chapters.length, text: '正在封装 EPUB 电子书...' })
      await buildEpub(novelInfo, completedChapters, outputPath)
    }

    // 如果开启了自动入库（autoImport: true），自动将生成的文件及章节书签加入书库
    if (cfg.autoImport !== false) {
      try {
        const stat = existsSync(outputPath) ? (await import('fs')).statSync(outputPath) : null
        const addRes = addBook({
          filePath: outputPath,
          format: format, // TXT, PDF 或 EPUB
          fileSize: stat ? stat.size : 0,
          title: novelInfo.title || safeTitle,
          author: novelInfo.author || '未知',
          cover: novelInfo.cover || null,
          description: novelInfo.description || '',
          publisher: 'YouQian Reader 下载器',
          language: 'zh'
        })

        // 若为 PDF 电子书，自动将全书章节添加为初始书签，方便点击直接跳转章节
        const bookObj = addRes?.book
        if (bookObj && format === 'PDF' && pdfRes && Array.isArray(pdfRes.chapterBookmarks)) {
          const autoBookmarks = pdfRes.chapterBookmarks.map((bm, bIdx) => ({
            id: `auto_pdf_bm_${bIdx}_${Date.now()}`,
            label: `${bm.title} (第 ${bm.page} 页)`,
            page: bm.page,
            createdAt: new Date().toISOString()
          }))
          saveBookmarks(bookObj.id, autoBookmarks)
        }
      } catch (importErr) {
        console.warn('[下载] 自动导入书库与书签保存失败:', importErr.message)
      }
    }

    tasks.set(taskId, { ...tasks.get(taskId), status: 'done', outputPath })
    pushProgress(taskId, { status: 'done', progress: done, total: chapters.length, outputPath })

    return { outputPath }

  } catch (err) {
    tasks.set(taskId, { ...tasks.get(taskId), status: 'error', error: err.message })
    pushProgress(taskId, { status: 'error', error: err.message })
    throw err
  }
}

export function cancelDownload(taskId) {
  const task = tasks.get(taskId)
  if (task?.cancel) task.cancel()
}

export function getTaskStatus(taskId) {
  return tasks.get(taskId) || null
}

export function getAllTasks() {
  const result = []
  tasks.forEach((v, k) => result.push({ taskId: k, ...v, cancel: undefined }))
  return result
}
