// Run: npx tsx scripts/tests/key.test.ts
// Key & Scale detection against synthesized material with a known answer.
import assert from 'node:assert/strict'
import { estimateKey, KEY_SAMPLE_RATE, type KeyCore } from '../../electron/services/lab/dsp/key'
import { decimate2 } from '../../electron/services/lab/dsp/resample'
import { RealFFT } from '../../electron/services/lab/dsp/fft'
import { waveformPeaks } from '../../electron/services/lab/dsp/waveform'
import { defaultSpelling, keyName, noteText, pcNameInKey, relativeOf, scaleNotes } from '../../shared/music'
import { midiHz, progression, rng, SR, Track } from './lab-synth'

let passed = 0
const test = (name: string, fn: () => void) => {
  const t0 = performance.now()
  fn()
  passed++
  console.log(`  ✓ ${name} (${Math.round(performance.now() - t0)} ms)`)
}

/** Same path as the app: 22.05 kHz decode → halved for the key estimator. */
const analyze = (x: Float32Array): KeyCore => estimateKey(decimate2(x, SR), KEY_SAMPLE_RATE)
const name = (k?: { tonic: number; mode: 'major' | 'minor' }) => (k ? keyName(k, undefined, true) : 'none')
const describe = (r: KeyCore) => `${r.status} ${name(r.best)} s=${r.best?.score} ts=${r.tonalShare} c=${(12 / r.chroma.reduce((a, b) => a + b, 0)).toFixed(2)} [${r.reasons.join(',')}] alts=${r.alternatives.map((a) => name(a)).join('/')} tuning=${r.tuningCents}`

// ---- building blocks ----

test('FFT magnitudes match a direct DFT', () => {
  const n = 64
  const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + (i % 5) * 0.1)
  const out = new Float64Array(n / 2 + 1)
  new RealFFT(n).magnitudes(x, out)
  for (let k = 0; k <= n / 2; k++) {
    let re = 0
    let im = 0
    for (let i = 0; i < n; i++) {
      re += x[i]! * Math.cos((2 * Math.PI * k * i) / n)
      im -= x[i]! * Math.sin((2 * Math.PI * k * i) / n)
    }
    assert.ok(Math.abs(out[k]! - Math.hypot(re, im)) < 1e-9, `bin ${k}`)
  }
})

test('decimator keeps 1 kHz and removes 7 kHz', () => {
  const tone = (hz: number) => Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR))
  const level = (y: Float32Array) => Math.sqrt(y.slice(200, -200).reduce((s, v) => s + v * v, 0) / (y.length - 400))
  assert.ok(Math.abs(level(decimate2(tone(1000), SR)) - Math.SQRT1_2) < 0.01)
  assert.ok(level(decimate2(tone(7000), SR)) < 0.003, 'aliasing tone must be gone')
})

test('waveform peaks cover the whole file', () => {
  const t = new Track(3)
  t.tone(1, 0.5, 220, 0.5)
  const w = waveformPeaks(t.x, SR, 300)
  assert.equal(w.min.length, 300)
  assert.ok(Math.abs(w.durationSec - 3) < 1e-6)
  assert.ok(w.max[0] === 0 && w.max[120]! > 0.1, 'silence first, tone at 1 s')
})

