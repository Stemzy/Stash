// The LAB workspace: one selected file shared by every tool, its waveform, the
// automatic analyses, and the user's own confirmed values (kept separate).

import type {
  ConfirmedKey,
  ExportDone,
  ExportPreset,
  ExportSettings,
  KeyAnalysis,
  LabAudioInfo,
  LabErrorCode,
  LabOpened,
  LabProgress,
  LabResult,
  LabSource,
  LabTool,
  LabUserMeta,
  PrepSettings,
  PreviewRender,
  TempoAnalysis,
  WaveformData
} from '@shared/types/lab'
import { api } from '@/shared/api'
import { createStore, useStore } from '@/shared/lib/store'
import { setPageArtwork } from '@/widgets/AmbientBackdrop'
import { notify } from '@/shared/ui/toast'
import { labPlayer } from './player'

export interface Task<T> {
  status: 'idle' | 'running' | 'done' | 'error'
  value?: T
  error?: string
  /** The result came from an earlier analysis of the same file. */
  cached?: boolean
  progress?: { stage: LabProgress['stage']; fraction?: number }
}

export interface LabState {
  tool: LabTool
  opening: boolean
  openError?: string
  source?: LabSource
  waveform: Task<WaveformData>
  key: Task<KeyAnalysis>
  tempo: Task<TempoAnalysis>
  /** The BPM and grid being checked/adjusted right now (not saved until confirmed). */
  tempoWork?: { bpm: number; gridStart: number; via: 'auto' | 'tap' | 'manual' }
  user: LabUserMeta
  /** Audio Prep: the selection and processing. Shared, so later tools can reuse the selection. */
  prep: PrepSettings
  /** Sample peak (dBFS) of the current selection, before gain. */
  peak: { status: 'idle' | 'measuring' | 'done' | 'error'; peakDb?: number | null; for?: string }
  preview: { status: 'idle' | 'rendering' | 'ready' | 'error'; render?: PreviewRender; for?: string; fraction?: number; error?: string }
  exportCfg: { preset: ExportPreset; custom: ExportSettings }
  exporting: Task<ExportDone>
}

const idle = { status: 'idle' } as const
const PREP0: PrepSettings = { start: 0, end: 0, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 }
const DEFAULT_CUSTOM: ExportSettings = { format: 'wav', bitDepth: 24, bitrateKbps: 320, sampleRate: 'source', channels: 'source' }
// Storage key from before the app was renamed to Stash; kept so saved settings carry over.
const CFG_KEY = 'downloader.lab.export.v1'
const savedCfg = ((): LabState['exportCfg'] => {
  try {
    const v = JSON.parse(localStorage.getItem(CFG_KEY) ?? 'null') as LabState['exportCfg'] | null
    if (v && ['producer', 'hq', 'mp3', 'custom'].includes(v.preset)) return { preset: v.preset, custom: { ...DEFAULT_CUSTOM, ...v.custom } }
  } catch {
    /* defaults */
  }
  return { preset: 'producer', custom: DEFAULT_CUSTOM }
})()
export const labStore = createStore<LabState>({
  tool: 'key',
  opening: false,
  waveform: idle,
  key: idle,
  tempo: idle,
  user: {},
  prep: PREP0,
  peak: { status: 'idle' },
  preview: { status: 'idle' },
  exportCfg: savedCfg,
  exporting: idle
})
export const useLab = () => useStore(labStore)
const patch = (p: Partial<LabState> | ((s: LabState) => Partial<LabState>)) => labStore.set((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }))

