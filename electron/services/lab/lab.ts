// LAB in the main process: which files are open, their metadata, the analysis
// cache, and the worker that does the heavy lifting.

import { app, dialog, shell, utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type {
  ExportDone,
  ExportSettings,
  KeyAnalysis,
  TempoAnalysis,
  LabAudioInfo,
  LabErrorCode,
  LabOpened,
  LabProgress,
  LabResult,
  LabSource,
  LabUserMeta,
  PeakReading,
  PreviewRender,
  WaveformData,
  WaveSlice
} from '../../../shared/types/lab'
import { sanitizeFilename, TEMP_NAME } from '../../lib/paths'
import { EXTENSION, measurePeak, processAudio, validateExport, validatePrep } from './prep'
import { log } from '../../lib/log'
import { requireTools } from '../binaries/tools'
import { savedPath } from '../jobs/jobManager'
import { listLibrary } from '../library/library'
import { LAB_MEDIA_HOST, labMedia } from '../library/mediaRegistry'
import { run } from '../runner/runner'
import { KEY_VERSION } from './dsp/key'
import { TEMPO_VERSION } from './dsp/tempo'
import { WAVEFORM_VERSION } from './dsp/waveform'
import type { WorkerIn, WorkerOut } from './worker'

/** What LAB opens: audio, and video files for their sound. */
export const LAB_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'aifc', 'alac', 'caf', 'mka', 'wv', 'ape', 'ac3', 'amr',
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', '3gp'
]
const LOSSLESS = /^(pcm_|flac|alac|wavpack|ape|tta|mlp|truehd)/

interface Entry {
  path: string
  identity: string
  source: LabSource
}
const sources = new Map<string, Entry>()
const MAX_OPEN = 12

// ---------- metadata ----------

async function probe(ffprobe: string, path: string): Promise<{ info: LabAudioInfo; artist?: string } | 'no-audio' | null> {
  const r = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', `file:${path}`], { timeoutMs: 30_000, maxStdout: 4 * 1024 * 1024 })
  if (r.code !== 0) return null
  try {
    const j = JSON.parse(r.stdout) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> }
    const num = (v: unknown) => {
      const x = typeof v === 'string' ? Number(v) : v
      return typeof x === 'number' && isFinite(x) && x > 0 ? x : undefined
    }
    const streams = j.streams ?? []
    const a = streams.find((s) => s.codec_type === 'audio')
    if (!a) return 'no-audio'
    const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition as Record<string, number> | undefined)?.attached_pic)
    const codec = String(a.codec_name ?? '')
    const lossless = LOSSLESS.test(codec)
    const bits = num(a.bits_per_raw_sample) ?? num(a.bits_per_sample)
    const fmt = String(a.sample_fmt ?? '')
    const float = /^flt|^dbl/.test(fmt) && codec.startsWith('pcm_')
    const tags = { ...((j.format?.tags as Record<string, string>) ?? {}), ...((a.tags as Record<string, string>) ?? {}) }
    const artist = tags.artist ?? tags.ARTIST ?? tags.album_artist
    const br = num(a.bit_rate) ?? (!v ? num(j.format?.bit_rate) : undefined)
    return {
      info: {
        durationSec: num(j.format?.duration) ?? num(a.duration),
        container: extname(path).slice(1).toUpperCase(),
        codec,
        sampleRateHz: num(a.sample_rate),
        channels: num(a.channels),
        bitDepth: lossless ? bits : undefined,
        floatSamples: float || undefined,
        bitrateKbps: !lossless && br ? Math.round(br / 1000) : undefined,
        sizeBytes: num(j.format?.size) ?? 0,
        hasVideo: !!v
      },
      artist: typeof artist === 'string' && artist.trim() ? artist.trim().slice(0, 200) : undefined
    }
  } catch {
    return null
  }
}

// ---------- cache (kept apart from the media file; never written into it) ----------

interface CacheFile {
  v: 1
  sizeBytes: number
  mtimeMs: number
  waveform?: WaveformData
  key?: KeyAnalysis
  tempo?: TempoAnalysis
  user?: LabUserMeta
}
const cacheDir = () => join(app.getPath('userData'), 'lab-cache')
const cachePath = (identity: string) => join(cacheDir(), `${identity}.json`)

