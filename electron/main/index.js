import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { setupDatabase } from './database'
import { setupIpcHandlers } from './ipc'

// 屏蔽开发环境下控制台堆积的黄色 Electron 安全警告，提供完美清爽的开发调试体验
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let mainWindow = null
const readerWindows = new Set()

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
  if (win) win.close()
})
ipcMain.handle('window-is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? win.isMaximized() : false
})

// 注册新开窗口的 IPC 服务
ipcMain.handle('open-book-window', (event, bookId) => {
  createReaderWindow(bookId)
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
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

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[MAIN WINDOW RENDERER] ${message} (at ${sourceId}:${line})`)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false))

  mainWindow.on('closed', () => {
    // 主窗口关闭时，关闭所有的阅读窗口
    for (const win of readerWindows) {
      if (!win.isDestroyed()) win.close()
    }
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

  readerWin.bookId = bookId
  readerWindows.add(readerWin)

  readerWin.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[READER WINDOW RENDERER] ${message} (at ${sourceId}:${line})`)
  })

  readerWin.once('ready-to-show', () => {
    readerWin.show()
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

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  setupDatabase()
  setupIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
