import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { setupDatabase } from './database'
import { setupIpcHandlers } from './ipc'

// 屏蔽开发环境下控制台堆积的黄色 Electron 安全警告，提供完美清爽的开发调试体验
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let mainWindow = null
const readerWindows = new Set()

// ===== 文件关联：记录待打开的文件路径 =====
let pendingFilePath = null

const getIconPath = () => {
  return app.isPackaged 
    ? join(process.resourcesPath, 'icon.ico') 
    : join(app.getAppPath(), 'resources/icon.ico')
}

// ===== 全局多窗口控制 IPC 处理器 =====
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.minimize()
})
ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  }
})
ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    // 当关闭的是阅读窗口且主书库窗口被隐藏时，恢复显示主书库窗口
    if (win !== mainWindow && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
    win.close()
  }
})
ipcMain.handle('window-is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? win.isMaximized() : false
})

// 注册新开窗口的 IPC 服务
ipcMain.handle('open-book-window', (event, bookId) => {
  createReaderWindow(bookId)
})

// ===== 文件关联：通过文件路径打开临时阅读窗口 =====
ipcMain.handle('open-file-reader-window', (event, filePath) => {
  createFileReaderWindow(filePath)
})

// ===== 文件关联：渲染进程确认关闭决策 =====
// result: { addToLibrary: bool }
ipcMain.on('file-reader-close-decision', (event, result) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  win._closeDecisionPending = false
  win.destroy()

  // 如果选择了添加到书架，显示主窗口（可能之前是静默的）
  if (result.addToLibrary && mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    mainWindow.focus()
  }
})

function createWindow(showImmediately = true) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    title: 'YouQian Reader',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: '#0d0d14',
    show: false,
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[MAIN WINDOW RENDERER] ${message} (at ${sourceId}:${line})`)
  })

  mainWindow.once('ready-to-show', () => {
    // showImmediately=false 时主窗口静默加载（文件关联启动场景）
    if (showImmediately) mainWindow.show()
  })

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false))

  mainWindow.on('closed', () => {
    // 主窗口关闭时，不影响已经打开的独立阅读窗口
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createReaderWindow(bookId) {
  // 检查是否已经打开该书的窗口
  for (const win of readerWindows) {
    if (win.bookId === bookId) {
      if (!win.isDestroyed()) {
        win.focus()
        return
      }
    }
  }

  const readerWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    title: 'YouQian Reader',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: '#0d0d14',
    show: false,
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false
    }
  })

  readerWin.on('page-title-updated', (event) => {
    event.preventDefault()
  })

  readerWin.bookId = bookId
  readerWindows.add(readerWin)

  readerWin.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[READER WINDOW RENDERER] ${message} (at ${sourceId}:${line})`)
  })

  readerWin.once('ready-to-show', () => {
    readerWin.show()
    // 打开书籍时，自动隐藏书库主窗口，无需展示书库
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide()
    }
  })

  readerWin.on('maximize', () => readerWin.webContents.send('window-maximized', true))
  readerWin.on('unmaximize', () => readerWin.webContents.send('window-maximized', false))

  readerWin.on('closed', () => {
    readerWindows.delete(readerWin)
  })

  const query = { windowType: 'reader', bookId: String(bookId) }
  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('windowType', 'reader')
    url.searchParams.set('bookId', String(bookId))
    readerWin.loadURL(url.href)
  } else {
    readerWin.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
}

// ===== 通过文件路径打开临时阅读窗口（文件关联入口）=====
function createFileReaderWindow(filePath) {
  // 检查是否已经打开该文件的窗口
  for (const win of readerWindows) {
    if (win.filePath === filePath) {
      if (!win.isDestroyed()) {
        win.focus()
        return
      }
    }
  }

  const readerWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    title: 'YouQian Reader',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: '#0d0d14',
    show: false,
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false
    }
  })

  readerWin.on('page-title-updated', (event) => {
    event.preventDefault()
  })

  readerWin.filePath = filePath
  readerWin._closeDecisionPending = false
  readerWindows.add(readerWin)

  readerWin.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[FILE READER WINDOW RENDERER] ${message} (at ${sourceId}:${line})`)
  })

  readerWin.once('ready-to-show', () => {
    readerWin.show()
  })

  readerWin.on('maximize', () => readerWin.webContents.send('window-maximized', true))
  readerWin.on('unmaximize', () => readerWin.webContents.send('window-maximized', false))

  // ===== 关键：关闭前询问逻辑 =====
  readerWin.on('close', (event) => {
    // 如果已经在处理关闭决策，则放行
    if (readerWin._closeDecisionPending) return
    // 阻止默认关闭，等待渲染进程的决策
    event.preventDefault()
    readerWin._closeDecisionPending = true
    // 通知渲染进程：用户想关闭窗口，需要询问
    readerWin.webContents.send('file-reader-close-requested')
  })

  readerWin.on('closed', () => {
    readerWindows.delete(readerWin)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('windowType', 'file-reader')
    url.searchParams.set('filePath', filePath)
    readerWin.loadURL(url.href)
  } else {
    readerWin.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { windowType: 'file-reader', filePath }
    })
  }
}

// ===== 解析命令行参数中的书籍文件路径 =====
function extractFilePathFromArgs(args) {
  const supportedExts = /\.(epub|pdf|azw3|mobi|txt)$/i
  // 跳过 electron 自身和入口脚本
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--') && supportedExts.test(arg)) {
      return arg
    }
  }
  return null
}

// ===== macOS：open-file 事件必须在 whenReady 之前注册 =====
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (app.isReady()) {
    createFileReaderWindow(path)
  } else {
    pendingFilePath = path
  }
})

// ===== 单实例锁：必须在 whenReady 之前调用 =====
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 已有实例在运行，直接退出（second-instance 事件会在已运行的实例中触发）
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    // 已运行的实例收到第二次启动请求
    const secondFilePath = extractFilePathFromArgs(argv)
    if (secondFilePath) {
      createFileReaderWindow(secondFilePath)
    }
    // 聚焦主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.youqian.reader.app')
    }
    nativeTheme.themeSource = 'dark'
    setupDatabase()
    setupIpcHandlers()

    // ===== 处理启动时通过文件关联传入的文件路径（Windows）=====
    const filePath = pendingFilePath || extractFilePathFromArgs(process.argv)
    if (filePath) {
      pendingFilePath = null
      // 有文件路径时：主窗口静默在后台加载，直接显示阅读窗口
      createWindow(false)
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => createFileReaderWindow(filePath), 300)
      })
    } else {
      // 正常启动：直接显示主窗口书库
      createWindow(true)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(true)
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
