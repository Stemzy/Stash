import { api } from '@/shared/api'
import { THEMES, type ThemeId } from './themes'

let current: ThemeId | null = null

function write(id: ThemeId): void {
  const t = THEMES[id]
  const root = document.documentElement
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v)
  root.dataset.theme = id
  root.style.colorScheme = t.mode
}

/**
 * Applies a theme to the whole window. The first call (at startup) is instant so
 * nothing flashes; later switches crossfade the window (~300ms) unless the user
 * prefers reduced motion. Also tells the main process, so the caption buttons and
 * native menus follow.
 */
export function applyTheme(id: ThemeId): void {
  if (id === current) return
  const first = current === null
  current = id
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!first && !reduce && doc.startViewTransition) doc.startViewTransition(() => write(id))
  else write(id)
  const t = THEMES[id]
  void api.system.setAppearance({ mode: t.mode, symbolColor: t.vars['--color-fg-2']!, background: t.vars['--color-base']! })
}
