import { app, BrowserWindow, nativeTheme } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Window chrome that has to follow the chosen theme: the native caption
// buttons' colour, Windows light/dark for native menus/dialogs/tooltips, and
// the background shown before the page paints (remembered for next launch).

const HEX = /^#[0-9a-f]{6}$/i
const file = () => join(app.getPath('userData'), 'appearance.json')

export interface Appearance {
  mode: 'dark' | 'light'
  symbolColor: string
  background: string
}

const DEFAULT: Appearance = { mode: 'dark', symbolColor: '#9A9DA3', background: '#0E0F11' }

export function savedAppearance(): Appearance {
  try {
    const a = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Appearance>
    return clean(a) ?? DEFAULT
  } catch {
    return DEFAULT
  }
}

function clean(a: unknown): Appearance | null {
  const x = (a ?? {}) as Partial<Appearance>
  if ((x.mode !== 'dark' && x.mode !== 'light') || !HEX.test(x.symbolColor ?? '') || !HEX.test(x.background ?? '')) return null
  return { mode: x.mode, symbolColor: x.symbolColor!, background: x.background! }
}

export async function applyAppearance(win: BrowserWindow | null, raw: unknown): Promise<void> {
  const a = clean(raw)
  if (!a) return
  nativeTheme.themeSource = a.mode
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(a.background)
    try {
      // Only exists where the window was created with titleBarOverlay (Windows, Linux).
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: a.symbolColor, height: 36 })
    } catch {
      /* platform without overlay */
    }
  }
  await writeFile(file(), JSON.stringify(a)).catch(() => undefined)
}
