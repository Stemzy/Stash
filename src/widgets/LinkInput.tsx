import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Link2, X } from 'lucide-react'
import { cn } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { normalizeLinkInput } from '@shared/link'

interface Props {
  value: string
  onValueChange: (v: string) => void
  placeholder: string
  analyzing: boolean
  /** Show Cancel instead of Analyze (after 3 s of analyzing). */
  canCancel: boolean
  onAnalyze: (url: string) => void
  onCancel: () => void
  onClear: () => void
  /** Result cue: the outline glows green (found) or red (failed) for a moment. */
  pulse?: { kind: 'success' | 'error'; n: number } | null
}

/** Paste, analyze, clear. Shared by Videos and Music. */
export function LinkInput({ value, onValueChange: setValue, placeholder, analyzing, canCancel, onAnalyze, onCancel, onClear, pulse }: Props) {
  const [focused, setFocused] = useState(false)

  // Clean up what was typed/pasted (adds https://, pulls the link out of share text).
  const go = (text: string) => {
    const link = normalizeLinkInput(text)
    // Always show what's being analyzed (a pasted link was intercepted before it reached the box).
    setValue(link ?? text.trim())
    onAnalyze(link ?? text.trim())
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim()) go(value)
  }

  return (
    <div className="relative">
      <form
        onSubmit={submit}
        aria-busy={analyzing}
        className={cn(
          'relative flex h-12 items-center gap-3 overflow-hidden rounded-md border bg-surface pl-4 pr-1.5',
          'shadow-[inset_0_1px_0_var(--glass-highlight)] transition-[border-color,box-shadow] duration-150 ease-out-soft',
          focused ? 'border-accent/55 shadow-[inset_0_1px_0_var(--glass-highlight),0_0_0_3px_var(--focus-halo)]' : 'border-ink/[0.09] hover:border-ink/[0.16]'
        )}
      >
        <Link2 size={16} strokeWidth={1.5} className={cn('shrink-0 transition-colors duration-150', focused || analyzing ? 'text-accent' : 'text-fg-3')} />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && analyzing) {
              e.preventDefault()
              onCancel()
            }
          }}
          onPaste={(e) => {
            // Analyze right away when a link is pasted into an empty field.
            const text = e.clipboardData.getData('text').trim()
            if (!value && normalizeLinkInput(text)) {
              e.preventDefault()
              go(text)
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          aria-label="Link"
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent text-body outline-none transition-colors duration-150 placeholder:text-fg-3 focus-visible:outline-none',
            analyzing ? 'text-fg-2' : 'text-fg'
          )}
        />
        {value && !analyzing && (
          <button
            type="button"
            aria-label="Clear link"
            title="Clear"
            onClick={() => {
              onClear()
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-3 transition-colors duration-100 hover:bg-ink/[0.06] hover:text-fg"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
        {analyzing && canCancel ? (
          // Separate keys: React must not reuse this element for the submit button, or the
          // click that cancels would finish as a "submit" and start the analysis again.
          <Button
            key="cancel"
            type="button"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault()
              onCancel()
            }}
            className="h-9 min-w-[96px]"
          >
            Cancel
          </Button>
        ) : (
          <Button key="analyze" type="submit" variant="primary" loading={analyzing} disabled={!value.trim()} className="h-9 min-w-[96px]">
            {analyzing ? 'Analyzing' : 'Analyze'}
          </Button>
        )}
        {/* Analyzing: a thin accent line glides along the bottom edge. */}
        {analyzing && (
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
            <span className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-accent/80 to-transparent [animation:link-scan_1.3s_ease-in-out_infinite]" />
          </span>
        )}
      </form>
      {/* Status glow: in quickly, hold, then ease back to the normal outline (~1.3 s). Outside the form so the halo isn't clipped. */}
      <AnimatePresence>
        {pulse && (
          <motion.span
            key={pulse.n}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-md border"
            style={
              {
                '--c': pulse.kind === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
                borderColor: 'color-mix(in srgb, var(--c) 85%, transparent)',
                boxShadow: '0 0 0 3px color-mix(in srgb, var(--c) 16%, transparent), 0 0 18px color-mix(in srgb, var(--c) 22%, transparent)'
              } as React.CSSProperties
            }
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.3, times: [0, 0.12, 0.42, 1], ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