async function readCache(identity: string): Promise<CacheFile | null> {
  try {
    const c = JSON.parse(await readFile(cachePath(identity), 'utf8')) as CacheFile
    if (c.v !== 1) return null
    // Results from an older analyzer version are not reused.
    if (c.waveform?.version !== WAVEFORM_VERSION) delete c.waveform
    if (c.key?.version !== KEY_VERSION) delete c.key
    if (c.tempo?.version !== TEMPO_VERSION) delete c.tempo
    return c
  } catch {
    return null
  }
}

let writing = Promise.resolve()
function updateCache(identity: string, meta: { sizeBytes: number; mtimeMs: number }, patch: Partial<CacheFile>): Promise<void> {
  writing = writing.then(async () => {
    try {
      await mkdir(cacheDir(), { recursive: true })
      const next: CacheFile = { ...((await readCache(identity)) ?? { v: 1, ...meta }), ...patch, v: 1, ...meta }
      const tmp = `${cachePath(identity)}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(next))
      await rename(tmp, cachePath(identity))
    } catch (e) {
      log.warn('lab cache write failed', (e as Error).message)
    }
  })
  return writing
}

/** Keeps the cache small: only the most recently used ~300 files. */
let pruned = false
async function pruneCache(): Promise<void> {
  if (pruned) return
  pruned = true
  try {
    const names = (await readdir(cacheDir())).filter((n) => n.endsWith('.json'))
    if (names.length <= 300) return
    const dated = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(cacheDir(), n))).mtimeMs })))
    dated.sort((a, b) => a.t - b.t)
    for (const { n } of dated.slice(0, dated.length - 300)) await unlink(join(cacheDir(), n)).catch(() => undefined)
  } catch {
    /* no cache yet */
  }
}

// ---------- opening files ----------

const fail = (code: LabErrorCode, message?: string): LabResult<never> => ({ ok: false, code, message })

async function open(path: string, extra: { origin: 'file' | 'library'; libraryId?: string; title?: string; creator?: string; artworkUrl?: string }): Promise<LabResult<LabOpened>> {
  const abs = resolve(path)
  let st
  try {
    st = await stat(abs)
  } catch {
    return fail('NOT_FOUND')
  }
  if (!st.isFile()) return fail('NOT_FOUND')
  if (!LAB_EXTENSIONS.includes(extname(abs).slice(1).toLowerCase())) return fail('UNSUPPORTED')
  const tools = await requireTools(['ffmpeg', 'ffprobe'])
  if (!tools) return fail('TOOLS_MISSING')
  const p = await probe(tools.ffprobe!, abs)
  if (p === 'no-audio') return fail('NO_AUDIO')
  if (!p) return fail('DECODE_FAILED', 'FFprobe could not read this file.')

  void pruneCache()
  const identity = createHash('sha1').update(`${abs}|${st.size}|${st.mtimeMs}`).digest('hex')
  const id = randomUUID()
  const source: LabSource = {
    id,
    origin: extra.origin,
    libraryId: extra.libraryId,
    title: extra.title || basename(abs, extname(abs)),
    creator: extra.creator ?? p.artist,
    artworkUrl: extra.artworkUrl,
    mediaUrl: `app-media://${LAB_MEDIA_HOST}/${id}`,
    info: { ...p.info, sizeBytes: st.size }
  }
  // Drop the oldest open file if many are open (each holds only a path and token).
  if (sources.size >= MAX_OPEN) {
    const oldest = sources.keys().next().value as string
    closeSource(oldest)
  }
  sources.set(id, { path: abs, identity, source })
  labMedia.set(id, abs)
  const cache = await readCache(identity)
  return { ok: true, value: { source, cached: { key: cache?.key, tempo: cache?.tempo, waveform: !!cache?.waveform }, user: cache?.user ?? {} } }
}

export async function pickFile(win: BrowserWindow | null): Promise<LabResult<LabOpened> | null> {
  const opts: Electron.OpenDialogOptions = {
    title: 'Choose audio for LAB',
    properties: ['openFile'],
    filters: [
      { name: 'Audio and video', extensions: LAB_EXTENSIONS },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths[0]) return null
  return open(r.filePaths[0], { origin: 'file' })
}

/** A file dropped on the window. The path came from the renderer, so it is checked like any input. */
export async function openDropped(path: unknown): Promise<LabResult<LabOpened>> {
  if (typeof path !== 'string' || !path || path.length > 2048 || path.includes('\u0000') || !isAbsolute(path)) return fail('UNSUPPORTED')
  return open(path, { origin: 'file' })
}

export async function openLibraryItem(id: unknown): Promise<LabResult<LabOpened>> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return fail('NOT_FOUND')
  const path = savedPath(id)
  if (!path) return fail('NOT_FOUND')
  const item = (await listLibrary()).find((i) => i.id === id)
  return open(path, { origin: 'library', libraryId: id, title: item?.title, creator: item?.creator, artworkUrl: item?.thumbnailUrl })
}

export function closeSource(id: unknown): void {
  if (typeof id !== 'string') return
  cancel(id)
  sources.delete(id)
  labMedia.delete(id)
  dropPreview(id)
}

// ---------- worker ----------

let worker: UtilityProcess | null = null
let idleTimer: NodeJS.Timeout | undefined
const pending = new Map<string, { sourceId: string; resolve: (r: LabResult<unknown>) => void; onProgress: (p: Omit<LabProgress, 'sourceId' | 'task'>) => void; canceled?: boolean }>()

function ensureWorker(): UtilityProcess {
  if (worker) return worker
  const w = utilityProcess.fork(join(__dirname, 'labWorker.js'), [], { serviceName: 'Stash LAB analysis', stdio: app.isPackaged ? 'ignore' : 'inherit' })
  w.on('message', (m: WorkerOut) => {
    const p = pending.get(m.jobId)
    if (!p) return
    if (m.type === 'progress') return p.onProgress({ stage: m.stage, fraction: m.fraction })
    pending.delete(m.jobId)
    p.resolve(m.ok ? { ok: true, value: m.value } : { ok: false, code: p.canceled ? 'CANCELED' : m.code, message: m.message })
    scheduleIdle()
  })
  w.on('exit', () => {
    if (worker === w) worker = null
    for (const [id, p] of pending) {
      pending.delete(id)
      p.resolve({ ok: false, code: p.canceled ? 'CANCELED' : 'FAILED', message: p.canceled ? undefined : 'The analysis process stopped unexpectedly.' })
    }
  })
  worker = w
  return w
}

/** Frees the worker (and the decoded audio it holds) after 2 idle minutes. */
function scheduleIdle(): void {
  clearTimeout(idleTimer)
  if (pending.size > 0) return
  idleTimer = setTimeout(() => {
    if (pending.size === 0) worker?.kill()
  }, 120_000)
  idleTimer.unref()
}

/** Stops work on a file: everything, or only one kind ('export', 'preview', 'analysis'). */
export function cancel(sourceId: unknown, kind?: unknown): void {
  if (typeof sourceId !== 'string') return
  if (kind === 'export' || kind === 'preview') return ops.get(sourceId)?.get(kind)?.abort()
  if (kind === undefined) for (const op of ops.get(sourceId)?.values() ?? []) op.abort()
  for (const [jobId, p] of pending) {
    if (p.sourceId !== sourceId) continue
    p.canceled = true
    worker?.postMessage({ type: 'cancel', jobId } satisfies WorkerIn)
    // Decoding stops at once; a running analysis can't be interrupted, so end the process.
    setTimeout(() => pending.has(jobId) && worker?.kill(), 300)
  }
}

/** Running FFmpeg operations per source (preview, export, peak), so Cancel and Close can stop them. */
const ops = new Map<string, Map<string, AbortController>>()
function startOp(sourceId: string, kind: string): AbortController {
  let m = ops.get(sourceId)
  if (!m) ops.set(sourceId, (m = new Map()))
  m.get(kind)?.abort() // a newer request of the same kind replaces the old one
  const c = new AbortController()
  m.set(kind, c)
  return c
}
function endOp(sourceId: string, kind: string, c: AbortController): void {
  if (ops.get(sourceId)?.get(kind) === c) ops.get(sourceId)!.delete(kind)
}

export async function runTask(sourceId: unknown, task: 'prepare' | 'key' | 'tempo', force: boolean, onProgress: (p: LabProgress) => void): Promise<LabResult<WaveformData | KeyAnalysis | TempoAnalysis>> {
  const e = typeof sourceId === 'string' ? sources.get(sourceId) : undefined
  if (!e) return fail('NOT_FOUND')
  // The file may have changed since it was opened; then it needs opening again.
  let st
  try {
    st = await stat(e.path)
  } catch {
    return fail('NOT_FOUND')
  }
  const meta = { sizeBytes: st.size, mtimeMs: st.mtimeMs }
  const identity = createHash('sha1').update(`${e.path}|${st.size}|${st.mtimeMs}`).digest('hex')
  if (identity !== e.identity) return fail('NOT_FOUND', 'The file changed on disk. Open it again.')

  if (!force) {
    const c = await readCache(identity)
    if (task === 'prepare' && c?.waveform) return { ok: true, value: c.waveform, cached: true }
    if (task === 'key' && c?.key) return { ok: true, value: c.key, cached: true }
    if (task === 'tempo' && c?.tempo) return { ok: true, value: c.tempo, cached: true }
  }
  const tools = await requireTools(['ffmpeg'])
  if (!tools) return fail('TOOLS_MISSING')

  clearTimeout(idleTimer)
  const jobId = randomUUID()
  const r = await new Promise<LabResult<unknown>>((resolveJob) => {
    pending.set(jobId, { sourceId: e.source.id, resolve: resolveJob, onProgress: (p) => onProgress({ sourceId: e.source.id, task, ...p }) })
    ensureWorker().postMessage({ type: 'run', jobId, task, ffmpeg: tools.ffmpeg!, path: e.path, identity, durationSec: e.source.info.durationSec } satisfies WorkerIn)
  })
  if (!r.ok) {
    if (r.code !== 'CANCELED') log.warn('lab task failed', task, r.code, r.message)
    return r
  }
  if (task === 'prepare') {
    await updateCache(identity, meta, { waveform: r.value as WaveformData })
    return { ok: true, value: r.value as WaveformData }
  }
  if (task === 'tempo') {
    const tempo = { ...(r.value as Omit<TempoAnalysis, 'analyzedAt'>), analyzedAt: new Date().toISOString() } as TempoAnalysis
    await updateCache(identity, meta, { tempo })
    return { ok: true, value: tempo }
  }
  const key = { ...(r.value as Omit<KeyAnalysis, 'analyzedAt'>), analyzedAt: new Date().toISOString() } as KeyAnalysis
  await updateCache(identity, meta, { key })
  return { ok: true, value: key }
}

/** The user's confirmed key and tempo, validated field by field. Only the fields given change. */
export async function saveUser(sourceId: unknown, meta: unknown): Promise<boolean> {
  const e = typeof sourceId === 'string' ? sources.get(sourceId) : undefined
  if (!e || typeof meta !== 'object' || meta === null) return false
  const m = meta as Record<string, unknown>
  const next: LabUserMeta = { ...((await readCache(e.identity))?.user ?? {}) }
  if ('key' in m) {
    const k = m.key as LabUserMeta['key']
    if (k === undefined || k === null) delete next.key
    else if (
      typeof k !== 'object' ||
      !Number.isInteger(k.tonic) ||
      k.tonic < 0 ||
      k.tonic > 11 ||
      (k.mode !== 'major' && k.mode !== 'minor') ||
      (k.spelling !== 'sharp' && k.spelling !== 'flat')
    )
      return false
    else next.key = { tonic: k.tonic, mode: k.mode, spelling: k.spelling, confirmedAt: new Date().toISOString() }
  }
  if ('tempo' in m) {
    const t = m.tempo as LabUserMeta['tempo']
    if (t === undefined || t === null) delete next.tempo
    else if (
      typeof t !== 'object' ||
      typeof t.bpm !== 'number' ||
      !(t.bpm >= 20 && t.bpm <= 400) ||
      !['auto', 'tap', 'manual'].includes(t.via) ||
      (t.gridStart !== undefined && !(typeof t.gridStart === 'number' && Number.isFinite(t.gridStart) && t.gridStart >= 0))
    )
      return false
    else next.tempo = { bpm: Math.round(t.bpm * 100) / 100, via: t.via, gridStart: t.gridStart, confirmedAt: new Date().toISOString() }
  }
  try {
    const st = await stat(e.path)
    await updateCache(e.identity, { sizeBytes: st.size, mtimeMs: st.mtimeMs }, { user: next })
    return true
  } catch {
    return false
  }
}

// ---------- Audio Prep ----------

/** Waveform columns for a zoomed range, from the already-decoded audio. */
export async function slicePeaks(sourceId: unknown, from: unknown, to: unknown, columns: unknown): Promise<LabResult<WaveSlice>> {
  const e = typeof sourceId === 'string' ? sources.get(sourceId) : undefined
  if (!e) return fail('NOT_FOUND')
  if (typeof from !== 'number' || typeof to !== 'number' || typeof columns !== 'number' || !(to > from) || from < 0 || !Number.isFinite(to)) return fail('FAILED')
  const tools = await requireTools(['ffmpeg'])
  if (!tools) return fail('TOOLS_MISSING')
  clearTimeout(idleTimer)
  const jobId = randomUUID()
  const r = await new Promise<LabResult<unknown>>((resolveJob) => {
    pending.set(jobId, { sourceId: e.source.id, resolve: resolveJob, onProgress: () => undefined })
    ensureWorker().postMessage({
      type: 'run',
      jobId,
      task: 'peaks',
      range: { from, to, columns: Math.max(16, Math.min(200_000, Math.round(columns))) },
      ffmpeg: tools.ffmpeg!,
      path: e.path,
      identity: e.identity,
      durationSec: e.source.info.durationSec
    } satisfies WorkerIn)
  })
  return r as LabResult<WaveSlice>
}

/** The decoded mono signal, for playback when the browser can't decode the format itself. */
export async function decodedPcm(sourceId: unknown): Promise<LabResult<{ sampleRate: number; data: Float32Array }>> {
  const e = typeof sourceId === 'string' ? sources.get(sourceId) : undefined
  if (!e) return fail('NOT_FOUND')
  const tools = await requireTools(['ffmpeg'])
  if (!tools) return fail('TOOLS_MISSING')
  clearTimeout(idleTimer)
  const jobId = randomUUID()
  const r = await new Promise<LabResult<unknown>>((resolveJob) => {
    pending.set(jobId, { sourceId: e.source.id, resolve: resolveJob, onProgress: () => undefined })
    ensureWorker().postMessage({ type: 'run', jobId, task: 'pcm', ffmpeg: tools.ffmpeg!, path: e.path, identity: e.identity, durationSec: e.source.info.durationSec } satisfies WorkerIn)
  })
  return r as LabResult<{ sampleRate: number; data: Float32Array }>
}

/** Sample peak of the selection, so the gain control can warn about clipping. */
export async function measure(sourceId: unknown, region: unknown): Promise<LabResult<PeakReading>> {
  const e = typeof sourceId === 'string' ? sources.get(sourceId) : undefined
  if (!e) return fail('NOT_FOUND')
  const s = validatePrep({ fadeInMs: 0, fadeOutMs: 0, gainDb: 0, ...(region as object) }, e.source.info.durationSec)
  if (!s) return fail('FAILED')
  const tools = await requireTools(['ffmpeg'])
  if (!tools) return fail('TOOLS_MISSING')
  const c = startOp(e.source.id, 'measure')
  try {
    const peak = await measurePeak(tools.ffmpeg!, e.path, s, e.source.info.sampleRateHz, c.signal)
    if (c.signal.aborted) return fail('CANCELED')
    return peak === undefined ? fail('FAILED', 'Could not measure the level.') : { ok: true, value: { peakDb: peak } }
  } finally {
    endOp(e.source.id, 'measure', c)
  }
}

const previewDir = () => join(tmpdir(), TEMP_NAME, 'lab-preview')
const previews = new Map<string, { token: string; path: string }>()
const MAX_PREVIEW_SEC = 15 * 60

function dropPreview(sourceId: string): void {
  const old = previews.get(sourceId)
  if (!old) return
  previews.delete(sourceId)
  labMedia.delete(old.token)
  void unlink(old.path).catch(() => undefined)
}

/** Removes leftover preview files (called at quit). */
export async function clearPreviews(): Promise<void> {
  for (const id of [...previews.keys()]) dropPreview(id)
  await rm(previewDir(), { recursive: true, force: true }).catch(() => undefined)
}

/**
 * Renders the selection with the same trim, gain and fades as the export, as a
 * 16-bit WAV to a temporary file, so the preview is what the export will sound like
 * (before format encoding).
 */
export async function renderPreview(sourceId: unknown, rawPrep: unknown, onProgress: (p: LabProgress) => void): Promise<LabResult<PreviewRender>> {
  const e = typeof sourceId === 'string' ? sources.get(sourceId) : undefined
  if (!e) return fail('NOT_FOUND')
  const s = validatePrep(rawPrep, e.source.info.durationSec)
  if (!s) return fail('FAILED', 'Invalid selection.')
  if (s.end - s.start > MAX_PREVIEW_SEC) return fail('TOO_LONG', 'Preview is limited to 15 minutes. Shorten the selection.')
  const tools = await requireTools(['ffmpeg'])
  if (!tools) return fail('TOOLS_MISSING')
  await mkdir(previewDir(), { recursive: true })
  const token = randomUUID()
  const output = join(previewDir(), `${token}.wav`)
  const c = startOp(e.source.id, 'preview')
  const r = await processAudio({
    ffmpeg: tools.ffmpeg!,
    input: e.path,
    output,
    settings: s,
    out: 'preview',
    sourceRate: e.source.info.sampleRateHz,
    sourceChannels: e.source.info.channels,
    signal: c.signal,
    onProgress: (f) => onProgress({ sourceId: e.source.id, task: 'preview', stage: 'analyzing', fraction: f })
  })
  endOp(e.source.id, 'preview', c)
  if (!r.ok) return fail(r.canceled ? 'CANCELED' : 'DECODE_FAILED', r.canceled ? undefined : r.message)
  dropPreview(e.source.id)
  previews.set(e.source.id, { token, path: output })
  labMedia.set(token, output)
  return { ok: true, value: { url: `app-media://${LAB_MEDIA_HOST}/${token}`, startSec: s.start, durationSec: s.end - s.start } }
}

let lastExportDir: string | undefined
const exported = new Set<string>()
const FORMAT_NAME: Record<ExportSettings['format'], string> = { wav: 'WAV audio', flac: 'FLAC audio', mp3: 'MP3 audio', m4a: 'M4A (AAC) audio' }
const samePath = (a: string, b: string) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b))

