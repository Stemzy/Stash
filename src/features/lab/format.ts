import type { LabAudioInfo } from '@shared/types/lab'
import { formatBytes } from '@/shared/lib/format'

/** 1:05.250 (millisecond precision for editing), or 1:05 when `ms` is false. */
export function formatTime(sec: number, ms = false): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return ms ? `${m}:${s.toFixed(3).padStart(6, '0')}` : `${m}:${String(Math.floor(s)).padStart(2, '0')}`
}

const CODEC: Record<string, string> = { mp3: 'MP3', aac: 'AAC', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', alac: 'ALAC', wmav2: 'WMA', ac3: 'AC-3', eac3: 'E-AC-3' }

/** Compact technical facts: "WAV · 24-bit · 48 kHz · Stereo · 12.4 MB". Only what's actually known. */
export function infoParts(i: LabAudioInfo): string[] {
  const codec = i.codec ? (CODEC[i.codec] ?? (i.codec.startsWith('pcm_') ? 'PCM' : i.codec.toUpperCase())) : undefined
  const format = codec && codec !== i.container && !(i.container === 'WAV' && codec === 'PCM') ? `${i.container} (${codec})` : i.container
  return [
    format,
    i.bitDepth ? `${i.bitDepth}-bit${i.floatSamples ? ' float' : ''}` : undefined,
    i.sampleRateHz ? `${+(i.sampleRateHz / 1000).toFixed(1)} kHz` : undefined,
    i.channels ? (i.channels === 1 ? 'Mono' : i.channels === 2 ? 'Stereo' : `${i.channels} ch`) : undefined,
    i.bitrateKbps ? `${i.bitrateKbps} kbps` : undefined,
    formatBytes(i.sizeBytes)
  ].filter((x): x is string => !!x)
}
