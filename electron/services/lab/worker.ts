// LAB analysis worker (Electron utility process). Decoding and DSP run here so
// the app's main process and window never stall. One job at a time; the last
// decoded file is kept so BPM/Key/waveform don't decode it again.

import type { LabErrorCode } from '../../../shared/types/lab'
import { decodeMono, DecodeError, DECODE_RATE, type Decoding } from './decode'
import { estimateKey, KEY_SAMPLE_RATE } from './dsp/key'
import { estimateTempo } from './dsp/tempo'
import { decimate2 } from './dsp/resample'
import { waveformPeaks } from './dsp/waveform'

export interface WorkerJob {
  type: 'run'
  jobId: string
  /** prepare = overview waveform, key = key estimate, peaks = waveform columns for a zoomed range. */
  task: 'prepare' | 'key' | 'tempo' | 'peaks' | 'pcm'
  range?: { from: number; to: number; columns: number }
  ffmpeg: string
  path: string
  /** Changes whenever the file does (path + size + modified time). */
  identity: string
  durationSec?: number
}
export type WorkerIn = WorkerJob | { type: 'cancel'; jobId: string }
export type WorkerOut =
  | { type: 'progress'; jobId: string; stage: 'decoding' | 'analyzing'; fraction?: number }
  | { type: 'result'; jobId: string; ok: true; value: unknown }
  | { type: 'result'; jobId: string; ok: false; code: LabErrorCode; message?: string }

const port = process.parentPort
const post = (m: WorkerOut) => port.postMessage(m)

let decoded: { identity: string; x: Float32Array } | null = null
let current: { jobId: string; decoding?: Decoding; canceled: boolean } | null = null
let chain = Promise.resolve()

async function signal(job: WorkerJob): Promise<Float32Array> {
  if (decoded?.identity === job.identity) return decoded.x
  decoded = null // free the previous file first
  post({ type: 'progress', jobId: job.jobId, stage: 'decoding', fraction: 0 })
  const d = decodeMono(job.ffmpeg, job.path, job.durationSec, (f) => post({ type: 'progress', jobId: job.jobId, stage: 'decoding', fraction: f }))
  current!.decoding = d
  const x = await d.done
  current!.decoding = undefined
  decoded = { identity: job.identity, x }
  return x
}

async function run(job: WorkerJob): Promise<void> {
  current = { jobId: job.jobId, canceled: false }
  try {
    const x = await signal(job)
    if (current.canceled) throw new DecodeError('CANCELED', 'canceled')
    let value: unknown
    if (job.task === 'prepare') {
      value = waveformPeaks(x, DECODE_RATE)
    } else if (job.task === 'peaks') {
      const { from, to, columns } = job.range!
      const a = Math.max(0, Math.floor(from * DECODE_RATE))
      const b = Math.min(x.length, Math.ceil(to * DECODE_RATE))
      const w = waveformPeaks(x.subarray(a, Math.max(a + 1, b)), DECODE_RATE, columns)
      value = { from: a / DECODE_RATE, to: b / DECODE_RATE, min: w.min, max: w.max }
    } else if (job.task === 'pcm') {
      value = { sampleRate: DECODE_RATE, data: x }
    } else if (job.task === 'tempo') {
      post({ type: 'progress', jobId: job.jobId, stage: 'analyzing', fraction: 0 })
      value = estimateTempo(x, DECODE_RATE, (f) => post({ type: 'progress', jobId: job.jobId, stage: 'analyzing', fraction: f }))
    } else {
      post({ type: 'progress', jobId: job.jobId, stage: 'analyzing', fraction: 0 })
      const y = decimate2(x, DECODE_RATE)
      value = estimateKey(y, KEY_SAMPLE_RATE, (f) => post({ type: 'progress', jobId: job.jobId, stage: 'analyzing', fraction: f }))
    }
    post({ type: 'result', jobId: job.jobId, ok: true, value })
  } catch (e) {
    const code: LabErrorCode = e instanceof DecodeError ? e.code : 'FAILED'
    post({ type: 'result', jobId: job.jobId, ok: false, code, message: (e as Error).message?.slice(0, 300) })
  } finally {
    current = null
  }
}

port.on('message', (e: { data: WorkerIn }) => {
  const m = e.data
  if (m.type === 'cancel') {
    if (current?.jobId === m.jobId) {
      current.canceled = true
      current.decoding?.kill()
    }
    return
  }
  if (m.type === 'run') chain = chain.then(() => run(m))
})
