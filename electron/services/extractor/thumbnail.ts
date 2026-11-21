import { net } from 'electron'

const MAX_BYTES = 4 * 1024 * 1024
const OK_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/i

/**
 * Fetches a thumbnail in the main process and returns it as a data: URL, so
 * the renderer (strict CSP, no remote images) never contacts third-party hosts.
 * Any failure just means "no thumbnail"; the UI handles that.
 */
export async function fetchThumbnail(src: string | undefined, signal: AbortSignal): Promise<string | undefined> {
  if (!src || !/^https?:\/\//i.test(src)) return undefined
  const timeout = AbortSignal.timeout(10_000)
  try {
    const res = await net.fetch(src, { signal: AbortSignal.any([signal, timeout]), redirect: 'follow' })
    if (!res.ok) return undefined
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim()
    if (!OK_TYPES.test(type)) return undefined
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) return undefined
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) return undefined
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}
