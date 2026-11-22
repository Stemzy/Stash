// The whole surface the renderer can call through window.api.
// Every channel is validated in the main process before anything runs.

import type { AnalyzeResult, AppUpdateStatus, ToolStatus, ToolUpdateProgress, ToolUpdateState } from './types/media'
import type { AudioJobRequest, DownloadJob, VideoJobRequest } from './types/job'
import type { LibraryItem } from './types/library'
import type { ExportDone, ExportSettings, KeyAnalysis, TempoAnalysis, LabOpened, LabProgress, LabResult, LabUserMeta, PeakReading, PrepSettings, PreviewRender, TrimRegion, WaveformData, WaveSlice } from './types/lab'

export const IPC = {
  pickFolder: 'system:pick-folder',
  defaultFolders: 'system:default-folders',
  toolsStatus: 'system:tools-status',
  setAppearance: 'system:set-appearance',
  updatesState: 'updates:state',
  updatesSetAuto: 'updates:set-auto',
  updatesCheck: 'updates:check',
  updatesProgress: 'updates:progress',
  appUpdateStatus: 'app-update:status',
  appUpdateCheck: 'app-update:check',
  appUpdateDownload: 'app-update:download',
  appUpdateInstall: 'app-update:install',
  appUpdateLater: 'app-update:later',
  appUpdateSkip: 'app-update:skip',
  appUpdateChanged: 'app-update:changed',
  analyze: 'media:analyze',
  cancelAnalyze: 'media:cancel-analyze',
  enqueueAudio: 'jobs:enqueue-audio',
  enqueueVideo: 'jobs:enqueue-video',
  cancelJob: 'jobs:cancel',
  pauseJob: 'jobs:pause',
  resumeJob: 'jobs:resume',
  retryJob: 'jobs:retry',
  againJob: 'jobs:again',
  removeJob: 'jobs:remove',
  clearHistory: 'jobs:clear-history',
  revealJob: 'jobs:reveal',
  deleteDownload: 'jobs:delete-download',
  reorderJobs: 'jobs:reorder',
  setConcurrency: 'jobs:set-concurrency',
  listJobs: 'jobs:list',
  jobUpdate: 'jobs:update',
  libraryList: 'library:list',
  libraryOpenExternal: 'library:open-external',
  labPick: 'lab:pick',
  labOpenPath: 'lab:open-path',
  labOpenLibrary: 'lab:open-library',
  labRun: 'lab:run',
  labCancel: 'lab:cancel',
  labSaveUser: 'lab:save-user',
  labClose: 'lab:close',
  labProgress: 'lab:progress',
  labPeaks: 'lab:peaks',
  labMeasure: 'lab:measure',
  labPreview: 'lab:preview',
  labExport: 'lab:export',
  labReveal: 'lab:reveal',
  labPcm: 'lab:pcm'
} as const

export type EnqueueResult = { ok: true; job: DownloadJob } | { ok: false; message: string }

