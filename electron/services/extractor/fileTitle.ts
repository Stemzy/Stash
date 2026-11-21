import { net } from 'electron'
import { filenameFromDisposition, titleFromFilename } from './shareLinks'

/**
 * Direct file links (CDN, cloud storage, a plain .mp4 on a website) often have
 * a meaningless URL like /cdn/abc123. The server usually sends the real file
 * name in Content-Disposition; ask for just the headers and use it as the title.
 */
export async function directFileTitle(url: string, signal: AbortSignal): Promise<string | undefined> {
  const timeout = AbortSignal.timeout(8000)
  const sig = AbortSignal.any([signal, timeout])
  const read = (res: Response) => filenameFromDisposition(res.headers.get('content-disposition'))
  try {
    let res = await net.fetch(url, { method: 'HEAD', redirect: 'follow', signal: sig })
    let name = res.ok ? read(res) : undefined
    if (!name && (!res.ok || res.status === 405)) {
      // Some servers refuse HEAD: ask for the first byte instead.
      res = await net.fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: sig })
      name = read(res)
      void res.body?.cancel()
    }
    return name ? titleFromFilename(name) || undefined : undefined
  } catch {
    return undefined
  }
}
