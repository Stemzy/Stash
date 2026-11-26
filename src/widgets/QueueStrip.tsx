import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronUp, Pause, Play, X } from 'lucide-react'
import { useJobs, isActive, jobActions } from '@/entities/job/model'
import { JobRow } from '@/entities/job/ui'
import { formatSpeed, cn } from '@/shared/lib/format'
import { navigate } from '@/shared/model/navigation'
import { Button, IconButton } from '@/shared/ui/Button'
import { t } from '@/shared/lib/motion'

/**
 * Slim status strip at the bottom of Videos and Music. Clicking it slides up a
 * drawer with the active jobs so progress can be watched without leaving the page.
 */
export function QueueStrip() {
  const jobs = useJobs()
  const active = jobs.filter(isActive)
  const running = active.filter((j) => ['downloading', 'merging', 'converting'].includes(j.status))
  const waiting = active.filter((j) => j.status === 'queued' || j.status === 'paused')
  const speed = running.reduce((s, j) => s + (j.speedBps ?? 0), 0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (active.length === 0) setOpen(false)
  }, [active.length])

  return (
    <div className="relative z-10 shrink-0">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={t.panel}
            className="glass-sheet absolute bottom-full left-0 right-0 px-6 pb-2 pt-3"
          >
            <div className="mx-auto max-w-[880px]">
              <div className="mb-1 flex items-center justify-between">
                <span className="small-caps text-fg-2">Active downloads</span>
                <Button size="sm" variant="ghost" onClick={() => navigate('queue')}>
                  Open queue
                </Button>
              </div>
              <div className="max-h-[260px] divide-y divide-line overflow-y-auto">
                {active.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    dense
                    showProgress
                    actions={
                      <>
                        {j.status === 'paused' ? (
                          <IconButton label="Resume" onClick={() => jobActions.resume(j.id)}>
                            <Play size={14} strokeWidth={1.5} />
                          </IconButton>
                        ) : (
                          <IconButton label="Pause" disabled={j.status !== 'downloading'} onClick={() => jobActions.pause(j.id)}>
                            <Pause size={14} strokeWidth={1.5} />
                          </IconButton>
                        )}
                        <IconButton label="Cancel" onClick={() => jobActions.cancel(j.id)}>
                          <X size={14} strokeWidth={1.5} />
                        </IconButton>
                      </>
                    }
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => active.length > 0 && setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'glass-bar glass-deep relative flex h-10 w-full items-center gap-3 px-6 text-label transition-colors duration-150',
          active.length > 0 ? 'hover:bg-[var(--glass-bar-hover)]' : 'cursor-default'
        )}
      >
        <span className={cn('size-1.5 rounded-full', running.length ? 'bg-accent' : 'bg-fg-3')} />
        <span className="tabular text-fg-2">
          {active.length === 0
            ? 'No active downloads'
            : [
                running.length && `${running.length} downloading`,
                waiting.length && `${waiting.length} waiting`,
                speed && formatSpeed(speed)
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
        {active.some((j) => j.simulated) && <span className="text-fg-3">(includes simulated)</span>}
        {active.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-fg">
            {open ? 'Hide' : 'Show'}
            <ChevronUp size={14} strokeWidth={1.5} className={cn('transition-transform duration-200', !open && 'rotate-180')} />
          </span>
        )}
      </button>
    </div>
  )
}
