// Tempo (BPM) and beat estimation, implemented from the published methods:
//
//   1. Onset strength: half-wave-rectified spectral flux of log-compressed energy
//      in 36 log-spaced bands (30 Hz–10 kHz), 11.6 ms hop. Peaks where notes and
//      drums start.
//   2. Periodicity: autocorrelation of the onset envelope. Each tempo from 50 to
//      220 BPM is scored with a harmonic comb (its period and multiples of it),
//      times a broad log-normal preference around 120 BPM (as in librosa), which
//      only breaks near-ties between half and double time.
//   3. Beats: dynamic-programming beat tracker (Ellis 2007) at that period.
//   4. Exact BPM: a straight-line fit through the tracked beats. Gives 128.47, not
//      just the nearest grid value.
//   5. The same per 20 s window, to notice tempo changes.
// Fits are relative scores for ranking, never shown as percentages.

import type { TempoAnalysis, TempoCandidate, TempoReason, TempoSection, TempoStatus } from '../../../../shared/types/lab'
import { RealFFT } from './fft'

export const TEMPO_VERSION = 2

const N = 1024
const HOP = 256
const BPM_MIN = 50
const BPM_MAX = 220
const PRIOR_CENTER = 120
const PRIOR_OCTAVES = 1

export type TempoCore = Omit<TempoAnalysis, 'analyzedAt'>

/** Onset strength envelope (one value per hop) and its frame rate. */
export function onsetEnvelope(x: Float32Array, sr: number, progress?: (f: number) => void): { env: Float32Array; fps: number; strength: number; spikiness: number } {
  const frames = x.length >= N ? Math.floor((x.length - N) / HOP) + 1 : 0
  const fps = sr / HOP
  const env = new Float32Array(frames)
  if (frames < 2) return { env, fps, strength: 0, spikiness: 0 }
  const fft = new RealFFT(N)
  const win = new Float64Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  const frame = new Float64Array(N)
  const spec = new Float64Array(N / 2 + 1)
  // Log-spaced bands.
  const B = 36
  const edges: number[] = []
  for (let b = 0; b <= B; b++) edges.push(Math.max(1, Math.round(((30 * Math.pow(10000 / 30, b / B)) / sr) * N)))
  const prev = new Float64Array(B)
  const cur = new Float64Array(B)
  for (let f = 0; f < frames; f++) {
    const o = f * HOP
    for (let i = 0; i < N; i++) frame[i] = x[o + i]! * win[i]!
    fft.magnitudes(frame, spec)
    let flux = 0
    for (let b = 0; b < B; b++) {
      let e = 0
      const a = edges[b]!
      const z = Math.max(a + 1, edges[b + 1]!)
      for (let k = a; k < z && k <= N / 2; k++) e += spec[k]! * spec[k]!
      cur[b] = Math.log1p(1000 * Math.sqrt(e / (z - a)))
      if (f > 0) flux += Math.max(0, cur[b]! - prev[b]!)
    }
    prev.set(cur)
    env[f] = flux / B
    if (f % 512 === 0) progress?.((0.7 * f) / frames)
  }
  // Remove the slow trend (a 1 s moving average) so loudness changes don't look like beats.
  const w = Math.round(fps)
  const out = new Float32Array(frames)
  let sum = 0
  const q: number[] = []
  for (let f = 0; f < frames; f++) {
    sum += env[f]!
    q.push(env[f]!)
    if (q.length > w) sum -= q.shift()!
    out[f] = Math.max(0, env[f]! - sum / q.length)
  }
  let sd = 0
  for (const v of out) sd += v * v
  sd = Math.sqrt(sd / frames)
  if (sd > 0) for (let f = 0; f < frames; f++) out[f]! /= sd
  // `strength`: how big the onsets are before normalising (log-energy jumps).
  // `spikiness`: kurtosis of the envelope. Notes and drums make sharp spikes (real songs
  // measure 25+); a sustained pad only ripples slowly (≈6–8), which is not a beat.
  let m2 = 0
  let m4 = 0
  let mean = 0
  for (const v of out) mean += v
  mean /= frames
  for (const v of out) {
    const d = v - mean
    m2 += d * d
    m4 += d ** 4
  }
  m2 /= frames
  m4 /= frames
  return { env: out, fps, strength: sd, spikiness: m2 > 0 ? m4 / (m2 * m2) : 0 }
}

/** Normalised autocorrelation for lags 0..maxLag. */
function autocorr(env: Float32Array, from: number, to: number, maxLag: number): Float64Array {
  const r = new Float64Array(maxLag + 1)
  const n = to - from
  for (let l = 0; l <= maxLag && l < n; l++) {
    let s = 0
    for (let i = from; i + l < to; i++) s += env[i]! * env[i + l]!
    r[l] = s / (n - l)
  }
  const r0 = r[0] || 1
  for (let l = 0; l <= maxLag; l++) r[l]! /= r0
  return r
}