export function errorText(code: LabErrorCode, message?: string): string {
  switch (code) {
    case 'TOOLS_MISSING':
      return 'FFmpeg and FFprobe are needed for LAB. Check Settings → Tools.'
    case 'NOT_FOUND':
      return message ?? "The file wasn't found. It may have been moved or deleted."
    case 'UNSUPPORTED':
      return "That isn't an audio or video file LAB can open."
    case 'NO_AUDIO':
      return 'This file has no audio track.'
    case 'TOO_LONG':
      return 'This file is longer than 40 minutes, which LAB doesn’t analyze.'
    case 'DECODE_FAILED':
      return 'FFmpeg could not decode this file.' + (message ? ` (${message})` : '')
    case 'CANCELED':
      return 'Canceled.'
    default:
      return 'Something went wrong while analyzing.' + (message ? ` (${message})` : '')
  }
}

api.lab.onProgress((p) => {
  const s = labStore.get()
  if (p.sourceId !== s.source?.id) return
  if (p.task === 'preview') return patch((st) => ({ preview: { ...st.preview, fraction: p.fraction } }))
  if (p.task === 'export') return patch((st) => ({ exporting: { ...st.exporting, progress: { stage: p.stage, fraction: p.fraction } } }))
  const field = p.task === 'prepare' ? 'waveform' : p.task === 'tempo' ? 'tempo' : 'key'
  if (s[field].status !== 'running') return
  patch((st) => ({ [field]: { ...st[field], progress: { stage: p.stage, fraction: p.fraction } } }))
})

let openSeq = 0

async function adopt(r: LabResult<LabOpened> | null, seq: number): Promise<void> {
  if (seq !== openSeq) return
  if (!r) return patch({ opening: false }) // dialog closed
  if (!r.ok) return patch({ opening: false, openError: errorText(r.code, r.message) })
  const prev = labStore.get().source
  if (prev) {
    flushTempoSave()
    void api.lab.close(prev.id)
  }
  const { source, cached, user } = r.value
  labPlayer.load(source.mediaUrl)
  setPageArtwork('lab', source.artworkUrl)
  patch({
    opening: false,
    openError: undefined,
    source,
    user,
    waveform: { status: 'running' },
    // A cached analysis of this exact file is shown at once.
    key: cached.key ? { status: 'done', value: cached.key, cached: true } : idle,
    tempo: cached.tempo ? { status: 'done', value: cached.tempo, cached: true } : idle,
    tempoWork: workFrom(user, cached.tempo),
    prep: { ...PREP0, end: source.info.durationSec ?? 0 },
    peak: { status: 'idle' },
    preview: { status: 'idle' },
    exporting: idle
  })
  const waveform = api.lab.waveform(source.id)
  // Key and BPM are always found right away (one shared decode). Cached results are reused.
  if (!cached.key) void labActions.analyzeKey()
  if (!cached.tempo) void tempoActions.analyze()
  const w = await waveform
  if (labStore.get().source?.id !== source.id) return
  patch({ waveform: w.ok ? { status: 'done', value: w.value, cached: w.cached } : { status: 'error', error: errorText(w.code, w.message) } })
}

/** The confirmed tempo if there is one, else the automatic estimate. */
function workFrom(user: LabUserMeta, t?: TempoAnalysis): LabState['tempoWork'] {
  if (user.tempo) return { bpm: user.tempo.bpm, gridStart: user.tempo.gridStart ?? t?.gridStart ?? 0, via: user.tempo.via }
  if (t?.bpm) return { bpm: t.bpm, gridStart: t.gridStart ?? t.beats[0] ?? 0, via: 'auto' }
  return undefined
}

const begin = () => {
  patch({ opening: true, openError: undefined })
  return ++openSeq
}

