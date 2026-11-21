// LAB's preview player. It has its own <audio> element (LAB plays files the
// music bar doesn't know about), with one rule: only one thing plays at a time.
//   • LAB starts → the music bar pauses.
//   • The music bar starts → LAB pauses.
//   • Leaving the LAB page or changing the file → LAB stops.
// It plays either the source file or a processed preview render (Audio Prep);
// `time()` is always a position on the SOURCE timeline, so cursors line up.

import { createStore, useStore } from '@/shared/lib/store'
import { player as music, playerStore } from '@/features/player/model'

export interface LabPlayerState {
  src?: string
  playing: boolean
  duration: number
  /** Set when the browser can't play this format (analysis still works). */
  error: boolean
  /** Playing only this stretch (a section preview); stops at `until`. */
  range?: { from: number; until: number }
  /** 'preview' = the processed render from Audio Prep is loaded. */
  mode: 'source' | 'preview'
  /** Where the processed render starts on the source timeline. */
  previewBase: number
  previewUrl?: string
}

export const labPlayerStore = createStore<LabPlayerState>({ playing: false, duration: 0, error: false, mode: 'source', previewBase: 0 })
export const useLabPlayer = () => useStore(labPlayerStore)
const set = (p: Partial<LabPlayerState>) => labPlayerStore.set((s) => ({ ...s, ...p }))

const audio = new Audio()
audio.preload = 'auto'

audio.addEventListener('play', () => set({ playing: true }))
audio.addEventListener('pause', () => set({ playing: false }))
audio.addEventListener('ended', () => set({ playing: false, range: undefined }))
audio.addEventListener('durationchange', () => {
  if (labPlayerStore.get().mode === 'source') set({ duration: isFinite(audio.duration) ? audio.duration : 0 })
})
audio.addEventListener('error', () => {
  if (audio.getAttribute('src') && labPlayerStore.get().mode === 'source') set({ error: true, playing: false })
})

// A section preview stops itself at its end. Checked every frame, not on timeupdate (~250 ms late).
let raf = 0
const watch = () => {
  const r = labPlayerStore.get().range
  if (r && audio.currentTime >= r.until) {
    audio.pause()
    audio.currentTime = r.from
    set({ range: undefined })
  }
  if (!audio.paused) raf = requestAnimationFrame(watch)
}
audio.addEventListener('play', () => {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(watch)
})

// React only when music *starts* (stopped → playing). Its store also updates while it is
// pausing (a last timeupdate), which must not be mistaken for a start.
let musicWasPlaying = playerStore.get().playing
playerStore.subscribe(() => {
  const now = playerStore.get().playing
  if (now && !musicWasPlaying && !audio.paused) audio.pause()
  musicWasPlaying = now
})

function toSource() {
  const s = labPlayerStore.get()
  if (s.mode !== 'preview') return
  audio.pause()
  if (s.src) audio.src = s.src
  set({ mode: 'source', range: undefined })
}

export const labPlayer = {
  /** Playhead on the source timeline (also while a processed preview plays). */
  time: () => {
    const s = labPlayerStore.get()
    return s.mode === 'preview' ? s.previewBase + audio.currentTime : audio.currentTime
  },
  load(src: string | undefined) {
    audio.pause()
    if (src) audio.src = src
    else {
      audio.removeAttribute('src')
      audio.load()
    }
    set({ src, playing: false, duration: 0, error: false, range: undefined, mode: 'source', previewBase: 0, previewUrl: undefined })
  },
  /** Plays the source, optionally only from..until. */
  play(from?: number, until?: number) {
    if (!labPlayerStore.get().src) return
    toSource()
    music.pause()
    if (from != null && isFinite(from)) audio.currentTime = Math.max(0, from)
    set({ range: from != null && until != null && until > from ? { from, until } : undefined })
    void audio.play().catch(() => undefined)
  },
  /** Plays a processed render that starts at `base` on the source timeline. */
  playPreview(url: string, base: number, offset = 0) {
    music.pause()
    if (labPlayerStore.get().previewUrl !== url || labPlayerStore.get().mode !== 'preview') audio.src = url
    set({ mode: 'preview', previewBase: base, previewUrl: url, range: undefined })
    audio.currentTime = Math.max(0, offset)
    void audio.play().catch(() => undefined)
  },
  toggle() {
    if (audio.paused) {
      music.pause()
      void audio.play().catch(() => undefined)
    } else audio.pause()
  },
  pause: () => audio.pause(),
  /** Moves the playhead (source timeline). Inside a loaded preview it stays in the preview. */
  seek(sec: number) {
    if (!isFinite(sec)) return
    const s = labPlayerStore.get()
    if (s.mode === 'preview') {
      const rel = sec - s.previewBase
      if (rel >= 0 && rel <= (audio.duration || 0)) {
        audio.currentTime = rel
        return
      }
      const wasPlaying = !audio.paused
      toSource()
      audio.currentTime = Math.max(0, sec)
      if (wasPlaying) void audio.play().catch(() => undefined)
      return
    }
    audio.currentTime = Math.max(0, Math.min(sec, audio.duration || sec))
    set({ range: undefined })
  },
  /** Leaves a processed preview and goes back to the source file. */
  useSource: toSource
}
