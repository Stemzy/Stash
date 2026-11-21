// Turns yt-dlp's JSON into our MediaInfo. Pure function: no Electron, no I/O,
// so it can be tested with saved JSON. Anything a site doesn't report stays
// undefined instead of being guessed.

import type { AudioStream, MediaInfo, VideoStream } from '../../../shared/types/media'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>

const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) && v > 0 ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export function normalizeVcodec(v?: string): string | undefined {
  if (!v || v === 'none') return undefined
  const c = v.toLowerCase()
  if (c.startsWith('avc') || c.startsWith('h264')) return 'h264'
  if (c.startsWith('vp09') || c.startsWith('vp9')) return 'vp9'
  if (c.startsWith('av01') || c === 'av1') return 'av1'
  if (c.startsWith('hev') || c.startsWith('hvc') || c.startsWith('h265')) return 'hevc'
  return c.split('.')[0]
}

export function normalizeAcodec(a?: string): string | undefined {
  if (!a || a === 'none') return undefined
  const c = a.toLowerCase()
  if (c.startsWith('mp4a') || c === 'aac') return 'aac'
  if (c.startsWith('opus')) return 'opus'
  if (c === 'mp3' || c.startsWith('mp4a.40.34') || c === 'mpga') return 'mp3'
  if (c.startsWith('vorbis')) return 'vorbis'
  if (c.startsWith('flac')) return 'flac'
  return c.split('.')[0]
}

