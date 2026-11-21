// Renderer-side view of all jobs.
// - Real jobs (audio, from Milestone 2) run in the main process; this store only
//   mirrors the snapshots it pushes over IPC.
// - Simulated jobs exist only in a plain-browser preview (no main process) and
//   as "Sample" history rows; they never start a process or write a file.

import type { AudioJobRequest, DownloadJob, JobSpec, JobStatus, VideoJobRequest } from '@shared/types/job'
import { createStore, useStore } from '@/shared/lib/store'
import { api, isElectron } from '@/shared/api'
import { settingsStore } from '@/entities/settings/model'
import { sampleArtwork } from '@/shared/mock/mockMedia'

export type UiJob = DownloadJob & {
  /** Sample row shown so History isn't empty on first launch. */
  sample?: boolean
  phaseStartedAt?: number
  /** Simulated download length in seconds. */
  simSeconds?: number
}

export const ACTIVE: JobStatus[] = ['queued', 'downloading', 'merging', 'converting', 'paused']
export const isActive = (j: UiJob): boolean => ACTIVE.includes(j.status)
export const kindOf = (j: UiJob): 'video' | 'audio' => j.spec.kind

const ago = (min: number): string => new Date(Date.now() - min * 60_000).toISOString()

function samples(): UiJob[] {
  const base = { simulated: true as const, sample: true, percent: 100 }
  return [
    {
      ...base,
      id: 's1',
      createdAt: ago(42),
      finishedAt: ago(40),
      status: 'completed',
      source: { url: 'https://youtube.com/watch?v=sample1', extractor: 'YouTube', title: 'Building a Mechanical Keyboard from Scratch', creator: 'Desk Lab', durationSec: 1082, thumbnailUrl: sampleArtwork('v-keyboard', 'wide') },
      spec: { kind: 'video', height: 1080, container: 'mp4' },
      output: { directory: '', filename: 'Desk Lab - Building a Mechanical Keyboard from Scratch.mp4', sizeBytes: 340_000_000 }
    },
    {
      ...base,
      id: 's2',
      createdAt: ago(190),
      finishedAt: ago(188),
      status: 'completed',
      source: { url: 'https://soundcloud.com/sample', extractor: 'SoundCloud', title: 'Midnight Drive (Lo-fi Mix)', creator: 'Kaito Rain', durationSec: 225, thumbnailUrl: sampleArtwork('m-midnight', 'square') },
      spec: { kind: 'audio', format: 'mp3', quality: { mode: 'bitrate', kbps: 192 } },
      output: { directory: '', filename: 'Kaito Rain - Midnight Drive (Lo-fi Mix).mp3', sizeBytes: 5_400_000 }
    },
    {
      ...base,
      id: 's3',
      createdAt: ago(60 * 26),
      finishedAt: ago(60 * 26),
      status: 'failed',
      percent: 37,
      source: { url: 'https://vimeo.com/sample', extractor: 'Vimeo', title: 'Night Train — a short film', creator: 'Ola Lindqvist', durationSec: 571, thumbnailUrl: sampleArtwork('v-train', 'wide') },
      spec: { kind: 'video', height: 1080, container: 'mkv' },
      output: { directory: '', filename: 'Ola Lindqvist - Night Train.mkv', sizeBytes: 260_000_000 }
    },
    {
      ...base,
      id: 's4',
      createdAt: ago(60 * 50),
      finishedAt: ago(60 * 50),
      status: 'completed',
      source: { url: 'https://bandcamp.com/sample', extractor: 'Bandcamp', title: 'Glass Harbor', creator: 'Wren & the Tides', durationSec: 303, thumbnailUrl: sampleArtwork('m-harbor', 'square') },
      spec: { kind: 'audio', format: 'flac', quality: { mode: 'pcm', sampleRateHz: 'source', bitDepth: 16, flacLevel: 5 } },
      output: { directory: '', filename: 'Wren & the Tides - Glass Harbor.flac', sizeBytes: 32_000_000 }
    }
  ]
}

export const jobsStore = createStore<UiJob[]>([])
let seeded = false

/** Sample rows (browser preview only) need the canvas, so they are created after the app mounts. */
export function seedSamples(): void {
  if (seeded || isElectron) return
  seeded = true
  jobsStore.set((list) => [...list, ...samples()])
}

export const useJobs = (): UiJob[] => useStore(jobsStore)

let n = 0
export function enqueueSimulated(input: {
  source: UiJob['source']
  spec: JobSpec
  output: UiJob['output']
}): UiJob {
  const job: UiJob = {
    id: `job-${Date.now()}-${n++}`,
    createdAt: new Date().toISOString(),
    status: 'queued',
    percent: 0,
    simulated: true,
    simSeconds: 14 + Math.random() * 12,
    ...input
  }
  jobsStore.set((list) => [...list, job])
  ensureTicking()
  return job
}

// ---- real jobs (main process) ----------------------------------------------

type RealRequest = { kind: 'audio'; req: AudioJobRequest } | { kind: 'video'; req: VideoJobRequest }

function upsertReal(job: DownloadJob): void {
  jobsStore.set((list) => (list.some((j) => j.id === job.id) ? list.map((j) => (j.id === job.id ? job : j)) : [...list, job]))
}

if (isElectron) {
  api.jobs.onUpdate(upsertReal)
  // Saved queue and history from earlier sessions.
  void api.jobs.list().then((all) => all.forEach(upsertReal))
}

