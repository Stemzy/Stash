import type { JobErrorCode, VideoJobRequest } from '../../../shared/types/job'
import type { ToolPaths } from '../binaries/binaries'
import { makeJobTemp, moveInto, removeJobTemp, removeQuietly, reserveUniquePath, fileExt, saveFailure } from '../../lib/paths'
import { JobFailure, PAUSE, SAFE_FORMAT_ID, ytdlpFetch } from './audioJob'
import { probeFile } from './probeFile'

export interface VideoStep {
  status: 'downloading' | 'merging'
  percent: number
  speedBps?: number
  etaSec?: number
  totalBytes?: number
}

export type VideoJobOutcome =
  | { ok: true; path: string; sizeBytes?: number; note: string }
  | { ok: false; code: JobErrorCode; detail?: string }

const safe = (id?: string) => (id && SAFE_FORMAT_ID.test(id) ? id : undefined)

/**
 * yt-dlp format selector. First choice: the exact streams the user saw.
 * Fallback (if a stream vanished since analysis): the best streams at or
 * below the chosen height that fit the container without re-encoding.
 */
export function videoSelector(req: Pick<VideoJobRequest, 'spec' | 'videoFormatId' | 'audioFormatId'>): string {
  const v = safe(req.videoFormatId)
  const a = safe(req.audioFormatId)
  const h = Number.isInteger(req.spec.height) && req.spec.height > 0 ? `[height<=${req.spec.height}]` : ''
  const primary = v && a ? `${v}+${a}` : v
  const fallback =
    req.spec.container === 'mp4'
      ? `bv*${h}[vcodec^=avc1]+ba[ext=m4a]/b${h}[ext=mp4]/bv*${h}+ba/b${h}`
      : `bv*${h}+ba/b${h}`
  return primary ? `${primary}/${fallback}` : fallback
}

/**
 * yt-dlp downloads video and audio one after the other, each with its own
 * 0–100%. This turns that into one bar, weighted by the expected sizes.
 */
export class CombinedProgress {
  private part = 0
  private lastDownloaded = 0
  private lastTotal?: number
  constructor(private weights: number[]) {}

  static fromSizes(parts: number, sizes?: { video?: number; audio?: number }): CombinedProgress {
    if (parts < 2) return new CombinedProgress([1])
    const v = sizes?.video, a = sizes?.audio
    const w = v && a ? [v / (v + a), a / (v + a)] : [0.85, 0.15]
    return new CombinedProgress(w)
  }

  update(downloaded: number, total?: number): number {
    // A new file started: the byte counter went back down or the total changed.
    if (this.part < this.weights.length - 1 && (downloaded < this.lastDownloaded * 0.5 || (total && this.lastTotal && total !== this.lastTotal && downloaded < this.lastDownloaded))) {
      this.part++
    }
    this.lastDownloaded = downloaded
    this.lastTotal = total ?? this.lastTotal
    const done = this.weights.slice(0, this.part).reduce((s, w) => s + w, 0)
    const cur = total ? Math.min(1, downloaded / total) : 0
    return Math.min(99, (done + cur * this.weights[this.part]!) * 100)
  }
}

/**
 * Video pipeline: yt-dlp downloads the chosen video (and audio) streams and has
 * FFmpeg merge them into the chosen container with stream copy (no re-encode).
 * FFprobe checks the result, then it is moved into the user's folder.
 */
export async function runVideoJob(
  jobId: string,
  req: VideoJobRequest & { filename: string; directory: string },
  tools: ToolPaths,
  signal: AbortSignal,
  onStep: (u: VideoStep) => void,
  resume = false
): Promise<VideoJobOutcome> {
  let tmp: string | undefined
  let reserved: string | undefined
  const container = req.spec.container
  try {
    tmp = await makeJobTemp(jobId)
    const parts = safe(req.audioFormatId) ? 2 : 1
    const combined = CombinedProgress.fromSizes(parts, req.expectedBytes)
    let merging = false

    const src = await ytdlpFetch(
      tools,
      req.url,
      videoSelector(req),
      tmp,
      signal,
      (p) => {
        if (merging) return
        onStep({ status: 'downloading', percent: combined.update(p.downloaded ?? 0, p.total), speedBps: p.speedBps, etaSec: p.etaSec, totalBytes: p.total })
      },
      ['--merge-output-format', container, '--remux-video', container],
      (line) => {
        // yt-dlp hands the streams to FFmpeg here; the UI shows "Merging video and audio".
        if (!merging && /^\[(Merger|VideoRemuxer|FixupM3u8|FixupM4a)\]/.test(line)) {
          merging = true
          onStep({ status: 'merging', percent: 100 })
        }
      },
      resume
    )

    // Check the result before it reaches the user's folder.
    const check = await probeFile(tools.ffprobe!, src, signal)
    if (signal.aborted) throw new JobFailure('CANCELED')
    if (!check?.video) throw new JobFailure('OUTPUT_CHECK', 'no video stream')
    if (parts === 2 && !check.audio) throw new JobFailure('OUTPUT_CHECK', 'audio missing after merge')
    if (fileExt(src) !== container) throw new JobFailure('OUTPUT_CHECK', `got .${fileExt(src)}`)
    const duration = req.meta.durationSec
    if (duration && check.durationSec && Math.abs(check.durationSec - duration) > Math.max(3, duration * 0.03)) {
      throw new JobFailure('OUTPUT_CHECK', `duration ${check.durationSec} vs ${duration}`)
    }

    reserved = await reserveUniquePath(req.directory, req.filename, container)
    await moveInto(src, reserved)
    const finalPath = reserved
    reserved = undefined
    const res = check.video.height ? `${check.video.height}p ` : ''
    return {
      ok: true,
      path: finalPath,
      sizeBytes: check.sizeBytes,
      note: `Saved ${res}${container.toUpperCase()}${parts === 2 ? ', video and audio merged without re-encoding' : ''}.`
    }
  } catch (e) {
    await removeQuietly(reserved)
    if (e instanceof JobFailure) return { ok: false, code: e.code, detail: e.detail }
    const err = e as NodeJS.ErrnoException
    const problem = await saveFailure(err, req.directory)
    if (problem) return { ok: false, code: problem, detail: err.code }
    return { ok: false, code: 'UNKNOWN', detail: err.message }
  } finally {
    if (signal.reason !== PAUSE) await removeJobTemp(tmp)
  }
}
