// The shared download queue for Videos and Music. No Electron imports: the
// runner, persistence and temp cleanup are injected, so this logic is testable.

import type { AudioJobRequest, DownloadJob, JobErrorCode, VideoJobRequest } from '../../../shared/types/job'
import { JOB_ERROR_TEXT } from '../../../shared/job-errors'

export const PAUSE_REASON = 'pause'
const RUNNING: DownloadJob['status'][] = ['downloading', 'merging', 'converting']

/** 'recording' = a screen recording made by an earlier version (Record was removed). Kept so
 *  existing recordings still show in Library; nothing to run or re-download. */
export type JobRequest = { kind: 'audio'; req: AudioJobRequest } | { kind: 'video'; req: VideoJobRequest } | { kind: 'recording' }

export interface JobRecord {
  job: DownloadJob
  request: JobRequest
  /** A partial download exists in the job's temp folder (after Pause or app quit). */
  resume: boolean
  attempts: number
}

export type Outcome = { ok: true; path: string; sizeBytes?: number; note: string } | { ok: false; code: JobErrorCode; detail?: string }
export type Step = { status: DownloadJob['status']; percent: number; speedBps?: number; etaSec?: number; totalBytes?: number }
export type Runner = (rec: JobRecord, signal: AbortSignal, onStep: (s: Step) => void) => Promise<Outcome>

export interface QueueHooks {
  run: Runner
  /** Every job change; `important` = status changed (persist + always deliver). */
  changed: (job: DownloadJob, important: boolean) => void
  /** Temp files of a job that will never resume (canceled while paused, removed). */
  dropTemp: (id: string) => void
  log?: (msg: string, ...a: unknown[]) => void
}

export class JobQueue {
  private recs = new Map<string, JobRecord>()
  /** Display/run order of all jobs; waiting jobs start in this order. */
  private order: string[] = []
  private ctrls = new Map<string, AbortController>()
  private limit = 2

  constructor(private hooks: QueueHooks) {}

  // ---- reading --------------------------------------------------------------

  list(): DownloadJob[] {
    return this.order.map((id) => ({ ...this.recs.get(id)!.job }))
  }

  get(id: string): JobRecord | undefined {
    return this.recs.get(id)
  }

  records(): JobRecord[] {
    return this.order.map((id) => this.recs.get(id)!)
  }

  get concurrency(): number {
    return this.limit
  }

  // ---- changes --------------------------------------------------------------

  setConcurrency(n: number): void {
    if (!Number.isInteger(n) || n < 1 || n > 4) return
    this.limit = n
    this.pump()
  }

  add(rec: JobRecord): void {
    rec.job.status = 'queued'
    this.recs.set(rec.job.id, rec)
    this.order.push(rec.job.id)
    this.emit(rec, true)
    this.pump()
  }

  /** Adds an entry that is already finished (a screen recording) to Library and History. */
  addFinished(rec: JobRecord): void {
    this.recs.set(rec.job.id, rec)
    this.order.push(rec.job.id)
    this.emit(rec, true)
  }

  /** Reload saved jobs. Anything that was running when the app closed becomes paused. */
  restore(saved: JobRecord[], concurrency?: number): void {
    if (concurrency) this.limit = Math.min(4, Math.max(1, concurrency))
    for (const rec of saved) {
      if (this.recs.has(rec.job.id)) continue
      if ([...RUNNING, 'queued'].includes(rec.job.status)) {
        rec.job = { ...rec.job, status: 'paused', speedBps: undefined, etaSec: undefined, note: 'Interrupted when the app closed. Resume to continue.' }
        rec.resume = true
      }
      this.recs.set(rec.job.id, rec)
      this.order.push(rec.job.id)
    }
  }

  pause(id: string): void {
    const rec = this.recs.get(id)
    if (!rec) return
    if (rec.job.status === 'queued') this.set(rec, { status: 'paused' }, true)
    // Only a download can be paused; merging/converting finish quickly.
    else if (rec.job.status === 'downloading') this.ctrls.get(id)?.abort(PAUSE_REASON)
  }

  resume(id: string): void {
    const rec = this.recs.get(id)
    if (rec?.job.status !== 'paused') return
    this.set(rec, { status: 'queued', note: undefined }, true)
    this.pump()
  }

  cancel(id: string): void {
    const rec = this.recs.get(id)
    if (!rec) return
    if (RUNNING.includes(rec.job.status)) return void this.ctrls.get(id)?.abort('cancel')
    if (rec.job.status === 'queued' || rec.job.status === 'paused') {
      if (rec.resume) this.hooks.dropTemp(id)
      rec.resume = false
      this.set(rec, { status: 'canceled', finishedAt: new Date().toISOString(), note: undefined }, true)
    }
  }

