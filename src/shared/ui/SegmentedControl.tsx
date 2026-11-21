import { useId, type ReactNode, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { cn } from '../lib/format'
import { t } from '../lib/motion'

export interface SegmentOption<V extends string | number> {
  value: V
  label: ReactNode
  /** Second line under the label (size, fps, "Best"). */
  detail?: ReactNode
  disabled?: boolean
  /** Shown as a tooltip, e.g. why an option is disabled. */
  reason?: string
}

interface Props<V extends string | number> {
  options: SegmentOption<V>[]
  value: V
  onChange: (v: V) => void
  ariaLabel: string
  size?: 'sm' | 'md'
  stretch?: boolean
}

/** Pick one of a few visible options. Arrow keys move between them. */
export function SegmentedControl<V extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  stretch
}: Props<V>) {
  const group = useId()
  const enabled = options.filter((o) => !o.disabled)
  // If any option has a second line, every option gets the same height so the row lines up.
  const twoLine = size === 'md' && options.some((o) => o.detail)

  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
    e.preventDefault()
    const i = enabled.findIndex((o) => o.value === value)
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length]
    if (next) onChange(next.value)
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} onKeyDown={onKey} className={cn('flex flex-wrap gap-1.5', stretch && 'w-full')}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            title={o.reason}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative flex flex-col items-center justify-center rounded-sm border text-center',
              // Immediate hover, small press. Transform only, so it stays cheap.
              'transition-[border-color,color,background-color,transform] duration-100 ease-out-soft active:scale-[0.98]',
              size === 'md' ? (twoLine ? 'h-[46px] min-w-[88px] px-3.5' : 'h-8 min-w-[64px] px-3.5') : 'h-7 min-w-[52px] px-2.5',
              stretch && 'flex-1',
              active
                ? 'border-accent/70 text-fg'
                : 'border-line-strong bg-ink/[0.015] text-fg-2 hover:border-ink/[0.2] hover:bg-ink/[0.04] hover:text-fg',
              o.disabled && 'pointer-events-auto cursor-not-allowed border-line bg-transparent text-fg-3 opacity-60 hover:border-line hover:bg-transparent hover:text-fg-3 active:scale-100'
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${group}`}
                transition={t.base}
                className="absolute inset-0 rounded-[5px] bg-accent/[0.11] shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]"
                aria-hidden
              />
            )}
            {/* Same weight selected or not, so the row never shifts. */}
            <span className="relative text-label font-medium leading-4">{o.label}</span>
            {o.detail && (
              <span className={cn('tabular relative mt-0.5 text-meta leading-[14px] transition-colors duration-100', active ? 'text-fg-2' : 'text-fg-3')}>
                {o.detail}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
