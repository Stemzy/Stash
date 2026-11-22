import { createStore, useStore } from '@/shared/lib/store'
import { api } from '@/shared/api'
import { THEMES, isThemeId, type ThemeId } from './themes'
import { applyTheme } from './applyTheme'

export type BackdropStyle = 'blur' | 'glow' | 'off'

export interface Settings {
  backdrop: BackdropStyle
  /** Moving, beat-reactive background while media plays in the Library. */
  liveBackdrop: boolean
  /** The faint illustration behind the whole app. */
  backgroundArt: boolean
  folders: { videos: string; music: string }
  concurrency: number
  /** Appearance theme. Existing installs (no value saved) get Default: their look doesn't change. */
  theme: ThemeId
  /** Ambient intensity 0–100, remembered per theme; a theme with no saved value uses its own default. */
  ambientIntensity: Partial<Record<ThemeId, number>>
}

// Storage key from before the app was renamed to Stash; kept so saved settings carry over.
const KEY = 'downloader.settings.v1'

function load(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
  } catch {
    return {}
  }
}

const saved = load()

export const settingsStore = createStore<Settings>({
  backdrop: saved.backdrop ?? 'blur',
  liveBackdrop: saved.liveBackdrop ?? true,
  backgroundArt: saved.backgroundArt ?? true,
  folders: { videos: saved.folders?.videos ?? '', music: saved.folders?.music ?? '' },
  concurrency: saved.concurrency ?? 2,
  theme: isThemeId(saved.theme) ? saved.theme : 'default',
  ambientIntensity: cleanIntensity(saved.ambientIntensity)
})


function cleanIntensity(v: unknown): Partial<Record<ThemeId, number>> {
  const out: Partial<Record<ThemeId, number>> = {}
  if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v)) if (isThemeId(k) && typeof n === 'number' && n >= 0 && n <= 100) out[k] = Math.round(n)
  }
  return out
}

/** The intensity in effect for a theme (saved value, or the theme's designed default). */
export function intensityFor(s: Pick<Settings, 'ambientIntensity'>, theme: ThemeId): number {
  return s.ambientIntensity[theme] ?? THEMES[theme].ambient.defaultIntensity
}

// Apply the saved theme before the first paint, then follow changes.
applyTheme(settingsStore.get().theme)
settingsStore.subscribe(() => applyTheme(settingsStore.get().theme))

settingsStore.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsStore.get()))
  } catch {
    /* storage unavailable: settings just won't persist */
  }
})

// Fill in the default folder (Downloads) the first time. Earlier versions defaulted to
// Videos and Music, which Windows' ransomware protection can block; a saved folder that
// is still exactly that old default (never changed by the user) moves to Downloads once.
const FOLDERS_MOVED = 'downloader.folders-to-downloads.v1'
let movedAlready = false
try {
  movedAlready = localStorage.getItem(FOLDERS_MOVED) === '1'
} catch {
  /* no storage */
}
if (!saved.folders?.videos || !saved.folders?.music || !movedAlready) {
  void api.system.defaultFolders().then((d) => {
    const same = (a: string, b?: string) => !!b && a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
    settingsStore.set((s) => {
      const pick = (cur: string, def: string, old?: string) => (!cur || (!movedAlready && same(cur, old)) ? def : cur)
      return { ...s, folders: { videos: pick(s.folders.videos, d.videos, d.previous?.videos), music: pick(s.folders.music, d.music, d.previous?.music) } }
    })
    try {
      localStorage.setItem(FOLDERS_MOVED, '1')
    } catch {
      /* no storage */
    }
  })
}

// The main process runs the queue, so it needs the limit too.
let sentConcurrency = 0
const syncConcurrency = () => {
  const n = settingsStore.get().concurrency
  if (n !== sentConcurrency) {
    sentConcurrency = n
    void api.jobs.setConcurrency(n)
  }
}
syncConcurrency()
settingsStore.subscribe(syncConcurrency)

export const useSettings = (): Settings => useStore(settingsStore)

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set((s) => ({ ...s, ...patch }))
}
