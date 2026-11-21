// Audio Prep processing: trim → gain → fades → channels → sample rate → encode.
// Pure Node (no Electron), so it can be tested against real FFmpeg.
//
// Accuracy notes
//   • Trim uses exact sample positions at the SOURCE rate (atrim start_sample/end_sample),
//     computed once here: round(seconds × rate). Nothing depends on the waveform's pixels.
//   • Fades are linear (curve=tri) and given in samples, applied once, inside the selection.
//   • Gain is a plain multiplication (volume filter in double precision). No limiter,
//     no compression, no normalization.
//   • 16-bit output gets triangular dither when converting from the float pipeline.
//   • Every export re-encodes. Nothing here is a stream copy.

import { randomBytes } from 'node:crypto'
import { rename, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { ExportFormat, ExportSettings, PrepSettings } from '../../../shared/types/lab'
import { run } from '../runner/runner'

export const MIN_SELECTION_SEC = 0.01
export const MAX_FADE_MS = 60_000
export const GAIN_RANGE = { min: -48, max: 24 }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Checks and clamps settings from the renderer. null = unusable. */
export function validatePrep(raw: unknown, durationSec: number | undefined): PrepSettings | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  let start = num(r.start)
  let end = num(r.end)
  const fadeInMs = num(r.fadeInMs)
  const fadeOutMs = num(r.fadeOutMs)
  const gainDb = num(r.gainDb)
  if (start == null || end == null || fadeInMs == null || fadeOutMs == null || gainDb == null) return null
  const dur = durationSec && durationSec > 0 ? durationSec : Infinity
  start = Math.max(0, start)
  end = Math.min(dur, end)
  if (end - start < MIN_SELECTION_SEC) return null
  if (gainDb < GAIN_RANGE.min || gainDb > GAIN_RANGE.max) return null
  if (fadeInMs < 0 || fadeOutMs < 0 || fadeInMs > MAX_FADE_MS || fadeOutMs > MAX_FADE_MS) return null
  return { start, end, fadeInMs, fadeOutMs, gainDb }
}

const FORMATS: ExportFormat[] = ['wav', 'flac', 'mp3', 'm4a']
export function validateExport(raw: unknown): ExportSettings | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const format = r.format as ExportFormat
  if (!FORMATS.includes(format)) return null
  const bitDepth = r.bitDepth as ExportSettings['bitDepth']
  if (![16, 24, 32].includes(bitDepth)) return null
  if (format === 'flac' && bitDepth === 32) return null
  const bitrateKbps = r.bitrateKbps as ExportSettings['bitrateKbps']
  if (![192, 256, 320].includes(bitrateKbps)) return null
  const sampleRate = r.sampleRate as ExportSettings['sampleRate']
  if (!['source', 44100, 48000, 96000].includes(sampleRate)) return null
  const channels = r.channels as ExportSettings['channels']
  if (!['source', 1, 2].includes(channels)) return null
  return { format, bitDepth, bitrateKbps, sampleRate, channels }
}

export const EXTENSION: Record<ExportFormat, string> = { wav: 'wav', flac: 'flac', mp3: 'mp3', m4a: 'm4a' }

/** Fades that fit inside the selection: fade-in first, fade-out gets what's left. */
export function effectiveFades(s: PrepSettings): { fadeInMs: number; fadeOutMs: number; clamped: boolean } {
  const len = (s.end - s.start) * 1000
  const fadeInMs = Math.min(s.fadeInMs, len)
  const fadeOutMs = Math.min(s.fadeOutMs, len - fadeInMs)
  return { fadeInMs, fadeOutMs, clamped: fadeInMs !== s.fadeInMs || fadeOutMs !== s.fadeOutMs }
}

/** Exact sample range of the selection at the source rate. */
export function sampleRange(s: Pick<PrepSettings, 'start' | 'end'>, rate: number): { first: number; end: number; count: number } {
  const first = Math.round(s.start * rate)
  const end = Math.round(s.end * rate)
  return { first, end, count: end - first }
}

export type OutputSpec = ExportSettings | 'preview'

/** The FFmpeg filter chain for a selection. */
export function buildFilter(s: PrepSettings, sourceRate: number | undefined, out: OutputSpec, sourceChannels?: number): string {
  const f: string[] = []
  const { fadeInMs, fadeOutMs } = effectiveFades(s)
  if (sourceRate) {
    const r = sampleRange(s, sourceRate)
    f.push(`atrim=start_sample=${r.first}:end_sample=${r.end}`, 'asetpts=PTS-STARTPTS')
  } else {
    f.push(`atrim=start=${s.start.toFixed(6)}:end=${s.end.toFixed(6)}`, 'asetpts=PTS-STARTPTS')
  }
  // Float from here on, so gain and fades never clip mid-chain.
  f.push('aformat=sample_fmts=dbl')
  if (s.gainDb !== 0) f.push(`volume=${s.gainDb.toFixed(2)}dB:precision=double`)
  if (sourceRate) {
    const count = sampleRange(s, sourceRate).count
    const inN = Math.round((fadeInMs / 1000) * sourceRate)
    const outN = Math.round((fadeOutMs / 1000) * sourceRate)
    if (inN > 0) f.push(`afade=t=in:ss=0:ns=${inN}:curve=tri`)
    if (outN > 0) f.push(`afade=t=out:ss=${count - outN}:ns=${outN}:curve=tri`)
  } else {
    const len = s.end - s.start
    if (fadeInMs > 0) f.push(`afade=t=in:st=0:d=${(fadeInMs / 1000).toFixed(6)}:curve=tri`)
    if (fadeOutMs > 0) f.push(`afade=t=out:st=${(len - fadeOutMs / 1000).toFixed(6)}:d=${(fadeOutMs / 1000).toFixed(6)}:curve=tri`)
  }
  const spec = out === 'preview' ? undefined : out
  const ch = spec?.channels === 1 ? 'mono' : spec?.channels === 2 ? 'stereo' : undefined
  if (ch && !(sourceChannels === (ch === 'mono' ? 1 : 2))) f.push(`aformat=channel_layouts=${ch}`)
  const rate = spec && spec.sampleRate !== 'source' && spec.sampleRate !== sourceRate ? spec.sampleRate : undefined
  const sixteen = out === 'preview' || ((spec!.format === 'wav' || spec!.format === 'flac') && spec!.bitDepth === 16)
  const twentyFour = spec && (spec.format === 'wav' || spec.format === 'flac') && spec.bitDepth === 24
  if (rate || sixteen) {
    // The resampler also does the conversion to 16-bit, with triangular dither.
    const opts = [rate ? `osr=${rate}` : '', 'filter_size=64', sixteen ? 'dither_method=triangular' : ''].filter(Boolean).join(':')
    f.push(`aresample=${opts}`)
  }
  if (sixteen) f.push('aformat=sample_fmts=s16')
  else if (twentyFour) f.push('aformat=sample_fmts=s32')
  else if (spec && spec.format === 'wav' && spec.bitDepth === 32) f.push('aformat=sample_fmts=flt')
  return f.join(',')
}

