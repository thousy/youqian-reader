import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { setupDatabase } from './database'
import { setupIpcHandlers } from './ipc'

// 屏蔽开发环境下控制台堆积的黄色 Electron 安全警告，提供完美清爽的开发调试体验
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let mainWindow = null

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
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 窗口控制
  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window-close', () => mainWindow.close())
  ipcMain.handle('window-is-maximized', () => mainWindow.isMaximized())

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false))

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