/** Prefer a JPEG around 480–1280px wide; fall back to the main thumbnail. */
export function pickThumbnail(j: Json): string | undefined {
  const list: Json[] = Array.isArray(j.thumbnails) ? j.thumbnails : []
  const ok = list.filter((t) => typeof t?.url === 'string' && /^https?:\/\//.test(t.url))
  const sized = ok
    .filter((t) => num(t.width) && t.width >= 320 && t.width <= 1280)
    .sort((a, b) => {
      const ja = /\.jpe?g(\?|$)/i.test(a.url) ? 1 : 0
      const jb = /\.jpe?g(\?|$)/i.test(b.url) ? 1 : 0
      return jb - ja || b.width - a.width
    })
  return sized[0]?.url ?? (str(j.thumbnail) && /^https?:\/\//.test(j.thumbnail) ? j.thumbnail : undefined) ?? ok.at(-1)?.url
}

const AUDIO_EXT = /^(mp3|m4a|opus|ogg|oga|flac|wav|aac|weba)$/i
const VIDEO_EXT = /^(mp4|webm|mkv|mov|m4v|flv|avi|ts|3gp)$/i

/** Audio-only: either declared (vcodec "none") or an audio file with no codec info. */
export function isAudioOnlyFormat(f: Json): boolean {
  if (f.vcodec === 'none') return !!f.acodec && f.acodec !== 'none'
  if (f.vcodec !== undefined) return false
  if (num(f.height) || (f.video_ext && f.video_ext !== 'none')) return false
  return (f.audio_ext && f.audio_ext !== 'none') || AUDIO_EXT.test(f.ext ?? '')
}

/** Has a picture: a known video codec, a height, or a video file with no codec info. */
export function isVideoFormat(f: Json): boolean {
  if (f.vcodec === 'none') return false
  if (normalizeVcodec(f.vcodec)) return true
  if (num(f.height)) return true
  if (f.vcodec === undefined && !isAudioOnlyFormat(f)) return VIDEO_EXT.test(f.ext ?? '') || (f.video_ext && f.video_ext !== 'none')
  return false
}

const sizeOf = (f: Json): { sizeBytes?: number; sizeApprox?: boolean } => {
  const exact = num(f.filesize)
  if (exact) return { sizeBytes: exact }
  const approx = num(f.filesize_approx)
  return approx ? { sizeBytes: approx, sizeApprox: true } : {}
}

/** Quality score used to pick one stream per resolution. */
const videoScore = (f: Json) => (num(f.fps) ?? 30) * 1000 + (num(f.tbr) ?? num(f.vbr) ?? 0)

export function mapInfo(j: Json, pastedUrl: string): MediaInfo {
  const formats: Json[] = (Array.isArray(j.formats) ? j.formats : [j])
    .filter((f) => f && typeof f === 'object' && !f.has_drm && f.format_note !== 'storyboard' && f.ext !== 'mhtml')
    // yt-dlp writes null for unknown fields; treat null exactly like "not reported".
    .map((f) => Object.fromEntries(Object.entries(f as Json).filter(([, v]) => v !== null)))

  // ---- video: one entry per height (best one), remembering an H.264 option ----
  const byHeight = new Map<number, Json[]>()
  for (const f of formats.filter(isVideoFormat)) {
    const h = num(f.height) ?? 0
    const list = byHeight.get(h) ?? []
    list.push(f)
    byHeight.set(h, list)
  }

  const videoStreams: VideoStream[] = []
  for (const [height, list] of byHeight) {
    const best = [...list].sort((a, b) => videoScore(b) - videoScore(a))[0]!
    // A stream that fits MP4 without re-encoding: H.264, or a site's own .mp4 file with unknown codecs.
    const mp4ok = (f: Json) => normalizeVcodec(f.vcodec) === 'h264' || (!normalizeVcodec(f.vcodec) && f.ext === 'mp4')
    const h264 = list.filter(mp4ok).sort((a, b) => videoScore(b) - videoScore(a))[0]
    const vcodec = normalizeVcodec(best.vcodec) ?? 'unknown'
    videoStreams.push({
      formatId: String(best.format_id ?? 'best'),
      height,
      width: num(best.width),
      fps: num(best.fps) ? Math.round(best.fps) : undefined,
      vcodec,
      ext: str(best.ext),
      ...sizeOf(best),
      hdr: typeof best.dynamic_range === 'string' && best.dynamic_range !== 'SDR',
      hasAudio: !!normalizeAcodec(best.acodec),
      mp4Alt:
        h264 && h264 !== best && !mp4ok(best)
          ? { formatId: String(h264.format_id), vcodec: normalizeVcodec(h264.vcodec) ?? 'unknown', fps: num(h264.fps) ? Math.round(h264.fps) : undefined, sizeBytes: sizeOf(h264).sizeBytes }
          : undefined
    })
  }
  videoStreams.sort((a, b) => b.height - a.height)

  // ---- audio: audio-only streams; fall back to the audio inside muxed streams ----
  const toAudio = (f: Json, fromMuxed: boolean): AudioStream => ({
    formatId: String(f.format_id ?? 'bestaudio'),
    acodec: normalizeAcodec(f.acodec) ?? 'unknown',
    ext: str(f.audio_ext !== 'none' ? f.audio_ext : undefined) ?? str(f.ext),
    bitrateKbps: num(f.abr) ? Math.round(f.abr) : fromMuxed ? undefined : num(f.tbr) ? Math.round(f.tbr) : undefined,
    sampleRateHz: num(f.asr),
    channels: num(f.audio_channels),
    language: str(f.language),
    ...(fromMuxed ? {} : { sizeBytes: sizeOf(f).sizeBytes }),
    ...(fromMuxed ? { fromMuxed: true } : {})
  })

  let audioStreams = formats.filter(isAudioOnlyFormat).map((f) => toAudio(f, false))
  // Some sites only offer combined streams: describe the audio inside them.
  if (audioStreams.length === 0) {
    audioStreams = formats.filter((f) => isVideoFormat(f) && f.acodec !== 'none').map((f) => toAudio(f, true))
  }
  // Best first; streams with unknown bitrate after known ones. Keep one per (codec, language).
  audioStreams.sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0))
  const seen = new Set<string>()
  audioStreams = audioStreams.filter((a) => {
    const k = `${a.acodec}|${a.language ?? ''}|${a.fromMuxed ? 'm' : ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return {
    id: String(j.id ?? ''),
    url: str(j.webpage_url) ?? pastedUrl,
    extractor: siteName(str(j.extractor_key) ?? str(j.extractor)),
    title: str(j.title) ?? str(j.fulltitle) ?? 'Untitled',
    creator: str(j.uploader) ?? str(j.channel) ?? str(j.artist) ?? str(j.creator),
    durationSec: num(j.duration),
    isLive: j.is_live === true || j.live_status === 'is_live',
    videoStreams,
    audioStreams
  }
}

/** True when every format was DRM-protected (we never try to work around DRM). */
export function allFormatsDrm(j: Json): boolean {
  const f: Json[] = Array.isArray(j.formats) ? j.formats : []
  return f.length > 0 && f.every((x) => x?.has_drm)
}

const SITE_NAMES: Record<string, string> = {
  youtube: 'YouTube',
  youtubetab: 'YouTube',
  soundcloud: 'SoundCloud',
  vimeo: 'Vimeo',
  bandcamp: 'Bandcamp',
  twitch: 'Twitch',
  twitchvod: 'Twitch',
  twitchclips: 'Twitch',
  tiktok: 'TikTok',
  twitter: 'X',
  instagram: 'Instagram',
  reddit: 'Reddit',
  dailymotion: 'Dailymotion',
  facebook: 'Facebook',
  generic: 'Website',
  html5mediaembed: 'Website'
}

export function siteName(key?: string): string {
  if (!key) return 'Website'
  return SITE_NAMES[key.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? key
}
