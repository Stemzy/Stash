import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { t } from '../lib/motion'
import { Button } from './Button'

/**
 * Small modal for confirming a destructive action. Esc or a click outside
 * cancels; focus starts on Cancel so Enter never deletes by accident.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="glass-scrim fixed inset-0 z-[60] flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.16 } }}
          transition={t.panel}
          onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99, transition: { duration: 0.14 } }}
            transition={t.panel}
            className="glass-panel w-full max-w-[400px] rounded-[14px] p-5"
          >
            <h2 className="text-section font-semibold">{title}</h2>
            <div className="mt-2 text-body text-fg-2">{body}</div>
            <div className="mt-5 flex justify-end gap-2">
              <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={onConfirm} loading={busy}>
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
