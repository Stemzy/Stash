// Run: npx tsx scripts/tests/links.test.ts
import assert from 'node:assert/strict'
import { filenameFromDisposition, rewriteShareLink, titleFromFilename } from '../../electron/services/extractor/shareLinks'
import { validateMediaUrl } from '../../electron/lib/validate'
import { normalizeLinkInput, suggestLinkFix } from '../../shared/link'
import { classifyError } from '../../electron/services/extractor/classifyError'

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

test('OneDrive personal share links use the shares API', () => {
  const r = rewriteShareLink('https://1drv.ms/v/s!AbCdEf123')
  assert.ok('url' in r && r.url.startsWith('https://api.onedrive.com/v1.0/shares/u!') && r.url.endsWith('/root/content'))
  assert.ok(!('url' in r && r.url.includes('=')), 'base64url has no padding')
})

test('SharePoint / OneDrive for work links get download=1', () => {
  const r = rewriteShareLink('https://contoso-my.sharepoint.com/:v:/g/personal/me/EaBcD?e=xyz')
  assert.ok('url' in r && new URL(r.url).searchParams.get('download') === '1')
})

test('Mega is reported as encrypted; Dropbox/Drive/YouTube pass through', () => {
  assert.deepEqual(rewriteShareLink('https://mega.nz/file/abc#key'), { blocked: 'ENCRYPTED' })
  for (const u of ['https://www.dropbox.com/scl/fi/x/clip.mp4?dl=0', 'https://drive.google.com/file/d/abc/view', 'https://youtu.be/x']) {
    assert.deepEqual(rewriteShareLink(u), { url: u })
  }
})

test('file names from Content-Disposition', () => {
  assert.equal(filenameFromDisposition('attachment; filename="My Holiday Clip.mp4"'), 'My Holiday Clip.mp4')
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''Caf%C3%A9%20Song.mp3"), 'Café Song.mp3')
  assert.equal(filenameFromDisposition('inline; filename=clip.webm'), 'clip.webm')
  assert.equal(filenameFromDisposition(null), undefined)
  assert.equal(titleFromFilename('My%20Song_final.mp3'), 'My Song final')
})

test('local network links are allowed when enabled; other schemes never', () => {
  assert.equal(validateMediaUrl('http://192.168.1.20:8096/videos/clip.mp4', true).ok, true)
  assert.equal(validateMediaUrl('file:///C:/clip.mp4', true).ok, false)
  assert.equal(validateMediaUrl('ftp://host/clip.mp4', true).ok, false)
})

test('links without https:// and links inside share text', () => {
  assert.equal(normalizeLinkInput('youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc')
  assert.equal(normalizeLinkInput('www.tiktok.com/@me/video/123'), 'https://www.tiktok.com/@me/video/123')
  assert.equal(normalizeLinkInput('Check this out! https://youtu.be/abc 🔥'), 'https://youtu.be/abc')
  assert.equal(normalizeLinkInput('(https://example.com/clip.mp4).'), 'https://example.com/clip.mp4')
  assert.equal(normalizeLinkInput('192.168.1.20:8096/web/clip.mp4'), 'https://192.168.1.20:8096/web/clip.mp4')
  assert.equal(normalizeLinkInput('hello world'), null)
  assert.equal(validateMediaUrl('soundcloud.com/artist/track').ok, true)
})

test('a DRM *warning* does not make the whole video "copy-protected"', () => {
  assert.equal(classifyError(['WARNING: [youtube] abc: Some tv client https formats have been skipped as they are DRM protected.', 'ERROR: [youtube] abc: Requested format is not available']), 'EXTRACTOR_OUTDATED')
  assert.equal(classifyError(['WARNING: some formats are DRM protected']), 'UNKNOWN')
  assert.equal(classifyError(['ERROR: [netflix] 123: This video is DRM protected']), 'DRM_PROTECTED')
})

test('typo suggestions for addresses', () => {
  assert.equal(suggestLinkFix('https://ww.youtube.com/fortnite'), 'https://www.youtube.com/fortnite')
  assert.equal(suggestLinkFix('https://wwww.tiktok.com/@a'), 'https://www.tiktok.com/@a')
  assert.equal(suggestLinkFix('https://www.youtube.con/watch?v=1'), 'https://www.youtube.com/watch?v=1')
  assert.equal(suggestLinkFix('https://www.youtube.com/watch?v=1'), null)
  assert.equal(suggestLinkFix('https://wwf.org/video'), null)
})

console.log(`\n${passed} passed`)
