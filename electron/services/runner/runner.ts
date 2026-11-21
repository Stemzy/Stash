import { execFile, spawn, type ChildProcess } from 'node:child_process'

export interface RunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  /** Keep at most this many bytes of stdout in the result (default 64 MB). */
  maxStdout?: number
}

export interface RunResult {
  code: number | null
  stdout: string
  /** Last ~40 stderr lines, for error classification and logs. */
  stderrTail: string[]
  aborted: boolean
  timedOut: boolean
}

/**
 * Runs an executable with an argument ARRAY. `shell` is always false, so no
 * argument is ever interpreted by cmd.exe or bash, whatever it contains.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const maxStdout = opts.maxStdout ?? 64 * 1024 * 1024
    let stdout = ''
    let outBuf = ''
    let errBuf = ''
    const stderrTail: string[] = []
    let aborted = false
    let timedOut = false
    let settled = false

    const pushErr = (line: string) => {
      stderrTail.push(line)
      if (stderrTail.length > 40) stderrTail.shift()
      opts.onStderrLine?.(line)
    }

    child.stdout!.setEncoding('utf8')
    child.stderr!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      if (stdout.length < maxStdout) stdout += chunk
      if (opts.onStdoutLine) {
        outBuf += chunk
        const lines = outBuf.split(/\r?\n|\r/)
        outBuf = lines.pop() ?? ''
        lines.forEach((l) => l && opts.onStdoutLine!(l))
      }
    })
    child.stderr!.on('data', (chunk: string) => {
      errBuf += chunk
      const lines = errBuf.split(/\r?\n|\r/)
      errBuf = lines.pop() ?? ''
      lines.forEach((l) => l && pushErr(l))
    })

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          killTree(child)
        }, opts.timeoutMs)
      : undefined

    const onAbort = () => {
      aborted = true
      killTree(child)
    }
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (outBuf && opts.onStdoutLine) opts.onStdoutLine(outBuf)
      if (errBuf) pushErr(errBuf)
      resolve({ code, stdout, stderrTail, aborted, timedOut })
    }
    child.on('error', (e) => {
      pushErr(`spawn error: ${e.message}`)
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

/** Kills a process and everything it started (yt-dlp spawns ffmpeg). */
export function killTree(child: ChildProcess): void {
  if (child.pid == null || child.exitCode !== null) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
  } else {
    child.kill('SIGTERM')
    setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2000).unref()
  }
}