const at = (r: Float64Array, lag: number) => {
  const i = Math.floor(lag)
  if (i + 1 >= r.length) return 0
  const t = lag - i
  return r[i]! * (1 - t) + r[i + 1]! * t
}

/** Comb score of one tempo: its period and two multiples (beats line up every 1, 2 and 4 periods). */
function comb(r: Float64Array, fps: number, bpm: number): number {
  const p = (60 * fps) / bpm
  return at(r, p) + 0.5 * at(r, 2 * p) + 0.25 * at(r, 4 * p)
}
const prior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / PRIOR_CENTER) / PRIOR_OCTAVES) ** 2)

/** Ranked tempi for a stretch of the onset envelope: best by fit × prior, plus raw fits. */
function scoreTempi(env: Float32Array, fps: number, from: number, to: number): { bpm: number; raw: number; weighted: number }[] {
  const maxLag = Math.ceil((60 * fps * 4) / BPM_MIN) + 2
  const r = autocorr(env, from, to, maxLag)
  const out: { bpm: number; raw: number; weighted: number }[] = []
  for (let b = BPM_MIN; b <= BPM_MAX; b += 0.25) {
    const raw = Math.max(0, comb(r, fps, b))
    out.push({ bpm: b, raw, weighted: raw * prior(b) })
  }
  return out
}

/** Local maxima of the weighted score, best first. */
function peaks(scores: { bpm: number; raw: number; weighted: number }[]) {
  const p = scores.filter((s, i) => i > 0 && i < scores.length - 1 && s.weighted >= scores[i - 1]!.weighted && s.weighted >= scores[i + 1]!.weighted)
  return p.sort((a, b) => b.weighted - a.weighted)
}

/** Ellis (2007) dynamic-programming beat tracker. Returns beat frames. */
export function trackBeats(env: Float32Array, period: number, tightness = 100): number[] {
  const n = env.length
  if (n === 0 || !(period > 1)) return []
  // Smooth the onsets a little around each beat.
  const k = Math.max(1, Math.round(period / 16))
  const local = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = -k; j <= k; j++) {
      const v = env[i + j]
      if (v !== undefined) s += v * Math.exp(-0.5 * (j / (k / 2 || 1)) ** 2)
    }
    local[i] = s
  }
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  const lo = Math.round(period / 2)
  const hi = Math.round(period * 2)
  for (let i = 0; i < n; i++) {
    let best = 0
    let arg = -1
    for (let d = lo; d <= hi && i - d >= 0; d++) {
      const s = score[i - d]! - tightness * Math.log(d / period) ** 2
      if (arg < 0 || s > best) {
        best = s
        arg = i - d
      }
    }
    score[i] = local[i]! + (arg >= 0 ? Math.max(0, best) : 0)
    back[i] = arg >= 0 && best > 0 ? arg : -1
  }
  // Finish at the best score in the last period, then walk back.
  let end = n - 1
  for (let i = Math.max(0, n - Math.ceil(period)); i < n; i++) if (score[i]! > score[end]!) end = i
  const beats: number[] = []
  for (let i = end; i >= 0; i = back[i]!) {
    beats.push(i)
    if (back[i]! < 0) break
  }
  beats.reverse()
  // Drop beats in leading/trailing quiet stretches (the tracker keeps counting through silence).
  const strength = beats.map((b) => local[b]!)
  const sorted = [...strength].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  let a = 0
  let z = beats.length - 1
  while (a < z && strength[a]! < 0.2 * median) a++
  while (z > a && strength[z]! < 0.2 * median) z--
  return beats.slice(a, z + 1)
}