test('note spelling follows the key', () => {
  assert.deepEqual(scaleNotes(3, 'major', 'flat').map((n) => noteText(n.name, true)), ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D'])
  assert.deepEqual(scaleNotes(6, 'major', 'sharp').map((n) => noteText(n.name, true)), ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#'])
  assert.deepEqual(scaleNotes(0, 'minor', 'flat').map((n) => noteText(n.name, true)), ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb'])
  assert.equal(defaultSpelling(3, 'major'), 'flat') // E♭, not D♯
  assert.equal(defaultSpelling(1, 'minor'), 'sharp') // C♯ minor, not D♭ minor
  assert.equal(defaultSpelling(10, 'major'), 'flat') // B♭
  assert.equal(defaultSpelling(8, 'minor'), 'sharp') // G♯ minor
  assert.equal(keyName({ tonic: 0, mode: 'minor' }), 'C Minor')
  assert.equal(keyName({ tonic: 3, mode: 'major' }), 'E♭ Major')
  assert.deepEqual(relativeOf({ tonic: 0, mode: 'minor' }), { tonic: 3, mode: 'major' })
  assert.equal(noteText(pcNameInKey(6, { tonic: 3, mode: 'major' })), 'G♭', 'outside notes in a flat key use flats')
})

// ---- key detection ----

const C = 60
test('C major pop progression (I–V–vi–IV)', () => {
  const r = analyze(progression(32, [[C, 'maj'], [C + 7 - 12, 'maj'], [C + 9 - 12, 'min'], [C + 5 - 12, 'maj']]).normalize())
  console.log('    ', describe(r))
  assert.equal(name(r.best), 'C Major')
  assert.notEqual(r.status, 'inconclusive')
  assert.ok(r.alternatives.some((a) => a.relation === 'relative' && name(a) === 'A Minor'))
  assert.ok(Math.abs(r.tuningCents) < 5)
})

test('A minor with the tonic emphasised (i–i–VI–VII)', () => {
  const r = analyze(progression(32, [[57, 'min'], [57, 'min'], [53, 'maj'], [55, 'maj']]).normalize())
  console.log('    ', describe(r))
  assert.equal(name(r.best), 'A Minor')
})

test('A minor with harmonic-minor V (i–iv–V–i)', () => {
  const r = analyze(progression(32, [[57, 'min'], [62 - 12, 'min'], [52, 'maj'], [57, 'min']]).normalize())
  console.log('    ', describe(r))
  assert.equal(name(r.best), 'A Minor')
})

test('E♭ major under heavy drums', () => {
  const r = analyze(progression(32, [[63 - 12, 'maj'], [56, 'maj'], [58 - 12, 'maj'], [63 - 12, 'maj']], 2, { drums: true, seed: 7 }).normalize())
  console.log('    ', describe(r))
  assert.equal(name(r.best), 'Eb Major')
})

test('F♯ minor tuned 35 cents sharp', () => {
  const r = analyze(progression(32, [[54, 'min'], [54, 'min'], [50, 'maj'], [49, 'maj']], 2, { cents: 35 }).normalize())
  console.log('    ', describe(r))
  assert.equal(name(r.best), 'F# Minor')
  assert.ok(Math.abs(r.tuningCents - 35) < 8, `tuning ${r.tuningCents}`)
})

test('trap-style C♯ minor: 808s, hats and a sparse pluck melody', () => {
  const t = new Track(32)
  const rand = rng(3)
  const roots = [49, 49, 45, 47] // C♯, C♯, A, B (i i VI VII)
  for (let bar = 0; bar < 16; bar++) {
    t.bass808(bar * 2, 1.9, roots[bar % 4]! - 24, 0.9)
    const mel = [61, 64, 68, 66, 64, 61, 59, 64] // C♯ E G♯ F♯ E C♯ B E
    for (let i = 0; i < 4; i++) t.tone(bar * 2 + i * 0.5, 0.3, midiHz(mel[(bar * 4 + i) % 8]! + 12), 0.25, { pluck: true })
    t.chord(bar * 2, 1.9, [roots[bar % 4]! + 12, roots[bar % 4]! + 12 + (bar % 4 < 2 ? 3 : 4), roots[bar % 4]! + 19], 0.15)
  }
  t.drums(140, 0.6, rand)
  const r = analyze(t.normalize())
  console.log('    ', describe(r))
  assert.equal(name(r.best), 'C# Minor')
})

test('sparse single-line melody in D minor (no chords)', () => {
  const t = new Track(24)
  const mel = [62, 65, 69, 67, 65, 64, 62, 57, 62, 64, 65, 62]
  for (let i = 0; i < 48; i++) t.tone(i * 0.5, 0.4, midiHz(mel[i % mel.length]!), 0.5, { harmonics: 4 })
  const r = analyze(t.normalize())
  console.log('    ', describe(r))
  assert.ok(['D Minor', 'F Major'].includes(name(r.best)), name(r.best))
  assert.notEqual(r.status, 'inconclusive')
})

test('a loop that starts on vi (Am–F–C–G) still reads by its notes; the relative is offered', () => {
  const r = analyze(progression(32, [[57, 'min'], [53, 'maj'], [60, 'maj'], [55, 'maj']]).normalize())
  console.log('    ', describe(r))
  assert.ok(['A Minor', 'C Major'].includes(name(r.best)), name(r.best))
  const other = name(r.best) === 'A Minor' ? 'C Major' : 'A Minor'
  assert.ok(r.alternatives.some((a) => name(a) === other), 'relative key offered')
})

test('key change: C major then E major', () => {
  const t = new Track(80)
  progression(40, [[C, 'maj'], [C + 5 - 12, 'maj'], [C + 7 - 12, 'maj'], [C, 'maj']], 2, { t })
  progression(40, [[64 - 12, 'maj'], [57, 'maj'], [59 - 12, 'maj'], [64 - 12, 'maj']], 2, { t, from: 40 })
  const r = analyze(t.normalize())
  console.log('    ', describe(r), r.sections.map((s) => `${s.startSec}-${s.endSec}:${name(s.key)}`).join(' '))
  assert.equal(r.keyChange, true)
  assert.ok(r.reasons.includes('key-change'))
  assert.notEqual(r.status, 'clear')
  const keys = new Set(r.sections.map((s) => name(s.key)))
  assert.ok(keys.has('C Major') && keys.has('E Major'), [...keys].join(','))
})

test('C major still found under steady noise (about −12 dB)', () => {
  const t = progression(24, [[C, 'maj'], [C + 5 - 12, 'maj'], [C + 7 - 12, 'maj'], [C, 'maj']], 2)
  const x = t.normalize(0.5)
  const rand = rng(9)
  for (let i = 0; i < x.length; i++) x[i]! += (rand() * 2 - 1) * 0.12
  const r = analyze(x)
  console.log('    ', describe(r))
  assert.equal(name(r.best), 'C Major')
})

test('a 4-second loop is never called clear (too little to go on)', () => {
  const r = analyze(progression(4, [[57, 'min'], [53, 'maj']]).normalize())
  console.log('    ', describe(r))
  assert.ok(r.reasons.includes('short') || r.status === 'inconclusive')
  assert.notEqual(r.status, 'clear')
})

test('drums only → inconclusive', () => {
  const t = new Track(20)
  t.drums(95, 0.9, rng(11))
  const r = analyze(t.normalize())
  console.log('    ', describe(r))
  assert.equal(r.status, 'inconclusive')
  assert.equal(r.best, undefined)
})

test('silence → inconclusive (silent)', () => {
  const r = analyze(new Float32Array(SR * 10))
  assert.equal(r.status, 'inconclusive')
  assert.deepEqual(r.reasons, ['silent'])
})

test('white noise → inconclusive', () => {
  const rand = rng(5)
  const r = analyze(Float32Array.from({ length: SR * 15 }, () => (rand() * 2 - 1) * 0.3))
  console.log('    ', describe(r))
  assert.equal(r.status, 'inconclusive')
})

test('all twelve notes at once (no tonal center) → inconclusive', () => {
  const t = new Track(16)
  for (let b = 0; b < 8; b++) t.chord(b * 2, 1.9, Array.from({ length: 12 }, (_, i) => 60 + i), 1)
  const r = analyze(t.normalize())
  console.log('    ', describe(r))
  assert.equal(r.status, 'inconclusive')
})

test('every tonic: major progressions transpose correctly', () => {
  for (let tonic = 0; tonic < 12; tonic++) {
    const root = 48 + tonic
    const r = analyze(progression(16, [[root, 'maj'], [root + 5, 'maj'], [root + 7, 'maj'], [root, 'maj']], 2, { seed: tonic }).normalize())
    assert.equal(name(r.best), name({ tonic, mode: 'major' }), `tonic ${tonic}: ${describe(r)}`)
  }
})

test('every tonic: minor progressions (i–iv–V–i) transpose correctly', () => {
  for (let tonic = 0; tonic < 12; tonic++) {
    const root = 48 + tonic
    const r = analyze(progression(16, [[root, 'min'], [root + 5, 'min'], [root + 7, 'maj'], [root, 'min']], 2, { seed: 20 + tonic }).normalize())
    assert.equal(name(r.best), name({ tonic, mode: 'minor' }), `tonic ${tonic}: ${describe(r)}`)
  }
})

test('5-minute track analyses in reasonable time', () => {
  const t0 = performance.now()
  const x = progression(300, [[C, 'maj'], [C + 5 - 12, 'maj'], [C + 7 - 12, 'maj'], [C, 'maj']], 2, { drums: true }).normalize()
  const synth = performance.now() - t0
  const t1 = performance.now()
  const r = analyze(x)
  const ms = performance.now() - t1
  console.log(`     synth ${Math.round(synth)} ms, analysis ${Math.round(ms)} ms → ${describe(r)}`)
  assert.equal(name(r.best), 'C Major')
  assert.ok(ms < 20000)
})

console.log(`\n${passed} passed`)
