import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppUpdateStatus } from '../../../shared/types/media'
import { log } from '../../lib/log'

// Updates Stash itself from the GitHub releases set in electron-builder.yml
// (publish → Stemzy/Stash). Nothing downloads without the user saying so:
// "Update now" downloads, "Restart now" installs; "Later" installs on the next quit.
// electron-updater checks the installer's SHA-512 (from latest.yml) before installing.

type Updater = typeof import('electron-updater').autoUpdater

let updater: Updater | null = null
let status: AppUpdateStatus = { phase: 'idle', current: app.getVersion() }
const listeners = new Set<(s: AppUpdateStatus) => void>()
const skipFile = () => join(app.getPath('userData'), 'app-update.json')

function set(s: Partial<AppUpdateStatus> & Pick<AppUpdateStatus, 'phase'>): void {
  status = { current: app.getVersion(), ...s } as AppUpdateStatus
  listeners.forEach((fn) => fn(status))
}

function skipped(): string | undefined {
  try {
    const v = (JSON.parse(readFileSync(skipFile(), 'utf8')) as { skip?: unknown }).skip
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

/** Release notes as plain text (GitHub gives HTML); short enough for the popup. */
function notesText(n: unknown): string | undefined {
  const raw = Array.isArray(n) ? n.map((x) => (x as { note?: string }).note ?? '').join('\n') : typeof n === 'string' ? n : ''
  const text = raw
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, 600) : undefined
}

export const appUpdateStatus = (): AppUpdateStatus => status

export function onAppUpdate(fn: (s: AppUpdateStatus) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Starts the updater. Only for the installed app: in dev there is nothing to update. */
export async function initAppUpdater(): Promise<void> {
  if (!app.isPackaged) {
    set({ phase: 'unsupported' })
    return
  }
  try {
    // electron-updater is CommonJS: depending on how it's loaded, its exports sit on `default`.
    const mod = (await import('electron-updater')) as typeof import('electron-updater') & { default?: typeof import('electron-updater') }
    const u = mod.autoUpdater ?? mod.default?.autoUpdater
    if (!u) throw new Error('electron-updater has no autoUpdater')
    setup(u)
  } catch (e) {
    // Never let updating get in the way of the app itself.
    log.warn('app updater unavailable', String(e))
    updater = null
    set({ phase: 'unsupported' })
  }
}

function setup(u: Updater): void {
  updater = u
  u.autoDownload = false // ask first
  u.autoInstallOnAppQuit = true // "Later" = install when Stash closes
  u.allowPrerelease = false
  u.logger = null

  u.on('checking-for-update', () => {
    if (status.phase !== 'downloading' && status.phase !== 'ready') set({ phase: 'checking' })
  })
  u.on('update-not-available', () => set({ phase: 'idle', checkedAt: Date.now() }))
  u.on('update-available', (info) => {
    if (info.version === skipped() && !manual) return set({ phase: 'idle', checkedAt: Date.now() })
    set({ phase: 'available', version: info.version, notes: notesText(info.releaseNotes), checkedAt: Date.now() })
  })
  u.on('download-progress', (p) => {
    if (status.phase === 'downloading' || status.phase === 'available') set({ phase: 'downloading', version: status.version, fraction: Math.max(0, Math.min(1, p.percent / 100)) })
  })
  u.on('update-downloaded', (info) => set({ phase: 'ready', version: info.version }))
  u.on('error', (e) => {
    log.warn('app update failed', String(e?.message ?? e))
    // A failed background check stays quiet; a failed download the user asked for doesn't.
    if (status.phase === 'downloading') set({ phase: 'error', version: status.version, error: "The update couldn't be downloaded. Try again later." })
    else if (manual) set({ phase: 'error', error: "Couldn't check for updates. Check your internet connection." })
    else set({ phase: 'idle' })
  })

  const auto = () => void check(false)
  setTimeout(auto, 10_000)
  setInterval(auto, 6 * 3600_000).unref()
}

let manual = false

export async function check(byUser: boolean): Promise<AppUpdateStatus> {
  if (!updater || status.phase === 'downloading' || status.phase === 'ready') return status
  manual = byUser
  try {
    await updater.checkForUpdates()
  } catch {
    /* reported through the 'error' event */
  }
  manual = false
  return status
}

export async function download(): Promise<void> {
  if (!updater || status.phase !== 'available') return
  set({ phase: 'downloading', version: status.version, fraction: 0 })
  try {
    await updater.downloadUpdate()
  } catch {
    /* reported through the 'error' event */
  }
}

export function installNow(): void {
  if (updater && status.phase === 'ready') updater.quitAndInstall(false, true)
}

/** "Later" on the offer: hide it until the next check. */
export function later(): void {
  if (status.phase === 'available' || status.phase === 'error') set({ phase: 'idle' })
}

/** Don't offer this version again (a newer one will still be offered). */
export async function skip(): Promise<void> {
  if (status.phase !== 'available' || !status.version) return
  await writeFile(skipFile(), JSON.stringify({ skip: status.version })).catch(() => undefined)
  set({ phase: 'idle' })
}
