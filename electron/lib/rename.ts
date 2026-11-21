import { app } from 'electron'
import { cpSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { log } from './log'
import { TEMP_NAME } from './paths'

// The app used to be called "Downloader". Windows keeps an app's data in a
// folder named after it, so without this the rename would lose settings,
// queue, history, thumbnails, LAB results and tool updates. Runs once, before
// anything opens those folders; does nothing when there is nothing to move.

const OLD_DATA = ['desktop-downloader', 'Downloader'] // dev name, installed name
const OLD_TEMP = 'ClipDownloader'

// Files only this app writes: if the new folder has any, it's already in use.
const OURS = ['jobs.json', 'Local Storage', 'appearance.json', 'lab-cache', 'tools', 'thumbs']
const hasOurData = (dir: string) => existsSync(dir) && readdirSync(dir).some((n) => OURS.includes(n))

function move(from: string, to: string): void {
  if (!existsSync(to)) {
    try {
      renameSync(from, to)
      return
    } catch {
      /* fall through to copy */
    }
  }
  // Electron may already have made the new folder (crash reporter etc.): merge into it.
  cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
  rmSync(from, { recursive: true, force: true, maxRetries: 3 })
}

export function carryOverOldName(): void {
  try {
    const target = app.getPath('userData')
    if (!hasOurData(target)) {
      const old = OLD_DATA.map((n) => join(app.getPath('appData'), n)).find((p) => hasOurData(p))
      if (old) {
        move(old, target)
        log.info('moved app data to the new Stash folder')
      }
    }
    const oldTemp = join(tmpdir(), OLD_TEMP)
    const newTemp = join(tmpdir(), TEMP_NAME)
    if (existsSync(oldTemp) && !existsSync(newTemp)) move(oldTemp, newTemp)
    else if (existsSync(oldTemp)) rmSync(oldTemp, { recursive: true, force: true }) // only partial downloads
  } catch (e) {
    log.warn('could not move data from the old app name', String(e))
  }
}
