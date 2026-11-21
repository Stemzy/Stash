import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { WaveformData } from '@shared/types/lab'
import { cn } from '@/shared/lib/format'
import { labPlayer, useLabPlayer } from './player'
import { formatTime } from './format'

/**
 * Waveform with a playback cursor. Colours come from the active theme's CSS
 * variables and are re-read when the theme changes. The shape is drawn once per
 * size/theme into two offscreen canvases; each frame only composites them, so the
 * cursor stays smooth even on long files.
 */
export function Waveform({ data, height = 88, className }: { data: WaveformData; height?: number; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const layers = useRef<{ base: HTMLCanvasElement; played: HTMLCanvasElement; w: number; h: number } | null>(null)
  const colors = useRef({ cursor: '#fff' })
  const [width, setWidth] = useState(0)
  const [theme, setTheme] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const { playing } = useLabPlayer()
  const duration = data.durationSec

  // Size and theme changes.
  useEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    const mo = new MutationObserver(() => setTheme((n) => n + 1))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  // Render the two colour layers.
  useEffect(() => {
    if (!width) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(width * dpr)
    const h = Math.round(height * dpr)
    const css = getComputedStyle(wrap.current!)
    const fg3 = css.getPropertyValue('--color-fg-3').trim() || '#666'
    const accent = css.getPropertyValue('--color-accent').trim() || '#8fa8c8'
    colors.current.cursor = css.getPropertyValue('--color-fg').trim() || '#fff'
    const scale = 0.94 / Math.max(0.02, data.peak) // shape scaled for readability, not a level meter
    const draw = (color: string, alpha: number) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')!
      g.fillStyle = color
      g.globalAlpha = alpha
      const n = data.max.length
      const bar = Math.max(1, Math.round(dpr)) // 1 css px columns
      const mid = h / 2
      for (let x = 0; x < w; x += bar) {
        const a = Math.floor((x / w) * n)
        const b = Math.max(a + 1, Math.floor(((x + bar) / w) * n))
        let lo = 0
        let hi = 0
        for (let i = a; i < b && i < n; i++) {
          if (data.min[i]! < lo) lo = data.min[i]!
          if (data.max[i]! > hi) hi = data.max[i]!
        }
        const top = mid - Math.min(1, hi * scale) * mid
        const bot = mid - Math.max(-1, lo * scale) * mid
        g.fillRect(x, top, bar, Math.max(dpr, bot - top))
      }
      return c
    }
    layers.current = { base: draw(fg3, 0.75), played: draw(accent, 1), w, h }
    const cv = canvas.current!
    cv.width = w
    cv.height = h
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, height, theme])

  function paint() {
    const L = layers.current
    const cv = canvas.current
    if (!L || !cv) return
    const g = cv.getContext('2d')!
    g.clearRect(0, 0, L.w, L.h)
    g.drawImage(L.base, 0, 0)
    const x = duration > 0 ? Math.round((labPlayer.time() / duration) * L.w) : 0
    if (x > 0) g.drawImage(L.played, 0, 0, x, L.h, 0, 0, x, L.h)
    if (labPlayer.time() > 0 || playing) {
      g.fillStyle = colors.current.cursor
      g.globalAlpha = 0.9
      g.fillRect(Math.min(L.w - 1, x), 0, Math.max(1, Math.round(window.devicePixelRatio || 1)), L.h)
      g.globalAlpha = 1
    }
  }

  // Animate the cursor only while playing; repaint once on pause/seek.
  useEffect(() => {
    let raf = 0
    const loop = () => {
      paint()
      raf = requestAnimationFrame(loop)
    }
    if (playing) raf = requestAnimationFrame(loop)
    else paint()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  const at = (e: PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
  }
  const seek = (sec: number) => {
    labPlayer.seek(sec)
    requestAnimationFrame(paint)
  }
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 5
    if (e.key === 'ArrowRight') seek(labPlayer.time() + step)
    else if (e.key === 'ArrowLeft') seek(labPlayer.time() - step)
    else if (e.key === 'Home') seek(0)
    else if (e.key === ' ' || e.key === 'Enter') labPlayer.toggle()
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={wrap}
      role="slider"
      tabIndex={0}
      aria-label="Waveform. Click or use the arrow keys to move the playhead."
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(labPlayer.time())}
      aria-valuetext={formatTime(labPlayer.time())}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        seek(at(e))
      }}
      onPointerMove={(e) => {
        setHover(at(e))
        if (e.buttons & 1) seek(at(e))
      }}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKey}
      className={cn('group relative cursor-pointer select-none rounded-sm outline-none focus-visible:focus-halo', className)}
      style={{ height }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      {hover != null && (
        <>
          <span className="pointer-events-none absolute inset-y-0 w-px bg-ink/30" style={{ left: `${(hover / duration) * 100}%` }} />
          <span
            className="tabular pointer-events-none absolute -top-5 -translate-x-1/2 rounded-[4px] bg-elevated px-1.5 text-meta text-fg-2"
            style={{ left: `${(hover / duration) * 100}%` }}
          >
            {formatTime(hover)}
          </span>
        </>
      )}
    </div>
  )
}