  /** Failed or canceled job: run it again as the same history entry. */
  retry(id: string): boolean {
    const rec = this.recs.get(id)
    if (!rec || rec.request.kind === 'recording' || (rec.job.status !== 'failed' && rec.job.status !== 'canceled')) return false
    rec.attempts++
    rec.resume = false
    // Move it to the end of the queue, like a new job.
    this.order = [...this.order.filter((x) => x !== id), id]
    this.set(rec, { status: 'queued', percent: 0, error: undefined, note: undefined, finishedAt: undefined }, true)
    this.pump()
    return true
  }

  /** New order for the waiting (queued/paused) jobs, as shown in the UI. */
  reorder(ids: string[]): void {
    const waiting = new Set(this.order.filter((id) => ['queued', 'paused'].includes(this.recs.get(id)!.job.status)))
    const valid = ids.filter((id) => waiting.has(id))
    if (valid.length !== waiting.size) return
    const others = this.order.filter((id) => !waiting.has(id))
    this.order = [...others, ...valid]
    this.pump()
  }

  /** Removes a finished job from the list (the file on disk is kept). */
  remove(id: string): boolean {
    const rec = this.recs.get(id)
    if (!rec || !['completed', 'failed', 'canceled'].includes(rec.job.status)) return false
    this.recs.delete(id)
    this.order = this.order.filter((x) => x !== id)
    this.hooks.dropTemp(id)
    return true
  }

  clearFinished(): string[] {
    const ids = this.order.filter((id) => ['completed', 'failed', 'canceled'].includes(this.recs.get(id)!.job.status))
    ids.forEach((id) => this.remove(id))
    return ids
  }

  /** App quit: stop every process but keep partial downloads for next time. */
  shutdown(): void {
    this.ctrls.forEach((c) => c.abort(PAUSE_REASON))
  }

  // ---- scheduling -----------------------------------------------------------

  private running(): number {
    return this.order.filter((id) => RUNNING.includes(this.recs.get(id)!.job.status)).length
  }

  private pump(): void {
    let free = this.limit - this.running()
    for (const id of this.order) {
      if (free <= 0) break
      const rec = this.recs.get(id)!
      if (rec.job.status !== 'queued') continue
      free--
      this.start(rec)
    }
  }

  private start(rec: JobRecord): void {
    const id = rec.job.id
    const ctrl = new AbortController()
    this.ctrls.set(id, ctrl)
    this.set(rec, { status: 'downloading', percent: rec.resume ? rec.job.percent : 0, error: undefined }, true)

    this.hooks
      .run(rec, ctrl.signal, (s) => {
        if (ctrl.signal.aborted) return
        const statusChanged = s.status !== rec.job.status
        this.set(rec, {
          status: s.status,
          percent: s.percent,
          speedBps: s.speedBps,
          etaSec: s.etaSec,
          output: { ...rec.job.output, sizeBytes: s.totalBytes ?? rec.job.output.sizeBytes }
        }, statusChanged)
      })
      .catch((e: Error): Outcome => ({ ok: false, code: 'UNKNOWN', detail: e.message }))
      .then((r) => {
        this.ctrls.delete(id)
        const idle = { speedBps: undefined, etaSec: undefined }
        const now = new Date().toISOString()
        if (!this.recs.has(id)) return
        if (ctrl.signal.reason === PAUSE_REASON) {
          rec.resume = true
          this.set(rec, { ...idle, status: 'paused' }, true)
        } else if (r.ok) {
          rec.resume = false
          this.set(rec, { ...idle, status: 'completed', percent: 100, finishedAt: now, note: r.note, output: { ...rec.job.output, path: r.path, sizeBytes: r.sizeBytes } }, true)
        } else if (r.code === 'CANCELED' || ctrl.signal.aborted) {
          rec.resume = false
          this.set(rec, { ...idle, status: 'canceled', finishedAt: now }, true)
        } else {
          rec.resume = false
          this.hooks.log?.(`${rec.job.spec.kind} job failed`, r.code, r.detail)
          this.set(rec, { ...idle, status: 'failed', finishedAt: now, error: { code: r.code, message: JOB_ERROR_TEXT[r.code] } }, true)
        }
        this.pump()
      })
  }

  private set(rec: JobRecord, patch: Partial<DownloadJob>, important: boolean): void {
    rec.job = { ...rec.job, ...patch }
    this.emit(rec, important)
  }

  private emit(rec: JobRecord, important: boolean): void {
    this.hooks.changed({ ...rec.job }, important)
  }
}
