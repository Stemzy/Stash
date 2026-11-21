import type { AnalyzeResult } from '../../../shared/types/media'
import type { ToolPaths } from '../binaries/binaries'
import { run } from '../runner/runner'
import { allFormatsDrm, mapInfo, pickThumbnail } from './mapInfo'
import { classifyError, errorDetail } from './classifyError'
import { enrichDirectFormats } from './probe'

/** Options every yt-dlp call shares: ignore the user's own yt-dlp config, use our tools. */
export function baseArgs(tools: ToolPaths): string[] {
  const args = ['--ignore-config', '--no-warnings', '--socket-timeout', '20']
  if (tools.ffmpeg) args.push('--ffmpeg-location', tools.ffmpeg)
  if (tools.deno) args.push('--js-runtimes', `deno:${tools.deno}`)
  return args
}

export interface AnalyzeOutput {
  result: AnalyzeResult
  /** Remote thumbnail URL; the caller fetches it so this file stays I/O-light. */
  thumbnailSource?: string
}

/**
 * Runs `yt-dlp --dump-single-json` for ONE item (no playlists) and maps it.
 * The URL is passed after `--`, so it can never be read as an option.
 */
export async function analyze(url: string, tools: ToolPaths, signal: AbortSignal): Promise<AnalyzeOutput> {
  const args = [
    ...baseArgs(tools),
    '--no-playlist',
    '--flat-playlist',
    '--skip-download',
    '--dump-single-json',
    // A site that doesn't answer shouldn't be retried for minutes: one retry, then give up.
    '--extractor-retries',
    '1',
    '--',
    url
  ]
  const r = await run(tools.ytdlp!, args, { signal, timeoutMs: 45_000 })

  if (r.aborted) return { result: { ok: false, error: { code: 'CANCELED' } } }
  if (r.timedOut) return { result: { ok: false, error: { code: 'NETWORK', detail: 'timed out' } } }
  if (r.code !== 0) {
    return { result: { ok: false, error: { code: classifyError(r.stderrTail), detail: errorDetail(r.stderrTail) } } }
  }

  let json: Record<string, unknown>
  try {
    json = JSON.parse(r.stdout) as Record<string, unknown>
  } catch {
    return { result: { ok: false, error: { code: 'EXTRACTOR_OUTDATED', detail: 'invalid JSON from yt-dlp' } } }
  }

  if (json._type === 'playlist' || json._type === 'multi_video') return { result: { ok: false, error: { code: 'PLAYLIST' } } }
  if (allFormatsDrm(json)) return { result: { ok: false, error: { code: 'DRM_PROTECTED' } } }

  await enrichDirectFormats(json, tools.ffprobe, signal)
  if (signal.aborted) return { result: { ok: false, error: { code: 'CANCELED' } } }
  const media = mapInfo(json, url)
  if (media.isLive) return { result: { ok: false, error: { code: 'LIVE' } } }
  if (media.videoStreams.length === 0 && media.audioStreams.length === 0) {
    return { result: { ok: false, error: { code: 'NO_MEDIA' } } }
  }
  return { result: { ok: true, media }, thumbnailSource: pickThumbnail(json) }
}
