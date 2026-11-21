import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioJobRequest, JobErrorCode } from '../../../shared/types/job'
import type { ToolPaths } from '../binaries/binaries'
import { baseArgs } from '../extractor/extractor'
import { classifyError, errorDetail } from '../extractor/classifyError'
import { run } from '../runner/runner'
import { makeJobTemp, moveInto, removeJobTemp, removeQuietly, reserveUniquePath } from '../../lib/paths'
import { buildAudioPlan } from './audioArgs'
import { parseFfmpegProgress, parseYtdlpProgress, YTDLP_PROGRESS_TEMPLATE } from './progress'
import { probeFile } from './probeFile'

export interface StepUpdate {
  status: 'downloading' | 'converting'
  percent: number
  speedBps?: number
  etaSec?: number
  totalBytes?: number
}

export type AudioJobOutcome =
  | { ok: true; path: string; sizeBytes?: number; note: string }
  | { ok: false; code: JobErrorCode; detail?: string }

export class JobFailure extends Error {
  constructor(public code: JobErrorCode, public detail?: string) {
    super(code)
  }
}

/** Abort reason used for Pause (and app quit): stop the process but keep temp files. */
export const PAUSE = 'pause'

export const SAFE_FORMAT_ID = /^[A-Za-z0-9._+-]{1,64}$/

/** yt-dlp format selector: the stream the user saw, falling back to best audio. */
export function audioSelector(sourceFormatId?: string): string {
  return sourceFormatId && SAFE_FORMAT_ID.test(sourceFormatId) ? `${sourceFormatId}/bestaudio/best` : 'bestaudio/best'
}

/** Downloads one format into `tmp` with yt-dlp and reports byte progress. */
export async function ytdlpFetch(
  tools: ToolPaths,
  url: string,
  selector: string,
  tmp: string,
  signal: AbortSignal,
  onProgress: (p: { percent?: number; speedBps?: number; etaSec?: number; total?: number; downloaded?: number }) => void,
  extra: string[] = [],
  onLine?: (line: string) => void,
  resume = false
): Promise<string> {
  const args = [
    ...baseArgs(tools),
    '--no-playlist',
    '--no-mtime',
    // Resume a paused job's partial download; otherwise start clean.
    resume ? '--continue' : '--no-continue',
    '--newline',
    '--progress',
    '--progress-template', YTDLP_PROGRESS_TEMPLATE,
    '-f', selector,
    ...extra,
    '-P', tmp,
    '-o', 'source.%(ext)s',
    '--',
    url
  ]
  const r = await run(tools.ytdlp!, args, {
    signal,
    onStdoutLine: (l) => {
      const p = parseYtdlpProgress(l)
      if (p) onProgress({ percent: p.percent, speedBps: p.speedBps, etaSec: p.etaSec, total: p.total, downloaded: p.downloaded })
      else onLine?.(l)
    }
  })
  if (r.aborted) throw new JobFailure('CANCELED')
  if (r.code !== 0) {
    const code = classifyError(r.stderrTail)
    // yt-dlp reports FFmpeg merge/remux failures as "Postprocessing" errors.
    const ff = code === 'UNKNOWN' && /Postprocessing|Conversion failed|ffmpeg/i.test(r.stderrTail.join('\n'))
    throw new JobFailure(ff ? 'FFMPEG' : code, errorDetail(r.stderrTail))
  }
  const files = (await readdir(tmp)).filter((f) => f.startsWith('source.') && !/\.(part|ytdl|temp)$/.test(f))
  if (files.length === 0) throw new JobFailure('NO_MEDIA', 'yt-dlp produced no file')
  return join(tmp, files[0]!)
}

/**
 * Audio pipeline: yt-dlp downloads the chosen source stream, FFprobe reads what
 * actually arrived, FFmpeg copies or encodes it, FFprobe checks the result, and
 * only then is the file moved into the user's folder under a free name.
 */
export async function runAudioJob(
  jobId: string,
  req: AudioJobRequest & { filename: string; directory: string },
  tools: ToolPaths,
  signal: AbortSignal,
  onStep: (u: StepUpdate) => void,
  resume = false
): Promise<AudioJobOutcome> {
  let tmp: string | undefined
  let reserved: string | undefined
  try {
    tmp = await makeJobTemp(jobId)

    // 1. Download the source audio.
    const src = await ytdlpFetch(
      tools,
      req.url,
      audioSelector(req.sourceFormatId),
      tmp,
      signal,
      (p) => onStep({ status: 'downloading', percent: p.percent ?? 0, speedBps: p.speedBps, etaSec: p.etaSec, totalBytes: p.total }),
      [],
      undefined,
      resume
    )

    // 2. See what we really got (codec, bitrate, duration).
    const probed = await probeFile(tools.ffprobe!, src, signal)
    if (signal.aborted) throw new JobFailure('CANCELED')
    if (!probed?.audio) throw new JobFailure('NO_MEDIA', 'no audio stream in download')

    // 3. Copy or encode.
    const plan = buildAudioPlan(req.spec.format, req.spec.quality, probed.audio, { title: req.meta.title, artist: req.meta.creator })
    const out = join(tmp, `output.${plan.ext}`)
    const duration = probed.durationSec ?? req.meta.durationSec
    onStep({ status: 'converting', percent: 0 })
    const ff = await run(
      tools.ffmpeg!,
      ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', `file:${src}`, ...plan.args, '-progress', 'pipe:1', '-nostats', `file:${out}`],
      {
        signal,
        onStdoutLine: (l) => {
          const p = parseFfmpegProgress(l)
          if (p?.outSec != null && duration) onStep({ status: 'converting', percent: Math.min(99, (p.outSec / duration) * 100) })
        }
      }
    )
    if (ff.aborted) throw new JobFailure('CANCELED')
    if (ff.code !== 0) {
      const text = ff.stderrTail.join('\n')
      throw new JobFailure(/No space left|Permission denied/i.test(text) ? 'DISK' : 'FFMPEG', ff.stderrTail.slice(-2).join(' | '))
    }

    // 4. Check the result before it reaches the user's folder.
    const check = await probeFile(tools.ffprobe!, out, signal)
    if (!check?.audio || !plan.expectCodec.test(check.audio.codec ?? '')) throw new JobFailure('OUTPUT_CHECK', `codec ${check?.audio?.codec}`)
    if (duration && check.durationSec && Math.abs(check.durationSec - duration) > Math.max(2, duration * 0.02)) {
      throw new JobFailure('OUTPUT_CHECK', `duration ${check.durationSec} vs ${duration}`)
    }

    // 5. Move into place under a collision-free name.
    reserved = await reserveUniquePath(req.directory, req.filename, plan.ext)
    await moveInto(out, reserved)
    const finalPath = reserved
    reserved = undefined
    onStep({ status: 'converting', percent: 100 })
    return { ok: true, path: finalPath, sizeBytes: check.sizeBytes, note: plan.note }
  } catch (e) {
    await removeQuietly(reserved)
    if (e instanceof JobFailure) return { ok: false, code: e.code, detail: e.detail }
    const err = e as NodeJS.ErrnoException
    if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'ENOENT'].includes(err.code ?? '')) return { ok: false, code: 'DISK', detail: err.code }
    return { ok: false, code: 'UNKNOWN', detail: err.message }
  } finally {
    // Paused: keep the partial download so Resume can continue it.
    if (signal.reason !== PAUSE) await removeJobTemp(tmp)
  }
}
