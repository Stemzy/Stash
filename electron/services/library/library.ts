import { protocol, shell } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import type { LibraryItem } from '../../../shared/types/library'
import { listJobs, savedPath } from '../jobs/jobManager'
import { LAB_MEDIA_HOST, labMedia } from './mediaRegistry'

// Plays finished downloads inside the app through a private `app-media://`
// scheme. Only files this app saved (or the user opened in LAB) can be served:
// the URL carries an id, never a path, so the renderer can't read anything else on disk.

export const MEDIA_SCHEME = 'app-media'
const ID = /^[0-9a-f-]{36}$/

const TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4v: 'video/mp4',
  mov: 'video/mp4'
}

/** Must run before `app.whenReady()`. `stream` enables seeking in <video>/<audio>. */
export const mediaSchemePrivileges = {
  scheme: MEDIA_SCHEME,
  // corsEnabled + the header below let the player read audio levels for the moving background.
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true }
}

export const mediaUrl = (id: string) => `${MEDIA_SCHEME}://f/${id}`

// Only this app's own window can load these URLs; the header just lets Web Audio read them.
const CORS = { 'Access-Control-Allow-Origin': '*' }

/** Must run after `app.whenReady()`. Serves byte ranges so playback can seek. */
export function handleMediaScheme(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const u = new URL(req.url)
    const id = u.pathname.replace(/^\//, '')
    const path = !ID.test(id) ? undefined : u.hostname === LAB_MEDIA_HOST ? labMedia.get(id) : savedPath(id)
    if (!path) return new Response(null, { status: 404 })
    let size: number
    try {
      const s = await stat(path)
      if (!s.isFile()) return new Response(null, { status: 404 })
      size = s.size
    } catch {
      return new Response(null, { status: 404 })
    }
    const type = TYPES[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream'
    const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/)
    if (range && size > 0) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2])
      let end = range[1] && range[2] ? Number(range[2]) : size - 1
      start = Math.max(0, start)
      end = Math.min(size - 1, end)
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: { ...CORS, 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' }
      })
    }
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(body, { status: 200, headers: { ...CORS, 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  })
}

/** Finished downloads whose files are still where the app saved them. */
export async function listLibrary(): Promise<LibraryItem[]> {
  const done = listJobs().filter((j) => j.status === 'completed' && j.output.path)
  const items = await Promise.all(
    done.map(async (j): Promise<LibraryItem | null> => {
      try {
        const s = await stat(j.output.path!)
        if (!s.isFile()) return null
        return {
          id: j.id,
          kind: j.spec.kind,
          title: j.source.title,
          creator: j.source.creator,
          durationSec: j.source.durationSec,
          thumbnailUrl: j.source.thumbnailUrl,
          extractor: j.source.extractor,
          ext: extname(j.output.path!).slice(1).toLowerCase(),
          sizeBytes: s.size,
          addedAt: j.finishedAt ?? j.createdAt,
          mediaUrl: mediaUrl(j.id)
        }
      } catch {
        return null // moved or deleted outside the app
      }
    })
  )
  return items.filter((x): x is LibraryItem => !!x).sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}

/** Opens the file in Windows' default player (for formats the app can't play). */
export async function openExternally(id: string): Promise<boolean> {
  const path = ID.test(id) ? savedPath(id) : undefined
  if (!path) return false
  return (await shell.openPath(path)) === ''
}
