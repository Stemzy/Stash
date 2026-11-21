import type { AudioJobRequest, AudioQuality, AudioSpec, VideoJobRequest, VideoSpec } from '../../../shared/types/job'
import { AUDIO_FORMATS, BITRATES, BIT_DEPTHS } from '../../../shared/audio-presets'
import { sanitizeFilename } from '../../lib/paths'

/** Shape check for the requested quality; values must be presets the UI offers. */
export function validAudioSpec(spec: unknown): spec is AudioSpec {
  const s = spec as AudioSpec
  if (!s || s.kind !== 'audio' || !AUDIO_FORMATS.some((f) => f.id === s.format)) return false
  const q = s.quality as AudioQuality
  if (!q || typeof q !== 'object') return false
  const lossless = s.format === 'flac' || s.format === 'wav'
  if (q.mode === 'original') return !lossless
  if (q.mode === 'bitrate') return !lossless && BITRATES[s.format as 'mp3'].includes(q.kbps)
  if (q.mode === 'pcm') {
    if (!lossless) return false
    if (!['source', 44100, 48000].includes(q.sampleRateHz as never)) return false
    if (!BIT_DEPTHS[s.format as 'flac'].some((d) => d.value === q.bitDepth)) return false
    return q.flacLevel === undefined || (Number.isInteger(q.flacLevel) && q.flacLevel >= 0 && q.flacLevel <= 8)
  }
  return false
}

/** Height must be a real resolution (0 = "Original" when the site reports none). */
export function validVideoSpec(spec: unknown): spec is VideoSpec {
  const s = spec as VideoSpec
  return !!s && s.kind === 'video' && Number.isInteger(s.height) && s.height >= 0 && s.height <= 8640 && (s.container === 'mp4' || s.container === 'mkv')
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const num = (v: unknown) => (typeof v === 'number' && v > 0 && isFinite(v) ? v : undefined)

export function cleanMeta(m: unknown): AudioJobRequest['meta'] {
  const x = (m ?? {}) as Record<string, unknown>
  return {
    title: str(x.title) ?? 'Untitled',
    creator: str(x.creator),
    durationSec: num(x.durationSec),
    extractor: str(x.extractor, 60) ?? 'Website'
  }
}

/** Rebuilds an audio request from known fields only (nothing extra from the renderer survives). */
export function cleanAudioRequest(raw: AudioJobRequest, url: string, directory: string): AudioJobRequest {
  const meta = cleanMeta(raw.meta)
  return {
    url,
    sourceFormatId: str(raw.sourceFormatId, 64),
    spec: { kind: 'audio', format: raw.spec.format, quality: raw.spec.quality },
    directory,
    filename: sanitizeFilename(raw.filename, sanitizeFilename(meta.title, 'audio')),
    meta
  }
}

export function cleanVideoRequest(raw: VideoJobRequest, url: string, directory: string): VideoJobRequest {
  const meta = cleanMeta(raw.meta)
  return {
    url,
    spec: { kind: 'video', height: raw.spec.height, container: raw.spec.container },
    videoFormatId: str(raw.videoFormatId, 64),
    audioFormatId: str(raw.audioFormatId, 64),
    expectedBytes: { video: num(raw.expectedBytes?.video), audio: num(raw.expectedBytes?.audio) },
    directory,
    filename: sanitizeFilename(raw.filename, sanitizeFilename(meta.title, 'video')),
    meta
  }
}
