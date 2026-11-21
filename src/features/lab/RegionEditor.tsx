import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { Maximize2, ZoomIn, ZoomOut, Crosshair } from 'lucide-react'
import type { TrimRegion, WaveformData, WaveSlice } from '@shared/types/lab'
import { api } from '@/shared/api'
import { cn } from '@/shared/lib/format'
import { IconButton } from '@/shared/ui/Button'
import { labPlayer, useLabPlayer } from './player'
import { MIN_SELECTION } from './model'
import { formatTime } from './format'

const RULER = 20
const MIN_SPAN = 0.02 // the closest zoom: 20 ms across the editor

interface View {
  from: number
  to: number
}

/**
 * Zoomable waveform with a selection. Drag the handles to trim, drag inside the
 * selection to move it, drag elsewhere to draw a new one, click to move the
 * playhead. Ctrl + wheel zooms, Shift + wheel scrolls. The drawing is only a
 * picture: export positions come from the numbers, converted to exact samples.
 */
export function RegionEditor({
  sourceId,
  overview,
  region,
  onRegion,
  fadeInMs,
  fadeOutMs,
  height = 140
}: {
  sourceId: string
  overview: WaveformData
  region: TrimRegion
  onRegion: (r: Partial<TrimRegion>) => void
  fadeInMs: number
  fadeOutMs: number
  height?: number
}) {
  const duration = overview.durationSec
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [view, setViewRaw] = useState<View>({ from: 0, to: duration })
  const [detail, setDetail] = useState<WaveSlice | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [theme, setTheme] = useState(0)
  const { playing } = useLabPlayer()

  const clampView = useCallback(
    (v: View): View => {
      const span = Math.max(Math.min(MIN_SPAN, duration), Math.min(duration, v.to - v.from))
      const from = Math.max(0, Math.min(duration - span, v.from))
      return { from, to: from + span }
    },
    [duration]
  )
  const setView = useCallback((v: View) => setViewRaw(clampView(v)), [clampView])

  // New file → show all of it.
  useEffect(() => {
    setViewRaw({ from: 0, to: duration })
    setDetail(null)
  }, [sourceId, duration])

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

  // Zoomed in: ask for real detail of the visible range (the overview is only ~3000 columns).
  useEffect(() => {
    if (!width || view.to - view.from > duration * 0.6) return setDetail(null)
    const t = setTimeout(async () => {
      const r = await api.lab.peaks(sourceId, view.from, view.to, width)
      if (r.ok) setDetail(r.value)
    }, 120)
    return () => clearTimeout(t)
  }, [sourceId, view, width, duration])

  const span = view.to - view.from
  const xOf = (t: number) => ((t - view.from) / span) * width
  const tAt = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, view.from + ((clientX - r.left) / r.width) * span))
  }

  // ---- drawing ----
  const latest = useRef({ view, region, detail, fadeInMs, fadeOutMs, width, height, theme })
  latest.current = { view, region, detail, fadeInMs, fadeOutMs, width, height, theme }

  const draw = useCallback(() => {
    const cv = canvas.current
    const L = latest.current
    if (!cv || !L.width) return
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(L.width * dpr)
    const H = Math.round(L.height * dpr)
    if (cv.width !== W || cv.height !== H) {
      cv.width = W
      cv.height = H
    }
    const g = cv.getContext('2d')!
    const css = getComputedStyle(wrap.current!)
    const c = (n: string, f: string) => css.getPropertyValue(n).trim() || f
    const fg = c('--color-fg', '#eee')
    const fg2 = c('--color-fg-2', '#999')
    const fg3 = c('--color-fg-3', '#666')
    const accent = c('--color-accent', '#8fa8c8')
    const lineCol = c('--color-line-strong', 'rgba(255,255,255,.12)')
    g.clearRect(0, 0, W, H)
    const vs = L.view.to - L.view.from
    const X = (t: number) => ((t - L.view.from) / vs) * W
    const top = RULER * dpr
    const waveH = H - top
    const mid = top + waveH / 2
    const scale = 0.92 / Math.max(0.02, overview.peak)
    const rs = X(L.region.start)
    const re = X(L.region.end)

    // Selection background.
    g.fillStyle = accent
    g.globalAlpha = 0.09
    g.fillRect(rs, top, re - rs, waveH)
    g.globalAlpha = 1

    // Ruler: ticks at a step that leaves ~80 px between labels.
    const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
    const step = steps.find((s) => (s / vs) * L.width >= 80) ?? 600
    g.fillStyle = fg3
    g.font = `${10 * dpr}px Inter Variable, system-ui, sans-serif`
    g.textBaseline = 'middle'
    for (let t = Math.ceil(L.view.from / step) * step; t <= L.view.to; t += step) {
      const x = Math.round(X(t))
      g.globalAlpha = 0.6
      g.fillRect(x, top - 5 * dpr, Math.max(1, dpr), 5 * dpr)
      g.globalAlpha = 1
      g.fillText(formatTime(t, step < 1), x + 3 * dpr, top / 2 - 1 * dpr)
    }
    g.fillStyle = lineCol
    g.fillRect(0, top - Math.max(1, dpr), W, Math.max(1, dpr))

    // Waveform: one column per CSS pixel.
    const col = Math.max(1, Math.round(dpr))
    const d = L.detail && L.detail.from <= L.view.from + vs * 0.001 && L.detail.to >= L.view.to - vs * 0.001 ? L.detail : null
    const srcMin = d ? d.min : overview.min
    const srcMax = d ? d.max : overview.max
    const srcFrom = d ? d.from : 0
    const srcTo = d ? d.to : duration
    const n = srcMax.length
    for (let x = 0; x < W; x += col) {
      const t0 = L.view.from + (x / W) * vs
      const t1 = L.view.from + ((x + col) / W) * vs
      let a = Math.floor(((t0 - srcFrom) / (srcTo - srcFrom)) * n)
      let b = Math.ceil(((t1 - srcFrom) / (srcTo - srcFrom)) * n)
      a = Math.max(0, Math.min(n - 1, a))
      b = Math.max(a + 1, Math.min(n, b))
      let lo = 0
      let hi = 0
      for (let i = a; i < b; i++) {
        if (srcMin[i]! < lo) lo = srcMin[i]!
        if (srcMax[i]! > hi) hi = srcMax[i]!
      }
      const inside = x + col / 2 >= rs && x + col / 2 <= re
      g.fillStyle = inside ? accent : fg3
      g.globalAlpha = inside ? 1 : 0.55
      const y0 = mid - Math.min(1, hi * scale) * (waveH / 2)
      const y1 = mid - Math.max(-1, lo * scale) * (waveH / 2)
      g.fillRect(x, y0, col, Math.max(dpr, y1 - y0))
    }
    g.globalAlpha = 1

    // Fade shapes inside the selection (what the export will do).
    const len = L.region.end - L.region.start
    const fi = Math.min(L.fadeInMs / 1000, len)
    const fo = Math.min(L.fadeOutMs / 1000, len - fi)
    if (fi > 0 || fo > 0) {
      g.strokeStyle = fg2
      g.globalAlpha = 0.85
      g.lineWidth = Math.max(1, dpr)
      g.setLineDash([3 * dpr, 3 * dpr])
      g.beginPath()
      g.moveTo(rs, H - 1)
      g.lineTo(X(L.region.start + fi), top + 2 * dpr)
      g.lineTo(X(L.region.end - fo), top + 2 * dpr)
      g.lineTo(re, H - 1)
      g.stroke()
      g.setLineDash([])
      g.globalAlpha = 1
    }

    // Playhead.
    const ph = labPlayer.time()
    if (ph > 0 && ph >= L.view.from && ph <= L.view.to) {
      g.fillStyle = fg
      g.fillRect(Math.round(X(ph)), top, Math.max(1, Math.round(dpr)), waveH)
    }
  }, [overview, duration])

  useLayoutEffect(draw)
  useEffect(() => {
    if (!playing) return draw()
    let raf = 0
    const loop = () => {
      draw()
      // Follow the playhead when it leaves the view.
      const t = labPlayer.time()
      const v = latest.current.view
      if (t > v.to || t < v.from) setView({ from: t - (v.to - v.from) * 0.1, to: t + (v.to - v.from) * 0.9 })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, draw, setView])

  // ---- wheel: Ctrl zooms at the pointer, Shift (or a sideways swipe) scrolls ----
  useEffect(() => {
    const el = wrap.current!
    const onWheel = (e: WheelEvent) => {
      const v = latest.current.view
      const s = v.to - v.from
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const at = v.from + ((e.clientX - r.left) / r.width) * s
        const k = Math.exp(e.deltaY * 0.0025)
        setView({ from: at - (at - v.from) * k, to: at + (v.to - at) * k })
      } else if (s < duration && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
        e.preventDefault()
        const dx = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX
        const shift = (dx / el.clientWidth) * s
        setView({ from: v.from + shift, to: v.to + shift })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [duration, setView])

  // ---- pointer on the wave ----
  const drag = useRef<{ kind: 'new' | 'move'; t0: number; x0: number; orig: TrimRegion; active: boolean } | null>(null)
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = tAt(e.clientX)
    drag.current = { kind: t > region.start && t < region.end ? 'move' : 'new', t0: t, x0: e.clientX, orig: region, active: false }
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const t = tAt(e.clientX)
    setHover(t)
    const d = drag.current
    if (!d) return
    if (!d.active && Math.abs(e.clientX - d.x0) < 4) return
    d.active = true
    if (d.kind === 'new') {
      onRegion({ start: Math.min(d.t0, t), end: Math.max(d.t0, t, Math.min(d.t0, t) + MIN_SELECTION) })
    } else {
      const len = d.orig.end - d.orig.start
      const start = Math.max(0, Math.min(duration - len, d.orig.start + (t - d.t0)))
      onRegion({ start, end: start + len })
    }
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (d && !d.active) {
      labPlayer.seek(tAt(e.clientX))
      requestAnimationFrame(draw)
    }
  }

  const zoom = (k: number) => {
    const c = playing ? labPlayer.time() : (view.from + view.to) / 2
    setView({ from: c - (c - view.from) * k, to: c + (view.to - c) * k })
  }
  const fitSelection = () => {
    const pad = (region.end - region.start) * 0.08
    setView({ from: region.start - pad, to: region.end + pad })
  }
  const zoomed = span < duration - 1e-6

  return (
    <div>
      <div
        ref={wrap}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setHover(null)}
        className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-sm bg-ink/[0.02]"
        style={{ height }}
        aria-label="Selection editor"
      >
        <canvas ref={canvas} className="absolute inset-0 size-full" />
        <Handle which="start" x={xOf(region.start)} t={region.start} onChange={(start) => onRegion({ start: Math.min(start, region.end - MIN_SELECTION) })} tAt={tAt} max={duration} hidden={xOf(region.start) < -8 || xOf(region.start) > width + 8} />
        <Handle which="end" x={xOf(region.end)} t={region.end} onChange={(end) => onRegion({ end: Math.max(end, region.start + MIN_SELECTION) })} tAt={tAt} max={duration} hidden={xOf(region.end) < -8 || xOf(region.end) > width + 8} />
        {hover != null && !drag.current?.active && (
          <span className="tabular pointer-events-none absolute top-[3px] -translate-x-1/2 rounded-[4px] bg-elevated px-1.5 text-meta text-fg-2 shadow-sm" style={{ left: xOf(hover) }}>
            {formatTime(hover, true)}
          </span>
        )}
      </div>

      {/* Zoom + where the view sits in the whole file. */}
      <div className="mt-2 flex items-center gap-1">
        <IconButton label="Zoom out" onClick={() => zoom(2)} disabled={!zoomed}>
          <ZoomOut size={14} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Zoom in (Ctrl + scroll also works)" onClick={() => zoom(0.5)} disabled={span <= MIN_SPAN + 1e-6}>
          <ZoomIn size={14} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Zoom to selection" onClick={fitSelection}>
          <Crosshair size={14} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Show the whole file" onClick={() => setView({ from: 0, to: duration })} disabled={!zoomed}>
          <Maximize2 size={13} strokeWidth={1.75} />
        </IconButton>
        <Minimap duration={duration} view={view} region={region} onView={setView} />
      </div>
    </div>
  )
}

