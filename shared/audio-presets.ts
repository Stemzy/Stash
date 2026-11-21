import type { AudioFormat, AudioQuality } from './types/job'
import type { AudioStream } from './types/media'

// Format -> allowed output settings. Shared by the renderer (to show options)
// and, later, the main process (to validate what it is asked to encode).

export const AUDIO_FORMATS: { id: AudioFormat; label: string; lossless: boolean; ext: string }[] = [
  { id: 'mp3', label: 'MP3', lossless: false, ext: 'mp3' },
  { id: 'm4a', label: 'M4A', lossless: false, ext: 'm4a' },
  { id: 'opus', label: 'Opus', lossless: false, ext: 'opus' },
  { id: 'flac', label: 'FLAC', lossless: true, ext: 'flac' },
  { id: 'wav', label: 'WAV', lossless: true, ext: 'wav' }
]

export const BITRATES: Record<'mp3' | 'm4a' | 'opus', number[]> = {
  mp3: [128, 192, 256, 320],
  m4a: [128, 160, 192, 256],
  opus: [64, 96, 128, 160, 192]
}

export const SAMPLE_RATES: { value: 'source' | 44100 | 48000; label: string }[] = [
  { value: 'source', label: 'Match source' },
  { value: 44100, label: '44.1 kHz' },
  { value: 48000, label: '48 kHz' }
]

export const BIT_DEPTHS: Record<'flac' | 'wav', { value: 16 | 24 | 32; label: string; hint: string }[]> = {
  flac: [
    { value: 16, label: '16-bit', hint: 'Recommended' },
    { value: 24, label: '24-bit', hint: 'For editing' }
  ],
  wav: [
    { value: 16, label: '16-bit', hint: 'Recommended' },
    { value: 24, label: '24-bit', hint: 'For editing' },
    { value: 32, label: '32-bit float', hint: 'For editing' }
  ]
}

const CODEC_FOR_FORMAT: Partial<Record<AudioFormat, string>> = { m4a: 'aac', opus: 'opus', mp3: 'mp3' }

/** "Original (no re-encode)" is offered only when the output codec matches the source codec. */
export function canKeepOriginal(format: AudioFormat, source?: AudioStream): boolean {
  return !!source && CODEC_FOR_FORMAT[format] === source.acodec
}

export function defaultQuality(format: AudioFormat, source?: AudioStream): AudioQuality {
  switch (format) {
    case 'mp3':
      return canKeepOriginal(format, source) ? { mode: 'original' } : { mode: 'bitrate', kbps: 192 }
    case 'm4a':
      return canKeepOriginal(format, source) ? { mode: 'original' } : { mode: 'bitrate', kbps: 192 }
    case 'opus':
      return canKeepOriginal(format, source) ? { mode: 'original' } : { mode: 'bitrate', kbps: 128 }
    case 'flac':
      return { mode: 'pcm', sampleRateHz: 'source', bitDepth: 16, flacLevel: 5 }
    case 'wav':
      return { mode: 'pcm', sampleRateHz: 'source', bitDepth: 16 }
  }
}

/** Keeps a remembered setting only if it is still valid for this format and source. */
export function sanitizeQuality(format: AudioFormat, q: AudioQuality | undefined, source?: AudioStream): AudioQuality {
  if (!q) return defaultQuality(format, source)
  if (format === 'flac' || format === 'wav') {
    if (q.mode !== 'pcm') return defaultQuality(format, source)
    const depthOk = BIT_DEPTHS[format].some((d) => d.value === q.bitDepth)
    return depthOk ? q : { ...q, bitDepth: 16 }
  }
  if (q.mode === 'original') return canKeepOriginal(format, source) ? q : defaultQuality(format, source)
  if (q.mode === 'bitrate' && BITRATES[format].includes(q.kbps)) return q
  return defaultQuality(format, source)
}

/** Rough output size in bytes, for display only. */
export function estimateAudioBytes(format: AudioFormat, q: AudioQuality, durationSec: number, source?: AudioStream): number {
  if (!durationSec) return q.mode === 'original' && source?.sizeBytes ? source.sizeBytes : NaN
  const channels = source?.channels ?? 2
  if (q.mode === 'original') return ((source?.bitrateKbps ?? 128) * 1000 * durationSec) / 8
  if (q.mode === 'bitrate') return (q.kbps * 1000 * durationSec) / 8
  const rate = q.sampleRateHz === 'source' ? source?.sampleRateHz ?? 48000 : q.sampleRateHz
  const pcm = (rate * q.bitDepth * channels * durationSec) / 8
  return format === 'flac' ? pcm * 0.6 : pcm
}