export const labActions = {
  setTool: (tool: LabTool) => patch({ tool }),
  async pickFile() {
    const seq = begin()
    await adopt(await api.lab.pickFile(), seq)
  },
  async openDropped(file: File) {
    const seq = begin()
    await adopt(await api.lab.openDropped(file), seq)
  },
  async openLibrary(libraryId: string) {
    if (labStore.get().source?.libraryId === libraryId) return
    const seq = begin()
    await adopt(await api.lab.openLibrary(libraryId), seq)
  },
  dismissError: () => patch({ openError: undefined }),
  close() {
    const s = labStore.get()
    if (s.source) void api.lab.close(s.source.id)
    openSeq++
    labPlayer.load(undefined)
    setPageArtwork('lab', undefined)
    patch({ source: undefined, waveform: idle, key: idle, tempo: idle, tempoWork: undefined, user: {}, opening: false, prep: PREP0, peak: { status: 'idle' }, preview: { status: 'idle' }, exporting: idle })
  },
  async analyzeKey(force = false) {
    const s = labStore.get()
    if (!s.source || s.key.status === 'running') return
    const id = s.source.id
    const prev = s.key.value
    patch({ key: { status: 'running', value: prev, progress: { stage: 'decoding' } } })
    // "Analyze again" redoes the BPM too; otherwise it's only found if missing.
    if (force || s.tempo.status === 'idle' || s.tempo.status === 'error') void tempoActions.analyze(force)
    const r = await api.lab.analyzeKey(id, force)
    if (labStore.get().source?.id !== id) return
    if (r.ok) patch({ key: { status: 'done', value: r.value, cached: r.cached } })
    else if (r.code === 'CANCELED') patch({ key: prev ? { status: 'done', value: prev } : idle })
    else patch({ key: { status: 'error', value: prev, error: errorText(r.code, r.message) } })
  },
  cancel() {
    const s = labStore.get()
    if (s.source) void api.lab.cancel(s.source.id, 'analysis')
  },
  /** The user's own key. The automatic estimate stays as it was. */
  async confirmKey(key: Omit<ConfirmedKey, 'confirmedAt'> | undefined) {
    const s = labStore.get()
    if (!s.source) return false
    const user: LabUserMeta = key ? { ...s.user, key: { ...key, confirmedAt: new Date().toISOString() } } : { ...s.user, key: undefined }
    patch({ user })
    return api.lab.saveUser(s.source.id, { key: user.key ?? null }) // null = remove
  }
}

// ---------- Audio Prep ----------

export const MIN_SELECTION = 0.01
export const prepKey = (p: PrepSettings) => `${p.start.toFixed(4)}|${p.end.toFixed(4)}|${p.fadeInMs}|${p.fadeOutMs}|${p.gainDb}`
const regionKey = (p: PrepSettings) => `${p.start.toFixed(4)}|${p.end.toFixed(4)}`

/** The real settings each preset stands for, given the source. */
export function presetSettings(preset: ExportPreset, info: LabAudioInfo | undefined, custom: ExportSettings): ExportSettings {
  const ch: ExportSettings['channels'] = info?.channels && info.channels > 2 ? 2 : 'source'
  switch (preset) {
    case 'producer':
      return { format: 'wav', bitDepth: 24, bitrateKbps: 320, sampleRate: 'source', channels: ch }
    case 'hq':
      // Lossless at the source's own rate; 16-bit stays 16-bit (24 would add nothing).
      return { format: 'flac', bitDepth: info?.bitDepth === 16 ? 16 : 24, bitrateKbps: 320, sampleRate: 'source', channels: ch }
    case 'mp3':
      // MP3 tops out at 48 kHz.
      return { format: 'mp3', bitDepth: 16, bitrateKbps: 320, sampleRate: (info?.sampleRateHz ?? 0) > 48000 ? 48000 : 'source', channels: ch }
    case 'custom':
      // MP3 can't go above 48 kHz.
      if (custom.format === 'mp3' && (custom.sampleRate === 96000 || (custom.sampleRate === 'source' && (info?.sampleRateHz ?? 0) > 48000))) return { ...custom, sampleRate: 48000 }
      return custom
  }
}

