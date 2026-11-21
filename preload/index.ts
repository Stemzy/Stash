import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type StashApi } from '../shared/ipc-contract'

// The only bridge between the sandboxed renderer and the main process.
// Never expose ipcRenderer itself.
const api: StashApi = {
  platform: process.platform,
  system: {
    pickFolder: (current) => ipcRenderer.invoke(IPC.pickFolder, current),
    defaultFolders: () => ipcRenderer.invoke(IPC.defaultFolders),
    toolsStatus: (refresh) => ipcRenderer.invoke(IPC.toolsStatus, refresh === true),
    setAppearance: (a) => ipcRenderer.invoke(IPC.setAppearance, a)
  },
  updates: {
    state: () => ipcRenderer.invoke(IPC.updatesState),
    setAuto: (on) => ipcRenderer.invoke(IPC.updatesSetAuto, on === true),
    checkNow: () => ipcRenderer.invoke(IPC.updatesCheck),
    onProgress: (cb) => {
      const handler = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
      ipcRenderer.on(IPC.updatesProgress, handler)
      return () => ipcRenderer.removeListener(IPC.updatesProgress, handler)
    }
  },
  media: {
    analyze: (url, requestId) => ipcRenderer.invoke(IPC.analyze, url, requestId),
    cancelAnalyze: (requestId) => ipcRenderer.invoke(IPC.cancelAnalyze, requestId)
  },
  jobs: {
    enqueueAudio: (req, thumbnail) => ipcRenderer.invoke(IPC.enqueueAudio, req, thumbnail),
    enqueueVideo: (req, thumbnail) => ipcRenderer.invoke(IPC.enqueueVideo, req, thumbnail),
    list: () => ipcRenderer.invoke(IPC.listJobs),
    cancel: (id) => ipcRenderer.invoke(IPC.cancelJob, id),
    pause: (id) => ipcRenderer.invoke(IPC.pauseJob, id),
    resume: (id) => ipcRenderer.invoke(IPC.resumeJob, id),
    retry: (id) => ipcRenderer.invoke(IPC.retryJob, id),
    again: (id) => ipcRenderer.invoke(IPC.againJob, id),
    remove: (id) => ipcRenderer.invoke(IPC.removeJob, id),
    clearHistory: () => ipcRenderer.invoke(IPC.clearHistory),
    reveal: (id) => ipcRenderer.invoke(IPC.revealJob, id),
    deleteDownload: (id) => ipcRenderer.invoke(IPC.deleteDownload, id),
    reorder: (ids) => ipcRenderer.invoke(IPC.reorderJobs, ids),
    setConcurrency: (n) => ipcRenderer.invoke(IPC.setConcurrency, n),
    onUpdate: (cb) => {
      // Hand the renderer only the job object, never the IPC event.
      const handler = (_e: Electron.IpcRendererEvent, job: Parameters<typeof cb>[0]) => cb(job)
      ipcRenderer.on(IPC.jobUpdate, handler)
      return () => ipcRenderer.removeListener(IPC.jobUpdate, handler)
    }
  },
  library: {
    list: () => ipcRenderer.invoke(IPC.libraryList),
    openExternal: (id) => ipcRenderer.invoke(IPC.libraryOpenExternal, id)
  },

  lab: {
    pickFile: () => ipcRenderer.invoke(IPC.labPick),
    openDropped: async (file) => {
      // Only a real local file has a path (not text or an image dragged from a web page).
      let path = ''
      try {
        path = webUtils.getPathForFile(file)
      } catch {
        path = ''
      }
      if (!path) return { ok: false, code: 'UNSUPPORTED' }
      return ipcRenderer.invoke(IPC.labOpenPath, path)
    },
    openLibrary: (id) => ipcRenderer.invoke(IPC.labOpenLibrary, id),
    waveform: (id) => ipcRenderer.invoke(IPC.labRun, id, 'prepare', false),
    analyzeKey: (id, force) => ipcRenderer.invoke(IPC.labRun, id, 'key', force === true),
    analyzeTempo: (id, force) => ipcRenderer.invoke(IPC.labRun, id, 'tempo', force === true),
    pcm: (id) => ipcRenderer.invoke(IPC.labPcm, id),
    cancel: (id, kind) => ipcRenderer.invoke(IPC.labCancel, id, kind),
    saveUser: (id, meta) => ipcRenderer.invoke(IPC.labSaveUser, id, meta),
    close: (id) => ipcRenderer.invoke(IPC.labClose, id),
    onProgress: (cb) => {
      const handler = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
      ipcRenderer.on(IPC.labProgress, handler)
      return () => ipcRenderer.removeListener(IPC.labProgress, handler)
    },
    peaks: (id, from, to, columns) => ipcRenderer.invoke(IPC.labPeaks, id, from, to, columns),
    measure: (id, region) => ipcRenderer.invoke(IPC.labMeasure, id, region),
    preview: (id, prep) => ipcRenderer.invoke(IPC.labPreview, id, prep),
    exportAudio: (id, prep, settings, name) => ipcRenderer.invoke(IPC.labExport, id, prep, settings, name),
    revealExport: (path) => ipcRenderer.invoke(IPC.labReveal, path)
  }
}

contextBridge.exposeInMainWorld('api', api)
