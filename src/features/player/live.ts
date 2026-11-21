// What the moving background reacts to: the media element that's playing, and
// its audio level (read with Web Audio, which only works because app-media://
// sends CORS headers and the elements use crossOrigin="anonymous").

import { createStore, useStore } from '@/shared/lib/store'

export interface LiveState {
  /** 'video' = the Library's video player is open and playing; 'music' = the music bar is playing. */
  mode: 'none' | 'music' | 'video'
  video?: HTMLVideoElement
}

export const liveStore = createStore<LiveState>({ mode: 'none' })
export const useLive = () => useStore(liveStore)

let ctx: AudioContext | undefined
const analysers = new WeakMap<HTMLMediaElement, AnalyserNode>()
let current: HTMLMediaElement | undefined
let buf: Uint8Array<ArrayBuffer> | undefined
let smooth = 0

/**
 * Routes an element's sound through an analyser (and on to the speakers).
 * Each element can only be connected once, so it's cached.
 */
export function analyse(el: HTMLMediaElement): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    if (!analysers.has(el)) {
      const src = ctx.createMediaElementSource(el)
      const an = ctx.createAnalyser()
      an.fftSize = 1024 // ~47 Hz per bin: fine enough to isolate the kick drum
      an.smoothingTimeConstant = 0.5
      src.connect(an)
      an.connect(ctx.destination)
      analysers.set(el, an)
    }
    current = el
  } catch {
    // Web Audio unavailable: the background still moves, just without the beat.
    current = undefined
  }
}

let peak = 0.2

/**
 * 0..1 "kick" strength: bass energy (~45–230 Hz) compared with the recent peak,
 * so quiet and loud tracks both pulse. Fast attack, slow release. 0 when nothing plays.
 */
export function level(): number {
  const an = current && analysers.get(current)
  if (!an || current!.paused) {
    smooth *= 0.9
    return smooth
  }
  buf ??= new Uint8Array(new ArrayBuffer(an.frequencyBinCount))
  if (buf.length !== an.frequencyBinCount) buf = new Uint8Array(new ArrayBuffer(an.frequencyBinCount))
  an.getByteFrequencyData(buf)
  let sum = 0
  for (let i = 1; i <= 5; i++) sum += buf[i]!
  const bass = sum / 5 / 255
  peak = Math.max(bass, peak * 0.997, 0.08) // slowly forgets old peaks (auto gain)
  const hit = Math.min(1, Math.max(0, (bass / peak - 0.5) / 0.5)) // only the top half counts as a hit
  smooth = hit > smooth ? smooth * 0.35 + hit * 0.65 : smooth * 0.86 + hit * 0.14
  return smooth
}
