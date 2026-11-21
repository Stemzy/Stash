// What the source offers, mapped from `yt-dlp --dump-single-json`.
// Every field that a site may not report is optional and never guessed.

export interface VideoStream {
  formatId: string
  /** 0 when the site doesn't report a resolution. */
  height: number
  width?: number
  fps?: number
  vcodec: 'h264' | 'vp9' | 'av1' | 'hevc' | string
  ext?: string
  sizeBytes?: number
  /** Size is an estimate from yt-dlp (filesize_approx). */
  sizeApprox?: boolean
  hdr?: boolean
  /** Progressive stream that already carries audio (no merge needed). */
  hasAudio?: boolean
  /** Another stream at the same height that fits MP4 without re-encoding (H.264, or an .mp4 file). */
  mp4Alt?: { formatId: string; vcodec: string; fps?: number; sizeBytes?: number }
}

export interface AudioStream {
  formatId: string
  acodec: 'opus' | 'aac' | 'mp3' | 'vorbis' | 'flac' | string
  ext?: string
  bitrateKbps?: number // undefined = not reported
  sampleRateHz?: number
  channels?: number
  language?: string
  sizeBytes?: number
  /** Audio lives inside a combined video+audio stream (some sites have no audio-only stream). */
  fromMuxed?: boolean
}

export interface MediaInfo {
  id: string
  url: string // canonical page URL when reported, else the pasted URL
  extractor: string // display name of the source site
  title: string
  creator?: string
  durationSec?: number
  /** Thumbnail as a data: URL, fetched by the main process (the renderer never contacts third-party hosts). */
  thumbnailUrl?: string
  isLive?: boolean
  videoStreams: VideoStream[]
  audioStreams: AudioStream[]
}

export type MediaErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_SITE'
  | 'DRM_PROTECTED'
  | 'AUTH_REQUIRED'
  | 'UNAVAILABLE'
  | 'NETWORK'
  | 'EXTRACTOR_OUTDATED'
  | 'PLAYLIST'
  | 'LIVE'
  | 'NO_MEDIA'
  | 'TOOLS_MISSING'
  | 'ENCRYPTED'
  | 'CANCELED'
  | 'UNKNOWN'

export interface MediaError {
  code: MediaErrorCode
  /** Last few lines from the tool, for the log only (never shown raw to the user). */
  detail?: string
}

export type AnalyzeResult = { ok: true; media: MediaInfo } | { ok: false; error: MediaError }

export interface ToolStatus {
  name: 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'deno'
  path?: string
  version?: string
  ok: boolean
  /** Deno is optional: without it YouTube support in yt-dlp is limited. */
  optional?: boolean
}

/** Live status of the media-tool updater (yt-dlp, Deno, FFmpeg), pushed to the window. */
export type ToolUpdateProgress =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading' | 'installing'; label: string; version: string; index: number; count: number; fraction: number }
  | { phase: 'done'; updated: string[]; error?: string }

export interface ToolUpdateState {
  /** null = never asked yet (show the one-time prompt). */
  auto: boolean | null
  lastCheck?: number
  progress: ToolUpdateProgress
  last?: { at: number; updated: string[]; error?: string; checkError?: string }
}
