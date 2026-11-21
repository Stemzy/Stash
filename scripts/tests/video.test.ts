// Run: npx tsx scripts/tests/video.test.ts
import assert from 'node:assert/strict'
import { CombinedProgress, videoSelector } from '../../electron/services/pipeline/videoJob'

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

test('selector: exact streams first, then a height-capped fallback', () => {
  assert.equal(
    videoSelector({ spec: { kind: 'video', height: 1080, container: 'mkv' }, videoFormatId: '248', audioFormatId: '251' }),
    '248+251/bv*[height<=1080]+ba/b[height<=1080]'
  )
})

test('selector: MP4 fallback prefers H.264 + M4A', () => {
  const s = videoSelector({ spec: { kind: 'video', height: 720, container: 'mp4' }, videoFormatId: '22' })
  assert.ok(s.startsWith('22/bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]'))
})

test('selector: unsafe format ids are ignored, never passed to yt-dlp', () => {
  const s = videoSelector({ spec: { kind: 'video', height: 0, container: 'mkv' }, videoFormatId: '1; rm -rf /', audioFormatId: '$(x)' })
  assert.equal(s, 'bv*+ba/b')
})

test('combined progress across video then audio', () => {
  const c = CombinedProgress.fromSizes(2, { video: 900, audio: 100 })
  assert.equal(Math.round(c.update(450, 900)), 45)
  assert.equal(Math.round(c.update(900, 900)), 90)
  assert.equal(Math.round(c.update(10, 100)), 91) // audio file starts
  assert.equal(Math.round(c.update(100, 100)), 99) // capped until saved
})

test('single progressive stream uses its own percent', () => {
  const c = CombinedProgress.fromSizes(1)
  assert.equal(Math.round(c.update(50, 200)), 25)
})

console.log(`\n${passed} passed`)