function Handle({ which, x, t, onChange, tAt, max, hidden }: { which: 'start' | 'end'; x: number; t: number; onChange: (t: number) => void; tAt: (clientX: number) => number; max: number; hidden: boolean }) {
  const [dragging, setDragging] = useState(false)
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = (e.altKey ? 0.001 : e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowRight' ? 1 : -1)
    onChange(Math.max(0, Math.min(max, Math.round((t + step) * 1000) / 1000)))
  }
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={which === 'start' ? 'Selection start' : 'Selection end'}
      aria-valuemin={0}
      aria-valuemax={Math.round(max * 1000) / 1000}
      aria-valuenow={Math.round(t * 1000) / 1000}
      aria-valuetext={formatTime(t, true)}
      title={`${which === 'start' ? 'Start' : 'End'} ${formatTime(t, true)} · ←/→ 10 ms, Shift 100 ms, Alt 1 ms`}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => dragging && onChange(tAt(e.clientX))}
      onPointerUp={() => setDragging(false)}
      className={cn(
        'group/h absolute bottom-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize outline-none',
        hidden && 'hidden'
      )}
      style={{ left: x, top: RULER - 2 }}
    >
      <span className={cn('absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-accent transition-opacity duration-150', dragging ? 'opacity-100' : 'opacity-90')} />
      <span
        className={cn(
          'absolute top-0 h-3.5 w-2.5 rounded-[3px] bg-accent shadow-sm transition-transform duration-150 group-hover/h:scale-110 group-focus-visible/h:focus-halo',
          which === 'start' ? 'left-1/2' : 'right-1/2'
        )}
      />
    </div>
  )
}

