// Run: npx tsx scripts/tests/tempo.test.ts
// Tempo/BPM detection against synthesized material with a known tempo.
import assert from 'node:assert/strict'
import { estimateTempo, type TempoCore } from '../../electron/services/lab/dsp/tempo'
import { midiHz, rng, SR, Track } from './lab-synth'
import { bpmText, tapBpm } from '../../shared/tempo'

let passed = 0
const test = (name: string, fn: () => void) => {
  const t0 = performance.now()
  fn()
  passed++
  console.log(`  ✓ ${name} (${Math.round(performance.now() - t0)} ms)`)
}
const describe = (r: TempoCore) =>
  `${r.status} ${r.bpm ?? '—'} [${r.reasons.join(',')}] ${r.candidates.map((c) => `${c.relation}:${c.bpm}@${c.fit}`).join(' ')} beats=${r.beats.length} grid=${r.gridStart}`

/** Kick/snare/hat groove (snare on 2 and 4, hats on 8ths) plus a little bass. */
function groove(bpm: number, seconds: number, opts: { lead?: number; seed?: number; t?: Track; from?: number } = {}) {
  const t = opts.t ?? new Track(seconds + (opts.lead ?? 0))
  const rand = rng(opts.seed ?? 1)
  const from = (opts.from ?? 0) + (opts.lead ?? 0)
  t.drums(bpm, 0.9, rand, from, from + seconds)
  const beat = 60 / bpm
  for (let b = 0; from + b * beat < from + seconds; b += 4) t.tone(from + b * beat, beat * 3.5, midiHz(36 + ((b / 4) % 2 ? 5 : 0)), 0.25, { harmonics: 3 })
  return t
}

const close = (a: number | undefined, b: number, tol: number) => a != null && Math.abs(a - b) <= tol

for (const bpm of [90, 120, 150]) {
  test(`${bpm} BPM groove`, () => {
    const r = estimateTempo(groove(bpm, 30).normalize(), SR)
    console.log('    ', describe(r))
    assert.ok(close(r.bpm, bpm, 0.3), `got ${r.bpm}`)
    assert.ok(r.candidates.some((c) => c.relation === 'half'), 'half time listed')
    assert.ok(bpm * 2 > 260 || r.candidates.some((c) => c.relation === 'double'), 'double time listed when in range')
    assert.equal(r.status, 'strong', 'a plain groove is not called ambiguous')
  })
}

test('slow 70 BPM boom-bap reads as 70 (or 140 flagged as possible half-time)', () => {
  const r = estimateTempo(groove(70, 30).normalize(), SR)
  console.log('    ', describe(r))
  assert.ok(close(r.bpm, 70, 0.3) || (close(r.bpm, 140, 0.5) && r.candidates.some((c) => c.relation === 'half' && c.fit >= 0.5)), `got ${r.bpm}`)
})

test('non-integer tempo: 128.5 BPM is measured, not rounded', () => {
  const r = estimateTempo(groove(128.5, 40).normalize(), SR)
  console.log('    ', describe(r))
  assert.ok(close(r.bpm, 128.5, 0.15), `got ${r.bpm}`)
})

test('trap at 140: 16th hats, kick and a half-time snare → 140 or 70, with the other offered', () => {
  const t = new Track(32)
  const rand = rng(4)
  const beat = 60 / 140
  for (let i = 0; i * beat < 32; i++) {
    const at = i * beat
    for (let s = 0; s < 4; s++) t.noise(at + (s * beat) / 4, 0.03, 0.3, rand, true) // 16th hats
    if (i % 4 === 0 || i % 8 === 5) t.kick(at, 0.9) // kick pattern
    if (i % 4 === 2) t.noise(at, 0.2, 0.8, rand) // snare on beat 3
    if (i % 4 === 0) t.bass808(at, beat * 3.8, 37, 0.6)
  }
  const r = estimateTempo(t.normalize(), SR)
  console.log('    ', describe(r))
  assert.ok(close(r.bpm, 140, 0.4) || close(r.bpm, 70, 0.3), `got ${r.bpm}`)
  const other = r.bpm! > 100 ? 'half' : 'double'
  assert.ok(r.candidates.some((c) => c.relation === other), 'the other reading is listed')
  assert.equal(r.status, 'ambiguous', 'a half-time feel is flagged')
})

