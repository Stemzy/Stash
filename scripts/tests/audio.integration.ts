// Run: npx tsx scripts/tests/audio.integration.ts <baseUrl> <outDir>
// Downloads real files from a local test server through the full audio pipeline
// (yt-dlp -> FFprobe -> FFmpeg -> FFprobe check -> move) and verifies each output.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTools } from '../../electron/services/binaries/binaries'
import { runAudioJob } from '../../electron/services/pipeline/audioJob'
import { probeFile } from '../../electron/services/pipeline/probeFile'
import type { AudioSpec } from '../../shared/types/job'

const [base = 'http://127.0.0.1:8765', outDir = '/tmp/audio-out'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const tools = resolveTools([join(process.cwd(), 'resources', 'bin', `${process.platform}-${process.arch}`)])

const cases: [string, AudioSpec, RegExp, boolean][] = [
  ['test-song.mp3', { kind: 'audio', format: 'mp3', quality: { mode: 'original' } }, /^mp3$/, true],
  ['test-song.mp3', { kind: 'audio', format: 'mp3', quality: { mode: 'bitrate', kbps: 128 } }, /^mp3$/, false],
  ['song-opus.webm', { kind: 'audio', format: 'opus', quality: { mode: 'original' } }, /^opus$/, true],
  ['song-opus.webm', { kind: 'audio', format: 'mp3', quality: { mode: 'bitrate', kbps: 320 } }, /^mp3$/, false],
  ['song-opus.webm', { kind: 'audio', format: 'm4a', quality: { mode: 'bitrate', kbps: 192 } }, /^aac$/, false],
  ['song-aac.m4a', { kind: 'audio', format: 'm4a', quality: { mode: 'original' } }, /^aac$/, true],
  ['song-aac.m4a', { kind: 'audio', format: 'opus', quality: { mode: 'bitrate', kbps: 96 } }, /^opus$/, false],
  ['song-aac.m4a', { kind: 'audio', format: 'flac', quality: { mode: 'pcm', sampleRateHz: 'source', bitDepth: 16, flacLevel: 5 } }, /^flac$/, false],
  ['song-opus.webm', { kind: 'audio', format: 'flac', quality: { mode: 'pcm', sampleRateHz: 44100, bitDepth: 24, flacLevel: 8 } }, /^flac$/, false],
  ['test-song.mp3', { kind: 'audio', format: 'wav', quality: { mode: 'pcm', sampleRateHz: 48000, bitDepth: 24 } }, /^pcm_s24le$/, false],
  ['test-song.mp3', { kind: 'audio', format: 'wav', quality: { mode: 'pcm', sampleRateHz: 'source', bitDepth: 32 } }, /^pcm_f32le$/, false],
  ['test-h264.mp4', { kind: 'audio', format: 'mp3', quality: { mode: 'bitrate', kbps: 192 } }, /^mp3$/, false] // audio from a video file
]

async function main() {
  let i = 0
  for (const [file, spec, codec, copy] of cases) {
    const id = `t${i++}`
    let last = ''
    const r = await runAudioJob(
      id,
      { url: `${base}/${file}`, spec, directory: outDir, filename: 'Same Name', meta: { title: 'Test', creator: 'Me', extractor: 'Website' } },
      tools,
      new AbortController().signal,
      (u) => (last = `${u.status} ${Math.round(u.percent)}%`)
    )
    assert.ok(r.ok, `${file} -> ${spec.format}: ${!r.ok ? r.code + ' ' + r.detail : ''}`)
    const p = await probeFile(tools.ffprobe!, r.path)
    assert.match(p?.audio?.codec ?? '', codec)
    assert.equal(r.note.startsWith('Saved the original'), copy)
    console.log(`  ✓ ${file} -> ${spec.format} ${JSON.stringify(spec.quality)} => ${r.path.split('/').pop()} [${p?.audio?.codec} ${p?.audio?.sampleRateHz}Hz] (${last})`)
  }

  // Cancel mid-way leaves no file and no temp folder.
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 300)
  const c = await runAudioJob('cancel', { url: `${base}/slow/test-song.mp3`, spec: cases[3]![1], directory: outDir, filename: 'Canceled', meta: { title: 'x', extractor: 'Website' } }, tools, ctrl.signal, () => undefined)
  assert.equal(!c.ok && c.code, 'CANCELED')
  console.log('  ✓ cancel')

  // Bad link reports a classified failure.
  const bad = await runAudioJob('bad', { url: `${base}/missing.mp3`, spec: cases[0]![1], directory: outDir, filename: 'Bad', meta: { title: 'x', extractor: 'Website' } }, tools, new AbortController().signal, () => undefined)
  assert.equal(bad.ok, false)
  console.log(`  ✓ failure reported as ${!bad.ok && bad.code}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
