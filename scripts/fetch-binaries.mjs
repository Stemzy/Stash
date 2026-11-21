// Downloads yt-dlp, FFmpeg and FFprobe into resources/bin/<platform>-<arch>/
// and verifies each download against the publisher's SHA-256 checksum list.
//
//   npm run fetch-binaries
//
// Windows x64: yt-dlp.exe from github.com/yt-dlp/yt-dlp, FFmpeg + FFprobe
// from github.com/BtbN/FFmpeg-Builds (GPL build, ~200 MB download).
// Deno (github.com/denoland/deno): the JavaScript runtime yt-dlp needs for
// full YouTube support since yt-dlp 2025.11.12.
// Linux: yt-dlp + Deno; install ffmpeg with your package manager (found on PATH).

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = `${process.platform}-${process.arch}`
const outDir = join(root, 'resources', 'bin', target)

const YTDLP = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/'
const DENO = 'https://github.com/denoland/deno/releases/latest/download/'

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function checksumFor(listUrl, name) {
  const text = (await download(listUrl)).toString('utf8')
  const line = text.split('\n').find((l) => l.trim().endsWith(`  ${name}`) || l.trim().endsWith(` *${name}`))
  if (!line) throw new Error(`No checksum for ${name} in ${listUrl}`)
  return line.trim().split(/\s+/)[0].toLowerCase()
}

/** Deno publishes one .sha256sum file per asset (PowerShell Get-FileHash format). */
async function denoChecksum(asset) {
  const text = (await download(DENO + asset + '.sha256sum')).toString('utf8')
  const m = text.match(/\b[a-fA-F0-9]{64}\b/)
  if (!m) throw new Error(`No checksum for ${asset}`)
  return m[0].toLowerCase()
}

function extractZip(zip, dir) {
  // Windows 10+ ships bsdtar, which reads zip files. No shell is involved.
  if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', dir], { stdio: 'ignore' })
  else execFileSync('unzip', ['-q', '-o', zip, '-d', dir], { stdio: 'ignore' })
}

function verify(buf, expected, name) {
  const actual = createHash('sha256').update(buf).digest('hex')
  if (actual !== expected) throw new Error(`Checksum mismatch for ${name}. Refusing to install it.`)
  console.log(`  ✓ checksum ok`)
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      const hit = findFile(p, name)
      if (hit) return hit
    } else if (entry === name) return p
  }
  return null
}

async function fetchYtDlp() {
  const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
  const dest = join(outDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  console.log(`• yt-dlp (${asset})`)
  const [buf, sum] = await Promise.all([download(YTDLP + asset), checksumFor(YTDLP + 'SHA2-256SUMS', asset)])
  verify(buf, sum, asset)
  writeFileSync(dest, buf)
  if (process.platform !== 'win32') chmodSync(dest, 0o755)
}

async function fetchFfmpegWindows() {
  const asset = 'ffmpeg-master-latest-win64-gpl.zip'
  console.log(`• FFmpeg + FFprobe (${asset}, about 200 MB, this takes a while)`)
  const [buf, sum] = await Promise.all([download(BTBN + asset), checksumFor(BTBN + 'checksums.sha256', asset)])
  verify(buf, sum, asset)
  const tmp = mkdtempSync(join(tmpdir(), 'ffmpeg-'))
  try {
    const zip = join(tmp, asset)
    writeFileSync(zip, buf)
    extractZip(zip, tmp)
    for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
      const found = findFile(tmp, exe)
      if (!found) throw new Error(`${exe} not found in ${asset}`)
      copyFileSync(found, join(outDir, exe))
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function fetchDeno() {
  const triple = { 'win32-x64': 'x86_64-pc-windows-msvc', 'linux-x64': 'x86_64-unknown-linux-gnu', 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin' }[target]
  if (!triple) return console.log('• Deno: no build for this platform, skipped.')
  const asset = `deno-${triple}.zip`
  console.log(`• Deno (${asset}, about 45 MB)`)
  const [buf, sum] = await Promise.all([download(DENO + asset), denoChecksum(asset)])
  verify(buf, sum, asset)
  const tmp = mkdtempSync(join(tmpdir(), 'deno-'))
  try {
    const zip = join(tmp, asset)
    writeFileSync(zip, buf)
    extractZip(zip, tmp)
    const name = process.platform === 'win32' ? 'deno.exe' : 'deno'
    const found = findFile(tmp, name)
    if (!found) throw new Error(`${name} not found in ${asset}`)
    copyFileSync(found, join(outDir, name))
    if (process.platform !== 'win32') chmodSync(join(outDir, name), 0o755)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  console.log(`Installing media tools into ${outDir}\n`)
  await fetchYtDlp()
  await fetchDeno()
  if (process.platform === 'win32' && process.arch === 'x64') await fetchFfmpegWindows()
  else console.log('• FFmpeg: install it with your package manager; the app finds it on PATH.')
  const have = readdirSync(outDir)
  console.log(`\nDone: ${have.join(', ')}`)
  if (!existsSync(join(outDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')) && process.platform === 'win32') process.exit(1)
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
