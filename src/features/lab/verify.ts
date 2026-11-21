// Tempo check: plays the file through Web Audio with metronome clicks scheduled
// on the SAME AudioContext clock, so clicks and music can't drift apart (an
// <audio> element and Web Audio run on separate clocks; this avoids that).
// Clicks are scheduled ~120 ms ahead by a small timer: React updates never
// affect their timing.
//
// Ownership: starting a check pauses the music bar and LAB's preview player;
// either of those starting stops the check.

import { api } from '@/shared/api'
import { createStore, useStore } from '@/shared/lib/store'
import { player as music, playerStore } from '@/features/player/model'
import { labPlayer, labPlayerStore } from './player'

export interface VerifyState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  sourceId?: string
  error?: string
  playing: boolean
  click: boolean
  volume: number
  /** Where playback is (or will start), in seconds. */
  position: number
  duration: number
  /** Decoded from the browser (full quality) or the app's 22 kHz mono analysis copy. */
  quality?: 'full' | 'analysis'
}

export const verifyStore = createStore<VerifyState>({ status: 'idle', playing: false, click: true, volume: 0.6, position: 0, duration: 0 })
export const useVerify = () => useStore(verifyStore)
const set = (p: Partial<VerifyState>) => verifyStore.set((s) => ({ ...s, ...p }))

let ctx: AudioContext | undefined
let buffer: AudioBuffer | undefined
let node: AudioBufferSourceNode | undefined
let musicGain: GainNode | undefined
let clickGain: GainNode | undefined
let startAt = 0 // context time where the file's 0 s would be
let timer: ReturnType<typeof setInterval> | undefined
let nextBeat = 0
let grid = { bpm: 120, start: 0 }
let loadSeq = 0

const audio = () => (ctx ??= new AudioContext({ latencyHint: 'interactive' }))

/** Current position in the file (seconds). */
export function verifyTime(): number {
  const s = verifyStore.get()
  if (!s.playing || !ctx) return s.position
  return Math.max(0, Math.min(s.duration, ctx.currentTime - startAt))
}

export async function loadVerify(sourceId: string, mediaUrl: string): Promise<void> {
  if (verifyStore.get().sourceId === sourceId && verifyStore.get().status === 'ready') return
  stopVerify()
  buffer = undefined
  const seq = ++loadSeq
  set({ status: 'loading', sourceId, error: undefined, position: 0, duration: 0, quality: undefined })
  const c = audio()
  let b: AudioBuffer | undefined
  let quality: VerifyState['quality'] = 'full'
  try {
    const res = await fetch(mediaUrl)
    b = await c.decodeAudioData(await res.arrayBuffer())
  } catch {
    // The browser can't decode this format: use the app's decoded copy (mono, 22.05 kHz).
    const r = await api.lab.pcm(sourceId)
    if (r.ok) {
      b = c.createBuffer(1, r.value.data.length, r.value.sampleRate)
      b.copyToChannel(new Float32Array(r.value.data), 0)
      quality = 'analysis'
    }
  }
  if (seq !== loadSeq) return
  if (!b) return set({ status: 'error', error: "This file couldn't be loaded for playback." })
  buffer = b
  set({ status: 'ready', duration: b.duration, quality })
}

export function unloadVerify(): void {
  stopVerify()
  loadSeq++
  buffer = undefined
  set({ status: 'idle', sourceId: undefined, position: 0, duration: 0 })
}

/** The grid the clicks follow. Can change while playing (÷2, ×2, nudges). */
export function setVerifyGrid(bpm: number, start: number): void {
  const changed = bpm !== grid.bpm || start !== grid.start
  grid = { bpm, start }
  if (changed && verifyStore.get().playing) nextBeat = firstBeatAfter(verifyTime() + 0.02)
}

function firstBeatAfter(t: number): number {
  const p = 60 / grid.bpm
  return Math.max(0, Math.ceil((t - grid.start) / p))
}

function scheduleClick(when: number) {
  const c = ctx!
  const osc = c.createOscillator()
  const env = c.createGain()
  osc.frequency.value = 1320
  env.gain.setValueAtTime(0, when)
  env.gain.linearRampToValueAtTime(1, when + 0.001)
  env.gain.exponentialRampToValueAtTime(0.001, when + 0.035)
  osc.connect(env).connect(clickGain!)
  osc.start(when)
  osc.stop(when + 0.04)
}

function pump() {
  if (!ctx || !verifyStore.get().playing) return
  const ahead = ctx.currentTime + 0.12
  const p = 60 / grid.bpm
  for (;;) {
    const beatSec = grid.start + nextBeat * p
    const when = startAt + beatSec
    if (when > ahead) break
    if (when >= ctx.currentTime - 0.005 && beatSec <= verifyStore.get().duration && verifyStore.get().click) scheduleClick(Math.max(when, ctx.currentTime))
    nextBeat++
  }
  // The readout only needs a few updates a second; the beat view reads the clock directly.
  if (performance.now() - lastReadout > 250) {
    lastReadout = performance.now()
    set({ position: verifyTime() })
  }
}
let lastReadout = 0

export function playVerify(from?: number): void {
  const s = verifyStore.get()
  if (!buffer || s.status !== 'ready') return
  stopVerify(true)
  music.pause()
  labPlayer.pause()
  const c = audio()
  void c.resume()
  const at = Math.max(0, Math.min(buffer.duration - 0.01, from ?? s.position))
  musicGain = c.createGain()
  musicGain.gain.value = 1
  musicGain.connect(c.destination)
  clickGain ??= c.createGain()
  clickGain.gain.value = s.volume
  clickGain.connect(c.destination)
  node = c.createBufferSource()
  node.buffer = buffer
  node.connect(musicGain)
  const t0 = c.currentTime + 0.06
  node.start(t0, at)
  startAt = t0 - at
  node.onended = () => {
    if (node && verifyStore.get().playing && verifyTime() >= buffer!.duration - 0.05) stopVerify()
  }
  nextBeat = firstBeatAfter(at)
  set({ playing: true, position: at })
  timer = setInterval(pump, 25)
  pump()
}

/** Stops playback and remembers where it was. */
export function stopVerify(keepPosition = true): void {
  const pos = verifyTime()
  clearInterval(timer)
  timer = undefined
  if (node) {
    node.onended = null
    try {
      node.stop()
    } catch {
      /* not started */
    }
    node.disconnect()
    node = undefined
  }
  musicGain?.disconnect()
  musicGain = undefined
  if (verifyStore.get().playing) set({ playing: false, position: keepPosition ? pos : 0 })
}

export function seekVerify(sec: number): void {
  const s = verifyStore.get()
  const t = Math.max(0, Math.min(s.duration, sec))
  if (s.playing) playVerify(t)
  else set({ position: t })
}

export function setVerifyOptions(p: Partial<Pick<VerifyState, 'click' | 'volume'>>): void {
  set(p)
  if (clickGain && p.volume != null) clickGain.gain.value = p.volume
}

// Only one thing plays at a time.
let musicWas = playerStore.get().playing
playerStore.subscribe(() => {
  const now = playerStore.get().playing
  if (now && !musicWas) stopVerify()
  musicWas = now
})
let labWas = labPlayerStore.get().playing
labPlayerStore.subscribe(() => {
  const now = labPlayerStore.get().playing
  if (now && !labWas) stopVerify()
  labWas = now
})
