import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import { bundledFfmpeg, toolStatus } from '../services/binaries/tools'
import { appUpdateStatus, check as checkApp, download as downloadApp, initAppUpdater, installNow, later as laterApp, onAppUpdate, skip as skipApp } from '../services/updater/appUpdater'
import { autoCheckDue, CHECK_EVERY, checkForToolUpdates, initToolUpdater, onToolUpdateProgress, setAutoUpdate, toolUpdateState } from '../services/updater/toolUpdater'

/** Runs a check with the versions of the tools in use right now. */
async function check(): Promise<void> {
  const s = await toolStatus()
  const ok = (n: string) => s.find((t) => t.name === n && t.ok)
  await checkForToolUpdates({ ytdlpPath: ok('yt-dlp')?.path, denoVersion: ok('deno')?.version }, bundledFfmpeg(), async () => {
    await toolStatus(true) // new downloads pick up the new copy
  })
}

export async function registerUpdatesIpc(): Promise<void> {
  await initToolUpdater().catch(() => undefined)

  onToolUpdateProgress((p) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.updatesProgress, p)
  })

  // Stash itself
  onAppUpdate((st) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.appUpdateChanged, st)
  })
  ipcMain.handle(IPC.appUpdateStatus, () => appUpdateStatus())
  ipcMain.handle(IPC.appUpdateCheck, (_e, byUser: unknown) => checkApp(byUser === true))
  ipcMain.handle(IPC.appUpdateDownload, () => downloadApp())
  ipcMain.handle(IPC.appUpdateInstall, () => installNow())
  ipcMain.handle(IPC.appUpdateLater, () => laterApp())
  ipcMain.handle(IPC.appUpdateSkip, () => skipApp())
  // Not awaited: the window must never wait on (or be stopped by) the updater.
  void initAppUpdater().catch(() => undefined)

  ipcMain.handle(IPC.updatesState, () => toolUpdateState())
  ipcMain.handle(IPC.updatesSetAuto, async (_e, on: unknown) => {
    await setAutoUpdate(on === true)
    if (on === true && autoCheckDue()) void check()
    return toolUpdateState()
  })
  ipcMain.handle(IPC.updatesCheck, async () => {
    await check()
    return toolUpdateState()
  })

  // Automatic checks: shortly after launch (the window comes first), then twice a day.
  const tick = () => {
    if (autoCheckDue()) void check()
  }
  setTimeout(tick, 20_000)
  setInterval(tick, CHECK_EVERY / 4).unref()
}
