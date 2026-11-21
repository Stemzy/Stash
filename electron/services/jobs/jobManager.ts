import { app, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { join } from 'node:path'
import type { AudioJobRequest, DownloadJob, VideoJobRequest } from '../../../shared/types/job'
import { JOB_ERROR_TEXT } from '../../../shared/job-errors'
import { log } from '../../lib/log'
import { dropJobTemp, sweepTemp, validateDirectory } from '../../lib/paths'
import { requireTools } from '../binaries/tools'
import { runAudioJob } from '../pipeline/audioJob'
import { runVideoJob } from '../pipeline/videoJob'
import { JobQueue, type JobRecord, type Outcome } from './queue'
import { loadJobs, saveJobs } from './store'
import { copyThumb, deleteThumb, saveThumb } from './thumbs'
import { cleanAudioRequest, cleanVideoRequest, validAudioSpec, validVideoSpec } from './validation'

// Glue between the queue (pure logic), the pipelines, persistence and the UI.
// Jobs live here in the main process; the renderer only gets snapshots.

type Listener = (job: DownloadJob) => void
const listeners = new Set<Listener>()
const lastEmit = new Map<string, number>()
const storeFile = () => join(app.getPath('userData'), 'jobs.json')

export function onJobUpdate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Runs one job: re-checks tools and folder (they may have changed since it was queued). */
async function runJob(rec: JobRecord, signal: AbortSignal, onStep: Parameters<typeof runAudioJob>[4]): Promise<Outcome> {
  if (rec.request.kind === 'recording') return { ok: false, code: 'UNKNOWN', detail: 'recordings are not downloads' }
  const tools = await requireTools(['ytdlp', 'ffmpeg', 'ffprobe'])
  if (!tools) return { ok: false, code: 'TOOLS_MISSING' }
  const directory = await validateDirectory(rec.request.req.directory)
  if (!directory) return { ok: false, code: 'DISK', detail: 'folder missing or not writable' }
  const id = rec.job.id
  return rec.request.kind === 'audio'
    ? runAudioJob(id, { ...rec.request.req, directory }, tools, signal, onStep, rec.resume)
    : runVideoJob(id, { ...rec.request.req, directory }, tools, signal, onStep as never, rec.resume)
}

const queue = new JobQueue({
  run: runJob,
  changed: (job, important) => {
    // Progress goes out ~5 times a second per job; status changes always, and are saved.
    const now = Date.now()
    if (!important && now - (lastEmit.get(job.id) ?? 0) < 200) return
    lastEmit.set(job.id, now)
    listeners.forEach((fn) => fn(job))
    if (important) void saveJobs(storeFile(), queue.records(), queue.concurrency)
  },
  dropTemp: (id) => void dropJobTemp(id),
  log: (msg, ...a) => log.warn(msg, ...a)
})

/** Loads saved jobs and clears temp folders nothing will resume. Call once at startup. */
export async function initJobs(): Promise<void> {
  const saved = await loadJobs(storeFile())
  queue.restore(saved.records, saved.concurrency)
  const keep = new Set(queue.records().filter((r) => r.resume).map((r) => r.job.id))
  const removed = await sweepTemp(keep)
  if (removed) log.info(`removed ${removed} stale temp folder(s)`)
}

export const listJobs = () => queue.list()

/** Path of a finished download, only for jobs this app completed itself. */
export function savedPath(id: string): string | undefined {
  const job = queue.get(id)?.job
  return job?.status === 'completed' ? job.output.path : undefined
}

type Started = { ok: true; job: DownloadJob } | { ok: false; message: string }

function newJob(request: Exclude<JobRecord['request'], { kind: 'recording' }>): JobRecord {
  const r = request.req
  return {
    job: {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      source: { url: r.url, extractor: r.meta.extractor, title: r.meta.title, creator: r.meta.creator, durationSec: r.meta.durationSec },
      spec: r.spec,
      output: { directory: r.directory, filename: r.filename },
      status: 'queued',
      percent: 0,
      simulated: false
    },
    request,
    resume: false,
    attempts: 1
  }
}

async function enqueue(request: Exclude<JobRecord['request'], { kind: 'recording' }>, thumbnail: unknown): Promise<Started> {
  const rec = newJob(request)
  const thumb = await saveThumb(rec.job.id, thumbnail).catch(() => undefined)
  if (thumb) rec.job.source.thumbnailUrl = thumb
  queue.add(rec)
  return { ok: true, job: queue.list().find((j) => j.id === rec.job.id)! }
}

export async function startAudioJob(raw: AudioJobRequest, url: string, thumbnail: unknown): Promise<Started> {
  if (!validAudioSpec(raw.spec)) return { ok: false, message: 'Those audio settings are not supported.' }
  const directory = await validateDirectory(raw.directory)
  if (!directory) return { ok: false, message: JOB_ERROR_TEXT.DISK }
  if (!(await requireTools(['ytdlp', 'ffmpeg', 'ffprobe']))) return { ok: false, message: JOB_ERROR_TEXT.TOOLS_MISSING }
  return enqueue({ kind: 'audio', req: cleanAudioRequest(raw, url, directory) }, thumbnail)
}

export async function startVideoJob(raw: VideoJobRequest, url: string, thumbnail: unknown): Promise<Started> {
  if (!validVideoSpec(raw.spec)) return { ok: false, message: 'Those video settings are not supported.' }
  const directory = await validateDirectory(raw.directory)
  if (!directory) return { ok: false, message: JOB_ERROR_TEXT.DISK }
  if (!(await requireTools(['ytdlp', 'ffmpeg', 'ffprobe']))) return { ok: false, message: JOB_ERROR_TEXT.TOOLS_MISSING }
  return enqueue({ kind: 'video', req: cleanVideoRequest(raw, url, directory) }, thumbnail)
}

/** Completed job: download the same link with the same settings as a new entry. */
export async function downloadAgain(id: string): Promise<Started> {
  const old = queue.get(id)
  if (!old) return { ok: false, message: 'That download is no longer in the list.' }
  if (old.request.kind === 'recording') return { ok: false, message: 'Screen recordings can’t be downloaded again.' }
  const rec = newJob(old.request)
  const thumb = await copyThumb(id, rec.job.id).catch(() => undefined)
  if (thumb) rec.job.source.thumbnailUrl = thumb
  queue.add(rec)
  return { ok: true, job: rec.job }
}

export const jobControl = {
  pause: (id: string) => queue.pause(id),
  resume: (id: string) => queue.resume(id),
  cancel: (id: string) => queue.cancel(id),
  retry: (id: string) => queue.retry(id),
  reorder: (ids: string[]) => {
    queue.reorder(ids)
    void saveJobs(storeFile(), queue.records(), queue.concurrency)
  },
  setConcurrency: (n: number) => {
    queue.setConcurrency(n)
    void saveJobs(storeFile(), queue.records(), queue.concurrency)
  },
  remove: (id: string) => {
    if (queue.remove(id)) {
      void deleteThumb(id)
      void saveJobs(storeFile(), queue.records(), queue.concurrency)
    }
  },
  clearHistory: () => {
    queue.clearFinished().forEach((id) => void deleteThumb(id))
    void saveJobs(storeFile(), queue.records(), queue.concurrency)
  }
}

/**
 * Opens Explorer with the finished file selected. Only paths the app itself
 * saved are used; the renderer can't ask to open an arbitrary path.
 */
export async function revealJob(id: string): Promise<'ok' | 'missing'> {
  const path = queue.get(id)?.job.output.path
  if (!path) return 'missing'
  try {
    if (!(await stat(path)).isFile()) return 'missing'
  } catch {
    return 'missing'
  }
  shell.showItemInFolder(path)
  return 'ok'
}

/**
 * Deletes a finished download everywhere: the file goes to the Recycle Bin
 * (so a mistake can be undone there), and the entry leaves Library and History.
 * Only the path the app itself saved is touched, and only if it is still
 * inside the folder it was saved to.
 */
export async function deleteDownload(id: string): Promise<'ok' | 'missing' | 'failed'> {
  const rec = queue.get(id)
  if (!rec || rec.job.status !== 'completed') return 'failed'
  const path = rec.job.output.path
  let result: 'ok' | 'missing' = 'missing'
  if (path) {
    const inside = resolve(path).startsWith(resolve(rec.job.output.directory) + sep)
    let exists = false
    try {
      exists = (await stat(path)).isFile()
    } catch {
      exists = false
    }
    if (exists) {
      if (!inside) return 'failed'
      try {
        await shell.trashItem(path)
        result = 'ok'
      } catch {
        // The file may still be held open for a moment (e.g. the player just closed): retry once.
        await new Promise((r) => setTimeout(r, 700))
        try {
          await shell.trashItem(path)
          result = 'ok'
        } catch (e) {
          log.warn('delete failed', (e as Error).message)
          return 'failed'
        }
      }
    }
  }
  // File gone (now or before): drop the entry from Library and History too.
  jobControl.remove(id)
  return result
}

/** App quit: pause running jobs (partial downloads are kept) and save everything now. */
export async function shutdownJobs(): Promise<void> {
  queue.shutdown()
  await saveJobs(storeFile(), queue.records(), queue.concurrency, true)
}

