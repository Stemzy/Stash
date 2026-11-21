import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import { cancel, clearPreviews, closeSource, decodedPcm, exportAudio, measure, openDropped, openLibraryItem, pickFile, renderPreview, revealExport, runTask, saveUser, slicePeaks } from '../services/lab/lab'

export function registerLabIpc(): void {
  ipcMain.handle(IPC.labPick, (e) => pickFile(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle(IPC.labOpenPath, (_e, path: unknown) => openDropped(path))
  ipcMain.handle(IPC.labOpenLibrary, (_e, id: unknown) => openLibraryItem(id))
  ipcMain.handle(IPC.labRun, (e, sourceId: unknown, task: unknown, force: unknown) => {
    if (task !== 'prepare' && task !== 'key' && task !== 'tempo') return { ok: false, code: 'FAILED' }
    return runTask(sourceId, task, force === true, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.labProgress, p)
    })
  })
  ipcMain.handle(IPC.labCancel, (_e, sourceId: unknown, kind: unknown) => cancel(sourceId, kind ?? undefined))
  ipcMain.handle(IPC.labSaveUser, (_e, sourceId: unknown, meta: unknown) => saveUser(sourceId, meta))
  ipcMain.handle(IPC.labClose, (_e, sourceId: unknown) => closeSource(sourceId))
  ipcMain.handle(IPC.labPeaks, (_e, sourceId: unknown, from: unknown, to: unknown, columns: unknown) => slicePeaks(sourceId, from, to, columns))
  ipcMain.handle(IPC.labMeasure, (_e, sourceId: unknown, region: unknown) => measure(sourceId, region))
  const progress = (e: Electron.IpcMainInvokeEvent) => (p: Parameters<Parameters<typeof renderPreview>[2]>[0]) => {
    if (!e.sender.isDestroyed()) e.sender.send(IPC.labProgress, p)
  }
  ipcMain.handle(IPC.labPreview, (e, sourceId: unknown, prep: unknown) => renderPreview(sourceId, prep, progress(e)))
  ipcMain.handle(IPC.labExport, (e, sourceId: unknown, prep: unknown, settings: unknown, name: unknown) =>
    exportAudio(BrowserWindow.fromWebContents(e.sender), sourceId, prep, settings, name, progress(e))
  )
  ipcMain.handle(IPC.labReveal, (_e, path: unknown) => revealExport(path))
  ipcMain.handle(IPC.labPcm, (_e, sourceId: unknown) => decodedPcm(sourceId))
  app.on('will-quit', () => void clearPreviews())
}
