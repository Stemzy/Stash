import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/format'
import { t } from '../lib/motion'

export interface SelectOption<V extends string | number> {
  value: V
  label: string
  hint?: string
}

interface Props<V extends string | number> {
  value: V
  options: SelectOption<V>[]
  onChange: (v: V) => void
  ariaLabel: string
  className?: string
}

/** Dropdown list. Keyboard: Enter/Space/Down opens, arrows move, Enter picks, Esc closes. */
export function Select<V extends string | number>({ value, options, onChange, ariaLabel, className }: Props<V>) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    setHi(Math.max(0, options.findIndex((o) => o.value === value)))
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open, options, value])

  const pick = (i: number) => {
    const o = options[i]
    if (o) onChange(o.value)
    setOpen(false)
  }

  const onKey = (e: KeyboardEvent) => {
    if (!open && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown') setHi((h) => Math.min(options.length - 1, h + 1))
    else if (e.key === 'ArrowUp') setHi((h) => Math.max(0, h - 1))
    else if (e.key === 'Enter' || e.key === ' ') pick(hi)
    else return
    e.preventDefault()
  }

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-sm border bg-ink/[0.025] px-3 text-left text-body',
          'transition-[border-color,box-shadow,background-color] duration-150 ease-out-soft',
          open ? 'border-accent/55 focus-halo' : 'border-ink/[0.09] hover:border-ink/[0.16] hover:bg-ink/[0.04]'
        )}
      >
        <span className="truncate">{current?.label ?? '—'}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={cn('shrink-0 text-fg-3 transition-[transform,color] duration-150', open && 'rotate-180 text-fg-2')}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={t.fast}
            className="glass-popover absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-md p-1"
          >
            {options.map((o, i) => {
              const selected = o.value === value
              return (
                <li
                  key={String(o.value)}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setHi(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(i)}
                  className={cn(
                    'flex h-8 items-center gap-2 rounded-[5px] px-2.5 text-body transition-colors duration-100',
                    i === hi ? 'bg-ink/[0.07] text-fg' : 'text-fg-2',
                    selected && 'text-fg'
                  )}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-meta text-fg-3">{o.hint}</span>}
                  <Check size={14} strokeWidth={1.5} className={cn('text-accent', !selected && 'invisible')} />
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