test('174 BPM drum & bass reads as 174 or 87, with the other offered', () => {
  const r = estimateTempo(groove(174, 30).normalize(), SR)
  console.log('    ', describe(r))
  assert.ok(close(r.bpm, 174, 0.5) || close(r.bpm, 87, 0.3), `got ${r.bpm}`)
})

test('3 s of silence before the beat: grid and first beat line up with the music', () => {
  const r = estimateTempo(groove(100, 30, { lead: 3 }).normalize(), SR)
  console.log('    ', describe(r))
  assert.ok(close(r.bpm, 100, 0.3))
  assert.ok(r.beats[0]! > 2.8, `first beat ${r.beats[0]}`)
  const p = 0.6
  const phase = (x: number) => ((x % p) + p) % p
  const d = Math.abs(phase(r.gridStart!) - phase(3))
  assert.ok(Math.min(d, p - d) < 0.03, `grid phase ${r.gridStart} vs beat at 3.0 s`)
})

test('tracked beats sit on the real beats (within 30 ms)', () => {
  const r = estimateTempo(groove(120, 20).normalize(), SR)
  const off = r.beats.map((b) => {
    const k = Math.round(b / 0.5)
    return Math.abs(b - k * 0.5)
  })
  const median = off.sort((a, b) => a - b)[Math.floor(off.length / 2)]!
  console.log(`     median offset ${(median * 1000).toFixed(1)} ms over ${r.beats.length} beats`)
  assert.ok(median < 0.03)
  assert.ok(r.beats.length >= 36)
})

test('tempo change 100 → 130 BPM is flagged, not averaged into one number', () => {
  const t = new Track(80)
  groove(100, 40, { t })
  groove(130, 40, { t, from: 40 })
  const r = estimateTempo(t.normalize(), SR)
  console.log('    ', describe(r), r.sections.map((s) => `${s.startSec}-${s.endSec}:${s.bpm}`).join(' '))
  assert.equal(r.tempoChange, true)
  assert.equal(r.status, 'uncertain')
  assert.ok(r.reasons.includes('tempo-change'))
})

test('silence → uncertain (silent)', () => {
  const r = estimateTempo(new Float32Array(SR * 10), SR)
  assert.deepEqual(r.reasons, ['silent'])
  assert.equal(r.bpm, undefined)
})

test('a sustained pad with no rhythm → uncertain, no BPM claimed', () => {
  const t = new Track(20)
  t.chord(0, 19.5, [60, 64, 67], 0.6)
  const r = estimateTempo(t.normalize(), SR)
  console.log('    ', describe(r))
  assert.equal(r.status, 'uncertain')
  assert.equal(r.bpm, undefined)
})

test('5-minute track analyses in reasonable time', () => {
  const x = groove(95, 300).normalize()
  const t0 = performance.now()
  const r = estimateTempo(x, SR)
  const ms = performance.now() - t0
  console.log(`     ${Math.round(ms)} ms → ${describe(r).slice(0, 80)}`)
  assert.ok(close(r.bpm, 95, 0.2))
  assert.ok(ms < 20000)
})

test('tap tempo: median-based, one bad tap ignored, needs 4 taps', () => {
  const at = (bpm: number, n: number, jitter = 0) => Array.from({ length: n }, (_, i) => i * (60000 / bpm) + (i % 2 ? jitter : -jitter))
  assert.equal(tapBpm(at(140, 3)), null)
  assert.ok(Math.abs(tapBpm(at(140, 8))! - 140) < 0.01)
  assert.ok(Math.abs(tapBpm(at(92, 12, 8))! - 92) < 0.5, 'human jitter averages out')
  const late = at(120, 9)
  late[5]! += 180 // one very late tap
  assert.ok(Math.abs(tapBpm(late)! - 120) < 0.5, `got ${tapBpm(late)}`)
  assert.equal(bpmText(139.99), '140')
  assert.equal(bpmText(128.47), '128.5')
})

console.log(`\n${passed} passed`)
