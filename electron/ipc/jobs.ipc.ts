import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import type { AudioJobRequest, VideoJobRequest } from '../../shared/types/job'
import { validateMediaUrl } from '../lib/validate'
import { deleteDownload, downloadAgain, initJobs, jobControl, listJobs, onJobUpdate, revealJob, shutdownJobs, startAudioJob, startVideoJob } from '../services/jobs/jobManager'

const isJobId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)

export async function registerJobsIpc(): Promise<void> {
  await initJobs()

  ipcMain.handle(IPC.enqueueAudio, async (_e, raw: unknown, thumbnail: unknown) => {
    const req = raw as AudioJobRequest
    if (!req || typeof req !== 'object') return { ok: false, message: 'Invalid request.' }
    const check = validateMediaUrl(req.url, true)
    if (!check.ok) return { ok: false, message: "That doesn't look like a link." }
    return startAudioJob(req, check.url!, thumbnail)
  })

  ipcMain.handle(IPC.enqueueVideo, async (_e, raw: unknown, thumbnail: unknown) => {
    const req = raw as VideoJobRequest
    if (!req || typeof req !== 'object') return { ok: false, message: 'Invalid request.' }
    const check = validateMediaUrl(req.url, true)
    if (!check.ok) return { ok: false, message: "That doesn't look like a link." }
    return startVideoJob(req, check.url!, thumbnail)
  })

  ipcMain.handle(IPC.listJobs, () => listJobs())
  ipcMain.handle(IPC.cancelJob, (_e, id: unknown) => void (isJobId(id) && jobControl.cancel(id)))
  ipcMain.handle(IPC.pauseJob, (_e, id: unknown) => void (isJobId(id) && jobControl.pause(id)))
  ipcMain.handle(IPC.resumeJob, (_e, id: unknown) => void (isJobId(id) && jobControl.resume(id)))
  ipcMain.handle(IPC.retryJob, (_e, id: unknown) => (isJobId(id) ? jobControl.retry(id) : false))
  ipcMain.handle(IPC.againJob, (_e, id: unknown) => (isJobId(id) ? downloadAgain(id) : { ok: false, message: 'Invalid job.' }))
  ipcMain.handle(IPC.removeJob, (_e, id: unknown) => void (isJobId(id) && jobControl.remove(id)))
  ipcMain.handle(IPC.clearHistory, () => jobControl.clearHistory())
  ipcMain.handle(IPC.deleteDownload, (_e, id: unknown) => (isJobId(id) ? deleteDownload(id) : 'failed'))
  ipcMain.handle(IPC.revealJob, (_e, id: unknown) => (isJobId(id) ? revealJob(id) : 'missing'))
  ipcMain.handle(IPC.reorderJobs, (_e, ids: unknown) => {
    if (Array.isArray(ids) && ids.length <= 1000 && ids.every(isJobId)) jobControl.reorder(ids)
  })
  ipcMain.handle(IPC.setConcurrency, (_e, n: unknown) => {
    if (typeof n === 'number') jobControl.setConcurrency(n)
  })

  // Push every job change to all windows.
  onJobUpdate((job) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.jobUpdate, job)
  })

  // On quit: pause running jobs (keeping partial downloads) and save, then exit.
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    void shutdownJobs()
      .then(() => new Promise((r) => setTimeout(r, 300))) // let process trees exit
      .finally(() => app.quit())
  })
}
