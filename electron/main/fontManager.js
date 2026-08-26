/**
 * 用户自定义字体管理模块 (True Portable 便携化)
 * 存储路径: YouQian Reader/data/custom_fonts
 * 支持格式: .ttf, .otf, .woff, .woff2
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, unlinkSync, statSync } from 'fs'
import { join, extname, basename } from 'path'
import * as electron from 'electron'
import { getPortableDataDir } from './portablePath.js'

const { dialog } = electron

// 获取自定义字体存储目录
export function getCustomFontsDir() {
  const dir = join(getPortableDataDir(), 'custom_fonts')
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch (_) {}
  }
  return dir
}

const SUPPORTED_EXTS = ['.ttf', '.otf', '.woff', '.woff2']

/**
 * 获取所有已导入的自定义字体列表
 */
export function getCustomFonts() {
  try {
    const dir = getCustomFontsDir()
    if (!existsSync(dir)) return []

    const files = readdirSync(dir)
    const list = []

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (SUPPORTED_EXTS.includes(ext)) {
        const fullPath = join(dir, file)
        const stat = statSync(fullPath)
        const rawName = basename(file, ext)
        // 规整字体名称作为 CSS font-family 标识
        const fontName = rawName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5\s-]/g, '').trim() || rawName

        list.push({
          id: file,
          name: fontName,
          fileName: file,
          fileSize: stat.size,
          ext: ext.replace('.', ''),
          fullPath
        })
      }
    }

    return list
  } catch (err) {
    console.error('[FontManager] 获取字体列表失败:', err)
    return []
  }
}

/**
 * 打开系统原生文件对话框导入字体文件
 */
export async function openAndImportFontFiles() {
  try {
    const res = await dialog.showOpenDialog({
      title: '选择要导入的本地字体文件 (支持 TTF / OTF / WOFF / WOFF2)',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '字体文件 (*.ttf; *.otf; *.woff; *.woff2)', extensions: ['ttf', 'otf', 'woff', 'woff2'] },
        { name: '所有文件 (*.*)', extensions: ['*'] }
      ]
    })

    if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const dir = getCustomFontsDir()
    let importedCount = 0

    for (const srcPath of res.filePaths) {
      const ext = extname(srcPath).toLowerCase()
      if (!SUPPORTED_EXTS.includes(ext)) continue

      const fileName = basename(srcPath)
      const targetPath = join(dir, fileName)

      try {
        copyFileSync(srcPath, targetPath)
        importedCount++
      } catch (e) {
        console.warn(`[FontManager] 复制字体文件失败 ${fileName}:`, e.message)
      }
    }

    return { success: true, count: importedCount, fonts: getCustomFonts() }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * 删除自定义字体文件
 */
export function deleteCustomFont(fileName) {
  try {
    if (!fileName) return { success: false, error: '未指定文件名' }
    const dir = getCustomFontsDir()
    const targetPath = join(dir, fileName)

    if (existsSync(targetPath)) {
      unlinkSync(targetPath)
    }

    return { success: true, fonts: getCustomFonts() }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * 批量删除自定义字体文件
 */
export function deleteCustomFonts(fileNames) {
  try {
    if (!Array.isArray(fileNames) || fileNames.length === 0) {
      return { success: false, error: '未指定要删除的字体列表' }
    }
    const dir = getCustomFontsDir()
    let deletedCount = 0
    for (const fileName of fileNames) {
      if (!fileName) continue
      const targetPath = join(dir, fileName)
      if (existsSync(targetPath)) {
        unlinkSync(targetPath)
        deletedCount++
      }
    }

    return { success: true, count: deletedCount, fonts: getCustomFonts() }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * 直接读取字体文件的原始二进制 Buffer (供 FontFace 零损耗原生加载)
 */
export function readCustomFontBuffer(fileName) {
  try {
    const dir = getCustomFontsDir()
    const targetPath = join(dir, fileName)
    if (!existsSync(targetPath)) return null
    return readFileSync(targetPath)
  } catch (err) {
    console.error(`[FontManager] 读取字体 Buffer 失败 ${fileName}:`, err)
    return null
  }
}

/**
 * 读取字体文件的 Base64 Data URL 供前端使用
 */
export function readCustomFontDataUrl(fileName) {
  try {
    const dir = getCustomFontsDir()
    const targetPath = join(dir, fileName)
    if (!existsSync(targetPath)) return null

    const ext = extname(fileName).toLowerCase()
    const buf = readFileSync(targetPath)
    let mime = 'font/truetype'
    if (ext === '.otf') mime = 'font/opentype'
    else if (ext === '.woff') mime = 'font/woff'
    else if (ext === '.woff2') mime = 'font/woff2'

    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    console.error(`[FontManager] 读取字体 DataURL 失败 ${fileName}:`, err)
    return null
  }
}
