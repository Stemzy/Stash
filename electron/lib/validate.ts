import { isIP } from 'node:net'
import { normalizeLinkInput } from '../../shared/link'

export interface UrlCheck {
  ok: boolean
  url?: string
}

const MAX_URL = 2048

/** Hosts that point at this computer or the local network. */
function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true
  const v = isIP(h)
  if (v === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number]
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (v === 6) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
  return false
}

/**
 * Accepts only plain http(s) links with a public host. Rejects anything that
 * yt-dlp could read as a local file or a command-line option.
 * `allowLocal` permits addresses on this computer or the local network (a NAS, a media server).
 */
export function validateMediaUrl(input: unknown, allowLocal = false): UrlCheck {
  if (typeof input !== 'string') return { ok: false }
  // Accept links without https:// and links inside pasted share text.
  const raw = normalizeLinkInput(input.slice(0, MAX_URL * 2)) ?? ''
  if (!raw || raw.length > MAX_URL || /[\s\u0000-\u001f]/.test(raw)) return { ok: false }
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false }
  if (!u.hostname || (!u.hostname.includes('.') && !isIP(u.hostname.replace(/^\[|\]$/g, '')) && u.hostname !== 'localhost')) return { ok: false }
  if (u.username || u.password) return { ok: false }
  if (!allowLocal && isPrivateHost(u.hostname)) return { ok: false }
  return { ok: true, url: u.toString() }
}

export function isSafeId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)
}
