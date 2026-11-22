import { settingsStore } from '@/entities/settings/model'

// Little 2000s-style interface sounds, made on the fly with the Web Audio API
// (no audio files, nothing borrowed): a glassy three-note chime when a download
// finishes, a soft blip when one starts, a low two-note tone when one fails, and
// a tiny dry tick for clicks. All off by default (Settings → Sounds).

export type SoundName = 'done' | 'start' | 'fail' | 'click'

let ctx: AudioContext | null = null
let out: GainNode | null = null

function audio(): { ctx: AudioContext; out: GainNode } | null {
  try {
    if (!ctx) {
      ctx = new AudioContext()
      out = ctx.createGain()
      // Gentle top-end roll-off and a limiter so stacked sounds never get harsh or loud.
      const soften = ctx.createBiquadFilter()
      soften.type = 'lowpass'
      soften.frequency.value = 7000
      const limit = ctx.createDynamicsCompressor()
      limit.threshold.value = -12
      limit.ratio.value = 8
      out.connect(soften).connect(limit).connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return { ctx, out: out! }
  } catch {
    return null // no audio device: stay silent
  }
}

/** A struck-glass note: a sine plus two inharmonic overtones that fade faster. */
function bell(c: AudioContext, dest: AudioNode, at: number, freq: number, dur: number, amp: number): void {
  for (const [ratio, level, life] of [
    [1, 1, 1],
    [2.76, 0.3, 0.42],
    [5.4, 0.1, 0.22]
  ] as const) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.value = freq * ratio
    const end = at + dur * life
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(amp * level, at + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, end)
    o.connect(g).connect(dest)
    o.start(at)
    o.stop(end + 0.05)
  }
}

/** A soft rounded note for the "something went wrong" tone. */
function soft(c: AudioContext, dest: AudioNode, at: number, freq: number, dur: number, amp: number): void {
  const o = c.createOscillator()
  const f = c.createBiquadFilter()
  const g = c.createGain()
  o.type = 'triangle'
  o.frequency.value = freq
  f.type = 'lowpass'
  f.frequency.value = 1600
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(amp, at + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(f).connect(g).connect(dest)
  o.start(at)
  o.stop(at + dur + 0.05)
}

let noise: AudioBuffer | null = null
/** A ~10 ms dry tick, like a click wheel. */
function tick(c: AudioContext, dest: AudioNode, at: number, amp: number): void {
  if (!noise) {
    noise = c.createBuffer(1, Math.round(c.sampleRate * 0.012), c.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.0018))
  }
  const s = c.createBufferSource()
  const f = c.createBiquadFilter()
  const g = c.createGain()
  s.buffer = noise
  f.type = 'bandpass'
  f.frequency.value = 2600
  f.Q.value = 1.1
  g.gain.value = amp
  s.connect(f).connect(g).connect(dest)
  s.start(at)
}

const last: Partial<Record<SoundName, number>> = {}

/**
 * Plays a sound if its setting is on (or `force`, for the Settings preview).
 * Several downloads finishing together make one chime, not a pile-up.
 */
export function playSound(name: SoundName, force = false): void {
  const s = settingsStore.get().sounds
  if (!force && !(name === 'click' ? s.clicks : s.downloads)) return
  const now = performance.now()
  if (!force && now - (last[name] ?? 0) < (name === 'click' ? 30 : 400)) return
  last[name] = now
  const a = audio()
  if (!a) return
  const { ctx: c, out: o } = a
  o.gain.value = Math.pow(Math.max(0, Math.min(100, s.volume)) / 100, 2) * 0.9
  const t = c.currentTime + 0.01
  switch (name) {
    case 'done': // E6 · G#6 · B6, a little sparkle on top
      bell(c, o, t, 1318.5, 1.1, 0.32)
      bell(c, o, t + 0.075, 1661.2, 1.1, 0.28)
      bell(c, o, t + 0.15, 1975.5, 1.4, 0.3)
      bell(c, o, t + 0.24, 2637, 0.9, 0.08)
      break
    case 'start':
      bell(c, o, t, 987.8, 0.3, 0.24)
      bell(c, o, t + 0.05, 1318.5, 0.35, 0.24)
      break
    case 'fail': // C5 → G4
      soft(c, o, t, 523.3, 0.32, 0.4)
      soft(c, o, t + 0.13, 392, 0.45, 0.4)
      break
    case 'click':
      tick(c, o, t, 0.55)
      break
  }
}

const CLICKABLE = 'button, [role="tab"], [role="switch"], [role="menuitem"], [role="option"], [role="radio"], a[href]'

/** Ticks on clicks (when "Click sounds" is on). Call once at startup. */
export function installClickSounds(): () => void {
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !settingsStore.get().sounds.clicks) return
    const el = (e.target as Element | null)?.closest?.(CLICKABLE)
    if (!el || el.closest('[data-no-click-sound]')) return
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return
    playSound('click')
  }
  window.addEventListener('pointerdown', onDown, true)
  return () => window.removeEventListener('pointerdown', onDown, true)
}
