import type { MediaErrorCode, MediaInfo } from './media'

export type VideoContainer = 'mp4' | 'mkv'
export type AudioFormat = 'mp3' | 'm4a' | 'opus' | 'flac' | 'wav'

export interface VideoSpec {
  kind: 'video'
  height: number
  container: VideoContainer
}

export type AudioQuality =
  | { mode: 'original' }
  | { mode: 'bitrate'; kbps: number }
  | { mode: 'pcm'; sampleRateHz: 'source' | 44100 | 48000; bitDepth: 16 | 24 | 32; flacLevel?: number }

export interface AudioSpec {
  kind: 'audio'
  format: AudioFormat
  quality: AudioQuality
}

export type JobSpec = VideoSpec | AudioSpec

export type JobStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'converting'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled'

export type JobErrorCode = MediaErrorCode | 'FFMPEG' | 'DISK' | 'OUTPUT_CHECK'

export interface JobError {
  code: JobErrorCode
  /** Plain-language message for the UI. */
  message: string
}

export interface DownloadJob {
  id: string
  createdAt: string
  finishedAt?: string
  source: Pick<MediaInfo, 'url' | 'extractor' | 'title' | 'creator' | 'durationSec' | 'thumbnailUrl'>
  spec: JobSpec
  output: { directory: string; filename: string; sizeBytes?: number; path?: string }
  status: JobStatus
  percent: number
  speedBps?: number
  etaSec?: number
  /** Human note about what happened, e.g. "Saved without re-encoding". */
  note?: string
  error?: JobError
  /** True for jobs that only animate in the UI (video downloads until Milestone 3). */
  simulated: boolean
}

/** What the renderer sends to start a real video job. Everything is re-validated in main. */
export interface VideoJobRequest {
  url: string
  spec: VideoSpec
  /** yt-dlp format ids picked at analysis time (the streams the user saw). */
  videoFormatId?: string
  /** Omitted for progressive streams that already carry audio. */
  audioFormatId?: string
  /** Expected sizes, used only to weight the combined progress bar. */
  expectedBytes?: { video?: number; audio?: number }
  directory: string
  filename: string
  meta: { title: string; creator?: string; durationSec?: number; extractor: string }
}

/** What the renderer sends to start a real audio job. Everything is re-validated in main. */
export interface AudioJobRequest {
  url: string
  /** yt-dlp format id of the source audio the user saw; main falls back to bestaudio. */
  sourceFormatId?: string
  spec: AudioSpec
  directory: string
  /** Without extension; main sanitizes it and adds the right one. */
  filename: string
  meta: { title: string; creator?: string; durationSec?: number; extractor: string }
}
