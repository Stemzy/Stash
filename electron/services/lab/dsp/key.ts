// Musical key estimation: tonal-profile correlation on a harmonic pitch-class
// profile, after the published approach (Gómez 2006 HPCP; Krumhansl–Kessler
// and Temperley key profiles), implemented here from scratch.
//
//   1. Short-time spectrum (4096-point Blackman-Harris, 93 ms hop at 11.025 kHz).
//   2. Median-filter harmonic/percussive separation (Fitzgerald 2010): sustained
//      partials are kept, broadband drum hits are turned down. Not a perfect
//      separation; it only reduces how much drums smear the note profile.
//   3. Spectral peaks with parabolic interpolation (40 Hz–5 kHz).
//   4. Tuning: weighted circular mean of every peak's offset from A = 440 Hz.
//   5. Pitch-class profile with cosine weighting and 4 harmonics; the bass band
//      (< 300 Hz) and the rest are balanced so a loud 808 can't drown the chords.
//   6. Pearson correlation against two key profiles for all 24 keys, averaged.
//   7. The same per 10 s region, to notice key changes.
// Scores are correlations used for ranking. They are never shown as percentages.

import type { KeyAlternative, KeyAnalysis, KeyCandidate, KeyMode, KeyReason, KeyRelation, KeySection, KeyStatus } from '../../../../shared/types/lab'
import { RealFFT, blackmanHarris } from './fft'

export const KEY_VERSION = 1
/** The estimator expects this rate (the shared 22.05 kHz decode, halved). */
export const KEY_SAMPLE_RATE = 11025

const N = 4096
const HOP = 1024
const TIME_MED = 9 // frames (~0.84 s): a partial must last about this long to count as sustained
const FREQ_MED = 9 // bins (~24 Hz)
const F_MIN = 40
const F_MAX = 5000
const BASS_SPLIT = 300
const BASS_WEIGHT = 0.6
const MAX_PEAKS = 40
const HARMONIC_MIN = 0.2 // share of a frame's energy that must be sustained for it to count as tonal

// Krumhansl & Kessler (1982) probe-tone ratings.
const KK = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
}
// Temperley (2007), from the Kostka–Payne corpus.
const TEMPERLEY = {
  major: [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4],
  minor: [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33]
}
const PROFILES = [KK, TEMPERLEY]

export type KeyCore = Omit<KeyAnalysis, 'analyzedAt'>

const mod12 = (n: number) => ((n % 12) + 12) % 12

