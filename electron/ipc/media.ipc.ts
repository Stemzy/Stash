import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import type { AnalyzeResult } from '../../shared/types/media'
import { isSafeId, validateMediaUrl } from '../lib/validate'
import { log } from '../lib/log'
import { requireTools } from '../services/binaries/tools'
import { analyze } from '../services/extractor/extractor'
import { fetchThumbnail } from '../services/extractor/thumbnail'
import { rewriteShareLink, titleFromFilename } from '../services/extractor/shareLinks'
import { directFileTitle } from '../services/extractor/fileTitle'

const running = new Map<string, AbortController>()

/** True when yt-dlp just used the URL's file name as the title. */
function isUrlTitle(title: string, url: string): boolean {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return titleFromFilename(last) === title || last.startsWith(title) || title === 'Untitled'
  } catch {
    return false
  }
}

export function registerMediaIpc(): void {
  ipcMain.handle(IPC.analyze, async (_e, rawUrl: unknown, requestId: unknown): Promise<AnalyzeResult> => {
    if (!isSafeId(requestId)) return { ok: false, error: { code: 'UNKNOWN' } }
    // Any http(s) link is accepted, including ones on your own network (a NAS, a media server).
    const check = validateMediaUrl(rawUrl, true)
    if (!check.ok) return { ok: false, error: { code: 'INVALID_URL' } }
    const share = rewriteShareLink(check.url!)
    if ('blocked' in share) return { ok: false, error: { code: share.blocked } }

    const tools = await requireTools(['ytdlp'])
    if (!tools) return { ok: false, error: { code: 'TOOLS_MISSING' } }

    running.get(requestId)?.abort()
    const ctrl = new AbortController()
    running.set(requestId, ctrl)
    try {
      const out = await analyze(share.url, tools, ctrl.signal)
      if (!out.result.ok) {
        if (out.result.error.code !== 'CANCELED') log.warn('analyze failed', out.result.error.code, out.result.error.detail)
        return out.result
      }
      const media = out.result.media
      const [thumbnailUrl, betterTitle] = await Promise.all([
        fetchThumbnail(out.thumbnailSource, ctrl.signal),
        // Direct file links: the URL's last part is often an id; the server knows the real name.
        media.extractor === 'Website' && isUrlTitle(media.title, media.url) ? directFileTitle(media.url, ctrl.signal) : undefined
      ])
      return { ok: true, media: { ...media, title: betterTitle ?? media.title, thumbnailUrl } }
    } catch (e) {
      log.error('analyze crashed', (e as Error).message)
      return { ok: false, error: { code: 'UNKNOWN' } }
    } finally {
      if (running.get(requestId) === ctrl) running.delete(requestId)
    }
  })

  ipcMain.handle(IPC.cancelAnalyze, (_e, requestId: unknown) => {
    if (isSafeId(requestId)) running.get(requestId)?.abort()
  })
}
