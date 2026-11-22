import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import { toolStatus } from '../services/binaries/tools'
import { applyAppearance } from '../lib/appearance'

export function registerSystemIpc(): void {
  ipcMain.handle(IPC.setAppearance, (e, a: unknown) => applyAppearance(BrowserWindow.fromWebContents(e.sender), a))

  ipcMain.handle(IPC.pickFolder, async (event, current: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose download folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: typeof current === 'string' ? current : undefined
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0] ?? null
  })

  // Both default to Downloads: Windows' Controlled folder access (ransomware protection)
  // guards Videos, Music, Documents, Pictures and Desktop, and blocks unknown apps from
  // saving there. Downloads isn't guarded. `previous` = the old defaults, so saved
  // settings that were never changed by the user can move over.
  ipcMain.handle(IPC.defaultFolders, () => {
    const downloads = app.getPath('downloads')
    return { videos: downloads, music: downloads, previous: { videos: app.getPath('videos'), music: app.getPath('music') } }
  })

  // Paths stay in the main process; the renderer only needs names and versions.
  ipcMain.handle(IPC.toolsStatus, async (_e, refresh: unknown) =>
    (await toolStatus(refresh === true)).map(({ path: _p, ...rest }) => rest)
  )
}
