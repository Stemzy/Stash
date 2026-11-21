import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '../lib/format'

/** Thin progress bar. `indeterminate` shows the only looping animation in the app. */
export function ProgressBar({
  value,
  tone = 'accent',
  indeterminate,
  className
}: {
  value: number
  tone?: 'accent' | 'success' | 'danger' | 'muted'
  indeterminate?: boolean
  className?: string
}) {
  const color = {
    accent: 'bg-accent',
    success: 'bg-success',
    danger: 'bg-danger',
    muted: 'bg-fg-3'
  }[tone]
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-ink/[0.06]', className)}
    >
      {indeterminate ? (
        <motion.div
          className={cn('absolute inset-y-0 w-1/3 rounded-full', color)}
          initial={{ x: '-100%' }}
          animate={{ x: '300%' }}
          transition={{ duration: 1.4, ease: 'easeInOut', repeat: Infinity }}
        />
      ) : (
        <motion.div
          className={cn('absolute inset-y-0 left-0 w-full origin-left rounded-full', color)}
          initial={false}
          animate={{ scaleX: Math.max(0, Math.min(100, value)) / 100 }}
          transition={{ duration: 0.45, ease: 'linear' }}
        />
      )}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  className
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  const tones = {
    neutral: 'text-fg-2 border-line-strong',
    accent: 'text-accent border-accent/40',
    success: 'text-success border-success/35',
    warning: 'text-warning border-warning/35',
    danger: 'text-danger border-danger/35'
  }
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 text-meta font-medium',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

/** Loading placeholder with a slow, soft light sweep (static under reduced motion). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-sm', className)} />
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  compact
}: {
  icon: ReactNode
  title: string
  body?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'py-8' : 'py-16')}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-md border border-line-strong text-fg-2">
        {icon}
      </div>
      <p className="text-body font-medium text-fg">{title}</p>
      {body && <p className="mt-1 max-w-[340px] text-label text-fg-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
