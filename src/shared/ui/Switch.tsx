import { cn } from '../lib/format'

/**
 * On/off toggle (Windows 11 style): filled accent when on, outlined when off.
 * The thumb slides with a transform, so it's smooth and cheap.
 */
export function Switch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        'group/switch relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full border',
        'transition-[background-color,border-color] duration-150 ease-out-soft',
        checked
          ? 'border-accent bg-accent hover:border-accent-hover hover:bg-accent-hover'
          : 'border-ink/[0.24] bg-ink/[0.04] hover:border-ink/[0.34] hover:bg-ink/[0.07]'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-[3px] top-1/2 size-3.5 -translate-y-1/2 rounded-full',
          'transition-[transform,background-color,scale] duration-180 ease-out-soft group-active/switch:scale-90',
          checked ? 'translate-x-[18px] bg-on-accent' : 'translate-x-0 bg-fg-2 group-hover/switch:bg-fg'
        )}
      />
    </button>
  )
}
