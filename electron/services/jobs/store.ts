import { readFile, rename, writeFile } from 'node:fs/promises'
import type { JobRecord } from './queue'

// Saves the queue and history to one JSON file in the app's data folder.
// Written atomically (temp file + rename) so a crash never leaves it half-written.

const VERSION = 1
const MAX_FINISHED = 300

interface Saved {
  version: number
  concurrency: number
  records: JobRecord[]
}

export async function loadJobs(file: string): Promise<{ records: JobRecord[]; concurrency?: number }> {
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as Saved
    if (data.version !== VERSION || !Array.isArray(data.records)) return { records: [] }
    const ok = data.records.filter(
      (r) => r && r.job && typeof r.job.id === 'string' && /^[0-9a-f-]{36}$/.test(r.job.id) && r.request && (r.request.kind === 'audio' || r.request.kind === 'video' || r.request.kind === 'recording')
    )
    return { records: ok, concurrency: data.concurrency }
  } catch {
    return { records: [] }
  }
}

let timer: NodeJS.Timeout | undefined
let pending: (() => Promise<void>) | undefined

/** Debounced save; `flush` writes immediately (used on quit). */
export function saveJobs(file: string, records: JobRecord[], concurrency: number, flush = false): Promise<void> {
  // Keep every unfinished job, and the newest finished ones.
  const finished = records.filter((r) => ['completed', 'failed', 'canceled'].includes(r.job.status))
  const drop = new Set(finished.slice(0, Math.max(0, finished.length - MAX_FINISHED)).map((r) => r.job.id))
  const data: Saved = {
    version: VERSION,
    concurrency,
    // Progress numbers are not worth saving; status, paths and requests are.
    records: records.filter((r) => !drop.has(r.job.id)).map((r) => ({ ...r, job: { ...r.job, speedBps: undefined, etaSec: undefined } }))
  }
  pending = async () => {
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(data), 'utf8')
    await rename(tmp, file)
  }
  if (timer) clearTimeout(timer)
  if (flush) {
    const p = pending
    pending = undefined
    return p().catch(() => undefined)
  }
  timer = setTimeout(() => {
    const p = pending
    pending = undefined
    void p?.().catch(() => undefined)
  }, 400)
  return Promise.resolve()
}