export interface StashApi {
  platform: string
  system: {
    pickFolder(current?: string): Promise<string | null>
    /** Where downloads go unless the user picks a folder (Downloads), plus the old defaults. */
    defaultFolders(): Promise<{ videos: string; music: string; previous?: { videos: string; music: string } }>
    toolsStatus(refresh?: boolean): Promise<ToolStatus[]>
    /** Theme → window chrome: caption-button colours, native light/dark, startup background. */
    setAppearance(a: { mode: 'dark' | 'light'; symbolColor: string; background: string }): Promise<void>
  }
  /** Keeping yt-dlp, Deno and FFmpeg up to date (only with the user's permission). */
  updates: {
    state(): Promise<ToolUpdateState>
    setAuto(on: boolean): Promise<ToolUpdateState>
    /** Check (and install) now, whatever the automatic setting. */
    checkNow(): Promise<ToolUpdateState>
    onProgress(cb: (p: ToolUpdateProgress) => void): () => void
  }
  /** Updating Stash itself from its GitHub releases (installed app only). */
  appUpdate: {
    status(): Promise<AppUpdateStatus>
    /** `true` when the user pressed "Check for updates" (shows errors and skipped versions). */
    check(byUser?: boolean): Promise<AppUpdateStatus>
    download(): Promise<void>
    /** Quits and installs the downloaded update. */
    install(): Promise<void>
    later(): Promise<void>
    skip(): Promise<void>
    onChange(cb: (s: AppUpdateStatus) => void): () => void
  }
  media: {
    /** `requestId` lets the renderer cancel a slow analysis. */
    analyze(url: string, requestId: string): Promise<AnalyzeResult>
    cancelAnalyze(requestId: string): Promise<void>
  }
  jobs: {
    /** `thumbnail` is the data: URL from analysis; main saves it for History. */
    enqueueAudio(req: AudioJobRequest, thumbnail?: string): Promise<EnqueueResult>
    enqueueVideo(req: VideoJobRequest, thumbnail?: string): Promise<EnqueueResult>
    list(): Promise<DownloadJob[]>
    cancel(id: string): Promise<void>
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    /** Failed/canceled job: run again as the same entry. */
    retry(id: string): Promise<boolean>
    /** Completed job: download again as a new entry. */
    again(id: string): Promise<EnqueueResult>
    remove(id: string): Promise<void>
    clearHistory(): Promise<void>
    /**
     * Moves a finished download's file to the Recycle Bin and removes it from
     * Library and History. 'missing' = the file was already gone (entry removed anyway).
     */
    deleteDownload(id: string): Promise<'ok' | 'missing' | 'failed'>
    /** Shows the saved file in Explorer. */
    reveal(id: string): Promise<'ok' | 'missing'>
    reorder(waitingIds: string[]): Promise<void>
    setConcurrency(n: number): Promise<void>
    /** Every change to a real job. Returns an unsubscribe function. */
    onUpdate(cb: (job: DownloadJob) => void): () => void
  }
  library: {
    /** Finished downloads that still exist on disk. */
    list(): Promise<LibraryItem[]>
    /** Opens the file in the system's default player. */
    openExternal(id: string): Promise<boolean>
  }

  lab: {
    /** Native file dialog. null = the user closed it. */
    pickFile(): Promise<LabResult<LabOpened> | null>
    /** A file dropped on the window (its path is read in preload and checked in main). */
    openDropped(file: File): Promise<LabResult<LabOpened>>
    openLibrary(libraryId: string): Promise<LabResult<LabOpened>>
    /** Decodes once and returns the waveform (cached per file). */
    waveform(sourceId: string): Promise<LabResult<WaveformData>>
    /** Key & scale estimate; `force` ignores a cached result. */
    analyzeKey(sourceId: string, force?: boolean): Promise<LabResult<KeyAnalysis>>
    /** BPM, beats and half/double readings; `force` ignores a cached result. */
    analyzeTempo(sourceId: string, force?: boolean): Promise<LabResult<TempoAnalysis>>
    /** Mono 22.05 kHz samples of the whole file (fallback for formats the browser can't decode). */
    pcm(sourceId: string): Promise<LabResult<{ sampleRate: number; data: Float32Array }>>
    /** Stops work on a file: all of it, or only an export, a preview, or the analysis. */
    cancel(sourceId: string, kind?: 'export' | 'preview' | 'analysis'): Promise<void>
    /** The user's own confirmed key/tempo, stored apart from the file. Only the fields given change. */
    saveUser(sourceId: string, meta: { [K in keyof LabUserMeta]?: LabUserMeta[K] | null }): Promise<boolean>
    close(sourceId: string): Promise<void>
    onProgress(cb: (p: LabProgress) => void): () => void
    /** Waveform columns for a zoomed-in range. */
    peaks(sourceId: string, from: number, to: number, columns: number): Promise<LabResult<WaveSlice>>
    /** Sample peak of a selection (dBFS), for clipping warnings. */
    measure(sourceId: string, region: TrimRegion): Promise<LabResult<PeakReading>>
    /** Renders the processed selection to a temporary WAV for listening. */
    preview(sourceId: string, prep: PrepSettings): Promise<LabResult<PreviewRender>>
    /** Save dialog, then export. null = the dialog was closed. The original is never changed. */
    exportAudio(sourceId: string, prep: PrepSettings, settings: ExportSettings, name: string): Promise<LabResult<ExportDone> | null>
    revealExport(path: string): Promise<boolean>
  }
}
