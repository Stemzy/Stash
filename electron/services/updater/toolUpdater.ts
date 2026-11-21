import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs'
import { copyFile, chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { ToolUpdateProgress, ToolUpdateState } from '../../../shared/types/media'
import { log } from '../../lib/log'
import { run } from '../runner/runner'

// Keeps yt-dlp, Deno and FFmpeg up to date, only if the user agreed.
//
// - Sources are fixed: each tool's official GitHub releases (the same ones
//   scripts/fetch-binaries.mjs uses). Nothing here comes from user input.
// - Every download is checked against the publisher's SHA-256 list, then run
//   once (`--version`) before it is used. A failure leaves the current tool alone.
// - Each version goes in its own folder (tools/<platform>/<tool>/<version>/), and
//   the app switches to it for the *next* run. A download already in progress
//   keeps using the old copy, so nothing is interrupted or overwritten in use.
// - Executables are only ever run with argument arrays (runner.ts), no shell.

type Tool = 'ytdlp' | 'deno' | 'ffmpeg'
interface Installed {
  version: string
  dir: string
  installedAt: number
  /** FFmpeg's "latest" build has no version number; the zip's checksum identifies it. */
  zipSha?: string
}
interface State {
  auto: boolean | null
  lastCheck: number
  current: Partial<Record<Tool, Installed>>
}

const TARGET = `${process.platform}-${process.arch}`
const EXE = process.platform === 'win32' ? '.exe' : ''
const CHECK_EVERY = 12 * 3600_000
const FFMPEG_EVERY = 30 * 24 * 3600_000 // FFmpeg rarely matters for downloads, and it is ~200 MB
const MAX_DOWNLOAD = 400 * 1024 * 1024
const UA = { 'User-Agent': 'Stash-app-updater' }

const root = () => join(app.getPath('userData'), 'tools')
const stateFile = () => join(root(), 'state.json')
const inside = (p: string) => resolve(p).startsWith(resolve(root(), TARGET) + sep)

let state: State = { auto: null, lastCheck: 0, current: {} }
let running: Promise<ToolUpdateState['last']> | null = null
let progress: ToolUpdateProgress = { phase: 'idle' }
let last: ToolUpdateState['last']
const listeners = new Set<(p: ToolUpdateProgress) => void>()

function load(): void {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<State>
    const current: State['current'] = {}
    for (const t of ['ytdlp', 'deno', 'ffmpeg'] as Tool[]) {
      const c = raw.current?.[t]
      // Only trust folders inside our own tools folder that still hold the tool.
      if (c && typeof c.dir === 'string' && typeof c.version === 'string' && inside(c.dir) && existsSync(join(c.dir, mainFile(t)))) current[t] = c
    }
    state = { auto: typeof raw.auto === 'boolean' ? raw.auto : null, lastCheck: Number(raw.lastCheck) || 0, current }
  } catch {
    /* first run */
  }
}

async function save(): Promise<void> {
  await mkdir(root(), { recursive: true })
  await writeFile(stateFile(), JSON.stringify(state, null, 1)).catch((e) => log.warn('tool updater: could not save state', e))
}

const mainFile = (t: Tool) => (t === 'ytdlp' ? 'yt-dlp' : t) + EXE

function emit(p: ToolUpdateProgress): void {
  progress = p
  listeners.forEach((fn) => fn(p))
}

