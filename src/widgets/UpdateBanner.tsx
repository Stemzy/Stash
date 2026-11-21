import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle2, RefreshCw, X } from 'lucide-react'
import { useUpdates, updatesActions } from '@/entities/updates/model'
import { Button } from '@/shared/ui/Button'
import { t } from '@/shared/lib/motion'

/**
 * Small popup at the top of the window for the media-tool updater:
 * the one-time "keep things up to date?" question, the live "Updating…"
 * progress bar, and a short "Updated" / failure note when it finishes.
 */
export function UpdateBanner() {
  const u = useUpdates()
  // Let the app settle before asking anything on first launch.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), 1500)
    return () => clearTimeout(id)
  }, [])

  const p = u.progress
  const working = p.phase === 'downloading' || p.phase === 'installing'
  const ask = settled && u.state?.auto === null && !working && !u.flash
  const key = working ? 'work' : u.flash ? 'flash' : ask ? 'ask' : null

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[46px] z-50 flex justify-center" aria-live="polite">
      <AnimatePresence initial={false}>
        {key && (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.16 } }}
            transition={t.panel}
            className="glass-toast pointer-events-auto w-[380px] rounded-md px-3.5 py-3"
          >
            {key === 'work' && working && (
              <div>
                <div className="flex items-center gap-2.5">
                  <RefreshCw size={15} strokeWidth={1.75} className="shrink-0 animate-spin text-accent [animation-duration:1.6s]" />
                  <p className="min-w-0 flex-1 truncate text-body font-medium">
                    {p.phase === 'installing' ? 'Installing' : 'Updating'} {p.label}
                    <span className="font-normal text-fg-3"> · {p.version}</span>
                  </p>
                  <span className="tabular shrink-0 text-label text-fg-2">
                    {p.count > 1 && `${p.index} of ${p.count} · `}
                    {Math.round(p.fraction * 100)}%
                  </span>
                </div>
                <div
                  className="mt-2.5 h-1 overflow-hidden rounded-full bg-ink/[0.08]"
                  role="progressbar"
                  aria-label={`Updating ${p.label}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(p.fraction * 100)}
                >
                  <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${Math.max(2, p.fraction * 100)}%` }} />
                </div>
                <p className="mt-2 text-label text-fg-3">Downloads in progress keep running.</p>
              </div>
            )}

            {key === 'flash' && u.flash && (
              <div className="flex items-start gap-2.5">
                {u.flash.error && !u.flash.updated.length ? (
                  <AlertCircle size={16} strokeWidth={1.75} className="mt-px shrink-0 text-danger" />
                ) : (
                  <CheckCircle2 size={16} strokeWidth={1.75} className="mt-px shrink-0 text-success" />
                )}
                <div className="min-w-0 flex-1">
                  {u.flash.updated.length > 0 && <p className="text-body font-medium">Updated {u.flash.updated.join(', ')}</p>}
                  {u.flash.error && <p className={u.flash.updated.length ? 'mt-0.5 text-label text-fg-2' : 'text-body font-medium'}>{u.flash.error}</p>}
                </div>
                <button
                  aria-label="Dismiss"
                  onClick={updatesActions.dismissFlash}
                  className="-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-3 transition-colors duration-150 hover:bg-ink/[0.07] hover:text-fg"
                >
                  <X size={14} strokeWidth={1.75} />
                </button>
              </div>
            )}

            {key === 'ask' && (
              <div>
                <div className="flex items-start gap-2.5">
                  <RefreshCw size={16} strokeWidth={1.75} className="mt-px shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium">Keep the media tools up to date?</p>
                    <p className="mt-0.5 text-label text-fg-2">
                      yt-dlp, FFmpeg and Deno get updates often, mostly to keep sites working. They come straight from each tool's official GitHub page and are
                      checked before use. You can change this in Settings.
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => void updatesActions.setAuto(false)}>
                    Not now
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => void updatesActions.setAuto(true)}>
                    Keep up to date
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
