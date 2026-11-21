// Progress parsing for yt-dlp and FFmpeg. Pure functions.

/** Template passed to yt-dlp's --progress-template; fields are "NA" when unknown. */
export const YTDLP_PROGRESS_TEMPLATE =
  'download:[dl] %(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s'

export interface DlProgress {
  downloaded: number
  total?: number
  speedBps?: number
  etaSec?: number
  percent?: number
}

const n = (s?: string) => {
  const v = Number(s)
  return s && s !== 'NA' && s !== 'None' && Number.isFinite(v) && v >= 0 ? v : undefined
}

export function parseYtdlpProgress(line: string): DlProgress | null {
  const m = line.match(/^\[dl\] ([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)$/)
  if (!m) return null
  const downloaded = n(m[1]) ?? 0
  const total = n(m[2]) ?? n(m[3])
  return {
    downloaded,
    total,
    speedBps: n(m[4]),
    etaSec: n(m[5]),
    percent: total ? Math.min(100, (downloaded / total) * 100) : undefined
  }
}

/** FFmpeg `-progress pipe:1` emits key=value lines; returns seconds processed. */
export function parseFfmpegProgress(line: string): { outSec?: number; end?: boolean } | null {
  const [k, v] = line.split('=', 2)
  if (k === 'out_time_us' || k === 'out_time_ms') {
    // Both keys are in microseconds in current FFmpeg builds.
    const us = Number(v)
    return Number.isFinite(us) && us >= 0 ? { outSec: us / 1_000_000 } : null
  }
  if (k === 'progress' && v === 'end') return { end: true }
  return null
}
