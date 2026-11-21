import { run } from '../runner/runner'
import type { ProbedAudio } from './audioArgs'

export interface ProbedFile {
  durationSec?: number
  sizeBytes?: number
  audio?: ProbedAudio
  video?: { codec?: string; height?: number; width?: number; /** Average frame rate (frames ÷ duration). */ fps?: number }
}

const num = (v: unknown) => {
  const x = typeof v === 'string' ? Number(v) : v
  return typeof x === 'number' && isFinite(x) && x > 0 ? x : undefined
}

/** "21780000/386149" → 56.4 */
const rate = (v: unknown): number | undefined => {
  const m = typeof v === 'string' ? v.match(/^(\d+)\/(\d+)$/) : null
  if (!m || Number(m[2]) === 0) return undefined
  const r = Number(m[1]) / Number(m[2])
  return r > 0 && r < 1000 ? Math.round(r * 10) / 10 : undefined
}

/** Reads a local media file's streams with FFprobe. */
export async function probeFile(ffprobe: string, path: string, signal?: AbortSignal): Promise<ProbedFile | null> {
  // `file:` prefix makes FFprobe treat the path literally, even if it starts with "-".
  const r = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', `file:${path}`], {
    signal,
    timeoutMs: 30_000,
    maxStdout: 4 * 1024 * 1024
  })
  if (r.code !== 0) return null
  try {
    const j = JSON.parse(r.stdout) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> }
    const streams = j.streams ?? []
    const a = streams.find((s) => s.codec_type === 'audio')
    const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition as Record<string, number> | undefined)?.attached_pic)
    const abr = num(a?.bit_rate) ?? (!v ? num(j.format?.bit_rate) : undefined)
    return {
      durationSec: num(j.format?.duration) ?? num(a?.duration),
      sizeBytes: num(j.format?.size),
      audio: a
        ? {
            codec: String(a.codec_name),
            sampleRateHz: num(a.sample_rate),
            channels: num(a.channels),
            bitrateKbps: abr ? Math.round(abr / 1000) : undefined,
            durationSec: num(a.duration)
          }
        : undefined,
      video: v ? { codec: String(v.codec_name), height: num(v.height), width: num(v.width), fps: rate(v.avg_frame_rate) } : undefined
    }
  } catch {
    return null
  }
}
