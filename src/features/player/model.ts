// Music playback state. One <audio> element for the whole app, so music keeps
// playing while you move between pages. Video uses its own element in the
// Library page and pauses the music when it starts.

import type { LibraryItem } from '@shared/types/library'
import { createStore, useStore } from '@/shared/lib/store'
import { analyse, liveStore } from './live'

export interface PlayerState {
  current?: LibraryItem
  /** The list "Next" and "Previous" move through (the Music list when you pressed play). */
  queue: LibraryItem[]
  playing: boolean
  time: number
  duration: number
  volume: number
  muted: boolean
  error: boolean
  shuffle: boolean
  /** off: stop at the end of the list; all: start the list again; one: repeat this song. */
  repeat: 'off' | 'all' | 'one'
}

// Storage key from before the app was renamed to Stash; kept so saved settings carry over.
const VOL_KEY = 'downloader.volume'
const savedVol = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(VOL_KEY) ?? 'null') as { volume?: number; muted?: boolean; shuffle?: boolean; repeat?: string } | null
    return {
      volume: typeof v?.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : 0.8,
      muted: !!v?.muted,
      shuffle: v?.shuffle === true,
      repeat: (v?.repeat === 'all' || v?.repeat === 'one' ? v.repeat : 'off') as PlayerState['repeat']
    }
  } catch {
    return { volume: 0.8, muted: false, shuffle: false, repeat: 'off' as const }
  }
})()

export const playerStore = createStore<PlayerState>({ queue: [], playing: false, time: 0, duration: 0, error: false, ...savedVol })
export const usePlayer = () => useStore(playerStore)

const audio = new Audio()
audio.preload = 'metadata'
audio.crossOrigin = 'anonymous' // lets the moving background read the beat
audio.volume = savedVol.volume
audio.muted = savedVol.muted

const set = (p: Partial<PlayerState>) => playerStore.set((s) => ({ ...s, ...p }))

audio.addEventListener('play', () => {
  set({ playing: true })
  analyse(audio)
  if (liveStore.get().mode !== 'video') liveStore.set({ mode: 'music' })
})
audio.addEventListener('pause', () => {
  set({ playing: false })
  if (liveStore.get().mode === 'music') liveStore.set({ mode: 'none' })
})
audio.addEventListener('timeupdate', () => set({ time: audio.currentTime }))
audio.addEventListener('durationchange', () => set({ duration: isFinite(audio.duration) ? audio.duration : 0 }))
audio.addEventListener('error', () => set({ error: true, playing: false }))
audio.addEventListener('ended', () => {
  if (playerStore.get().repeat === 'one') {
    audio.currentTime = 0
    void audio.play().catch(() => undefined)
    return
  }
  const to = step(1)
  if (to) player.play(to)
  else set({ playing: false, time: 0 })
})

// The order Next/Previous follow: the list as shown, or shuffled (current song first).
let order: string[] = []
function rebuildOrder(): void {
  const { queue, current, shuffle } = playerStore.get()
  const ids = queue.map((t) => t.id)
  if (!shuffle) {
    order = ids
    return
  }
  const rest = ids.filter((id) => id !== current?.id)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j]!, rest[i]!]
  }
  order = current ? [current.id, ...rest] : rest
}

/** The song `dir` steps away in play order (wrapping when Repeat is on), if any. */
function step(dir: 1 | -1): LibraryItem | undefined {
  const { queue, current, repeat } = playerStore.get()
  if (!queue.length) return undefined
  if (order.length !== queue.length || (current && !order.includes(current.id))) rebuildOrder()
  let i = current ? order.indexOf(current.id) + dir : 0
  if (i >= order.length || i < 0) {
    if (repeat !== 'all') return undefined
    if (dir === 1 && playerStore.get().shuffle) rebuildOrder() // a fresh shuffle each time round
    i = dir === 1 ? 0 : order.length - 1
  }
  return queue.find((t) => t.id === order[i])
}

/** Called by the video player so music and video never play at once. */
let onMusicStart: (() => void) | undefined
export function setOnMusicStart(fn: (() => void) | undefined): void {
  onMusicStart = fn
}

export const player = {
  play(track: LibraryItem, queue?: LibraryItem[]) {
    const s = playerStore.get()
    onMusicStart?.()
    if (s.current?.id === track.id && !s.error) {
      void audio.play()
      return
    }
    audio.src = track.mediaUrl
    set({ current: track, queue: queue ?? s.queue, time: 0, duration: track.durationSec ?? 0, error: false })
    if (queue) rebuildOrder() // a new list was chosen
    void audio.play().catch(() => undefined)
  },
  toggle() {
    const s = playerStore.get()
    if (!s.current) return
    if (audio.paused) {
      onMusicStart?.()
      void audio.play().catch(() => undefined)
    } else audio.pause()
  },
  pause: () => audio.pause(),
  seek(sec: number) {
    if (isFinite(sec)) audio.currentTime = Math.max(0, Math.min(sec, audio.duration || sec))
  },
  next() {
    const to = step(1)
    if (to) player.play(to)
  },
  previous() {
    // Like most players: restart the song unless it just began.
    if (audio.currentTime > 3) return player.seek(0)
    const to = step(-1)
    if (to) player.play(to)
    else player.seek(0)
  },
  /** Whether Next would go anywhere (for greying the button out). */
  hasNext: () => !!step(1),
  toggleShuffle() {
    set({ shuffle: !playerStore.get().shuffle })
    rebuildOrder()
    persistVolume()
  },
  /** off → all → one → off */
  cycleRepeat() {
    const r = playerStore.get().repeat
    set({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' })
    persistVolume()
  },
  setVolume(v: number) {
    audio.volume = Math.min(1, Math.max(0, v))
    audio.muted = audio.volume === 0
    persistVolume()
    set({ volume: audio.volume, muted: audio.muted })
  },
  toggleMute() {
    audio.muted = !audio.muted
    persistVolume()
    set({ muted: audio.muted })
  },
  stop() {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    set({ current: undefined, playing: false, time: 0, duration: 0, error: false })
  },
  /** A track was deleted or moved: stop if it's the one playing. */
  forget(ids: Set<string>) {
    const s = playerStore.get()
    if (s.current && !ids.has(s.current.id)) player.stop()
    set({ queue: s.queue.filter((t) => ids.has(t.id)) })
  }
}

function persistVolume() {
  try {
    const { shuffle, repeat } = playerStore.get()
    localStorage.setItem(VOL_KEY, JSON.stringify({ volume: audio.volume, muted: audio.muted, shuffle, repeat }))
  } catch {
    /* not critical */
  }
}