export function onToolUpdateProgress(fn: (p: ToolUpdateProgress) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function toolUpdateState(): ToolUpdateState {
  return { auto: state.auto, lastCheck: state.lastCheck || undefined, progress, last }
}

/** Updated tool paths to use instead of the bundled ones (only those that exist). */
export function updatedToolPaths(): { ytdlp?: string; deno?: string; ffmpeg?: string; ffprobe?: string } {
  const out: Record<string, string> = {}
  const c = state.current
  if (c.ytdlp) out.ytdlp = join(c.ytdlp.dir, mainFile('ytdlp'))
  if (c.deno) out.deno = join(c.deno.dir, mainFile('deno'))
  if (c.ffmpeg && existsSync(join(c.ffmpeg.dir, 'ffprobe' + EXE))) {
    out.ffmpeg = join(c.ffmpeg.dir, 'ffmpeg' + EXE)
    out.ffprobe = join(c.ffmpeg.dir, 'ffprobe' + EXE)
  }
  return out
}

// ── network ──────────────────────────────────────────────────────────────

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

/**
 * Latest release tag, read from where github.com/<repo>/releases/latest
 * redirects to (/releases/tag/<tag>). No API call, so no API rate limit.
 */
async function latestTag(repo: string): Promise<string> {
  const res = await fetch(`https://github.com/${repo}/releases/latest`, { headers: { 'User-Agent': UA['User-Agent'] }, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  const tag = decodeURIComponent(res.headers.get('location')?.match(/\/releases\/tag\/([^/?#]+)/)?.[1] ?? '')
  if (!/^[\w.-]{1,40}$/.test(tag)) throw new Error(`no release tag for ${repo} (HTTP ${res.status})`)
  return tag
}

function sumFromList(text: string, name: string): string {
  const line = text.split('\n').find((l) => l.trim().endsWith(`  ${name}`) || l.trim().endsWith(` *${name}`))
  const sum = line?.trim().split(/\s+/)[0]?.toLowerCase()
  if (!sum || !/^[a-f0-9]{64}$/.test(sum)) throw new Error(`no checksum for ${name}`)
  return sum
}

/** Streams a file to disk, hashing as it goes. Throws if the hash isn't the published one. */
async function download(url: string, dest: string, expected: string, onBytes: (got: number, total: number) => void): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'] }, redirect: 'follow', signal: AbortSignal.timeout(20 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  if (total > MAX_DOWNLOAD) throw new Error('download too large')
  const hash = createHash('sha256')
  const out = createWriteStream(dest)
  let writeError: Error | null = null
  out.on('error', (e) => (writeError = e))
  let got = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.byteLength
      if (got > MAX_DOWNLOAD) throw new Error('download too large')
      hash.update(value)
      if (writeError) throw writeError
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      onBytes(got, total)
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()))
  }
  if (writeError) throw writeError
  if (hash.digest('hex') !== expected) throw new Error('checksum mismatch, refusing to install')
}

async function extractZip(zip: string, dir: string): Promise<void> {
  // Windows 10+ ships bsdtar, which reads zips. Full path, argument array, no shell.
  const cmd = process.platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'unzip'
  const args = process.platform === 'win32' ? ['-xf', zip, '-C', dir] : ['-q', '-o', zip, '-d', dir]
  const r = await run(cmd, args, { timeoutMs: 5 * 60_000, maxStdout: 1024 * 1024 })
  if (r.code !== 0) throw new Error(`could not unpack ${zip}`)
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const hit = await findFile(p, name)
      if (hit) return hit
    } else if (e.name === name) return p
  }
  return null
}

async function works(path: string, args: string[]): Promise<boolean> {
  if (process.platform !== 'win32') await chmod(path, 0o755)
  const r = await run(path, args, { timeoutMs: 30_000, maxStdout: 64 * 1024 })
  return r.code === 0
}

// ── tools ────────────────────────────────────────────────────────────────

export interface Current {
  ytdlp?: string
  deno?: string
  ffmpeg?: string
}

interface Plan {
  tool: Tool
  label: string
  version: string
  /** Downloads into `tmp`, verifies, and returns the folder holding the new tool. */
  install: (tmp: string, onBytes: (got: number, total: number) => void) => Promise<{ dir: string; zipSha?: string; version?: string }>
}

const versionDir = (t: Tool, v: string) => join(root(), TARGET, t, v.replace(/[^\w.-]/g, '_'))

/** SHA-256 of a file on disk (streamed). */
function fileSha(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('error', rej)
      .on('end', () => res(h.digest('hex')))
  })
}

