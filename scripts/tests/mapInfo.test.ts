// Run: npx tsx scripts/tests/mapInfo.test.ts [extra.json ...]
// Checks the yt-dlp JSON -> MediaInfo mapping with fixtures (no network).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mapInfo, allFormatsDrm, pickThumbnail } from '../../electron/services/extractor/mapInfo'
import { classifyError } from '../../electron/services/extractor/classifyError'
import { validateMediaUrl } from '../../electron/lib/validate'

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// A trimmed, YouTube-shaped dump (codecs, DASH split, DRM and storyboard rows).
const yt = {
  id: 'abc123', title: 'Golden Hour', uploader: 'Northbound', duration: 766.4, extractor_key: 'Youtube',
  webpage_url: 'https://www.youtube.com/watch?v=abc123',
  thumbnails: [
    { url: 'https://i.ytimg.com/vi/abc/default.jpg', width: 120 },
    { url: 'https://i.ytimg.com/vi_webp/abc/maxres.webp', width: 1280 },
    { url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg', width: 480 }
  ],
  formats: [
    { format_id: 'sb0', format_note: 'storyboard', ext: 'mhtml', vcodec: 'none', acodec: 'none' },
    { format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 129.9, asr: 48000, audio_channels: 2, filesize: 12_000_000 },
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129.5, asr: 44100, audio_channels: 2 },
    { format_id: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080, width: 1920, fps: 30, tbr: 4000, filesize: 300_000_000 },
    { format_id: '248', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 1080, width: 1920, fps: 30, tbr: 2500 },
    { format_id: '401', ext: 'mp4', vcodec: 'av01.0.12M.08', acodec: 'none', height: 2160, fps: 60, tbr: 18000, filesize_approx: 1_900_000_000 },
    { format_id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, fps: 30, tbr: 500 },
    { format_id: 'drm1', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1440, has_drm: true }
  ]
}

test('maps title, creator, duration, site name', () => {
  const m = mapInfo(yt, 'https://youtu.be/abc123')
  assert.equal(m.title, 'Golden Hour')
  assert.equal(m.creator, 'Northbound')
  assert.equal(m.durationSec, 766.4)
  assert.equal(m.extractor, 'YouTube')
  assert.equal(m.url, 'https://www.youtube.com/watch?v=abc123')
})

test('one video entry per height, best first, DRM and storyboards dropped', () => {
  const m = mapInfo(yt, '')
  assert.deepEqual(m.videoStreams.map((v) => v.height), [2160, 1080, 360])
  const v1080 = m.videoStreams.find((v) => v.height === 1080)!
  assert.equal(v1080.vcodec, 'h264') // higher tbr wins here
  assert.equal(m.videoStreams[0]!.vcodec, 'av1')
  assert.equal(m.videoStreams[0]!.sizeApprox, true)
  assert.equal(m.videoStreams.find((v) => v.height === 360)!.hasAudio, true)
})

test('remembers an H.264 variant when the best stream is VP9', () => {
  const m = mapInfo({ ...yt, formats: yt.formats.map((f) => (f.format_id === '248' ? { ...f, tbr: 9000 } : f)) }, '')
  const v = m.videoStreams.find((x) => x.height === 1080)!
  assert.equal(v.vcodec, 'vp9')
  assert.equal(v.mp4Alt?.formatId, '137')
  assert.equal(v.mp4Alt?.vcodec, 'h264')
})

test('audio streams: codec, bitrate, sample rate; best first', () => {
  const m = mapInfo(yt, '')
  assert.deepEqual(m.audioStreams.map((a) => [a.acodec, a.bitrateKbps, a.sampleRateHz]), [['opus', 130, 48000], ['aac', 130, 44100]])
})

test('missing metadata stays undefined, never guessed', () => {
  const m = mapInfo({ formats: [{ format_id: 'x', ext: 'mp4', vcodec: null, acodec: null }] }, 'https://example.com/v.mp4')
  assert.equal(m.title, 'Untitled')
  assert.equal(m.creator, undefined)
  assert.equal(m.durationSec, undefined)
  assert.equal(m.extractor, 'Website')
  assert.equal(m.videoStreams.length, 1)
  assert.equal(m.videoStreams[0]!.height, 0)
  assert.equal(m.audioStreams[0]?.bitrateKbps, undefined)
})

test('direct audio file is audio-only', () => {
  const m = mapInfo({ title: 's', formats: [{ format_id: 'mp3', ext: 'mp3', vcodec: null, acodec: null, video_ext: 'none', audio_ext: 'mp3' }] }, '')
  assert.equal(m.videoStreams.length, 0)
  assert.equal(m.audioStreams.length, 1)
})

test('thumbnail prefers a 320–1280px JPEG', () => {
  assert.equal(pickThumbnail(yt), 'https://i.ytimg.com/vi/abc/hqdefault.jpg')
})

test('all-DRM sources are detected', () => {
  assert.equal(allFormatsDrm({ formats: [{ has_drm: true }, { has_drm: true }] }), true)
  assert.equal(allFormatsDrm(yt), false)
})

test('error classification', () => {
  assert.equal(classifyError(['ERROR: [generic] Unsupported URL: https://x']), 'UNSUPPORTED_SITE')
  assert.equal(classifyError(['ERROR: [youtube] abc: Sign in to confirm your age']), 'AUTH_REQUIRED')
  assert.equal(classifyError(['ERROR: [youtube] abc: Video unavailable']), 'UNAVAILABLE')
  assert.equal(classifyError(['ERROR: This video is DRM protected']), 'DRM_PROTECTED')
  assert.equal(classifyError(['ERROR: Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name resolution>']), 'NETWORK')
  assert.equal(classifyError(['ERROR: [youtube] abc: nsig extraction failed']), 'EXTRACTOR_OUTDATED')
  assert.equal(classifyError(['something odd']), 'UNKNOWN')
})

test('URL validation', () => {
  assert.equal(validateMediaUrl('https://www.youtube.com/watch?v=x').ok, true)
  assert.equal(validateMediaUrl('--exec rm -rf /').ok, false)
  assert.equal(validateMediaUrl('file:///C:/Windows/win.ini').ok, false)
  assert.equal(validateMediaUrl('https://user:pw@example.com/v').ok, false)
  assert.equal(validateMediaUrl('http://127.0.0.1:8765/a.mp4').ok, false)
  assert.equal(validateMediaUrl('http://192.168.1.5/a.mp4').ok, false)
  assert.equal(validateMediaUrl('http://127.0.0.1:8765/a.mp4', true).ok, true)
  assert.equal(validateMediaUrl('https://exa mple.com').ok, false)
  assert.equal(validateMediaUrl(42).ok, false)
})

// Optional: real yt-dlp dumps passed on the command line.
for (const file of process.argv.slice(2)) {
  test(`real dump: ${file}`, () => {
    const m = mapInfo(JSON.parse(readFileSync(file, 'utf8')), 'https://example.com')
    console.log('    ', JSON.stringify({ title: m.title, site: m.extractor, video: m.videoStreams.map((v) => [v.height, v.vcodec, v.ext, v.mp4Alt?.formatId]), audio: m.audioStreams.map((a) => [a.acodec, a.bitrateKbps]) }))
    assert.ok(m.videoStreams.length + m.audioStreams.length > 0)
  })
}

console.log(`\n${passed} passed`)
