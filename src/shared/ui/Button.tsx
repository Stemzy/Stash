import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/format'
import { Spinner } from './Spinner'

/** `solid` = the one main action on a screen (e.g. Download). */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'solid'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent/14 text-fg border border-accent/70 hover:bg-accent/20 hover:border-accent active:bg-accent/26',
  secondary: 'bg-ink/[0.03] text-fg border border-line-strong hover:bg-ink/[0.06] active:bg-ink/[0.08]',
  ghost: 'bg-transparent text-fg-2 border border-transparent hover:text-fg hover:bg-ink/[0.05] active:bg-ink/[0.08]',
  danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger/10 active:bg-danger/15',
  solid:
    'bg-accent text-on-accent font-semibold border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_1px_2px_rgb(0_0_0/0.18)] hover:bg-accent-hover active:bg-accent-press'
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 gap-1.5 text-label',
  md: 'h-8 px-3 gap-2 text-body',
  lg: 'h-10 px-4 gap-2 text-body'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, disabled, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm font-medium',
        'transition-[background-color,border-color,color,opacity,transform] duration-100 ease-out-soft active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  )
})

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-2',
        'transition-colors duration-150 hover:bg-ink/[0.06] hover:text-fg active:bg-ink/[0.09]',
        'disabled:pointer-events-none disabled:opacity-35',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