function pearson(a: ArrayLike<number>, b: ArrayLike<number>, rot: number): number {
  let ma = 0
  let mb = 0
  for (let i = 0; i < 12; i++) {
    ma += a[i]!
    mb += b[i]!
  }
  ma /= 12
  mb /= 12
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < 12; i++) {
    const x = a[i]! - ma
    const y = b[mod12(i - rot)]! - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

/** All 24 keys, best first. */
export function rankKeys(chroma: ArrayLike<number>): KeyCandidate[] {
  const out: KeyCandidate[] = []
  for (const mode of ['major', 'minor'] as KeyMode[]) {
    for (let t = 0; t < 12; t++) {
      let s = 0
      for (const p of PROFILES) s += pearson(chroma, p[mode], t)
      out.push({ tonic: t, mode, score: s / PROFILES.length })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

const same = (a?: { tonic: number; mode: KeyMode }, b?: { tonic: number; mode: KeyMode }) => !!a && !!b && a.tonic === b.tonic && a.mode === b.mode
const relative = (k: { tonic: number; mode: KeyMode }) =>
  k.mode === 'minor' ? { tonic: mod12(k.tonic + 3), mode: 'major' as KeyMode } : { tonic: mod12(k.tonic - 3), mode: 'minor' as KeyMode }
/** Keys sharing a pitch set (C major / A minor) belong to one family. */
const family = (k: { tonic: number; mode: KeyMode }) => (k.mode === 'major' ? k.tonic : mod12(k.tonic + 3))

function relationOf(best: KeyCandidate, k: KeyCandidate): KeyRelation {
  if (same(relative(best), k)) return 'relative'
  if (k.tonic === best.tonic) return 'parallel'
  if (k.mode === best.mode && k.tonic === mod12(best.tonic + 7)) return 'dominant'
  if (k.mode === best.mode && k.tonic === mod12(best.tonic + 5)) return 'subdominant'
  return 'other'
}

/** Small-array median (n ≤ 9) using a scratch buffer. */
function median(buf: Float64Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = buf[i]!
    let j = i - 1
    while (j >= 0 && buf[j]! > v) {
      buf[j + 1] = buf[j]!
      j--
    }
    buf[j + 1] = v
  }
  return n & 1 ? buf[n >> 1]! : (buf[(n >> 1) - 1]! + buf[n >> 1]!) / 2
}

/** `x`: mono audio at KEY_SAMPLE_RATE (any rate works; frequencies are scaled). */
export function estimateKey(x: Float32Array, sr: number, progress?: (fraction: number) => void): KeyCore {
  const binHz = sr / N
  const kLo = Math.max(2, Math.floor(F_MIN / binHz))
  const kHi = Math.min(N / 2 - 2, Math.ceil(F_MAX / binHz))
  const nb = Math.min(N / 2 + 1, kHi + 1 + (FREQ_MED >> 1) + 1)
  const frames = x.length >= N ? Math.floor((x.length - N) / HOP) + 1 : x.length > 0 ? 1 : 0
  const durationSec = x.length / sr
  const empty = (status: KeyStatus, reasons: KeyReason[]): KeyCore => ({
    version: KEY_VERSION,
    status,
    reasons,
    alternatives: [],
    chroma: new Array(12).fill(0),
    tuningCents: 0,
    tonalShare: 0,
    sections: durationSec > 0 ? [{ startSec: 0, endSec: durationSec }] : [],
    keyChange: false
  })
  if (frames === 0) return empty('inconclusive', ['silent'])

  // Pass 0: frame loudness, to skip silence.
  const rms = new Float32Array(frames)
  let maxRms = 0
  for (let f = 0; f < frames; f++) {
    let s = 0
    const o = f * HOP
    const end = Math.min(x.length, o + N)
    for (let i = o; i < end; i++) s += x[i]! * x[i]!
    rms[f] = Math.sqrt(s / N)
    if (rms[f]! > maxRms) maxRms = rms[f]!
  }
  const silentBelow = Math.max(1e-4, maxRms * 0.0032) // −50 dB under the loudest frame
  const silent = new Uint8Array(frames)
  let audible = 0
  for (let f = 0; f < frames; f++) {
    silent[f] = rms[f]! < silentBelow ? 1 : 0
    if (!silent[f]) audible++
  }
  if (audible === 0) return empty('inconclusive', ['silent'])

  // Pass 1: spectra → harmonic part → peaks. A ring of TIME_MED spectra feeds the time median.
  const fft = new RealFFT(N)
  const win = blackmanHarris(N)
  const frame = new Float64Array(N)
  const spec = new Float64Array(N / 2 + 1)
  const ring = Array.from({ length: TIME_MED }, () => new Float32Array(nb))
  const half = TIME_MED >> 1
  const fhalf = FREQ_MED >> 1
  const scratch = new Float64Array(Math.max(TIME_MED, FREQ_MED))
  const harm = new Float64Array(nb)
  const harmonicShare = new Float32Array(frames)
  const peakStart = new Int32Array(frames + 1)
  let peakF = new Float32Array(frames * 8)
  let peakM = new Float32Array(frames * 8)
  let peakCount = 0
  const pushPeak = (f: number, m: number) => {
    if (peakCount === peakF.length) {
      const nf = new Float32Array(peakF.length * 2)
      nf.set(peakF)
      peakF = nf
      const nm = new Float32Array(peakM.length * 2)
      nm.set(peakM)
      peakM = nm
    }
    peakF[peakCount] = f
    peakM[peakCount++] = m
  }
  const cand: { k: number; m: number }[] = []

  for (let f = 0; f < frames + half; f++) {
    if (f < frames) {
      const o = f * HOP
      for (let i = 0; i < N; i++) {
        const j = o + i
        frame[i] = j < x.length ? x[j]! * win[i]! : 0
      }
      fft.magnitudes(frame, spec)
      const r = ring[f % TIME_MED]!
      for (let k = 0; k < nb; k++) r[k] = spec[k]!
    }
    const c = f - half
    if (c < 0) continue
    peakStart[c] = peakCount
    if (c % 64 === 0) progress?.(c / frames)
    if (silent[c]) continue

    const sc = ring[c % TIME_MED]!
    const lo = Math.max(0, c - half)
    const hi = Math.min(frames - 1, c + half)
    let eAll = 0
    let eHarm = 0
    let maxH = 0
    for (let k = kLo - 1; k <= kHi + 1; k++) {
      let n = 0
      for (let t = lo; t <= hi; t++) scratch[n++] = ring[t % TIME_MED]![k]!
      const h = median(scratch, n)
      n = 0
      for (let q = Math.max(0, k - fhalf); q <= Math.min(nb - 1, k + fhalf); q++) scratch[n++] = sc[q]!
      const p = median(scratch, n)
      const s = sc[k]!
      const h2 = h * h
      const mask = h2 / (h2 + p * p + 1e-20)
      const v = s * mask
      harm[k] = v
      if (k >= kLo && k <= kHi) {
        eAll += s * s
        eHarm += v * v
        if (v > maxH) maxH = v
      }
    }
    harmonicShare[c] = eAll > 0 ? eHarm / eAll : 0
    if (maxH <= 0) continue

    cand.length = 0
    const floor = maxH * 0.0032 // −50 dB under the frame's strongest partial
    for (let k = kLo; k <= kHi; k++) {
      const v = harm[k]!
      if (v > floor && v > harm[k - 1]! && v >= harm[k + 1]!) cand.push({ k, m: v })
    }
    if (cand.length > MAX_PEAKS) cand.sort((a, b) => b.m - a.m).length = MAX_PEAKS
    for (const { k } of cand) {
      const a = Math.log(harm[k - 1]! + 1e-12)
      const b = Math.log(harm[k]! + 1e-12)
      const g = Math.log(harm[k + 1]! + 1e-12)
      const den = a - 2 * b + g
      const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - g)) / den)) : 0
      pushPeak((k + off) * binHz, Math.exp(b - 0.25 * (a - g) * off))
    }
  }
  peakStart[frames] = peakCount
  progress?.(1)

  const tonal = new Uint8Array(frames)
  let tonalFrames = 0
  for (let f = 0; f < frames; f++) {
    if (!silent[f] && harmonicShare[f]! >= HARMONIC_MIN && peakStart[f + 1]! > peakStart[f]!) {
      tonal[f] = 1
      tonalFrames++
    }
  }

  // Tuning: where the partials sit between equal-tempered semitones.
  let sx = 0
  let sy = 0
  let sw = 0
  for (let f = 0; f < frames; f++) {
    if (!tonal[f]) continue
    for (let i = peakStart[f]!; i < peakStart[f + 1]!; i++) {
      const cents = 1200 * Math.log2(peakF[i]! / 440)
      const ang = (2 * Math.PI * cents) / 100
      const w = peakM[i]!
      sx += w * Math.cos(ang)
      sy += w * Math.sin(ang)
      sw += w
    }
  }
  const concentration = sw > 0 ? Math.hypot(sx, sy) / sw : 0
  const tuningCents = concentration > 0.08 ? Math.round(((Math.atan2(sy, sx) / (2 * Math.PI)) * 100) * 10) / 10 : 0
  const ref = 440 * Math.pow(2, tuningCents / 1200)

  // Per-frame pitch-class shares (bass band and upper band kept apart).
  const fc = new Float32Array(frames * 24)
  const harmonics = [1, 2, 3, 4]
  const hw = harmonics.map((_, i) => Math.pow(0.6, i))
  const WIDTH = 2 / 3 // semitones either side
  for (let f = 0; f < frames; f++) {
    if (!tonal[f]) continue
    const base = f * 24
    let total = 0
    for (let i = peakStart[f]!; i < peakStart[f + 1]!; i++) {
      const semis = 12 * Math.log2(peakF[i]! / ref) + 9 // C = 0
      const band = peakF[i]! < BASS_SPLIT ? 0 : 12
      const m = peakM[i]!
      for (let h = 0; h < harmonics.length; h++) {
        const q = semis - 12 * Math.log2(harmonics[h]!)
        const centre = Math.round(q)
        for (let cc = centre - 1; cc <= centre + 1; cc++) {
          const d = Math.abs(q - cc)
          if (d >= WIDTH) continue
          const w = Math.cos((Math.PI / 2) * (d / WIDTH)) ** 2 * hw[h]! * m
          fc[base + band + mod12(cc)]! += w
          total += w
        }
      }
    }
    if (total > 0) for (let j = 0; j < 24; j++) fc[base + j]! /= total
  }

  /** Pitch-class profile of a frame range, bass and upper bands balanced. */
  const combine = (from: number, to: number): { chroma: number[]; tonal: number } => {
    const low = new Float64Array(12)
    const up = new Float64Array(12)
    let count = 0
    for (let f = from; f < to; f++) {
      if (!tonal[f]) continue
      count++
      for (let j = 0; j < 12; j++) {
        low[j]! += fc[f * 24 + j]!
        up[j]! += fc[f * 24 + 12 + j]!
      }
    }
    const ml = Math.max(...low)
    const mu = Math.max(...up)
    const out = new Array<number>(12)
    for (let j = 0; j < 12; j++) out[j] = (ml > 0 ? (BASS_WEIGHT * low[j]!) / ml : 0) + (mu > 0 ? up[j]! / mu : 0)
    const mx = Math.max(...out)
    return { chroma: out.map((v) => (mx > 0 ? v / mx : 0)), tonal: count }
  }

  const frameSec = HOP / sr
  const tonalShare = tonalFrames / audible
  const whole = combine(0, frames)
  const chroma = whole.chroma.map((v) => Math.round(v * 1000) / 1000)
  const base: Omit<KeyCore, 'status' | 'reasons' | 'best' | 'alternatives' | 'sections' | 'keyChange'> = {
    version: KEY_VERSION,
    chroma,
    tuningCents,
    tonalShare: Math.round(tonalShare * 1000) / 1000
  }

  if (tonalFrames * frameSec < 2.5 || tonalShare < 0.12) {
    return { ...empty('inconclusive', ['little-tonal']), ...base }
  }

  const ranked = rankKeys(whole.chroma)
  const top = ranked[0]!
  const mean = chroma.reduce((s, v) => s + v, 0) / 12
  const contrast = mean > 0 ? 1 / mean : 0 // the strongest pitch class is 1
  // Drum loops and noise can still correlate a little with some key. Ask for more
  // agreement when only part of the audio is tonal.
  const weak = top.score < 0.6 || (tonalShare < 0.45 && top.score < 0.75)
  if (weak || contrast < 1.3) {
    // Not enough to name a key; the top few are kept only as weak leads.
    return {
      ...base,
      status: 'inconclusive',
      reasons: [contrast < 1.3 ? 'flat-notes' : 'weak-match'],
      alternatives: ranked.slice(0, 3).map((k) => ({ ...round(k), relation: 'other' as KeyRelation })),
      sections: [{ startSec: 0, endSec: durationSec }],
      keyChange: false
    }
  }

  // Sections: separate 10 s regions (shorter material is one section).
  const sections: (KeySection & { score?: number })[] = []
  if (durationSec < 30) {
    sections.push({ startSec: 0, endSec: durationSec, key: round(top) })
  } else {
    const H = 10
    const count = Math.max(1, Math.round(durationSec / H))
    for (let i = 0; i < count; i++) {
      const endSec = i === count - 1 ? durationSec : (i + 1) * H
      const a = Math.floor((i * H) / frameSec)
      const b = Math.min(frames, Math.floor(endSec / frameSec))
      const part = combine(a, b)
      const k = part.tonal >= 0.3 * (b - a) && part.tonal * frameSec >= 3 ? rankKeys(part.chroma)[0] : undefined
      const ok = k && k.score >= 0.6
      sections.push({ startSec: i * H, endSec, key: ok ? round(k) : undefined, score: ok ? k.score : undefined })
    }
    for (let i = 1; i < sections.length - 1; i++) {
      const p = sections[i - 1]!
      const n = sections[i + 1]!
      const s = sections[i]!
      if (same(p.key, n.key) && !same(s.key, p.key)) {
        // One region that disagrees with matching neighbours is noise, not a modulation.
        s.key = p.key
        s.score = p.score
      } else if (s.key && p.key && n.key && !same(s.key, p.key) && !same(s.key, n.key) && s.score! < Math.min(p.score!, n.score!) - 0.08) {
        // A region that fits worse than both sides is where one key turns into another.
        s.key = undefined
        s.score = undefined
      }
    }
  }
  const merged: KeySection[] = []
  for (const { score: _score, ...s } of sections) {
    const last = merged[merged.length - 1]
    if (last && (same(last.key, s.key) || (!last.key && !s.key))) last.endSec = s.endSec
    else merged.push({ ...s })
  }

  const famTime = new Map<number, number>()
  const keyTime = new Map<string, { key: KeyCandidate; d: number }>()
  let keyedTime = 0
  for (const s of merged) {
    if (!s.key) continue
    const d = s.endSec - s.startSec
    keyedTime += d
    famTime.set(family(s.key), (famTime.get(family(s.key)) ?? 0) + d)
    const id = `${s.key.tonic}${s.key.mode}`
    keyTime.set(id, { key: s.key, d: (keyTime.get(id)?.d ?? 0) + d })
  }
  const keyChange = [...famTime.values()].filter((d) => keyedTime > 0 && d / keyedTime >= 0.2).length >= 2
  // With a key change, the whole-file profile is a blend. Report the key heard longest instead.
  const longest = keyChange ? [...keyTime.values()].sort((a, b) => b.d - a.d)[0]!.key : undefined
  const best = longest ? ranked.find((k) => same(k, longest))! : top

  const rel = ranked.find((k) => same(k, relative(best)))!
  const neighbour = ranked.find((k) => !same(k, best) && !same(k, rel))!
  const reasons: KeyReason[] = []
  if (keyChange) reasons.push('key-change')
  // With a key change, closeness in the blended profile says nothing useful.
  if (!keyChange && best.score - rel.score < 0.06) reasons.push('relative-close')
  if (!keyChange && best.score - neighbour.score < 0.06) reasons.push('neighbor-close')
  if (durationSec < 6) reasons.push('short')
  const status: KeyStatus = reasons.length === 0 && best.score >= 0.75 && tonalShare >= 0.4 ? 'clear' : 'estimated'

  const alternatives: KeyAlternative[] = [{ ...round(rel), relation: 'relative' }]
  if (keyChange) {
    // Only what the sections actually found; near-misses in a blended profile mean nothing here.
    for (const { key } of [...keyTime.values()].sort((a, b) => b.d - a.d)) {
      if (alternatives.length >= 3) break
      if (!same(key, best) && !alternatives.some((a) => same(a, key))) alternatives.push({ ...round(ranked.find((k) => same(k, key))!), relation: 'section' })
    }
  } else {
    for (const k of ranked) {
      if (alternatives.length >= 3) break
      if (same(k, best) || same(k, rel) || best.score - k.score > 0.1) continue
      alternatives.push({ ...round(k), relation: relationOf(best, k) })
    }
  }

  return { ...base, status, reasons, best: round(best), alternatives, sections: merged.map(roundSection), keyChange }
}

function round<T extends KeyCandidate>(k: T): T {
  return { ...k, score: Math.round(k.score * 1000) / 1000 }
}
function roundSection(s: KeySection): KeySection {
  return { startSec: Math.round(s.startSec * 100) / 100, endSec: Math.round(s.endSec * 100) / 100, key: s.key }
}
