// LAB: shared shapes for the producer tools. Automatic results and the
// user's own corrections are always kept apart.

export type LabTool = 'key' | 'tempo'

/** Technical facts about the selected file, read with FFprobe. */
export interface LabAudioInfo {
  durationSec?: number
  /** Container, from the file extension ("MP3", "WAV", "MP4"…). */
  container: string
  /** Audio codec as FFprobe names it ("mp3", "pcm_s24le", "flac"…). */
  codec?: string
  sampleRateHz?: number
  channels?: number
  /** Only for lossless/PCM audio, where it is reliably defined. */
  bitDepth?: number
  /** True for 32/64-bit float PCM. */
  floatSamples?: boolean
  bitrateKbps?: number
  sizeBytes: number
  /** The file also has a picture track (a video). Only its sound is used. */
  hasVideo: boolean
}

/** The file every LAB tool works on. `id` is a session token; never a path. */
export interface LabSource {
  id: string
  origin: 'file' | 'library'
  libraryId?: string
  title: string
  creator?: string
  artworkUrl?: string
  /** app-media:// URL for in-app preview. */
  mediaUrl: string
  info: LabAudioInfo
}

/** Min/max per column, for drawing. Values are -1..1. */
export interface WaveformData {
  version: number
  durationSec: number
  min: number[]
  max: number[]
  /** Highest sample level in the decoded analysis signal (0..1+). Mono mix, so a guide, not a meter reading. */
  peak: number
}

export type KeyMode = 'major' | 'minor'

export interface KeyCandidate {
  /** Pitch class of the tonal center, C = 0 … B = 11. */
  tonic: number
  mode: KeyMode
  /** Profile correlation (-1..1). A ranking value, NOT a probability. */
  score: number
}

/** 'section': the key of another part of a track whose key changes. */
export type KeyRelation = 'relative' | 'parallel' | 'dominant' | 'subdominant' | 'section' | 'other'

export interface KeyAlternative extends KeyCandidate {
  relation: KeyRelation
}

/**
 * clear: one key fits clearly better than its neighbours (still an estimate).
 * estimated: plausible, but close alternatives or changes exist.
 * inconclusive: too little tonal information to name a key.
 */
export type KeyStatus = 'clear' | 'estimated' | 'inconclusive'

export type KeyReason =
  | 'silent'
  | 'little-tonal'
  | 'weak-match'
  | 'flat-notes'
  | 'relative-close'
  | 'neighbor-close'
  | 'key-change'
  | 'short'

export interface KeySection {
  startSec: number
  endSec: number
  /** Missing when the section has too little tonal content. */
  key?: KeyCandidate
}

export interface KeyAnalysis {
  version: number
  status: KeyStatus
  reasons: KeyReason[]
  best?: KeyCandidate
  alternatives: KeyAlternative[]
  /** How much each pitch class sounds, C..B, scaled so the strongest is 1. */
  chroma: number[]
  /** Estimated tuning offset from A = 440 Hz, in cents (-50..50). */
  tuningCents: number
  /** Share of the non-silent audio that carried usable tonal content (0..1). */
  tonalShare: number
  sections: KeySection[]
  keyChange: boolean
  analyzedAt: string
}

export interface ConfirmedKey {
  tonic: number
  mode: KeyMode
  spelling: 'sharp' | 'flat'
  confirmedAt: string
}

/** What the user set themselves. Stored apart from the media file; never written into it. */
export interface LabUserMeta {
  key?: ConfirmedKey
  tempo?: ConfirmedTempo
}

export interface LabOpened {
  source: LabSource
  /** Results from an earlier analysis of this exact file (same size and date). */
  cached: { key?: KeyAnalysis; tempo?: TempoAnalysis; waveform?: boolean }
  user: LabUserMeta
}

export type LabTask = 'prepare' | 'key' | 'tempo' | 'preview' | 'export'

export interface LabProgress {
  sourceId: string
  task: LabTask
  stage: 'decoding' | 'analyzing'
  /** 0..1 when known. */
  fraction?: number
}

export type LabErrorCode = 'CANCELED' | 'TOOLS_MISSING' | 'NOT_FOUND' | 'UNSUPPORTED' | 'NO_AUDIO' | 'DECODE_FAILED' | 'TOO_LONG' | 'FAILED'

export type LabResult<T> = { ok: true; value: T; cached?: boolean } | { ok: false; code: LabErrorCode; message?: string }

// ---------- Audio Prep ----------

/** A stretch of the source, in seconds. Converted to exact sample positions at export. */
export interface TrimRegion {
  start: number
  end: number
}

export interface PrepSettings extends TrimRegion {
  /** Linear fades at the edges of the exported selection, in milliseconds. 0 = off. */
  fadeInMs: number
  fadeOutMs: number
  /** Plain gain in dB (no limiting, no compression, no normalization). */
  gainDb: number
}

export type ExportFormat = 'wav' | 'flac' | 'mp3' | 'm4a'
export type ExportPreset = 'producer' | 'hq' | 'mp3' | 'custom'

export interface ExportSettings {
  format: ExportFormat
  /** WAV: 16, 24 or 32 (float). FLAC: 16 or 24. Ignored for MP3/M4A. */
  bitDepth: 16 | 24 | 32
  /** MP3/M4A only. */
  bitrateKbps: 192 | 256 | 320
  sampleRate: 'source' | 44100 | 48000 | 96000
  channels: 'source' | 1 | 2
}

/** Waveform columns for part of the file (zoomed views). */
export interface WaveSlice {
  from: number
  to: number
  min: number[]
  max: number[]
}

/** Highest sample in the selection, in dBFS across all channels (null = digital silence). */
export interface PeakReading {
  peakDb: number | null
}

export interface PreviewRender {
  url: string
  /** Where the preview starts in the source, so its playhead can be drawn on the source timeline. */
  startSec: number
  durationSec: number
}

/** What FFprobe reads back from the exported file. */
export interface ExportDone {
  path: string
  name: string
  output: { durationSec?: number; codec?: string; sampleRateHz?: number; channels?: number; bitDepth?: number; sizeBytes: number }
}

// ---------- Tempo ----------

/**
 * strong: one steady tempo fits clearly (half/double readings are still listed).
 * ambiguous: a half- or double-time reading fits about as well (common: 70 vs 140).
 * uncertain: little steady rhythm, or the tempo moves.
 */
export type TempoStatus = 'strong' | 'ambiguous' | 'uncertain'
export type TempoReason = 'silent' | 'weak-rhythm' | 'half-double' | 'tempo-change' | 'short'

export interface TempoCandidate {
  bpm: number
  /** Relative fit (0..1, best = 1). A ranking value, not a probability. */
  fit: number
  relation: 'best' | 'half' | 'double' | 'other'
}

export interface TempoSection {
  startSec: number
  endSec: number
  bpm?: number
}

export interface TempoAnalysis {
  version: number
  status: TempoStatus
  reasons: TempoReason[]
  /** Refined from the tracked beats (e.g. 128.47). */
  bpm?: number
  candidates: TempoCandidate[]
  /** Tracked beat times in seconds. Beats, not bars: the first one is not claimed to be a downbeat. */
  beats: number[]
  /** A steady grid at `bpm` fitted to the beats: beat k is at gridStart + k·60/bpm. */
  gridStart?: number
  sections: TempoSection[]
  tempoChange: boolean
  analyzedAt: string
}

export interface ConfirmedTempo {
  bpm: number
  /** How the user arrived at it. */
  via: 'auto' | 'tap' | 'manual'
  /** Where the user's grid starts (seconds), if they moved it. */
  gridStart?: number
  confirmedAt: string
}
