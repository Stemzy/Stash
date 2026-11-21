import { copyFile, mkdir, open, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** Windows-safe file name (no extension handling). Never empty. */
export function sanitizeFilename(input: unknown, fallback = 'download'): string {
  let s = typeof input === 'string' ? input : ''
  s = s
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')
  if (RESERVED.test(s)) s = `_${s}`
  // Leave room for " (999)" and the extension within Windows' 255-char name limit.
  s = s.slice(0, 180).trim()
  return s || fallback
}

/** The download folder must be an absolute path to an existing, writable directory. */
export async function validateDirectory(dir: unknown): Promise<string | null> {
  const r = await prepareDirectory(dir)
  return r.ok ? r.dir : null
}

export type FolderProblem = 'FOLDER_MISSING' | 'FOLDER_BLOCKED' | 'DISK_FULL'

/**
 * Makes sure files can really be saved in `dir`: creates it if it's missing
 * (e.g. a OneDrive-redirected Videos folder that was never made), then writes
 * and deletes a tiny test file. On Windows, `access(W_OK)` only checks the
 * read-only flag, so it says yes even when Controlled folder access (ransomware
 * protection) or permissions will refuse the actual file.
 */
export async function prepareDirectory(dir: unknown): Promise<{ ok: true; dir: string } | { ok: false; code: FolderProblem; detail?: string }> {
  if (typeof dir !== 'string' || !dir || dir.length > 1024 || !isAbsolute(dir) || dir.includes('\u0000')) return { ok: false, code: 'FOLDER_MISSING' }
  const abs = resolve(dir)
  try {
    await mkdir(abs, { recursive: true })
    if (!(await stat(abs)).isDirectory()) return { ok: false, code: 'FOLDER_MISSING' }
  } catch (e) {
    return { ok: false, code: folderProblem(e, false), detail: (e as NodeJS.ErrnoException).code }
  }
  const probe = join(abs, `.stash-write-test-${process.pid}-${Date.now()}.tmp`)
  try {
    const fh = await open(probe, 'wx')
    await fh.close()
    await unlink(probe).catch(() => undefined)
    return { ok: true, dir: abs }
  } catch (e) {
    return { ok: false, code: folderProblem(e, true), detail: (e as NodeJS.ErrnoException).code }
  }
}

/** Turns a file-system error from saving into a message the user can act on. */
export function folderProblem(e: unknown, folderExists: boolean): FolderProblem {
  const code = (e as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'DISK_FULL'
  if (code === 'ENOENT' || code === 'ENOTDIR') return folderExists ? 'FOLDER_BLOCKED' : 'FOLDER_MISSING'
  return 'FOLDER_BLOCKED' // EACCES, EPERM, EROFS, EBUSY…
}

/** Error code for a save that failed part-way (the folder was fine when the job started). */
export async function saveFailure(e: unknown, dir: string): Promise<FolderProblem | null> {
  const code = (e as NodeJS.ErrnoException)?.code
  if (!['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOTDIR', 'EBUSY'].includes(code ?? '')) return null
  const exists = await stat(dir).then((s) => s.isDirectory()).catch(() => false)
  return folderProblem(e, exists)
}

/**
 * Picks "name.ext", or "name (2).ext", "name (3).ext"… and reserves it by
 * creating an empty file atomically ('wx'), so two jobs never pick the same name.
 */
export async function reserveUniquePath(dir: string, name: string, ext: string): Promise<string> {
  for (let i = 1; i < 1000; i++) {
    const candidate = join(dir, `${name}${i === 1 ? '' : ` (${i})`}.${ext}`)
    // Defense in depth: the result must stay inside the chosen folder.
    if (!resolve(candidate).startsWith(resolve(dir) + sep)) throw new Error('path escapes folder')
    try {
      const fh = await open(candidate, 'wx')
      await fh.close()
      return candidate
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  throw new Error('no free file name')
}

/** Moves a finished file over its reserved placeholder; copies when crossing drives. */
export async function moveInto(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await copyFile(src, dest)
    await unlink(src)
  }
}

/** Name of the app's own folder in the OS temp directory. */
export const TEMP_NAME = 'Stash'
const TEMP_ROOT = () => join(tmpdir(), TEMP_NAME)

/**
 * A private temp folder per job, under the OS temp directory. The name is the
 * job id, so a paused or interrupted job finds its partial download again.
 */
export async function makeJobTemp(jobId: string): Promise<string> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(jobId)) throw new Error('bad job id')
  const dir = join(TEMP_ROOT(), jobId)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Removes the temp folder of a job that will never resume. */
export async function dropJobTemp(jobId: string): Promise<void> {
  if (/^[A-Za-z0-9-]{1,64}$/.test(jobId)) await removeJobTemp(join(TEMP_ROOT(), jobId))
}

/** Startup cleanup: removes temp folders that no paused/queued job will resume. */
export async function sweepTemp(keepJobIds: Set<string>): Promise<number> {
  let removed = 0
  const entries = await readdir(TEMP_ROOT()).catch(() => [] as string[])
  for (const name of entries) {
    if (keepJobIds.has(name)) continue
    await removeJobTemp(join(TEMP_ROOT(), name))
    removed++
  }
  return removed
}

/** Removes a job temp folder. Only ever deletes inside our own temp root. */
export async function removeJobTemp(dir: string | undefined): Promise<void> {
  if (!dir) return
  const root = TEMP_ROOT() + sep
  if (!resolve(dir).startsWith(root)) return
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => undefined)
}

export async function removeQuietly(p: string | undefined): Promise<void> {
  if (p) await unlink(p).catch(() => undefined)
}

export const fileExt = (p: string) => extname(p).slice(1).toLowerCase()
export const fileName = (p: string) => basename(p)
