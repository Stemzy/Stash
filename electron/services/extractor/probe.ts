import { run } from '../runner/runner'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>

const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && isFinite(n) && n > 0 ? n : undefined
}

function fps(rate?: string): number | undefined {
  const [a, b] = (rate ?? '').split('/').map(Number)
  return a && b ? Math.round(a / b) : undefined
}

/**
 * Direct media links (a plain .mp4/.mp3 on a website) come back from yt-dlp's
 * generic extractor with no codecs, size or duration. For those only, ask
 * FFprobe to read the file header so the UI can show real source facts.
 * Network-bound and best-effort: failures leave the fields unreported.
 */
export async function enrichDirectFormats(j: Json, ffprobe: string | undefined, signal: AbortSignal): Promise<void> {
  if (!ffprobe) return
  const key = String(j.extractor_key ?? j.extractor ?? '').toLowerCase()
  if (key !== 'generic' && key !== 'html5mediaembed') return
  const formats: Json[] = Array.isArray(j.formats) ? j.formats : [j]
  const incomplete = (f: Json) => (!f.vcodec && !f.acodec) || (!f.abr && !f.asr && !f.height)
  const targets = formats.filter((f) => incomplete(f) && typeof f.url === 'string' && /^https?:\/\//i.test(f.url)).slice(0, 4)

  await Promise.all(
    targets.map(async (f) => {
      // The URL comes from yt-dlp and starts with http(s), so ffprobe can't read it as an option.
      const r = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f.url], {
        signal,
        timeoutMs: 20_000,
        maxStdout: 2 * 1024 * 1024
      })
      if (r.code !== 0) return
      let p: Json
      try {
        p = JSON.parse(r.stdout)
      } catch {
        return
      }
      const streams: Json[] = Array.isArray(p.streams) ? p.streams : []
      const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
      const a = streams.find((s) => s.codec_type === 'audio')
      f.vcodec ??= v ? String(v.codec_name) : 'none'
      f.acodec ??= a ? String(a.codec_name) : 'none'
      if (v) {
        f.height ??= num(v.height)
        f.width ??= num(v.width)
        f.fps ??= fps(v.avg_frame_rate)
      }
      if (a) {
        f.asr ??= num(a.sample_rate)
        f.audio_channels ??= num(a.channels)
        const br = num(a.bit_rate) ?? (!v ? num(p.format?.bit_rate) : undefined)
        if (br) f.abr ??= br / 1000
      }
      f.filesize ??= num(p.format?.size)
      j.duration ??= num(p.format?.duration)
    })
  )
}