export function encoderArgs(out: OutputSpec): string[] {
  if (out === 'preview') return ['-c:a', 'pcm_s16le', '-f', 'wav']
  switch (out.format) {
    case 'wav':
      return ['-c:a', out.bitDepth === 16 ? 'pcm_s16le' : out.bitDepth === 24 ? 'pcm_s24le' : 'pcm_f32le', '-f', 'wav']
    case 'flac':
      return ['-c:a', 'flac', '-compression_level', '8', ...(out.bitDepth === 24 ? ['-bits_per_raw_sample', '24'] : []), '-f', 'flac']
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${out.bitrateKbps}k`, '-f', 'mp3']
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', `${out.bitrateKbps}k`, '-movflags', '+faststart', '-f', 'ipod']
  }
}

export interface ProcessJob {
  ffmpeg: string
  input: string
  output: string
  settings: PrepSettings
  out: OutputSpec
  sourceRate?: number
  sourceChannels?: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export function processArgs(j: Omit<ProcessJob, 'ffmpeg' | 'signal' | 'onProgress'>): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-progress',
    'pipe:1',
    '-nostats',
    '-i',
    `file:${j.input}`,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-af',
    buildFilter(j.settings, j.sourceRate, j.out, j.sourceChannels),
    // Keep the source's tags (title, artist) but not cover art or chapters.
    '-map_metadata',
    '0',
    '-map_chapters',
    '-1',
    ...encoderArgs(j.out),
    '-y',
    `file:${j.output}`
  ]
}

export type ProcessResult = { ok: true } | { ok: false; canceled: boolean; message: string }

/**
 * Renders into a hidden partial file next to the target, then renames it into
 * place. A failed or canceled run never leaves a half-written file behind.
 */
export async function processAudio(j: ProcessJob): Promise<ProcessResult> {
  const dir = dirname(j.output)
  const partial = join(dir, `.${basename(j.output, extname(j.output))}.${randomBytes(4).toString('hex')}.partial${extname(j.output)}`)
  const total = j.settings.end - j.settings.start
  const r = await run(j.ffmpeg, processArgs({ ...j, output: partial }), {
    signal: j.signal,
    timeoutMs: 30 * 60_000,
    maxStdout: 64 * 1024,
    onStdoutLine: (line) => {
      const m = line.match(/^out_time_us=(\d+)/)
      if (m && total > 0) j.onProgress?.(Math.min(1, Number(m[1]) / 1e6 / total))
    }
  })
  if (r.code !== 0 || r.aborted) {
    await unlink(partial).catch(() => undefined)
    const msg = r.stderrTail.filter((l) => l.trim()).pop() ?? `FFmpeg exited with ${r.code}`
    return { ok: false, canceled: r.aborted, message: r.aborted ? 'canceled' : msg.slice(0, 300) }
  }
  try {
    await rename(partial, j.output)
  } catch (e) {
    await unlink(partial).catch(() => undefined)
    return { ok: false, canceled: false, message: (e as Error).message }
  }
  j.onProgress?.(1)
  return { ok: true }
}

/** Sample peak of the selection after trimming (before gain), in dBFS. */
export async function measurePeak(ffmpeg: string, input: string, s: Pick<PrepSettings, 'start' | 'end'>, sourceRate: number | undefined, signal?: AbortSignal): Promise<number | null | undefined> {
  const trim = sourceRate ? `atrim=start_sample=${sampleRange(s, sourceRate).first}:end_sample=${sampleRange(s, sourceRate).end}` : `atrim=start=${s.start}:end=${s.end}`
  const r = await run(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'info', '-nostats', '-i', `file:${input}`, '-map', '0:a:0', '-vn', '-af', `${trim},aformat=sample_fmts=dbl,astats=measure_perchannel=none`, '-f', 'null', '-'], {
    signal,
    timeoutMs: 5 * 60_000,
    maxStdout: 1024
  })
  if (r.code !== 0) return undefined
  const lines = r.stderrTail.join('\n')
  const all = [...lines.matchAll(/Peak level dB:\s*(-?inf|-?[\d.]+)/g)]
  const last = all.pop()
  if (!last) return undefined
  return /inf/.test(last[1]!) ? null : Math.round(Number(last[1]) * 100) / 100
}
