import { app } from 'electron'
import { join, dirname, basename } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs'

/**
 * 获取软件本体所在的根目录
 * 优先级：
 * 1. electron-builder portable 单文件运行注入的外部目录 (PORTABLE_EXECUTABLE_DIR)
 * 2. 打包后的安装/解压可执行文件所在目录 (app.isPackaged -> dirname(app.getPath('exe')))
 * 3. 开发模式下的项目根目录 (process.cwd())
 */
export function getAppRootDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR
  }
  if (app && app.isPackaged) {
    return dirname(app.getPath('exe'))
  }
  return process.cwd()
}

/**
 * 获取软件本体下的数据存储目录 (软件本体/data)
 */
export function getPortableDataDir() {
  const dir = join(getAppRootDir(), 'data')
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }) } catch (_) {}
  }
  return dir
}

/**
 * 获取软件本体下的小说下载存放目录 (软件本体/downloads)
 */
export function getPortableDownloadsDir() {
  const dir = join(getAppRootDir(), 'downloads')
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }) } catch (_) {}
  }
  return dir
}

/**
 * 递归复制目录工具
 */
function copyDirRecursive(src, dest) {
  if (!existsSync(src)) return
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true })
  }
  const entries = readdirSync(src)
  for (const entry of entries) {
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      if (!existsSync(destPath)) {
        try { copyFileSync(srcPath, destPath) } catch (_) {}
      }
    }
  }
}

/**
 * 检查并平滑迁移旧版本系统 AppData 中的数据到软件本体的 data 目录下
 */
export function migrateLegacyDataIfNeed() {
  try {
    const targetDataDir = getPortableDataDir()
    const targetDbFile = join(targetDataDir, 'youqian-data.json')

    // 如果本体 data 目录下已经有数据库文件，说明已经初始化或已经便携化，无需迁移
    if (existsSync(targetDbFile)) {
      return
    }

    // 获取系统默认的旧 AppData 路径
    let legacyAppDataDir = ''
    if (process.platform === 'win32' && process.env.APPDATA) {
      legacyAppDataDir = join(process.env.APPDATA, 'youqian-reader')
    }

    if (legacyAppDataDir && existsSync(legacyAppDataDir)) {
      console.log('[Portable] 检测到系统 AppData 中存在旧版本数据，正在平滑迁移至软件本体目录...', legacyAppDataDir)

      // 1. 迁移核心数据库
      const legacyDbFile = join(legacyAppDataDir, 'youqian-data.json')
      if (existsSync(legacyDbFile) && !existsSync(targetDbFile)) {
        copyFileSync(legacyDbFile, targetDbFile)
        console.log('[Portable] 成功迁移核心数据库 youqian-data.json')
      }

      // 2. 迁移下载配置
      const legacyDownloadCfg = join(legacyAppDataDir, 'download_config.json')
      const targetDownloadCfg = join(targetDataDir, 'download_config.json')
      if (existsSync(legacyDownloadCfg) && !existsSync(targetDownloadCfg)) {
        copyFileSync(legacyDownloadCfg, targetDownloadCfg)
        console.log('[Portable] 成功迁移下载配置 download_config.json')
      }

      // 3. 迁移自定义书源规则 custom_rules
      const legacyRulesDir = join(legacyAppDataDir, 'custom_rules')
      const targetRulesDir = join(targetDataDir, 'custom_rules')
      if (existsSync(legacyRulesDir)) {
        copyDirRecursive(legacyRulesDir, targetRulesDir)
        console.log('[Portable] 成功迁移自定义书源规则 custom_rules 目录')
      }

      console.log('[Portable] 旧版本数据平滑迁移完成！已完全切换为纯绿色便携模式。')
    }
  } catch (err) {
    console.warn('[Portable] 迁移旧版本数据时发生异常:', err.message)
  }
}

/**
 * 智能重定位书籍文件路径（支持换盘符、换机、相对路径定位）
 * @param {string} originalPath 书籍原本记录的绝对路径
 * @returns {string} 实际可访问的物理路径
 */
export function resolveBookPath(originalPath) {
  if (!originalPath) return originalPath
  // 1. 若原始路径依然有效，直接返回
  if (existsSync(originalPath)) {
    return originalPath
  }

  // 2. 尝试在当前软件本体的 downloads 目录下寻找同名文件
  const fileName = basename(originalPath)
  const downloadsCandidate = join(getPortableDownloadsDir(), fileName)
  if (existsSync(downloadsCandidate)) {
    return downloadsCandidate
  }

  // 3. 尝试在当前软件本体的 data/downloads 目录下寻找同名文件
  const dataDownloadsCandidate = join(getPortableDataDir(), 'downloads', fileName)
  if (existsSync(dataDownloadsCandidate)) {
    return dataDownloadsCandidate
  }

  // 4. 尝试在软件本体根目录下寻找同名文件
  const rootCandidate = join(getAppRootDir(), fileName)
  if (existsSync(rootCandidate)) {
    return rootCandidate
  }

  return originalPath
}