let measureTimer: ReturnType<typeof setTimeout> | undefined
function scheduleMeasure() {
  clearTimeout(measureTimer)
  measureTimer = setTimeout(() => void measureNow(), 350)
}
async function measureNow() {
  const s = labStore.get()
  if (!s.source || s.prep.end - s.prep.start < MIN_SELECTION) return
  const key = regionKey(s.prep)
  if (s.peak.for === key && s.peak.status === 'done') return
  const id = s.source.id
  patch((st) => ({ peak: { ...st.peak, status: 'measuring', for: key } }))
  const r = await api.lab.measure(id, { start: s.prep.start, end: s.prep.end })
  const now = labStore.get()
  if (now.source?.id !== id || regionKey(now.prep) !== key) return
  if (r.ok) patch({ peak: { status: 'done', peakDb: r.value.peakDb, for: key } })
  else if (r.code !== 'CANCELED') patch({ peak: { status: 'error', for: key } })
}

export const prepActions = {
  /** Changes the selection or processing; keeps it valid (inside the file, at least 10 ms). */
  set(p: Partial<PrepSettings>) {
    const s = labStore.get()
    const dur = s.source?.info.durationSec ?? s.waveform.value?.durationSec ?? 0
    const next = { ...s.prep, ...p }
    next.start = Math.max(0, Math.min(next.start, dur - MIN_SELECTION))
    next.end = Math.max(next.start + MIN_SELECTION, Math.min(next.end, dur))
    if (p.start != null && p.end == null && next.end - next.start < MIN_SELECTION) next.start = next.end - MIN_SELECTION
    next.fadeInMs = Math.max(0, Math.min(60000, Math.round(next.fadeInMs)))
    next.fadeOutMs = Math.max(0, Math.min(60000, Math.round(next.fadeOutMs)))
    next.gainDb = Math.max(-48, Math.min(24, Math.round(next.gainDb * 10) / 10))
    const regionMoved = regionKey(next) !== regionKey(s.prep)
    patch({ prep: next })
    if (regionMoved) scheduleMeasure()
  },
  reset() {
    const s = labStore.get()
    prepActions.set({ start: 0, end: s.source?.info.durationSec ?? 0 })
  },
  playOriginal() {
    const { prep } = labStore.get()
    labPlayer.play(prep.start, prep.end)
  },
  /** Plays the processed selection, rendering it first if the settings changed. */
  async playProcessed() {
    const s = labStore.get()
    if (!s.source) return
    const key = prepKey(s.prep)
    if (s.preview.status === 'ready' && s.preview.for === key && s.preview.render) {
      return labPlayer.playPreview(s.preview.render.url, s.preview.render.startSec)
    }
    if (s.preview.status === 'rendering' && s.preview.for === key) return
    const id = s.source.id
    labPlayer.pause()
    patch({ preview: { status: 'rendering', for: key, fraction: 0 } })
    const r = await api.lab.preview(id, s.prep)
    const now = labStore.get()
    if (now.source?.id !== id || now.preview.for !== key) return
    if (r.ok) {
      patch({ preview: { status: 'ready', render: r.value, for: key } })
      labPlayer.playPreview(r.value.url, r.value.startSec)
    } else if (r.code === 'CANCELED') patch({ preview: { status: 'idle' } })
    else patch({ preview: { status: 'error', for: key, error: errorText(r.code, r.message) } })
  },
  setPreset(preset: ExportPreset) {
    patch((s) => ({ exportCfg: { ...s.exportCfg, preset } }))
    persistCfg()
  },
  setCustom(p: Partial<ExportSettings>) {
    patch((s) => {
      const custom = { ...s.exportCfg.custom, ...p }
      if (custom.format === 'flac' && custom.bitDepth === 32) custom.bitDepth = 24
      return { exportCfg: { preset: 'custom', custom } }
    })
    persistCfg()
  },
  async exportNow(name: string) {
    const s = labStore.get()
    if (!s.source || s.exporting.status === 'running') return
    const id = s.source.id
    const settings = presetSettings(s.exportCfg.preset, s.source.info, s.exportCfg.custom)
    patch({ exporting: { status: 'running', progress: { stage: 'analyzing', fraction: 0 } } })
    const r = await api.lab.exportAudio(id, s.prep, settings, name)
    if (labStore.get().source?.id !== id) return
    if (r === null) return patch({ exporting: idle }) // save dialog closed
    if (r.ok) {
      patch({ exporting: { status: 'done', value: r.value } })
      notify({ tone: 'success', title: 'Exported', body: r.value.name })
    } else if (r.code === 'CANCELED') patch({ exporting: idle })
    else patch({ exporting: { status: 'error', error: r.message ?? errorText(r.code) } })
  },
  cancelExport() {
    const s = labStore.get()
    if (s.source) void api.lab.cancel(s.source.id, 'export')
  },
  cancelPreview() {
    const s = labStore.get()
    if (s.source) void api.lab.cancel(s.source.id, 'preview')
  }
}

