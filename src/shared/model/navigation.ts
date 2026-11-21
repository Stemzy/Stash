import { createStore, useStore } from '../lib/store'

export type PageId = 'videos' | 'music' | 'library' | 'lab' | 'queue' | 'history'

export const navStore = createStore<PageId>('videos')

export const navigate = (page: PageId): void => navStore.set(page)
export const useActivePage = (): PageId => useStore(navStore)
