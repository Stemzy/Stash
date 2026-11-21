import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaErrorCode, MediaInfo } from '@shared/types/media'
import { api, isElectron } from '@/shared/api'
import { AnalyzeError, mockAnalyze } from '@/shared/mock/mockMedia'

export type AnalyzeState =
  | { status: 'idle' }
  | { status: 'analyzing'; url: string; slow: boolean }
  | { status: 'ready'; media: MediaInfo }
  | { status: 'error'; code: MediaErrorCode }

let seq = 0

/** Shared by Videos and Music: paste -> analyze -> ready | error. */
export function useAnalyze(kind: 'video' | 'audio') {
  const [state, setState] = useState<AnalyzeState>({ status: 'idle' })
  /** Brief status cue for the link field: changes once per finished analysis (never on cancel). */
  const [pulse, setPulse] = useState<{ kind: 'success' | 'error'; n: number } | null>(null)
  const current = useRef<{ id: string; ctrl: AbortController } | null>(null)
  const slowTimer = useRef<number | undefined>(undefined)

  const stop = useCallback(() => {
    const c = current.current
    if (!c) return
    c.ctrl.abort()
    if (isElectron) void api.media.cancelAnalyze(c.id)
    current.current = null
  }, [])

  const cancel = useCallback(() => {
    stop()
    window.clearTimeout(slowTimer.current)
    setState({ status: 'idle' })
  }, [stop])

  const analyze = useCallback(
    (url: string) => {
      stop()
      const id = `a${Date.now().toString(36)}${seq++}`
      const ctrl = new AbortController()
      current.current = { id, ctrl }
      setState({ status: 'analyzing', url, slow: false })
      // Offer Cancel after a moment (instant results don't flash a Cancel button).
      window.clearTimeout(slowTimer.current)
      slowTimer.current = window.setTimeout(
        () => setState((s) => (s.status === 'analyzing' ? { ...s, slow: true } : s)),
        1200
      )
      const done = (next: AnalyzeState) => {
        if (current.current?.id !== id) return // a newer request or a cancel won
        current.current = null
        window.clearTimeout(slowTimer.current)
        setState(next)
        if (next.status === 'ready' || next.status === 'error') setPulse((p) => ({ kind: next.status === 'ready' ? 'success' : 'error', n: (p?.n ?? 0) + 1 }))
      }

      if (isElectron) {
        api.media
          .analyze(url, id)
          .then((r) => {
            if (r.ok) done({ status: 'ready', media: r.media })
            else if (r.error.code !== 'CANCELED') done({ status: 'error', code: r.error.code })
          })
          .catch(() => done({ status: 'error', code: 'UNKNOWN' }))
      } else {
        // Plain-browser preview only: no main process, so use mock data.
        mockAnalyze(url, kind, ctrl.signal)
          .then((media) => done({ status: 'ready', media }))
          .catch((e: unknown) => e instanceof AnalyzeError && done({ status: 'error', code: e.code }))
      }
    },
    [kind, stop]
  )

  useEffect(() => stop, [stop])

  return { state, analyze, cancel, reset: cancel, pulse }
}
