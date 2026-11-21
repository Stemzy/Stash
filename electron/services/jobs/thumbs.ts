import { app, net, protocol } from 'electron'
import { copyFile, mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Job thumbnails are saved as small files in the app's data folder and shown
// through a private `app-thumb://` scheme, so History keeps its artwork after a
// restart without storing large images in the job list.

export const THUMB_SCHEME = 'app-thumb'
const ID = /^[0-9a-f-]{36}$/
const dir = () => join(app.getPath('userData'), 'thumbs')
const TYPES: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', avif: 'avif' }

/** Must run before `app.whenReady()`. */
export const thumbSchemePrivileges = { scheme: THUMB_SCHEME, privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } }

/** Must run after `app.whenReady()`. */
export function handleThumbScheme(): void {
  protocol.handle(THUMB_SCHEME, async (req) => {
    const id = new URL(req.url).pathname.replace(/^\//, '')
    if (!ID.test(id)) return new Response(null, { status: 404 })
    const file = (await readdir(dir()).catch(() => [] as string[])).find((f) => f.startsWith(`${id}.`))
    if (!file) return new Response(null, { status: 404 })
    const res = await net.fetch(pathToFileURL(join(dir(), file)).toString())
    // Same-app images only; CORS lets the background read their colors.
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/jpeg', 'Access-Control-Allow-Origin': '*' } })
  })
}

export const thumbUrl = (id: string) => `${THUMB_SCHEME}://t/${id}`

/** Saves a data: URL image from the renderer. Anything else is ignored. */
export async function saveThumb(id: string, dataUrl: unknown): Promise<string | undefined> {
  if (typeof dataUrl !== 'string' || dataUrl.length > 6_000_000) return undefined
  const m = dataUrl.match(/^data:image\/(jpeg|png|webp|gif|avif);base64,([A-Za-z0-9+/=]+)$/)
  if (!m || !ID.test(id)) return undefined
  await mkdir(dir(), { recursive: true })
  await writeFile(join(dir(), `${id}.${TYPES[m[1]!]}`), Buffer.from(m[2]!, 'base64'))
  return thumbUrl(id)
}

/** Uses an image file made by the app (e.g. a frame grabbed from a recording) as a job's thumbnail. */
export async function saveThumbFile(id: string, file: string): Promise<string | undefined> {
  if (!ID.test(id)) return undefined
  await mkdir(dir(), { recursive: true })
  await copyFile(file, join(dir(), `${id}.jpg`))
  return thumbUrl(id)
}

export async function copyThumb(fromId: string, toId: string): Promise<string | undefined> {
  const file = (await readdir(dir()).catch(() => [] as string[])).find((f) => f.startsWith(`${fromId}.`))
  if (!file || !ID.test(toId)) return undefined
  await copyFile(join(dir(), file), join(dir(), `${toId}.${file.split('.').pop()}`))
  return thumbUrl(toId)
}

export async function deleteThumb(id: string): Promise<void> {
  const files = (await readdir(dir()).catch(() => [] as string[])).filter((f) => f.startsWith(`${id}.`))
  await Promise.all(files.map((f) => unlink(join(dir(), f)).catch(() => undefined)))
}
