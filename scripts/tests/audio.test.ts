// Run: npx tsx scripts/tests/audio.test.ts
// Pure checks for the audio format -> FFmpeg mapping, progress parsing and file names.
import assert from 'node:assert/strict'
import { buildAudioPlan, canCopy } from '../../electron/services/pipeline/audioArgs'
import { parseFfmpegProgress, parseYtdlpProgress } from '../../electron/services/pipeline/progress'
import { sanitizeFilename } from '../../electron/lib/paths'

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const opus = { codec: 'opus', bitrateKbps: 130, sampleRateHz: 48000, channels: 2 }
const aac = { codec: 'aac', bitrateKbps: 128, sampleRateHz: 44100, channels: 2 }
const mp3 = { codec: 'mp3', bitrateKbps: 192, sampleRateHz: 44100, channels: 2 }
const has = (args: string[], ...seq: string[]) => args.join(' ').includes(seq.join(' '))

test('Original + matching codec = stream copy', () => {
  for (const [fmt, src] of [['opus', opus], ['m4a', aac], ['mp3', mp3]] as const) {
    const p = buildAudioPlan(fmt, { mode: 'original' }, src, {})
    assert.equal(p.copy, true, fmt)
    assert.ok(has(p.args, '-c:a', 'copy'))
  }
})

test('Original + different codec falls back to encoding', () => {
  const p = buildAudioPlan('m4a', { mode: 'original' }, opus, {})
  assert.equal(p.copy, false)
  assert.ok(has(p.args, '-c:a', 'aac'))
})

test('MP3 presets use libmp3lame CBR', () => {
  for (const k of [128, 192, 256, 320]) {
    const p = buildAudioPlan('mp3', { mode: 'bitrate', kbps: k }, opus, {})
    assert.ok(has(p.args, '-c:a', 'libmp3lame', '-b:a', `${k}k`))
    assert.equal(p.ext, 'mp3')
  }
})

test('M4A uses AAC + faststart; Opus uses libopus', () => {
  assert.ok(has(buildAudioPlan('m4a', { mode: 'bitrate', kbps: 192 }, opus, {}).args, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'))
  assert.ok(has(buildAudioPlan('opus', { mode: 'bitrate', kbps: 96 }, aac, {}).args, '-c:a', 'libopus', '-b:a', '96k'))
})

test('unsupported bitrate is snapped to a preset, never passed through', () => {
  const p = buildAudioPlan('mp3', { mode: 'bitrate', kbps: 999 }, opus, {})
  assert.ok(!p.args.includes('999k'))
})

test('FLAC: bit depth, compression, optional resample', () => {
  const p16 = buildAudioPlan('flac', { mode: 'pcm', sampleRateHz: 'source', bitDepth: 16, flacLevel: 8 }, opus, {})
  assert.ok(has(p16.args, '-c:a', 'flac', '-compression_level', '8', '-sample_fmt', 's16'))
  assert.ok(!p16.args.includes('-ar'))
  const p24 = buildAudioPlan('flac', { mode: 'pcm', sampleRateHz: 44100, bitDepth: 24 }, opus, {})
  assert.ok(has(p24.args, '-ar', '44100') && has(p24.args, '-sample_fmt', 's32', '-bits_per_raw_sample', '24'))
  assert.match(p24.note, /does not restore/)
})

test('WAV: PCM codec per bit depth', () => {
  assert.ok(has(buildAudioPlan('wav', { mode: 'pcm', sampleRateHz: 'source', bitDepth: 16 }, aac, {}).args, '-c:a', 'pcm_s16le'))
  assert.ok(has(buildAudioPlan('wav', { mode: 'pcm', sampleRateHz: 48000, bitDepth: 24 }, aac, {}).args, '-c:a', 'pcm_s24le'))
  assert.ok(has(buildAudioPlan('wav', { mode: 'pcm', sampleRateHz: 'source', bitDepth: 32 }, aac, {}).args, '-c:a', 'pcm_f32le'))
})

test('above-source bitrate note is honest', () => {
  assert.match(buildAudioPlan('mp3', { mode: 'bitrate', kbps: 320 }, opus, {}).note, /larger, not better/)
})

test('tags are separate arguments (no shell quoting needed)', () => {
  const p = buildAudioPlan('mp3', { mode: 'bitrate', kbps: 192 }, opus, { title: 'A "quoted" & title; rm -rf', artist: 'Me' })
  assert.ok(p.args.includes('title=A "quoted" & title; rm -rf'))
})

test('canCopy needs a matching codec', () => {
  assert.equal(canCopy('opus', opus), true)
  assert.equal(canCopy('opus', aac), false)
  assert.equal(canCopy('flac', opus), false)
})

test('yt-dlp progress line', () => {
  assert.deepEqual(parseYtdlpProgress('[dl] 500|1000|NA|250.5|2'), { downloaded: 500, total: 1000, speedBps: 250.5, etaSec: 2, percent: 50 })
  assert.equal(parseYtdlpProgress('[dl] 500|NA|NA|NA|NA')?.percent, undefined)
  assert.equal(parseYtdlpProgress('[download] something else'), null)
})

test('FFmpeg progress lines', () => {
  assert.deepEqual(parseFfmpegProgress('out_time_us=2500000'), { outSec: 2.5 })
  assert.deepEqual(parseFfmpegProgress('progress=end'), { end: true })
  assert.equal(parseFfmpegProgress('bitrate=128k'), null)
})

test('file names are Windows-safe', () => {
  assert.equal(sanitizeFilename('AC/DC: Back <in> Black?'), 'ACDC Back in Black')
  assert.equal(sanitizeFilename('CON'), '_CON')
  assert.equal(sanitizeFilename('..\\..\\evil'), 'evil')
  assert.equal(sanitizeFilename('   '), 'download')
  assert.equal(sanitizeFilename('name. . .'), 'name')
})

console.log(`\n${passed} passed`)
