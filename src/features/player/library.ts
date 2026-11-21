import type { LibraryItem } from '@shared/types/library'
import { api } from '@/shared/api'
import { createStore, useStore } from '@/shared/lib/store'
import { jobsStore } from '@/entities/job/model'
import { player } from './model'

// The Library's list of playable files, kept in sync with finished downloads.

export const libraryStore = createStore<{ items: LibraryItem[]; loaded: boolean }>({ items: [], loaded: false })
export const useLibrary = () => useStore(libraryStore)

let inflight: Promise<void> | null = null
export function reloadLibrary(): Promise<void> {
  inflight ??= api.library
    .list()
    .then((items) => {
      libraryStore.set({ items, loaded: true })
      player.forget(new Set(items.map((i) => i.id)))
    })
    .finally(() => (inflight = null))
  return inflight
}

// Refresh when a download finishes or a finished one is removed.
let lastKey = ''
jobsStore.subscribe(() => {
  const key = jobsStore
    .get()
    .filter((j) => j.status === 'completed' && !j.simulated)
    .map((j) => j.id)
    .join(',')
  if (key !== lastKey) {
    lastKey = key
    void reloadLibrary()
  }
})
