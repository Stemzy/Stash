import { spawn, type ChildProcess } from 'node:child_process'
import type { LabErrorCode } from '../../../shared/types/lab'

/** One decode serves every LAB analysis; each tool resamples from here if it needs to. */
export const DECODE_RATE = 22050
/** Longer files are refused rather than filling memory (40 min ≈ 210 MB of samples). */
export const MAX_DECODE_SEC = 40 * 60

export class DecodeError extends Error {
  constructor(
    readonly code: LabErrorCode,
    message: string
  ) {
    super(message)
  }
}

export interface Decoding {
  done: Promise<Float32Array>
  kill(): void
}

/**
 * First audio track → mono float32 at DECODE_RATE, read straight from FFmpeg's
 * stdout. Argument array, no shell; the `file:` prefix keeps any file name literal.
 */
export function decodeMono(ffmpeg: string, path: string, durationSec: number | undefined, onProgress?: (f: number) => void): Decoding {
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-i', `file:${path}`, '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(DECODE_RATE), '-f', 'f32le', 'pipe:1']
  const child: ChildProcess = spawn(ffmpeg, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const limit = MAX_DECODE_SEC * DECODE_RATE * 4
  const expected = durationSec ? durationSec * DECODE_RATE * 4 : 0
  const chunks: Buffer[] = []
  let bytes = 0
  let err = ''
  let tooLong = false
  let killed = false
  let lastReport = 0

  const done = new Promise<Float32Array>((resolve, reject) => {
    child.stdout!.on('data', (b: Buffer) => {
      if (tooLong) return
      bytes += b.length
      if (bytes > limit) {
        tooLong = true
        child.kill()
        return
      }
      chunks.push(b)
      if (expected && onProgress && bytes - lastReport > 1 << 20) {
        lastReport = bytes
        onProgress(Math.min(1, bytes / expected))
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (s: string) => {
      if (err.length < 4000) err += s
    })
    child.on('error', (e) => reject(new DecodeError('TOOLS_MISSING', e.message)))
    child.on('close', (code) => {
      if (killed) return reject(new DecodeError('CANCELED', 'canceled'))
      if (tooLong) return reject(new DecodeError('TOO_LONG', `longer than ${MAX_DECODE_SEC / 60} minutes`))
      if (code !== 0) {
        const noAudio = /matches no streams|does not contain any stream|Output file .* does not contain/i.test(err)
        return reject(new DecodeError(noAudio ? 'NO_AUDIO' : 'DECODE_FAILED', err.trim().split('\n').pop() || `FFmpeg exited with ${code}`))
      }
      // Copy into a fresh, aligned buffer (Buffer pools may be offset).
      const ab = new ArrayBuffer(bytes - (bytes % 4))
      const u8 = new Uint8Array(ab)
      let o = 0
      for (const c of chunks) {
        const n = Math.min(c.length, ab.byteLength - o)
        u8.set(c.subarray(0, n), o)
        o += n
      }
      chunks.length = 0
      resolve(new Float32Array(ab))
    })
  })
  return {
    done,
    kill() {
      killed = true
      child.kill()
    }
  }
}
