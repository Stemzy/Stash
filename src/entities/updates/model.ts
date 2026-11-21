import type { ToolUpdateProgress, ToolUpdateState } from '@shared/types/media'
import { api, isElectron } from '@/shared/api'
import { createStore, useStore } from '@/shared/lib/store'

/**
 * The media-tool updater as the window sees it. `flash` keeps a finished
 * update ("Updated yt-dlp") on screen for a few seconds after the main process
 * goes idle.
 */
interface UpdatesUi {
  state: ToolUpdateState | null
  progress: ToolUpdateProgress
  /** Whether a download happened in the current run (so a plain check stays silent). */
  showedWork: boolean
  flash: { updated: string[]; error?: string } | null
}

export const updatesStore = createStore<UpdatesUi>({ state: null, progress: { phase: 'idle' }, showedWork: false, flash: null })
export const useUpdates = () => useStore(updatesStore)

let flashTimer: ReturnType<typeof setTimeout> | undefined

function onProgress(p: ToolUpdateProgress): void {
  updatesStore.set((u) => {
    if (p.phase === 'downloading' || p.phase === 'installing') return { ...u, progress: p, showedWork: true, flash: null }
    if (p.phase === 'done') {
      // Quiet when nothing needed updating, or the check simply couldn't reach GitHub.
      if (!u.showedWork) return { ...u, progress: p }
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => updatesStore.set((x) => ({ ...x, flash: null })), p.error ? 7000 : 4000)
      return { ...u, progress: p, showedWork: false, flash: { updated: p.updated, error: p.error } }
    }
    return { ...u, progress: p }
  })
  if (p.phase === 'done') void refresh()
}

export async function refresh(): Promise<void> {
  const state = await api.updates.state()
  updatesStore.set((u) => ({ ...u, state }))
}

export const updatesActions = {
  async setAuto(on: boolean) {
    const state = await api.updates.setAuto(on)
    updatesStore.set((u) => ({ ...u, state }))
  },
  async checkNow() {
    const state = await api.updates.checkNow()
    updatesStore.set((u) => ({ ...u, state }))
    return state
  },
  dismissFlash() {
    clearTimeout(flashTimer)
    updatesStore.set((u) => ({ ...u, flash: null }))
  }
}

if (isElectron) {
  api.updates.onProgress(onProgress)
  void refresh()
}
