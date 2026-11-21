// Synthetic test audio with a known key, so detection can be checked exactly.
// Everything is generated at 22.05 kHz mono, like the app's analysis decode.

export const SR = 22050

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export const midiHz = (m: number, cents = 0) => 440 * Math.pow(2, (m - 69) / 12 + cents / 1200)

export class Track {
  readonly x: Float32Array
  constructor(readonly seconds: number) {
    this.x = new Float32Array(Math.round(seconds * SR))
  }
  /** Harmonic tone (keys/pad/pluck). */
  tone(t0: number, dur: number, hz: number, gain: number, opts: { harmonics?: number; attack?: number; release?: number; pluck?: boolean } = {}) {
    const H = opts.harmonics ?? 6
    const a = opts.attack ?? 0.01
    const r = opts.release ?? 0.08
    const s0 = Math.round(t0 * SR)
    const n = Math.round((dur + r) * SR)
    for (let i = 0; i < n && s0 + i < this.x.length; i++) {
      const t = i / SR
      let env = t < a ? t / a : t < dur ? 1 : Math.max(0, 1 - (t - dur) / r)
      if (opts.pluck) env *= Math.exp(-t * 6)
      let v = 0
      for (let h = 1; h <= H; h++) {
        const f = hz * h
        if (f > SR / 2 - 200) break
        v += Math.sin(2 * Math.PI * f * t) / h
      }
      this.x[s0 + i]! += gain * env * v
    }
  }
  chord(t0: number, dur: number, midis: number[], gain: number, cents = 0) {
    for (const m of midis) this.tone(t0, dur, midiHz(m, cents), gain / midis.length, { attack: 0.02, release: 0.15 })
  }
  /** 808: low sine with a pitch drop and long decay. */
  bass808(t0: number, dur: number, midi: number, gain: number, cents = 0) {
    const hz = midiHz(midi, cents)
    const s0 = Math.round(t0 * SR)
    const n = Math.round(dur * SR)
    let ph = 0
    for (let i = 0; i < n && s0 + i < this.x.length; i++) {
      const t = i / SR
      const f = hz * (1 + 0.6 * Math.exp(-t * 40))
      ph += (2 * Math.PI * f) / SR
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 1.2)
      this.x[s0 + i]! += gain * env * Math.tanh(1.5 * Math.sin(ph))
    }
  }
  kick(t0: number, gain: number) {
    const s0 = Math.round(t0 * SR)
    let ph = 0
    for (let i = 0; i < 0.3 * SR && s0 + i < this.x.length; i++) {
      const t = i / SR
      ph += (2 * Math.PI * (45 + 110 * Math.exp(-t * 30))) / SR
      this.x[s0 + i]! += gain * Math.exp(-t * 12) * Math.sin(ph)
    }
  }
  noise(t0: number, dur: number, gain: number, rand: () => number, bright = false) {
    const s0 = Math.round(t0 * SR)
    let prev = 0
    for (let i = 0; i < dur * SR && s0 + i < this.x.length; i++) {
      const w = rand() * 2 - 1
      const v = bright ? w - prev : w // first difference = brighter (hats)
      prev = w
      this.x[s0 + i]! += gain * Math.exp((-i / SR) * (bright ? 60 : 18)) * v
    }
  }
  drums(bpm: number, gain: number, rand: () => number, from = 0, to = this.seconds) {
    const beat = 60 / bpm
    for (let t = from; t < to; t += beat) {
      const n = Math.round((t - from) / beat)
      if (n % 2 === 0) this.kick(t, gain)
      else this.noise(t, 0.18, gain * 0.7, rand)
      this.noise(t, 0.04, gain * 0.35, rand, true)
      this.noise(t + beat / 2, 0.04, gain * 0.3, rand, true)
    }
  }
  normalize(peak = 0.8) {
    let m = 0
    for (const v of this.x) m = Math.max(m, Math.abs(v))
    if (m > 0) for (let i = 0; i < this.x.length; i++) this.x[i]! *= peak / m
    return this.x
  }
}

/** Triad on `root` (MIDI) of a given quality. */
export const triad = (root: number, q: 'maj' | 'min' | 'dim') => [root, root + (q === 'maj' ? 4 : 3), root + (q === 'dim' ? 6 : 7)]

/** Chords + bass, one chord per `barSec`, repeated to fill `seconds`. */
export function progression(seconds: number, chords: [number, 'maj' | 'min' | 'dim'][], barSec = 2, opts: { cents?: number; drums?: boolean; seed?: number; t?: Track; from?: number } = {}) {
  const t = opts.t ?? new Track(seconds)
  const rand = rng(opts.seed ?? 1)
  const from = opts.from ?? 0
  let i = 0
  for (let at = from; at < from + seconds - 0.01; at += barSec, i++) {
    const [root, q] = chords[i % chords.length]!
    t.chord(at, barSec - 0.05, triad(root, q), 0.6, opts.cents)
    t.tone(at, barSec - 0.1, midiHz(root - 24, opts.cents), 0.35, { harmonics: 3 })
  }
  if (opts.drums) t.drums(120, 0.9, rand, from, from + seconds)
  return t
}
