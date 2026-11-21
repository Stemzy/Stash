import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '../lib/format'

/**
 * Seek / volume bar. Drag or click anywhere on it; arrow keys step.
 *
 * Visuals are transform-only (scaleX for the played part, translateX for the
 * handle), so the track never changes size and nothing reflows. Between the
 * player's ~4 position updates a second, the fill glides linearly to the next
 * value; jumps (seeks) and drags apply instantly. After a seek, the bar holds
 * the chosen spot until playback reports it, so it never flickers back.
 */
export function Scrubber({
  value,
  max,
  buffered,
  onChange,
  onCommit,
  ariaLabel,
  step,
  className
}: {
  value: number
  max: number
  buffered?: number
  onChange?: (v: number) => void
  /** Called once when a drag ends (or on click / key). */
  onCommit: (v: number) => void
  ariaLabel: string
  step?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [pending, setPending] = useState<number | null>(null)

  // Release the held seek position once the real value arrives (or after 1.2 s).
  useEffect(() => {
    if (pending === null) return
    if (Math.abs(value - pending) <= Math.max(max * 0.01, 0.75)) {
      setPending(null)
      return
    }
    const t = window.setTimeout(() => setPending(null), 1200)
    return () => window.clearTimeout(t)
  }, [value, pending, max])

  const shown = drag ?? pending ?? value
  const frac = max > 0 ? Math.min(1, Math.max(0, shown / max)) : 0
  const bufFrac = max > 0 && buffered ? Math.min(1, buffered / max) : 0

  // Glide only for small forward steps (normal playback); everything else is immediate.
  const prev = useRef(frac)
  const glide = drag === null && frac >= prev.current && frac - prev.current < 0.02
  prev.current = frac
  const motionStyle = glide ? 'transform 260ms linear' : 'none'

  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * max
  }

  const commit = (v: number) => {
    setPending(v)
    onCommit(v)
  }

  const onKey = (e: KeyboardEvent) => {
    const s = step ?? max / 20
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') commit(Math.min(max, value + s))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') commit(Math.max(0, value - s))
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        if (max <= 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const v = at(e)
        setDrag(v)
        onChange?.(v)
      }}
      onPointerMove={(e) => {
        if (drag === null) return
        const v = at(e)
        setDrag(v)
        onChange?.(v)
      }}
      onPointerUp={(e) => {
        if (drag === null) return
        commit(at(e))
        setDrag(null)
      }}
      onPointerCancel={() => setDrag(null)}
      className={cn('group relative flex h-4 cursor-pointer touch-none items-center outline-none [container-type:inline-size]', className)}
    >
      {/* Track: fixed 3px; a slightly brighter rail on hover instead of growing. */}
      <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-ink/[0.1] transition-colors duration-150 group-hover:bg-ink/[0.14]">
        {bufFrac > 0 && <div className="absolute inset-0 origin-left bg-ink/[0.1]" style={{ transform: `scaleX(${bufFrac})` }} />}
        <div className="absolute inset-0 origin-left bg-accent" style={{ transform: `scaleX(${frac})`, transition: motionStyle }} />
      </div>
      {/* Zero-size anchor moved by a fraction of the track width (container units): GPU-only, and it never widens the page. */}
      <div className="pointer-events-none absolute left-0 top-1/2 size-0" style={{ transform: `translateX(calc(${frac} * 100cqw))`, transition: motionStyle }}>
        <div
          className={cn(
            'absolute left-0 top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg shadow-[0_1px_3px_rgb(0_0_0/0.5)]',
            'transition-[opacity,scale] duration-150 ease-out-soft',
            drag !== null ? 'scale-110 opacity-100' : 'scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100'
          )}
        />
      </div>
      {/* Keyboard focus: a quiet ring around the track instead of the global outline box. */}
      <div className="pointer-events-none absolute -inset-x-1 inset-y-0.5 rounded-full opacity-0 ring-1 ring-accent/60 group-focus-visible:opacity-100" />
    </div>
  )
}
