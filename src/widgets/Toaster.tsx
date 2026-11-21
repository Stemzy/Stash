import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useStore } from '@/shared/lib/store'
import { dismissToast, toastStore } from '@/shared/ui/toast'
import { t } from '@/shared/lib/motion'
import { usePlayer } from '@/features/player/model'
import { cn } from '@/shared/lib/format'

const ICON = {
  info: <Info size={16} strokeWidth={1.75} className="text-accent" />,
  success: <CheckCircle2 size={16} strokeWidth={1.75} className="text-success" />,
  error: <AlertCircle size={16} strokeWidth={1.75} className="text-danger" />
}

/** Notifications, bottom-right above the queue strip. */
export function Toaster() {
  const toasts = useStore(toastStore)
  const playing = !!usePlayer().current // lift above the music bar
  return (
    <div className={cn('pointer-events-none absolute right-5 z-50 flex w-[340px] flex-col gap-2', playing ? 'bottom-[124px]' : 'bottom-14')} aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((x) => (
          <motion.div
            key={x.id}
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 12, transition: { duration: 0.16 } }}
            transition={t.panel}
            className="glass-toast pointer-events-auto flex gap-3 rounded-md py-3 pl-3.5 pr-2.5"
          >
            <span className="mt-px shrink-0">{ICON[x.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium">{x.title}</p>
              {x.body && <p className="mt-0.5 text-label text-fg-2">{x.body}</p>}
              {x.action && (
                <button
                  onClick={() => {
                    x.action!.run()
                    dismissToast(x.id)
                  }}
                  className="-ml-1.5 mt-1.5 rounded-sm px-1.5 py-0.5 text-label font-medium text-accent transition-colors duration-150 hover:bg-accent/[0.1]"
                >
                  {x.action.label}
                </button>
              )}
            </div>
            <button
              aria-label="Dismiss"
              onClick={() => dismissToast(x.id)}
              className="-mt-0.5 flex size-6 shrink-0 items-center justify-center self-start rounded-sm text-fg-3 transition-colors duration-150 hover:bg-ink/[0.07] hover:text-fg"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
