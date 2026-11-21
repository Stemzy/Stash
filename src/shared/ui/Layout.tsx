import type { ReactNode } from 'react'
import { cn } from '../lib/format'

/** Fixed gutters and the 880px content column from the plan. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[880px] px-8 pb-16 pt-7">{children}</div>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-title font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-1 text-body text-fg-2">{subtitle}</p>}
      </div>
      {actions}
    </header>
  )
}

/**
 * Content panel. `solid` (Graphite Glass) is a near-opaque surface with a hairline
 * top highlight: primary content stays crisp over the ambient background.
 * The default translucent style is kept for pages not yet moved over.
 */
export function Panel({ children, className, solid }: { children: ReactNode; className?: string; solid?: boolean }) {
  return (
    <section
      className={cn(
        'rounded-md border',
        solid
          ? 'border-ink/[0.08] bg-surface shadow-[var(--shadow-card)]'
          : 'border-line-strong bg-raised/55 backdrop-blur-md',
        className
      )}
    >
      {children}
    </section>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-section font-semibold">{children}</h2>
      {aside}
    </div>
  )
}

/** Label + control + optional hint, stacked. */
export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="text-label font-medium text-fg-2">{label}</span>
      {children}
      {hint && <div className="text-meta text-fg-2">{hint}</div>}
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-line', className)} />
}
