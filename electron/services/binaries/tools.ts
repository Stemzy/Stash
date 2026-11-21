import { app } from 'electron'
import { join } from 'node:path'
import type { ToolStatus } from '../../../shared/types/media'
import { checkTools, resolveTools, type ToolPaths } from './binaries'
import { updatedToolPaths } from '../updater/toolUpdater'

let paths: ToolPaths | null = null
let status: Promise<ToolStatus[]> | null = null

function binDirs(): string[] {
  const target = `${process.platform}-${process.arch}`
  return app.isPackaged
    ? [join(process.resourcesPath, 'bin')]
    : [join(app.getAppPath(), 'resources', 'bin', target)]
}

/** Checked once and cached; `refresh` re-checks (e.g. after fetch-binaries). */
export function toolStatus(refresh = false): Promise<ToolStatus[]> {
  if (!status || refresh) {
    paths = resolveTools(binDirs(), updatedToolPaths())
    status = checkTools(paths)
  }
  return status
}

/** Bundled (not updated) FFmpeg, for the updater to judge its age. */
export function bundledFfmpeg(): string | undefined {
  return resolveTools(binDirs()).ffmpeg
}

/**
 * Paths of working tools, or null if a required one is missing.
 * Deno is optional (yt-dlp falls back to limited YouTube support without it).
 */
export async function requireTools(need: ('ytdlp' | 'ffmpeg' | 'ffprobe')[]): Promise<ToolPaths | null> {
  const s = await toolStatus()
  const ok = (n: string) => s.find((t) => t.name === n)?.ok
  const map = { ytdlp: 'yt-dlp', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' } as const
  if (!need.every((k) => ok(map[k]))) {
    // Maybe the user just ran fetch-binaries: check once more before giving up.
    const again = await toolStatus(true)
    if (!need.every((k) => again.find((t) => t.name === map[k])?.ok)) return null
  }
  return { ...paths!, deno: ok('deno') ? paths!.deno : undefined }
}