/**
 * yt-dlp: the latest release publishes a SHA-256 for every build. If the copy
 * in use doesn't match it, there's a newer one. No version lookup needed.
 */
async function planYtDlp(inUse: string | undefined): Promise<Plan | null> {
  const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
  const sum = sumFromList(await getText(base + 'SHA2-256SUMS'), asset)
  if (inUse && (await fileSha(inUse).catch(() => '')) === sum) return null
  return {
    tool: 'ytdlp',
    label: 'yt-dlp',
    version: 'new version',
    install: async (tmp, onBytes) => {
      const file = join(tmp, mainFile('ytdlp'))
      await download(base + asset, file, sum, onBytes)
      if (process.platform !== 'win32') await chmod(file, 0o755)
      const r = await run(file, ['--version'], { timeoutMs: 30_000, maxStdout: 64 * 1024 })
      const version = r.stdout.trim().split('\n')[0] ?? ''
      if (r.code !== 0 || !/^[\w.-]{1,40}$/.test(version)) throw new Error('new yt-dlp did not start')
      const dir = versionDir('ytdlp', version)
      await mkdir(dir, { recursive: true })
      await copyFile(file, join(dir, mainFile('ytdlp')))
      if (process.platform !== 'win32') await chmod(join(dir, mainFile('ytdlp')), 0o755)
      return { dir, version }
    }
  }
}