/** Least-squares line through beat times: period and phase. */
function fitGrid(times: number[]): { period: number; start: number; residual: number } | null {
  const n = times.length
  if (n < 4) return null
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += times[i]!
    sxx += i * i
    sxy += i * times[i]!
  }
  const period = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const start = (sy - period * sx) / n
  let res = 0
  for (let i = 0; i < n; i++) res += (times[i]! - (start + i * period)) ** 2
  return { period, start, residual: Math.sqrt(res / n) }
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function estimateTempo(x: Float32Array, sr: number, progress?: (f: number) => void): TempoCore {
  const duration = x.length / sr
  const empty = (status: TempoStatus, reasons: TempoReason[]): TempoCore => ({
    version: TEMPO_VERSION,
    status,
    reasons,
    candidates: [],
    beats: [],
    sections: duration > 0 ? [{ startSec: 0, endSec: duration }] : [],
    tempoChange: false
  })
  let peak = 0
  for (let i = 0; i < x.length; i += 7) peak = Math.max(peak, Math.abs(x[i]!))
  if (duration < 1 || peak < 1e-4) return empty('uncertain', ['silent'])

  const { env, fps, strength, spikiness } = onsetEnvelope(x, sr, progress)
  const frameTime = (f: number) => (f * HOP + N / 2) / sr

  const scores = scoreTempi(env, fps, 0, env.length)
  const ranked = peaks(scores)
  if (ranked.length === 0) return empty('uncertain', ['weak-rhythm'])
  const top = ranked[0]!
  progress?.(0.8)

  // Beats at the winning tempo, then the exact tempo from them.
  const beatFrames = trackBeats(env, (60 * fps) / top.bpm)
  const beatTimes = beatFrames.map(frameTime)
  const grid = fitGrid(beatTimes)
  const bpm = grid ? 60 / grid.period : top.bpm
  progress?.(0.9)

  // How periodic is it? (normalised autocorrelation at the beat period)
  const r = autocorr(env, 0, env.length, Math.ceil((60 * fps * 2) / BPM_MIN) + 2)
  const periodicity = at(r, (60 * fps) / bpm)

  // Half and double time, judged by what is heard at the beats:
  //  • half time is plausible when every other beat is much weaker (e.g. a snare only on 3);
  //  • double time is plausible when the off-beats are nearly as strong as the beats.
  const peakNear = (f: number) => {
    let m = 0
    for (let i = Math.max(0, Math.round(f) - 2); i <= Math.min(env.length - 1, Math.round(f) + 2); i++) m = Math.max(m, env[i]!)
    return m
  }
  let even = 0
  let odd = 0
  let onBeat = 0
  let offBeat = 0
  for (let i = 0; i < beatFrames.length; i++) {
    const v = peakNear(beatFrames[i]!)
    if (i % 2) odd += v
    else even += v
    onBeat += v
    if (i + 1 < beatFrames.length) offBeat += peakNear((beatFrames[i]! + beatFrames[i + 1]!) / 2)
  }
  const nb = Math.max(1, beatFrames.length)
  const alternation = Math.max(even, odd) > 0 ? Math.min(even, odd) / Math.max(even, odd) : 1
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  const fitHalf = clamp01((1 - alternation) / 0.5)
  const fitDouble = clamp01(offBeat / Math.max(1, nb - 1) / Math.max(1e-9, onBeat / nb) / 0.9)
  const half = bpm / 2
  const double = bpm * 2
  const candidates: TempoCandidate[] = [{ bpm: round2(bpm), fit: 1, relation: 'best' }]
  if (half >= 40) candidates.push({ bpm: round2(half), fit: round2(half >= 55 ? fitHalf : fitHalf * 0.5), relation: 'half' })
  if (double <= 260) candidates.push({ bpm: round2(double), fit: round2(double <= 200 ? fitDouble : fitDouble * 0.5), relation: 'double' })
  const best = top.raw
  // Another tempo that isn't simply half/double (e.g. a 3:2 feel).
  const other = ranked.find((c) => [1, 0.5, 2, 1 / 3, 3, 2 / 3, 1.5].every((k) => Math.abs(c.bpm / bpm - k) > 0.04))
  if (other && other.weighted > 0.9 * top.weighted) candidates.push({ bpm: round2(other.bpm), fit: Math.min(1, round2(other.raw / best)), relation: 'other' })

  // Tempo per 20 s window (every 10 s).
  const sections: TempoSection[] = []
  let tempoChange = false
  if (duration >= 40) {
    const W = 20
    const H = 10
    const count = Math.max(1, Math.round((duration - W) / H) + 1)
    for (let i = 0; i < count; i++) {
      const a = Math.floor((i * H * sr) / HOP)
      const z = Math.min(env.length, Math.floor(((i * H + W) * sr) / HOP))
      const all = scoreTempi(env, fps, a, z)
      const loc = peaks(all)
      // How well does the whole track's tempo (or its half/double) fit this window, compared
      // with the window's own best? Real music often locks onto another beat level for a few
      // bars (e.g. 4:3); that is not a tempo change as long as the main tempo still fits.
      const rawNear = (b: number) => (b < BPM_MIN || b > BPM_MAX ? 0 : all[Math.round((b - BPM_MIN) / 0.25)]?.raw ?? 0)
      const fitMain = Math.max(rawNear(bpm), rawNear(bpm / 2), rawNear(bpm * 2))
      const own = loc[0]
      let b = own?.bpm
      if (b) {
        while (b > bpm * 1.41) b /= 2
        while (b < bpm / 1.41) b *= 2
      }
      const strong = !!own && own.raw > 0.15
      const differs = strong && b != null && Math.abs(b / bpm - 1) > 0.04 && fitMain < 0.7 * own!.raw
      sections.push({ startSec: i * H, endSec: i === count - 1 ? duration : (i + 1) * H, bpm: !strong ? undefined : differs ? round2(b!) : round2(bpm) })
    }
    const off = sections.filter((s) => s.bpm && Math.abs(s.bpm / bpm - 1) > 0.04)
    tempoChange = off.length >= 2 && off.reduce((d, s) => d + (s.endSec - s.startSec), 0) >= 0.3 * duration
  } else {
    sections.push({ startSec: 0, endSec: duration, bpm: round2(bpm) })
  }
  // Merge neighbours with (nearly) the same tempo.
  const merged: TempoSection[] = []
  for (const s of sections) {
    const last = merged[merged.length - 1]
    if (last && ((!last.bpm && !s.bpm) || (last.bpm && s.bpm && Math.abs(last.bpm / s.bpm - 1) < 0.02))) last.endSec = s.endSec
    else merged.push({ ...s })
  }

  // Steadiness: how much neighbouring beats deviate from the beat period (local, so a
  // slip somewhere in a long song doesn't count against the whole thing).
  const period = 60 / bpm
  const ibi = beatTimes.slice(1).map((t, i) => t - beatTimes[i]!)
  const med = (a: number[]) => {
    const b = [...a].sort((x, y) => x - y)
    return b.length ? b[Math.floor(b.length / 2)]! : 0
  }
  const jitter = ibi.length ? med(ibi.map((d) => Math.abs(d / period - 1))) : 1
  // Drift: compare beat spacing in the first, middle and last third (a song that speeds up).
  let drift = false
  if (ibi.length >= 12) {
    const n3 = Math.floor(ibi.length / 3)
    const thirds = [ibi.slice(0, n3), ibi.slice(n3, 2 * n3), ibi.slice(2 * n3)].map(med)
    drift = Math.max(...thirds) / Math.min(...thirds) > 1.05
  }
  tempoChange = tempoChange || drift
  // No BPM only when there's nothing beat-like: no sharp onsets at all, or almost no beats.
  // Real mixed songs have small onsets, so loudness alone is never the reason.
  const weak = strength < 0.01 || spikiness < 15 || beatTimes.length < 4
  const loose = periodicity < 0.12 || jitter > 0.05
  const reasons: TempoReason[] = []
  if (weak || loose) reasons.push('weak-rhythm')
  if (tempoChange) reasons.push('tempo-change')
  // Readings below 55 or above 200 BPM are rarely how anyone counts a track: listed, not flagged.
  if (Math.max(half >= 55 ? fitHalf : 0, double <= 200 ? fitDouble : 0) >= 0.8) reasons.push('half-double')
  if (duration < 8) reasons.push('short')
  const status: TempoStatus = weak || loose || tempoChange ? 'uncertain' : reasons.includes('half-double') ? 'ambiguous' : 'strong'

  // Grid phase: the fitted line, moved to the first beat at or after 0 s.
  let gridStart: number | undefined
  if (grid) {
    const p = 60 / bpm
    gridStart = grid.start - Math.floor(grid.start / p) * p
  }
  progress?.(1)
  if (weak) {
    return { ...empty('uncertain', ['weak-rhythm', ...(duration < 8 ? (['short'] as TempoReason[]) : [])]), sections: [{ startSec: 0, endSec: round2(duration) }] }
  }
  // With a tempo change, report the tempo heard longest (the whole-track fit is a blend).
  let main = bpm
  if (tempoChange) {
    const time = new Map<number, number>()
    for (const s of merged) if (s.bpm) time.set(s.bpm, (time.get(s.bpm) ?? 0) + s.endSec - s.startSec)
    main = [...time.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? bpm
  }
  return {
    version: TEMPO_VERSION,
    status,
    reasons,
    bpm: round2(main),
    candidates: tempoChange ? [{ bpm: round2(main), fit: 1, relation: 'best' as const }, ...[...new Set(merged.filter((s) => s.bpm && Math.abs(s.bpm / main - 1) > 0.02).map((s) => s.bpm!))].map((b) => ({ bpm: b, fit: 1, relation: 'other' as const }))] : candidates,
    beats: beatTimes.map((t) => Math.round(t * 1000) / 1000),
    gridStart: gridStart != null && !tempoChange ? Math.round(gridStart * 1000) / 1000 : undefined,
    sections: merged.map((s) => ({ ...s, startSec: round2(s.startSec), endSec: round2(s.endSec) })),
    tempoChange
  }
}
