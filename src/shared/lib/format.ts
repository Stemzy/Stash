export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function formatBytes(bytes?: number, approx = false): string {
  if (bytes == null || !isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  const n = v >= 100 || i === 0 ? Math.round(v).toString() : v.toFixed(1)
  return `${approx ? '~' : ''}${n} ${units[i]}`
}

export function formatDuration(sec?: number): string {
  if (sec == null) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function formatSpeed(bps?: number): string {
  return bps ? `${formatBytes(bps)}/s` : ''
}

export function formatEta(sec?: number): string {
  if (sec == null || !isFinite(sec)) return ''
  if (sec < 60) return `${Math.ceil(sec)}s left`
  return `${Math.ceil(sec / 60)} min left`
}

export function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  const d = Math.floor(diff / 86400)
  return d === 1 ? 'Yesterday' : `${d} days ago`
}

export function resolutionLabel(height: number): string {
  if (height >= 4320) return '8K'
  if (height >= 2160) return '4K'
  if (height >= 1440) return '2K'
  if (height >= 1080) return 'Full HD'
  if (height >= 720) return 'HD'
  return 'SD'
}

export function codecLabel(codec: string): string {
  const map: Record<string, string> = { h264: 'H.264', vp9: 'VP9', av1: 'AV1', hevc: 'HEVC', aac: 'AAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', unknown: 'Unknown codec' }
  return map[codec] ?? codec.toUpperCase()
}

/** Windows-safe filename: strips reserved characters and trailing dots/spaces. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')
    .slice(0, 200)
}

export function shortPath(p: string, max = 42): string {
  if (p.length <= max) return p
  const parts = p.split(/[\\/]/)
  const sep = p.includes('\\') ? '\\' : '/'
  if (parts.length <= 3) return '…' + p.slice(-max)
  return `${parts[0]}${sep}…${sep}${parts.slice(-2).join(sep)}`
}