/** Asks where to save, renders, then reads the result back with FFprobe. null = the save dialog was closed. */
export async function exportAudio(
  win: BrowserWindow | null,
  sourceId: unknown,
  rawPrep: unknown,
  rawExport: unknown,
  rawName: unknown,
  onProgress: (p: LabProgress) => void
): Promise<LabResult<ExportDone> | null> {
  const e = typeof sourceId === 'string' ? sources.get(sourceId) : undefined
  if (!e) return fail('NOT_FOUND')
  const s = validatePrep(rawPrep, e.source.info.durationSec)
  const x = validateExport(rawExport)
  if (!s || !x) return fail('FAILED', 'Invalid export settings.')
  const tools = await requireTools(['ffmpeg', 'ffprobe'])
  if (!tools) return fail('TOOLS_MISSING')

  const ext = EXTENSION[x.format]
  const name = `${sanitizeFilename(typeof rawName === 'string' ? rawName.replace(/\.[a-z0-9]{2,4}$/i, '') : '', 'export')}.${ext}`
  const opts: Electron.SaveDialogOptions = {
    title: 'Export audio',
    defaultPath: join(lastExportDir ?? app.getPath('music'), name),
    filters: [{ name: FORMAT_NAME[x.format], extensions: [ext] }],
    properties: ['showOverwriteConfirmation', 'createDirectory']
  }
  const pick = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (pick.canceled || !pick.filePath) return null
  let out = resolve(pick.filePath)
  if (extname(out).slice(1).toLowerCase() !== ext) out = `${out}.${ext}`
  // The original is never overwritten.
  if (samePath(out, e.path)) return fail('FAILED', "That's the original file. Choose a different name or folder.")
  lastExportDir = dirname(out)

  const c = startOp(e.source.id, 'export')
  const r = await processAudio({
    ffmpeg: tools.ffmpeg!,
    input: e.path,
    output: out,
    settings: s,
    out: x,
    sourceRate: e.source.info.sampleRateHz,
    sourceChannels: e.source.info.channels,
    signal: c.signal,
    onProgress: (f) => onProgress({ sourceId: e.source.id, task: 'export', stage: 'analyzing', fraction: f })
  })
  endOp(e.source.id, 'export', c)
  if (!r.ok) {
    if (!r.canceled) log.warn('lab export failed', r.message)
    return fail(r.canceled ? 'CANCELED' : 'FAILED', r.canceled ? undefined : r.message)
  }
  exported.add(out)
  const p = await probe(tools.ffprobe!, out)
  const info = p && p !== 'no-audio' ? p.info : undefined
  let size = 0
  try {
    size = (await stat(out)).size
  } catch {
    /* reported as 0 */
  }
  return {
    ok: true,
    value: {
      path: out,
      name: basename(out),
      output: { durationSec: info?.durationSec, codec: info?.codec, sampleRateHz: info?.sampleRateHz, channels: info?.channels, bitDepth: info?.bitDepth, sizeBytes: size }
    }
  }
}

/** Shows an exported file in Explorer (only files LAB just wrote). */
export function revealExport(path: unknown): boolean {
  if (typeof path !== 'string' || !exported.has(path)) return false
  shell.showItemInFolder(path)
  return true
}
