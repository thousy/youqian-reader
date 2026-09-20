import { Menu, MenuItem, BrowserWindow, clipboard } from 'electron'

/**
 * 注册全局输入框与文本上下文右键菜单
 * 支持所有窗口（书库、找书、设置弹窗、独立阅读窗口等）的可编辑输入框呼出标准右键菜单
 * @param {import('electron').App} app 
 */
export function setupContextMenu(app) {
  app.on('web-contents-created', (event, contents) => {
    contents.on('context-menu', (e, params) => {
      const { isEditable, selectionText, editFlags } = params
      const win = BrowserWindow.fromWebContents(contents)
      if (!win || win.isDestroyed()) return

      // 1. 输入框 / 文本域 / 可编辑区域 (input, textarea, contenteditable)
      if (isEditable) {
        const menu = new Menu()
        const hasSelection = Boolean(selectionText && selectionText.length > 0)
        let hasClipboard = false
        try {
          hasClipboard = Boolean(clipboard.readText())
        } catch (_) {}

        // 撤销 (Undo)
        menu.append(new MenuItem({
          label: '撤销',
          role: 'undo',
          enabled: Boolean(editFlags.canUndo)
        }))

        // 重做 (Redo)
        menu.append(new MenuItem({
          label: '重做',
          role: 'redo',
          enabled: Boolean(editFlags.canRedo)
        }))

        menu.append(new MenuItem({ type: 'separator' }))

        // 剪切 (Cut)
        menu.append(new MenuItem({
          label: '剪切',
          role: 'cut',
          enabled: Boolean(editFlags.canCut || hasSelection)
        }))

        // 复制 (Copy)
        menu.append(new MenuItem({
          label: '复制',
          role: 'copy',
          enabled: Boolean(editFlags.canCopy || hasSelection)
        }))

        // 粘贴 (Paste) - 兼容底层 editFlags 延迟判断，只要剪贴板有内容或底层允许即放行
        menu.append(new MenuItem({
          label: '粘贴',
          role: 'paste',
          enabled: Boolean(editFlags.canPaste || hasClipboard)
        }))

        // 删除 (Delete)
        menu.append(new MenuItem({
          label: '删除',
          role: 'delete',
          enabled: Boolean(editFlags.canDelete || hasSelection)
        }))

        menu.append(new MenuItem({ type: 'separator' }))

        // 全选 (Select All)
        menu.append(new MenuItem({
          label: '全选',
          role: 'selectAll',
          enabled: editFlags.canSelectAll !== false
        }))

        menu.popup({ window: win })
        return
      }

      // 2. 非可编辑区域但有选中文本（例如书库列表、书名、作者、搜索结果划选复制）
      if (selectionText && selectionText.trim().length > 0) {
        const menu = new Menu()
        menu.append(new MenuItem({
          label: '复制',
          role: 'copy',
          enabled: editFlags.canCopy !== false
        }))
        menu.append(new MenuItem({
          label: '全选',
          role: 'selectAll',
          enabled: editFlags.canSelectAll !== false
        }))
        menu.popup({ window: win })
      }
    })
  })
}
