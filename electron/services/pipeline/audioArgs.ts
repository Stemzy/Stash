// Maps the user's audio format + quality to FFmpeg arguments. Pure: no I/O.
//
// Rules (plan section 6):
// - Stream copy ("Original") only when the downloaded codec already matches the
//   output format, so nothing is re-encoded and nothing is lost.
// - Everything else is encoded. Encoding to a higher bitrate or a lossless
//   container never restores detail the source didn't have; the UI says so.

import type { AudioFormat, AudioQuality } from '../../../shared/types/job'
import { BITRATES, BIT_DEPTHS, sanitizeQuality } from '../../../shared/audio-presets'

export interface ProbedAudio {
  codec?: string // ffprobe codec_name: mp3, aac, opus, vorbis, flac, pcm_s16le…
  sampleRateHz?: number
  channels?: number
  bitrateKbps?: number
  durationSec?: number
}

export interface AudioPlan {
  /** Arguments that go between `-i <input>` and the output path. */
  args: string[]
  ext: string
  /** True when the audio is copied bit-for-bit. */
  copy: boolean
  /** codec_name ffprobe must report on the output. */
  expectCodec: RegExp
  note: string
}

const EXT: Record<AudioFormat, string> = { mp3: 'mp3', m4a: 'm4a', opus: 'opus', flac: 'flac', wav: 'wav' }
const SAME_CODEC: Partial<Record<AudioFormat, string>> = { mp3: 'mp3', m4a: 'aac', opus: 'opus' }

/** Copy is possible when the probed codec is the one the output format holds. */
export function canCopy(format: AudioFormat, probed: ProbedAudio): boolean {
  return !!probed.codec && SAME_CODEC[format] === probed.codec
}

export function buildAudioPlan(
  format: AudioFormat,
  requested: AudioQuality,
  probed: ProbedAudio,
  meta: { title?: string; artist?: string }
): AudioPlan {
  // Never trust the request blindly: snap it to the allowed presets for this format.
  const quality = sanitizeQuality(format, requested, probed.codec ? { formatId: '', acodec: probed.codec } : undefined)
  const tags: string[] = []
  if (meta.title) tags.push('-metadata', `title=${meta.title}`)
  if (meta.artist) tags.push('-metadata', `artist=${meta.artist}`)
  // Drop any video/cover stream; keep only the first audio stream.
  const base = ['-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1', ...tags]

  if (quality.mode === 'original' && canCopy(format, probed)) {
    const extra = format === 'm4a' ? ['-movflags', '+faststart'] : []
    return {
      args: [...base, '-c:a', 'copy', ...extra],
      ext: EXT[format],
      copy: true,
      expectCodec: new RegExp(`^${SAME_CODEC[format]}$`),
      note: 'Saved the original audio without re-encoding.'
    }
  }

  switch (format) {
    case 'mp3':
    case 'm4a':
    case 'opus': {
      // "Original" requested but the codec differs: encode at the closest preset to the source.
      const kbps =
        quality.mode === 'bitrate'
          ? quality.kbps
          : closest(BITRATES[format], probed.bitrateKbps ?? (format === 'opus' ? 128 : 192))
      const enc = format === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', `${kbps}k`]
        : format === 'm4a' ? ['-c:a', 'aac', '-b:a', `${kbps}k`, '-movflags', '+faststart']
        : ['-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on']
      const above = probed.bitrateKbps != null && kbps > probed.bitrateKbps
      return {
        args: [...base, ...enc],
        ext: EXT[format],
        copy: false,
        expectCodec: new RegExp(`^${SAME_CODEC[format]}$`),
        note: above
          ? `Encoded at ${kbps} kbps. The source was about ${probed.bitrateKbps} kbps, so this is larger, not better.`
          : `Encoded at ${kbps} kbps.`
      }
    }
    case 'flac':
    case 'wav': {
      const q = quality.mode === 'pcm' ? quality : { mode: 'pcm' as const, sampleRateHz: 'source' as const, bitDepth: 16 as const }
      const depth = BIT_DEPTHS[format].some((d) => d.value === q.bitDepth) ? q.bitDepth : 16
      const rate = q.sampleRateHz === 'source' ? [] : ['-ar', String(q.sampleRateHz)]
      const enc =
        format === 'flac'
          ? ['-c:a', 'flac', '-compression_level', String(clampInt(q.flacLevel ?? 5, 0, 8)), '-sample_fmt', depth === 16 ? 's16' : 's32', ...(depth === 24 ? ['-bits_per_raw_sample', '24'] : [])]
          : ['-c:a', depth === 16 ? 'pcm_s16le' : depth === 24 ? 'pcm_s24le' : 'pcm_f32le']
      return {
        args: [...base, ...rate, ...enc],
        ext: EXT[format],
        copy: false,
        expectCodec: format === 'flac' ? /^flac$/ : /^pcm_/,
        note: 'Lossless container: keeps the decoded source exactly; it does not restore detail lost in the original.'
      }
    }
  }
}

function closest(list: number[], target: number): number {
  return list.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), list[0]!)
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : 5)))
}