/** Thin bar: the whole file, the selection, and the visible part (drag to scroll). */
function Minimap({ duration, view, region, onView }: { duration: number; view: View; region: TrimRegion; onView: (v: View) => void }) {
  const bar = useRef<HTMLDivElement>(null)
  const grab = useRef<{ x: number; from: number } | null>(null)
  const pct = (t: number) => `${(t / duration) * 100}%`
  return (
    <div
      ref={bar}
      className="relative ml-2 h-2 flex-1 cursor-pointer rounded-full bg-ink/[0.06]"
      onPointerDown={(e) => {
        const r = bar.current!.getBoundingClientRect()
        const t = ((e.clientX - r.left) / r.width) * duration
        const span = view.to - view.from
        if (t < view.from || t > view.to) onView({ from: t - span / 2, to: t + span / 2 })
        e.currentTarget.setPointerCapture(e.pointerId)
        grab.current = { x: e.clientX, from: t < view.from || t > view.to ? t - span / 2 : view.from }
      }}
      onPointerMove={(e) => {
        if (!grab.current) return
        const r = bar.current!.getBoundingClientRect()
        const from = grab.current.from + ((e.clientX - grab.current.x) / r.width) * duration
        onView({ from, to: from + (view.to - view.from) })
      }}
      onPointerUp={() => (grab.current = null)}
      aria-hidden
    >
      <span className="absolute inset-y-0 rounded-full bg-accent/35" style={{ left: pct(region.start), width: pct(region.end - region.start) }} />
      <span className="absolute -inset-y-[3px] rounded-[4px] border border-fg-2/60 bg-ink/[0.06]" style={{ left: pct(view.from), width: `max(6px, ${pct(view.to - view.from)})` }} />
    </div>
  )
}
