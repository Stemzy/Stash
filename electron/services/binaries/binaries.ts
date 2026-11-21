import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { ToolStatus } from '../../../shared/types/media'
import { run } from '../runner/runner'

export interface ToolPaths {
  ytdlp?: string
  ffmpeg?: string
  ffprobe?: string
  deno?: string
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function onPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, exe(name))
    if (isFile(p)) return p
  }
  return undefined
}

/**
 * Auto-updated copies first (if any), then bundled binaries
 * (resources/bin/<platform>-<arch>/), then PATH.
 * `binDirs` comes from the main process so this file stays free of Electron.
 */
export function resolveTools(binDirs: string[], updated: ToolPaths = {}): ToolPaths {
  const find = (name: string) => {
    const u = updated[(name === 'yt-dlp' ? 'ytdlp' : name) as keyof ToolPaths]
    if (u && isFile(u)) return u
    for (const d of binDirs) {
      const p = join(d, exe(name))
      if (existsSync(p) && isFile(p)) return p
    }
    return onPath(name)
  }
  return { ytdlp: find('yt-dlp'), ffmpeg: find('ffmpeg'), ffprobe: find('ffprobe'), deno: find('deno') }
}

async function version(path: string | undefined, args: string[], parse: (out: string) => string | undefined) {
  if (!path) return undefined
  const r = await run(path, args, { timeoutMs: 20_000, maxStdout: 64 * 1024 })
  return r.code === 0 ? parse(r.stdout) : undefined
}

/** Runs each tool once to prove it starts, and reads its version. */
export async function checkTools(paths: ToolPaths): Promise<ToolStatus[]> {
  const ffVersion = (out: string) => out.match(/version\s+(\S+)/)?.[1]
  const [y, f, p, d] = await Promise.all([
    version(paths.ytdlp, ['--version'], (o) => o.trim().split('\n')[0] || undefined),
    version(paths.ffmpeg, ['-hide_banner', '-version'], ffVersion),
    version(paths.ffprobe, ['-hide_banner', '-version'], ffVersion),
    version(paths.deno, ['--version'], (o) => o.match(/deno\s+(\S+)/)?.[1])
  ])
  return [
    { name: 'yt-dlp', path: paths.ytdlp, version: y, ok: !!y },
    { name: 'ffmpeg', path: paths.ffmpeg, version: f, ok: !!f },
    { name: 'ffprobe', path: paths.ffprobe, version: p, ok: !!p },
    { name: 'deno', path: paths.deno, version: d, ok: !!d, optional: true }
  ]
}