function persistCfg() {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(labStore.get().exportCfg))
  } catch {
    /* not critical */
  }
}

// ---------- Tempo ----------

export const tempoActions = {
  async analyze(force = false) {
    const s = labStore.get()
    if (!s.source || s.tempo.status === 'running') return
    const id = s.source.id
    const prev = s.tempo.value
    patch({ tempo: { status: 'running', value: prev, progress: { stage: 'decoding' } } })
    const r = await api.lab.analyzeTempo(id, force)
    if (labStore.get().source?.id !== id) return
    if (r.ok) {
      patch((st) => ({
        tempo: { status: 'done', value: r.value, cached: r.cached },
        // A fresh estimate becomes the working tempo, unless the user already confirmed one.
        tempoWork: st.user.tempo ? st.tempoWork : workFrom(st.user, r.value)
      }))
    } else if (r.code === 'CANCELED') patch({ tempo: prev ? { status: 'done', value: prev } : idle })
    else patch({ tempo: { status: 'error', value: prev, error: errorText(r.code, r.message) } })
  },
  /** Changes the BPM (tap, typing, ÷2, ×2, picking a reading, lining up clicks). Saved automatically. */
  setWork(p: Partial<NonNullable<LabState['tempoWork']>>) {
    patch((s) => {
      const base = s.tempoWork ?? { bpm: 120, gridStart: s.tempo.value?.gridStart ?? 0, via: 'manual' as const }
      const next = { ...base, ...p }
      next.bpm = Math.max(20, Math.min(400, Math.round(next.bpm * 100) / 100))
      const period = 60 / next.bpm
      // Keep the grid start within the first beat period.
      next.gridStart = ((next.gridStart % period) + period) % period
      return { tempoWork: next }
    })
    scheduleTempoSave()
  },
  async confirm() {
    const s = labStore.get()
    if (!s.source || !s.tempoWork) return false
    const tempo = { bpm: s.tempoWork.bpm, via: s.tempoWork.via, gridStart: Math.round(s.tempoWork.gridStart * 1000) / 1000, confirmedAt: new Date().toISOString() }
    patch({ user: { ...s.user, tempo } })
    return api.lab.saveUser(s.source.id, { tempo })
  },
  /** Back to the detected BPM (removes the user's own). */
  async unconfirm() {
    clearTimeout(saveTimer)
    const s = labStore.get()
    if (!s.source) return false
    patch({ user: { ...s.user, tempo: undefined }, tempoWork: workFrom({}, s.tempo.value) })
    return api.lab.saveUser(s.source.id, { tempo: null })
  }
}

// The user's BPM is saved shortly after the last change, for the file it was made on.
let saveTimer: ReturnType<typeof setTimeout> | undefined
/** Saves a pending change now (before another file replaces this one). */
function flushTempoSave() {
  if (saveTimer === undefined) return
  clearTimeout(saveTimer)
  saveTimer = undefined
  void tempoActions.confirm()
}
function scheduleTempoSave() {
  clearTimeout(saveTimer)
  const id = labStore.get().source?.id
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    if (labStore.get().source?.id === id) void tempoActions.confirm()
  }, 400)
}
