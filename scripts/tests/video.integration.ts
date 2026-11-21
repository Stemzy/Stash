// Run: npx tsx scripts/tests/video.integration.ts <baseUrl> <outDir>
// Downloads DASH test streams you serve locally (separate video + audio, so
// FFmpeg must merge them) and progressive files, then checks every output.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTools } from '../../electron/services/binaries/binaries'
import { runVideoJob } from '../../electron/services/pipeline/videoJob'
import { probeFile } from '../../electron/services/pipeline/probeFile'
import type { VideoJobRequest } from '../../shared/types/job'

const [base = 'http://127.0.0.1:8765', outDir = '/tmp/video-out'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const tools = resolveTools([join(process.cwd(), 'resources', 'bin', `${process.platform}-${process.arch}`)])
const meta = { title: 'Clip', creator: 'Me', extractor: 'Website' }

const cases: [string, Omit<VideoJobRequest, 'url' | 'directory' | 'filename' | 'meta'>, { h: number; vcodec: RegExp; audio: boolean; ext: string }][] = [
  ['dash/manifest.mpd', { spec: { kind: 'video', height: 720, container: 'mp4' }, videoFormatId: '0', audioFormatId: '2' }, { h: 720, vcodec: /h264/, audio: true, ext: 'mp4' }],
  ['dash/manifest.mpd', { spec: { kind: 'video', height: 360, container: 'mkv' }, videoFormatId: '1', audioFormatId: '2' }, { h: 360, vcodec: /h264/, audio: true, ext: 'mkv' }],
  ['dashvp9/manifest.mpd', { spec: { kind: 'video', height: 1080, container: 'mkv' }, videoFormatId: '0', audioFormatId: '1' }, { h: 1080, vcodec: /vp9/, audio: true, ext: 'mkv' }],
  // Stale ids (stream gone since analysis) fall back to the best at that height.
  ['dash/manifest.mpd', { spec: { kind: 'video', height: 720, container: 'mp4' }, videoFormatId: 'gone', audioFormatId: 'gone2' }, { h: 720, vcodec: /h264/, audio: true, ext: 'mp4' }],
  // Progressive file (audio already inside): no merge, remux into MKV.
  ['test-h264.mp4', { spec: { kind: 'video', height: 0, container: 'mkv' }, videoFormatId: 'mp4' }, { h: 720, vcodec: /h264/, audio: true, ext: 'mkv' }]
]

async function main() {
  let i = 0
  for (const [path, part, want] of cases) {
    const steps = new Set<string>()
    const r = await runVideoJob(`v${i++}`, { url: `${base}/${path}`, ...part, directory: outDir, filename: 'Same Clip', meta }, tools, new AbortController().signal, (u) => steps.add(u.status))
    assert.ok(r.ok, `${path}: ${!r.ok ? `${r.code} ${r.detail}` : ''}`)
    const p = await probeFile(tools.ffprobe!, r.path)
    assert.equal(p?.video?.height, want.h)
    assert.match(p?.video?.codec ?? '', want.vcodec)
    assert.equal(!!p?.audio, want.audio)
    assert.ok(r.path.endsWith(`.${want.ext}`))
    console.log(`  ✓ ${path} ${part.spec.height}p ${part.spec.container} => ${r.path.split('/').pop()} [${p?.video?.codec} ${p?.video?.height}p + ${p?.audio?.codec}] steps: ${[...steps].join('→')}`)
  }
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 400)
  const c = await runVideoJob('vc', { url: `${base}/dashvp9/manifest.mpd`, spec: { kind: 'video', height: 1080, container: 'mkv' }, videoFormatId: '0', audioFormatId: '1', directory: outDir, filename: 'Canceled', meta }, tools, ctrl.signal, () => undefined)
  console.log(`  ✓ cancel → ${!c.ok && c.code}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
