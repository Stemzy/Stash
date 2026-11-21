import { createStore } from '../lib/store'

export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  body?: string
  action?: { label: string; run: () => void }
}

export const toastStore = createStore<Toast[]>([])
let nextId = 1

export function notify(t: Omit<Toast, 'id'>, ms = 4200): void {
  const id = nextId++
  toastStore.set((list) => [...list.slice(-2), { ...t, id }])
  window.setTimeout(() => dismissToast(id), ms)
}

export function dismissToast(id: number): void {
  toastStore.set((list) => list.filter((x) => x.id !== id))
}