async function planDeno(installedVersion: string | undefined): Promise<Plan | null> {
  const triple = { 'win32-x64': 'x86_64-pc-windows-msvc', 'linux-x64': 'x86_64-unknown-linux-gnu', 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin' }[TARGET]
  if (!triple || !installedVersion) return null // only update a Deno the app already has
  const tag = await latestTag('denoland/deno')
  if (tag.replace(/^v/, '') === installedVersion.replace(/^v/, '')) return null
  const asset = `deno-${triple}.zip`
  const base = `https://github.com/denoland/deno/releases/download/${tag}/`
  return {
    tool: 'deno',
    label: 'Deno',
    version: tag.replace(/^v/, ''),
    install: async (tmp, onBytes) => {
      const sum = (await getText(base + asset + '.sha256sum')).match(/\b[a-fA-F0-9]{64}\b/)?.[0]?.toLowerCase()
      if (!sum) throw new Error('no checksum for Deno')
      const zip = join(tmp, asset)
      await download(base + asset, zip, sum, onBytes)
      await extractZip(zip, tmp)
      const found = await findFile(tmp, mainFile('deno'))
      if (!found || !(await works(found, ['--version']))) throw new Error('new Deno did not start')
      const dir = versionDir('deno', tag)
      await mkdir(dir, { recursive: true })
      await copyFile(found, join(dir, mainFile('deno')))
      if (process.platform !== 'win32') await chmod(join(dir, mainFile('deno')), 0o755)
      return { dir }
    }
  }
}

async function planFfmpeg(bundledFfmpeg: string | undefined): Promise<Plan | null> {
  if (TARGET !== 'win32-x64') return null // elsewhere FFmpeg comes from the system's package manager
  const mine = state.current.ffmpeg
  const builtAt = mine?.installedAt ?? (bundledFfmpeg ? statSync(bundledFfmpeg).mtimeMs : 0)
  if (Date.now() - builtAt < FFMPEG_EVERY) return null
  const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/'
  const asset = 'ffmpeg-master-latest-win64-gpl.zip'
  const sum = sumFromList(await getText(BTBN + 'checksums.sha256'), asset)
  if (mine?.zipSha === sum) return null
  const version = new Date().toISOString().slice(0, 10)
  return {
    tool: 'ffmpeg',
    label: 'FFmpeg',
    version,
    install: async (tmp, onBytes) => {
      const zip = join(tmp, asset)
      await download(BTBN + asset, zip, sum, onBytes)
      await extractZip(zip, tmp)
      const dir = versionDir('ffmpeg', sum.slice(0, 12))
      await mkdir(dir, { recursive: true })
      for (const exe of ['ffmpeg', 'ffprobe']) {
        const found = await findFile(tmp, exe + EXE)
        if (!found || !(await works(found, ['-hide_banner', '-version']))) throw new Error(`new ${exe} did not start`)
        await copyFile(found, join(dir, exe + EXE))
      }
      return { dir, zipSha: sum }
    }
  }
}

/** Deletes version folders the app no longer points at (skips any still in use). */
async function sweepOld(): Promise<void> {
  for (const t of ['ytdlp', 'deno', 'ffmpeg'] as Tool[]) {
    const base = join(root(), TARGET, t)
    if (!existsSync(base)) continue
    for (const v of await readdir(base)) {
      const p = join(base, v)
      if (resolve(p) !== resolve(state.current[t]?.dir ?? '\0')) await rm(p, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/**
 * Checks for and installs updates. `inUse` describes the tools in use now
 * (from toolStatus); `bundledFfmpeg` is its path, for its age.
 * Returns which tools were updated. Never throws.
 */
export function checkForToolUpdates(inUse: { ytdlpPath?: string; denoVersion?: string }, bundledFfmpeg: string | undefined, afterInstall: () => Promise<void>): Promise<ToolUpdateState['last']> {
  if (running) return running
  running = (async () => {
    const updated: string[] = []
    let error: string | undefined
    let checkError: string | undefined
    try {
      emit({ phase: 'checking' })
      const plans: Plan[] = []
      for (const p of [() => planYtDlp(inUse.ytdlpPath), () => planDeno(inUse.denoVersion), () => planFfmpeg(bundledFfmpeg)]) {
        try {
          const plan = await p()
          if (plan) plans.push(plan)
        } catch (e) {
          log.warn('tool updater: check failed', String(e))
          checkError = 'Could not reach GitHub to check for updates.'
        }
      }
      state.lastCheck = Date.now()
      await save()
      for (const [i, plan] of plans.entries()) {
        const tmp = await mkdtemp(join(tmpdir(), 'stash-update-'))
        try {
          const step = (fraction: number) =>
            emit({ phase: 'downloading', label: plan.label, version: plan.version, index: i + 1, count: plans.length, fraction: Math.max(0, Math.min(1, fraction)) })
          step(0)
          const res = await plan.install(tmp, (got, total) => step(total ? (got / total) * 0.9 : 0))
          const version = res.version ?? plan.version
          emit({ phase: 'installing', label: plan.label, version, index: i + 1, count: plans.length, fraction: 0.95 })
          state.current[plan.tool] = { version, dir: res.dir, installedAt: Date.now(), zipSha: res.zipSha }
          await save()
          await afterInstall()
          updated.push(`${plan.label} ${version}`)
          log.info(`tool updater: ${plan.label} updated to ${version}`)
        } catch (e) {
          log.warn(`tool updater: ${plan.label} failed`, String(e))
          error = `${plan.label} couldn't be updated. The current version is still in use.`
        } finally {
          await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
        }
      }
      await sweepOld()
    } catch (e) {
      log.warn('tool updater failed', String(e))
      error = 'Updating the media tools failed.'
    }
    last = { at: Date.now(), updated, error, checkError }
    emit({ phase: 'done', updated, error })
    emit({ phase: 'idle' })
    running = null
    return last
  })()
  return running
}

export async function setAutoUpdate(on: boolean): Promise<void> {
  state.auto = on
  await save()
}

/** Loads saved state and clears leftovers. Call once at startup. */
export async function initToolUpdater(): Promise<void> {
  load()
  await sweepOld().catch(() => undefined)
}

/** True when an automatic check is allowed and due. */
export function autoCheckDue(): boolean {
  return state.auto === true && Date.now() - state.lastCheck > CHECK_EVERY
}

export { CHECK_EVERY }
