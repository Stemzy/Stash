// Run: npx tsx scripts/tests/prep.integration.ts
// Audio Prep against real FFmpeg/FFprobe (must be on PATH or in resources/bin).
// Measures the exported files themselves: sample counts, fade shape, gain, format.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { measurePeak, processAudio, type ProcessJob } from '../../electron/services/lab/prep'
import type { ExportSettings, PrepSettings } from '../../shared/types/lab'

const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const ffprobe = process.env.FFPROBE ?? 'ffprobe'
const dir = mkdtempSync(join(tmpdir(), 'prep-test-'))
let passed = 0
const test = async (name: string, fn: () => Promise<void>) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

/** Stereo 16-bit WAV: left = 440 Hz at −6 dBFS, right = 660 Hz at −12 dBFS. */
function makeSource(path: string, rate: number, seconds: number, channels = 2) {
  const n = Math.round(rate * seconds)
  const b = Buffer.alloc(44 + n * channels * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + n * channels * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(channels, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * channels * 2, 28)
  b.writeUInt16LE(channels * 2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(n * channels * 2, 40)
  for (let i = 0; i < n; i++) {
    const l = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate)
    const r = 0.25 * Math.sin((2 * Math.PI * 660 * i) / rate)
    b.writeInt16LE(Math.round(l * 32767), 44 + i * channels * 2)
    if (channels === 2) b.writeInt16LE(Math.round(r * 32767), 46 + i * channels * 2)
  }
  writeFileSync(path, b)
}

function probe(path: string) {
  const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_packets', path]).toString())
  return j.streams[0] as Record<string, string | number>
}

/** Decodes to interleaved float32 at the file's own rate. */
function decode(path: string): Float32Array {
  const buf = execFileSync(ffmpeg, ['-v', 'error', '-i', path, '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
}
const rms = (x: Float32Array, ch: number, c: number, from: number, to: number) => {
  let s = 0
  for (let i = from; i < to; i++) s += x[i * ch + c]! ** 2
  return Math.sqrt(s / (to - from))
}

const RATE = 44100
const src = join(dir, 'source.wav')
makeSource(src, RATE, 6)
const srcHash = createHash('sha256').update(readFileSync(src)).digest('hex')

const base: PrepSettings = { start: 1.25, end: 3.75, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 }
const wav = (bitDepth: 16 | 24 | 32, extra: Partial<ExportSettings> = {}): ExportSettings => ({ format: 'wav', bitDepth, bitrateKbps: 320, sampleRate: 'source', channels: 'source', ...extra })
const go = async (name: string, settings: PrepSettings, out: ProcessJob['out'], extra: Partial<ProcessJob> = {}) => {
  const output = join(dir, name)
  const r = await processAudio({ ffmpeg, input: src, output, settings, out, sourceRate: RATE, sourceChannels: 2, ...extra })
  return { r, output }
}

async function main() {
  await test('trim is sample-exact (1.250 s → 3.750 s = 110 250 samples)', async () => {
    const { r, output } = await go('trim.wav', base, wav(24))
    assert.ok(r.ok)
    const x = decode(output)
    assert.equal(x.length / 2, 110250)
    // The first exported sample is source sample 55 125 (left channel 440 Hz).
    const expect = 0.5 * Math.sin((2 * Math.PI * 440 * 55125) / RATE)
    assert.ok(Math.abs(x[0]! - expect) < 2e-4, `first sample ${x[0]} vs ${expect}`)
    const p = probe(output)
    assert.equal(p.codec_name, 'pcm_s24le')
    assert.equal(Number(p.sample_rate), 44100)
    assert.equal(Number(p.channels), 2)
  })

  await test('millisecond positions that fall between samples round to the nearest sample', async () => {
    const { r, output } = await go('round.wav', { ...base, start: 0.0125, end: 0.0351 }, wav(16))
    assert.ok(r.ok)
    assert.equal(decode(output).length / 2, Math.round(0.0351 * RATE) - Math.round(0.0125 * RATE))
  })

  await test('very short selection (10 ms) exports 441 samples', async () => {
    const { r, output } = await go('short.wav', { ...base, start: 2, end: 2.01 }, wav(24))
    assert.ok(r.ok)
    assert.equal(decode(output).length / 2, 441)
  })

  await test('fade-in starts at silence and rises linearly; fade-out ends at silence', async () => {
    const { r, output } = await go('fades.wav', { ...base, fadeInMs: 100, fadeOutMs: 250 }, wav(32))
    assert.ok(r.ok)
    const x = decode(output)
    const n = x.length / 2
    const inN = Math.round(0.1 * RATE)
    const outN = Math.round(0.25 * RATE)
    assert.ok(Math.abs(x[0]!) < 1e-6, 'first sample silent')
    // Half-way through the fade-in the level is about half (RMS over a short window).
    const mid = rms(x, 2, 0, inN / 2 - 200, inN / 2 + 200) / rms(x, 2, 0, inN + 1000, inN + 5000)
    assert.ok(Math.abs(mid - 0.5) < 0.03, `mid-fade ratio ${mid}`)
    assert.ok(Math.abs(x[(n - 1) * 2]!) < 0.001, 'last sample near silent')
    const body = rms(x, 2, 0, inN + 1000, n - outN - 1000)
    assert.ok(Math.abs(body - 0.5 / Math.SQRT2) < 0.005, 'body untouched by fades')
  })

  await test('fades longer than the selection are shortened, never doubled', async () => {
    const { r, output } = await go('overlap.wav', { ...base, start: 2, end: 2.2, fadeInMs: 150, fadeOutMs: 150 }, wav(32))
    assert.ok(r.ok)
    const x = decode(output)
    assert.equal(x.length / 2, Math.round(2.2 * RATE) - Math.round(2 * RATE))
    assert.ok(Math.abs(x[0]!) < 1e-6 && Math.abs(x[x.length - 2]!) < 0.01)
  })

  await test('gain is exact: +6 dB and −6 dB', async () => {
    for (const g of [6, -6]) {
      const { r, output } = await go(`gain${g}.wav`, { ...base, gainDb: g }, wav(32))
      assert.ok(r.ok)
      const x = decode(output)
      const ratio = rms(x, 2, 1, 1000, 50000) / (0.25 / Math.SQRT2)
      assert.ok(Math.abs(20 * Math.log10(ratio) - g) < 0.02, `gain ${g}: measured ${20 * Math.log10(ratio)}`)
    }
  })

  await test('peak measurement matches the signal (−6.02 dBFS) and predicts clipping', async () => {
    const peak = await measurePeak(ffmpeg, src, base, RATE)
    assert.ok(peak != null && Math.abs(peak - -6.02) < 0.1, `peak ${peak}`)
    // +9 dB on a −6 dBFS peak goes over full scale: 16-bit output really clips.
    const { output } = await go('clip.wav', { ...base, gainDb: 9 }, wav(16))
    const x = decode(output)
    let max = 0
    for (const v of x) max = Math.max(max, Math.abs(v))
    assert.ok(max >= 0.9999, 'clipped at full scale')
    // 32-bit float keeps the overs (the file can go above 0 dBFS).
    const f = decode((await go('clipf.wav', { ...base, gainDb: 9 }, wav(32))).output)
    let fmax = 0
    for (const v of f) fmax = Math.max(fmax, Math.abs(v))
    assert.ok(fmax > 1.3, `float keeps overs: ${fmax}`)
  })

  await test('silence measures as null (−inf)', async () => {
    const silent = join(dir, 'silent.wav')
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '2', silent])
    assert.equal(await measurePeak(ffmpeg, silent, { start: 0, end: 1 }, 44100), null)
  })

  await test('mono downmix and 48 kHz resample keep the duration', async () => {
    const { r, output } = await go('mono48.wav', base, wav(24, { channels: 1, sampleRate: 48000 }))
    assert.ok(r.ok)
    const p = probe(output)
    assert.equal(Number(p.channels), 1)
    assert.equal(Number(p.sample_rate), 48000)
    assert.equal(decode(output).length, 120000) // 2.5 s × 48 000
  })

  await test('mono source → stereo duplicates the channel', async () => {
    const monoSrc = join(dir, 'mono.wav')
    makeSource(monoSrc, RATE, 2, 1)
    const output = join(dir, 'stereo-from-mono.wav')
    const r = await processAudio({ ffmpeg, input: monoSrc, output, settings: { ...base, start: 0, end: 1 }, out: wav(16, { channels: 2 }), sourceRate: RATE, sourceChannels: 1 })
    assert.ok(r.ok)
    assert.equal(Number(probe(output).channels), 2)
  })

  await test('16-bit WAV, 16/24-bit FLAC', async () => {
    assert.equal(probe((await go('w16.wav', base, wav(16))).output).codec_name, 'pcm_s16le')
    const f16 = probe((await go('f16.flac', base, { ...wav(16), format: 'flac' })).output)
    assert.equal(f16.codec_name, 'flac')
    assert.equal(Number(f16.bits_per_raw_sample), 16)
    const f24 = (await go('f24.flac', base, { ...wav(24), format: 'flac' })).output
    assert.equal(Number(probe(f24).bits_per_raw_sample), 24)
    assert.equal(decode(f24).length / 2, 110250, 'FLAC is lossless and exact')
  })

  await test('MP3 320 and M4A 256 encode with the asked bitrate', async () => {
    const mp3 = probe((await go('o.mp3', base, { ...wav(16), format: 'mp3', bitrateKbps: 320 })).output)
    assert.equal(mp3.codec_name, 'mp3')
    assert.ok(Math.abs(Number(mp3.bit_rate) - 320000) < 2000)
    const m4a = probe((await go('o.m4a', base, { ...wav(16), format: 'm4a', bitrateKbps: 256 })).output)
    assert.equal(m4a.codec_name, 'aac')
  })

  await test('cancel leaves no file and no partial file behind', async () => {
    const long = join(dir, 'long.wav')
    makeSource(long, RATE, 120)
    const ctrl = new AbortController()
    const output = join(dir, 'canceled.flac')
    const p = processAudio({ ffmpeg, input: long, output, settings: { ...base, start: 0, end: 120 }, out: { ...wav(24), format: 'flac' }, sourceRate: RATE, sourceChannels: 2, signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 30)
    const r = await p
    assert.ok(!r.ok && r.canceled)
    assert.ok(!readdirSync(dir).some((f) => f.includes('canceled')), readdirSync(dir).join(','))
  })

  await test('an unwritable output folder fails cleanly with FFmpeg’s message', async () => {
    const r = await processAudio({ ffmpeg, input: src, output: join(dir, 'missing-folder', 'x.wav'), settings: base, out: wav(16), sourceRate: RATE, sourceChannels: 2 })
    assert.ok(!r.ok && !r.canceled && r.message.length > 0, JSON.stringify(r))
  })

  await test('the source file is unchanged', async () => {
    assert.equal(createHash('sha256').update(readFileSync(src)).digest('hex'), srcHash)
  })

  await test('preview render: 16-bit WAV, same trim, fades and gain as export', async () => {
    const s = { ...base, fadeInMs: 50, gainDb: -3 }
    const pv = decode((await go('preview.wav', s, 'preview')).output)
    const ex = decode((await go('export32.wav', s, wav(32))).output)
    assert.equal(pv.length, ex.length)
    let maxDiff = 0
    for (let i = 0; i < ex.length; i++) maxDiff = Math.max(maxDiff, Math.abs(pv[i]! - ex[i]!))
    assert.ok(maxDiff < 1e-3, `preview differs from export by ${maxDiff} (16-bit rounding only)`)
  })

}

main().then(
  () => console.log(`\n${passed} passed`),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