/** Starts a real job in the main process. Returns an error message on failure. */
export async function enqueueReal(request: RealRequest, thumbnailUrl?: string): Promise<string | null> {
  const r = request.kind === 'audio' ? await api.jobs.enqueueAudio(request.req, thumbnailUrl) : await api.jobs.enqueueVideo(request.req, thumbnailUrl)
  if (!r.ok) return r.message
  upsertReal(r.job)
  return null
}

const patch = (id: string, p: Partial<UiJob>) =>
  jobsStore.set((list) => list.map((j) => (j.id === id ? { ...j, ...p } : j)))

const isReal = (id: string) => {
  const j = jobsStore.get().find((x) => x.id === id)
  return !!j && !j.simulated
}

/**
 * Every action goes to the main process for real jobs. The local branches only
 * serve the plain-browser preview's simulated jobs.
 */
export const jobActions = {
  pause: (id: string) => {
    if (isReal(id)) return void api.jobs.pause(id)
    patch(id, { status: 'paused', speedBps: undefined, etaSec: undefined })
  },
  resume: (id: string) => {
    if (isReal(id)) return void api.jobs.resume(id)
    patch(id, { status: 'queued' })
    ensureTicking()
  },
  cancel: (id: string) => {
    if (isReal(id)) return void api.jobs.cancel(id)
    patch(id, { status: 'canceled', finishedAt: new Date().toISOString(), speedBps: undefined, etaSec: undefined })
  },
  remove: (id: string) => {
    if (isReal(id)) void api.jobs.remove(id)
    jobsStore.set((list) => list.filter((j) => j.id !== id))
  },
  clearHistory: () => {
    if (isElectron) void api.jobs.clearHistory()
    jobsStore.set((list) => list.filter(isActive))
  },
  /** Failed/canceled: retry as the same entry. Completed: download again as a new one. */
  again: async (job: UiJob): Promise<string | null> => {
    if (!job.simulated) {
      if (job.status === 'failed' || job.status === 'canceled') return (await api.jobs.retry(job.id)) ? null : 'This download can no longer be retried.'
      const r = await api.jobs.again(job.id)
      if (!r.ok) return r.message
      upsertReal(r.job)
      return null
    }
    enqueueSimulated({ source: job.source, spec: job.spec, output: job.output })
    return null
  },
  /** Recycle Bin + remove from Library and History. */
  deleteDownload: async (id: string): Promise<'ok' | 'missing' | 'failed'> => {
    const r = await api.jobs.deleteDownload(id)
    if (r !== 'failed') jobsStore.set((list) => list.filter((j) => j.id !== id))
    return r
  },
  /** Opens Explorer at the saved file. Returns false if the file is gone. */
  reveal: async (id: string): Promise<boolean> => (await api.jobs.reveal(id)) === 'ok',
  /** New order for the waiting jobs (ids in display order). */
  reorderWaiting: (ids: string[]) => {
    jobsStore.set((list) => {
      const waiting = ids.map((id) => list.find((j) => j.id === id)).filter(Boolean) as UiJob[]
      const others = list.filter((j) => !ids.includes(j.id))
      return [...others, ...waiting]
    })
    if (isElectron) void api.jobs.reorder(ids)
  }
}

// ---- simulation timer -------------------------------------------------------

const TICK = 500
let timer: number | undefined

function ensureTicking(): void {
  if (timer === undefined) timer = window.setInterval(tick, TICK)
}

function tick(): void {
  const now = Date.now()
  const limit = settingsStore.get().concurrency
  let list = jobsStore.get()
  const running = list.filter((j) => j.simulated && ['downloading', 'merging', 'converting'].includes(j.status)).length
  let free = Math.max(0, limit - running)

  list = list.map((j) => {
    if (!j.simulated) return j // real jobs are driven by the main process
    if (j.status === 'queued' && free > 0) {
      free--
      return { ...j, status: 'downloading', phaseStartedAt: now }
    }
    if (j.status === 'downloading') {
      const secs = j.simSeconds ?? 20
      const step = (100 / secs) * (TICK / 1000) * (0.7 + Math.random() * 0.6)
      const percent = Math.min(100, j.percent + step)
      const size = j.output.sizeBytes ?? 0
      const speedBps = (size / secs) * (0.85 + Math.random() * 0.3)
      if (percent >= 100) {
        const next: JobStatus = j.spec.kind === 'video' ? 'merging' : j.spec.quality.mode === 'original' ? 'completed' : 'converting'
        return next === 'completed'
          ? { ...j, percent: 100, status: next, finishedAt: new Date().toISOString(), speedBps: undefined, etaSec: undefined }
          : { ...j, percent: next === 'converting' ? 0 : 100, status: next, phaseStartedAt: now, speedBps: undefined, etaSec: undefined }
      }
      return { ...j, percent, speedBps, etaSec: ((100 - percent) / 100) * secs }
    }
    if (j.status === 'merging' && now - (j.phaseStartedAt ?? now) > 2200) {
      return { ...j, status: 'completed', finishedAt: new Date().toISOString() }
    }
    if (j.status === 'converting') {
      const percent = Math.min(100, j.percent + 100 / (3000 / TICK))
      return percent >= 100 ? { ...j, percent: 100, status: 'completed', finishedAt: new Date().toISOString() } : { ...j, percent }
    }
    return j
  })

  jobsStore.set(list)
  if (!list.some((j) => j.simulated && ['queued', 'downloading', 'merging', 'converting'].includes(j.status))) {
    window.clearInterval(timer)
    timer = undefined
  }
}
