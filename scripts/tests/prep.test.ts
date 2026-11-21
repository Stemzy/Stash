// Run: npx tsx scripts/tests/prep.test.ts
// Audio Prep input checks and FFmpeg argument building (no FFmpeg needed).
import assert from 'node:assert/strict'
import { buildFilter, effectiveFades, processArgs, sampleRange, validateExport, validatePrep } from '../../electron/services/lab/prep'

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const s = { start: 12.5, end: 28.75, fadeInMs: 10, fadeOutMs: 50, gainDb: -3 }

test('settings from the renderer are checked and clamped', () => {
  assert.deepEqual(validatePrep(s, 60), s)
  assert.equal(validatePrep({ ...s, end: 12.505 }, 60), null, 'shorter than 10 ms')
  assert.equal(validatePrep({ ...s, gainDb: 99 }, 60), null)
  assert.equal(validatePrep({ ...s, fadeInMs: -1 }, 60), null)
  assert.equal(validatePrep({ ...s, start: Number.NaN }, 60), null)
  assert.equal(validatePrep('rm -rf /', 60), null)
  assert.deepEqual(validatePrep({ ...s, start: -4, end: 999 }, 60), { ...s, start: 0, end: 60 })
})

test('export settings accept only known values', () => {
  const ok = { format: 'wav', bitDepth: 24, bitrateKbps: 320, sampleRate: 'source', channels: 'source' }
  assert.deepEqual(validateExport(ok), ok)
  assert.equal(validateExport({ ...ok, format: 'exe' }), null)
  assert.equal(validateExport({ ...ok, format: 'flac', bitDepth: 32 }), null)
  assert.equal(validateExport({ ...ok, sampleRate: 12345 }), null)
  assert.equal(validateExport({ ...ok, bitrateKbps: '320k; rm' }), null)
})

test('seconds → samples rounds once, at the source rate', () => {
  assert.deepEqual(sampleRange({ start: 12.5, end: 28.75 }, 44100), { first: 551250, end: 1267875, count: 716625 })
  assert.deepEqual(sampleRange({ start: 0.0000113, end: 1 }, 44100), { first: 0, end: 44100, count: 44100 })
})

test('overlapping fades are fitted inside the selection', () => {
  assert.deepEqual(effectiveFades({ start: 0, end: 0.2, fadeInMs: 150, fadeOutMs: 150, gainDb: 0 }), { fadeInMs: 150, fadeOutMs: 50, clamped: true })
  assert.equal(effectiveFades(s).clamped, false)
})

test('filter chain: exact trim, gain, one fade each, dither only for 16-bit', () => {
  const f = buildFilter(s, 44100, { format: 'wav', bitDepth: 16, bitrateKbps: 320, sampleRate: 'source', channels: 'source' }, 2)
  assert.ok(f.startsWith('atrim=start_sample=551250:end_sample=1267875,asetpts=PTS-STARTPTS'))
  assert.ok(f.includes('volume=-3.00dB'))
  assert.equal(f.match(/afade=t=in/g)?.length, 1)
  assert.ok(f.includes(`afade=t=out:ss=${716625 - 2205}:ns=2205`))
  assert.ok(f.includes('dither_method=triangular') && f.endsWith('aformat=sample_fmts=s16'))
  const f24 = buildFilter({ ...s, gainDb: 0, fadeInMs: 0, fadeOutMs: 0 }, 44100, { format: 'wav', bitDepth: 24, bitrateKbps: 320, sampleRate: 'source', channels: 'source' }, 2)
  assert.ok(!f24.includes('volume') && !f24.includes('afade') && !f24.includes('dither'))
  const f48 = buildFilter(s, 44100, { format: 'mp3', bitDepth: 16, bitrateKbps: 320, sampleRate: 48000, channels: 1 }, 2)
  assert.ok(f48.includes('aformat=channel_layouts=mono') && f48.includes('osr=48000') && !f48.includes('dither'))
})

test('a file name can never become an FFmpeg option', () => {
  const a = processArgs({ input: '-i evil.wav', output: '-y C:\\x.wav', settings: s, out: 'preview', sourceRate: 44100, sourceChannels: 2 })
  assert.ok(a.includes('file:-i evil.wav') && a.includes('file:-y C:\\x.wav'))
  assert.ok(!a.includes('-i evil.wav'))
})

console.log(`\n${passed} passed`)
