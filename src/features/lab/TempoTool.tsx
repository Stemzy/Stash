import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Copy, Gauge, Hand, Pause, Pencil, Play, RotateCcw, Undo2, Volume2 } from 'lucide-react'
import type { TempoAnalysis, TempoReason, WaveSlice } from '@shared/types/lab'
import { bpmText, tapBpm } from '@shared/tempo'
import { api } from '@/shared/api'
import { cn, formatRelative } from '@/shared/lib/format'
import { fadeUp, t } from '@/shared/lib/motion'
import { Button } from '@/shared/ui/Button'
import { ProgressBar, Skeleton } from '@/shared/ui/Feedback'
import { Panel } from '@/shared/ui/Layout'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { labActions, tempoActions, useLab } from './model'
import { loadVerify, playVerify, seekVerify, setVerifyGrid, setVerifyOptions, stopVerify, unloadVerify, useVerify, verifyTime } from './verify'
import { formatTime } from './format'

const STATUS: Record<TempoAnalysis['status'], { label: string; dot: string }> = {
  strong: { label: 'Strong rhythmic match', dot: 'bg-success' },
  ambiguous: { label: 'Possible tempo ambiguity', dot: 'bg-warning' },
  uncertain: { label: 'Uncertain', dot: 'bg-fg-3' }
}

function reasonText(r: TempoReason, a: TempoAnalysis): string {
  const half = a.candidates.find((c) => c.relation === 'half')
  const dbl = a.candidates.find((c) => c.relation === 'double')
  switch (r) {
    case 'half-double': {
      const alt = (half?.fit ?? 0) >= (dbl?.fit ?? 0) ? half : dbl
      return `It could also be counted at ${alt ? bpmText(alt.bpm) : 'half or double'} BPM (${alt?.relation === 'half' ? 'half-time' : 'double-time'}). Both are the same groove; pick the one your project uses.`
    }
    case 'tempo-change':
      return 'The tempo seems to change or drift. See the sections below.'
    case 'weak-rhythm':
      return 'Not enough steady rhythm to measure a tempo. Use Tap Tempo or type one.'
    case 'silent':
      return 'The audio is silent.'
    case 'short':
      return 'A short clip gives few beats to measure.'
  }
}

/** Tempo: automatic BPM, tap tempo, manual adjustment, and a metronome to check it by ear. */
export function TempoTool() {
  const lab = useLab()
  const src = lab.source

  // The check player decodes the file when the Tempo tab is used, and lets go when the file changes.
  useEffect(() => {
    if (src) void loadVerify(src.id, src.mediaUrl)
    else unloadVerify()
  }, [src])
  useEffect(() => () => stopVerify(), [])
  useEffect(() => {
    if (lab.tempoWork) setVerifyGrid(lab.tempoWork.bpm, lab.tempoWork.gridStart)
  }, [lab.tempoWork])

  if (!src) {
    return (
      <Intro>
        <p className="text-label text-fg-2">Choose a file above to find its BPM, tap along, and check the tempo with a metronome. The result stays with the file while you switch tools.</p>
      </Intro>
    )
  }
  return (
    <motion.div {...fadeUp} transition={t.base} className="flex flex-col gap-4">
      <ResultPanel />
      <TapPanel key={src.id} />
      <CheckPanel />
    </motion.div>
  )
}

function Intro({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...fadeUp} transition={t.base}>
      <Panel solid>
        <div className="p-5">
          <h2 className="mb-2 text-section font-semibold">Tempo</h2>
          {children}
        </div>
      </Panel>
    </motion.div>
  )
}

function ResultPanel() {
  const lab = useLab()
  const task = lab.tempo
  const a = task.value
  const confirmed = lab.user.tempo
  const work = lab.tempoWork
  const [copied, setCopied] = useState(false)

  if (task.status === 'running') {
    return (
      <Panel solid>
        <div className="flex items-center gap-4 p-5">
          <div className="flex-1">
            <p className="text-body font-medium">{task.progress?.stage === 'analyzing' ? 'Finding the beat…' : 'Reading audio…'}</p>
            <ProgressBar value={(task.progress?.fraction ?? 0) * 100} indeterminate={task.progress?.fraction == null} className="mt-2.5" />
          </div>
          <Button size="sm" variant="ghost" onClick={labActions.cancel}>
            Cancel
          </Button>
        </div>
      </Panel>
    )
  }

  const shown = work?.bpm
  const status = a ? STATUS[a.status] : undefined
  const label = confirmed ? 'BPM · set by you' : 'Detected BPM'

  return (
    <Panel solid>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-label font-medium text-fg-2">{shown != null ? label : 'Tempo'}</p>
            <p className={cn('mt-1 text-[34px] font-semibold leading-[40px] tracking-[-0.015em]', shown == null && 'text-fg-2')}>
              {shown != null ? (
                <>
                  {bpmText(shown)} <span className="text-[20px] font-medium text-fg-2">BPM</span>
                </>
              ) : a ? (
                'No steady tempo'
              ) : (
                '—'
              )}
            </p>
            {shown != null && Math.abs(shown - Math.round(shown)) < 0.05 && Math.abs(shown - Math.round(shown)) > 0.004 && (
              <p className="tabular mt-0.5 text-meta text-fg-3">Measured {shown.toFixed(2)}</p>
            )}
            {a && !confirmed && (
              <div className="mt-2 flex flex-col gap-1">
                <p className="flex items-center gap-2 text-label text-fg">
                  <span className={cn('size-1.5 rounded-full', status!.dot)} aria-hidden />
                  {status!.label}
                </p>
                {a.status === 'strong' ? (
                  <p className="max-w-[540px] text-label text-fg-2">One steady tempo fits clearly. Check it with the metronome below if it matters.</p>
                ) : (
                  a.reasons.map((r) => (
                    <p key={r} className="max-w-[540px] text-label text-fg-2">
                      {reasonText(r, a)}
                    </p>
                  ))
                )}
              </div>
            )}
            {confirmed && a?.bpm != null && (
              <p className="mt-2 text-label text-fg-2">
                Detected: <span className="text-fg">{bpmText(a.bpm)} BPM</span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {shown != null && (
              <Button
                size="sm"
                icon={copied ? <Check size={13} strokeWidth={2} className="text-success" /> : <Copy size={13} strokeWidth={1.75} />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(bpmText(shown))
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1400)
                  } catch {
                    /* clipboard unavailable */
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy BPM'}
              </Button>
            )}
            {confirmed && (
              <Button size="sm" variant="ghost" icon={<Undo2 size={12} strokeWidth={1.75} />} onClick={() => void tempoActions.unconfirm()}>
                Use detected
              </Button>
            )}
            {!a && (
              <Button variant="solid" icon={<Gauge size={14} strokeWidth={1.75} />} onClick={() => void tempoActions.analyze()}>
                {task.status === 'error' ? 'Try again' : 'Analyze tempo'}
              </Button>
            )}
          </div>
        </div>

        {task.status === 'error' && (
          <p role="alert" className="mt-3 text-label text-danger">
            {task.error}
          </p>
        )}
        {!a && task.status !== 'error' && (
          <p className="mt-3 max-w-[560px] text-label text-fg-2">
            The BPM is found automatically when a file opens. You can also tap along or type a tempo below.
          </p>
        )}

        {a && a.candidates.length > 1 && (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-label font-medium text-fg-2">{a.tempoChange ? 'Tempos found in different parts' : 'Other ways to count it'}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {a.candidates
                .filter((c) => !work || Math.abs(c.bpm - work.bpm) > 0.005)
                .map((c) => (
                  <button
                    key={`${c.relation}${c.bpm}`}
                    onClick={() => tempoActions.setWork({ bpm: c.bpm, via: 'auto' })}
                    className="group/c flex items-center gap-2 rounded-sm border border-line-strong bg-ink/[0.02] px-3 py-1.5 text-left transition-colors duration-150 hover:bg-ink/[0.06]"
                    title="Use this tempo"
                  >
                    <span className="tabular text-body font-semibold">{bpmText(c.bpm)}</span>
                    <span className="text-meta text-fg-2">
                      {c.relation === 'half' ? 'half-time' : c.relation === 'double' ? 'double-time' : c.relation === 'best' ? 'estimate' : 'other part'}
                      {c.relation === 'half' || c.relation === 'double' ? ` · ${c.fit >= 0.8 ? 'about as plausible' : c.fit >= 0.5 ? 'possible' : 'less likely'}` : ''}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {a && a.sections.length > 1 && (
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="text-label font-medium text-fg-2">By section</h3>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
              {a.sections.map((s) => (
                <button key={s.startSec} onClick={() => seekVerify(s.startSec)} className="tabular text-label text-fg-2 hover:text-fg">
                  {formatTime(s.startSec)}–{formatTime(s.endSec)} <span className="font-medium text-fg">{s.bpm ? `${bpmText(s.bpm)} BPM` : 'unclear'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {a && (
          <div className="mt-4 flex items-center justify-between text-meta text-fg-3">
            <span>
              {task.cached ? 'Analyzed earlier' : 'Analyzed'} {formatRelative(a.analyzedAt)} · {a.beats.length} beats tracked
              {confirmed && ' · Your BPM is saved with this file in LAB and shows on Key & BPM (the file itself isn’t changed)'}
            </span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="ghost" icon={<RotateCcw size={12} strokeWidth={1.75} />} onClick={() => void tempoActions.analyze(true)}>
                Analyze again
              </Button>
            </span>
          </div>
        )}
      </div>
    </Panel>
  )
}

// ---------------- Check with a metronome ----------------

function CheckPanel() {
  const lab = useLab()
  const v = useVerify()
  const work = lab.tempoWork
  const a = lab.tempo.value
  const period = work ? 60 / work.bpm : 0.5
  // How far the clicks sit from the tracked beats (or from 0 s without an analysis), wrapped to ±half a beat.
  const ref = a?.gridStart ?? 0
  const rawOff = work ? work.gridStart - ref : 0
  const offsetMs = Math.round((((((rawOff + period / 2) % period) + period) % period) - period / 2) * 1000)

  return (
    <Panel solid>
      <div className="p-5">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-section font-semibold">Check by ear</h2>
          <span className="text-meta text-fg-3">
            {work ? `Clicks at ${bpmText(work.bpm)} BPM` : 'Set a tempo to hear clicks'}
            {v.quality === 'analysis' && ' · playing the analysis copy (mono, 22 kHz) because this format can’t be decoded here'}
          </span>
        </div>

        {v.status === 'ready' ? (
          <BeatView sourceId={lab.source!.id} duration={v.duration} beats={a?.beats ?? []} bpm={work?.bpm} gridStart={work?.gridStart} />
        ) : v.status === 'error' ? (
          <p className="text-label text-danger">{v.error}</p>
        ) : (
          <Skeleton className="h-[120px] w-full" />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={v.playing ? <Pause size={12} strokeWidth={0} fill="currentColor" /> : <Play size={12} strokeWidth={0} fill="currentColor" />}
            disabled={v.status !== 'ready'}
            onClick={() => (v.playing ? stopVerify() : playVerify())}
          >
            {v.playing ? 'Pause' : 'Play'}
          </Button>
          <span className="tabular w-[92px] text-label text-fg-2">
            {formatTime(v.position)} <span className="text-fg-3">/ {formatTime(v.duration)}</span>
          </span>
          <SegmentedControl<'on' | 'off'>
            ariaLabel="Metronome"
            size="sm"
            value={v.click ? 'on' : 'off'}
            onChange={(x) => setVerifyOptions({ click: x === 'on' })}
            options={[
              { value: 'on', label: 'Click on' },
              { value: 'off', label: 'Click off' }
            ]}
          />
          <label className="flex items-center gap-2 text-meta text-fg-2" title="Click volume">
            <Volume2 size={13} strokeWidth={1.75} className="text-fg-3" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={v.volume}
              onChange={(e) => setVerifyOptions({ volume: Number(e.target.value) })}
              aria-label="Click volume"
              className="h-1 w-24 cursor-pointer accent-[var(--color-accent)]"
            />
          </label>
        </div>

        {work && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <span className="text-label font-medium text-fg-2">Line up the clicks</span>
            <div className="flex items-center gap-1">
              {[-10, -1].map((ms) => (
                <Button key={ms} size="sm" variant="ghost" onClick={() => tempoActions.setWork({ gridStart: work.gridStart + ms / 1000 })}>
                  {ms} ms
                </Button>
              ))}
              <span className="tabular w-[70px] text-center text-label text-fg">{offsetMs > 0 ? `+${offsetMs}` : offsetMs} ms</span>
              {[1, 10].map((ms) => (
                <Button key={ms} size="sm" variant="ghost" onClick={() => tempoActions.setWork({ gridStart: work.gridStart + ms / 1000 })}>
                  +{ms} ms
                </Button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => tempoActions.setWork({ gridStart: work.gridStart + period / 2 })} title="Move the clicks onto the off-beats (or back)">
              Shift half a beat
            </Button>
            {a?.gridStart != null && (
              <Button size="sm" variant="ghost" icon={<RotateCcw size={12} strokeWidth={1.75} />} onClick={() => tempoActions.setWork({ gridStart: a.gridStart })}>
                Snap to tracked beats
              </Button>
            )}
            <p className="w-full text-meta text-fg-3">
              Clicks and music play on one audio clock, so what you hear is how the grid really sits. The first beat isn't assumed to start a bar.
            </p>
          </div>
        )}
      </div>
    </Panel>
  )
}

/** A scrolling window around the playhead: waveform, tracked beats (ticks) and the click grid (lines). */
function BeatView({ sourceId, duration, beats, bpm, gridStart }: { sourceId: string; duration: number; beats: number[]; bpm?: number; gridStart?: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [env, setEnv] = useState<WaveSlice | null>(null)
  const [theme, setTheme] = useState(0)
  const v = useVerify()
  const H = 120
  const SPAN = 6 // seconds visible
  const LEAD = 0.25 // playhead sits a quarter of the way in

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

  // 200 columns per second for the whole file: detailed enough for a 6 s window, fetched once.
  useEffect(() => {
    setEnv(null)
    let live = true
    void api.lab.peaks(sourceId, 0, duration, Math.min(200_000, Math.ceil(duration * 200))).then((r) => live && r.ok && setEnv(r.value))
    return () => {
      live = false
    }
  }, [sourceId, duration])

  const latest = useRef({ beats, bpm, gridStart, env, width, theme })
  latest.current = { beats, bpm, gridStart, env, width, theme }

  const draw = useCallback(() => {
    const cv = canvas.current
    const L = latest.current
    if (!cv || !L.width) return
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(L.width * dpr)
    const Hh = Math.round(H * dpr)
    if (cv.width !== W || cv.height !== Hh) {
      cv.width = W
      cv.height = Hh
    }
    const g = cv.getContext('2d')!
    const css = getComputedStyle(wrap.current!)
    const c = (n: string, f: string) => css.getPropertyValue(n).trim() || f
    const fg = c('--color-fg', '#eee')
    const fg3 = c('--color-fg-3', '#666')
    const accent = c('--color-accent', '#8fa8c8')
    g.clearRect(0, 0, W, Hh)
    const now = verifyTime()
    const from = now - SPAN * LEAD
    const X = (sec: number) => ((sec - from) / SPAN) * W
    const mid = Hh / 2
    // Waveform.
    if (L.env) {
      const n = L.env.max.length
      const per = n / Math.max(1e-9, L.env.to - L.env.from)
      let peak = 0.02
      for (let i = 0; i < n; i += 37) peak = Math.max(peak, L.env.max[i]!, -L.env.min[i]!)
      const scale = 0.9 / peak
      const col = Math.max(1, Math.round(dpr))
      g.fillStyle = fg3
      g.globalAlpha = 0.7
      for (let x = 0; x < W; x += col) {
        const t0 = from + (x / W) * SPAN
        const t1 = from + ((x + col) / W) * SPAN
        const a = Math.max(0, Math.floor(t0 * per))
        const b = Math.min(n, Math.max(a + 1, Math.ceil(t1 * per)))
        if (t1 < 0 || a >= n) continue
        let lo = 0
        let hi = 0
        for (let i = a; i < b; i++) {
          if (L.env.min[i]! < lo) lo = L.env.min[i]!
          if (L.env.max[i]! > hi) hi = L.env.max[i]!
        }
        const y0 = mid - Math.min(1, hi * scale) * mid
        const y1 = mid - Math.max(-1, lo * scale) * mid
        g.fillRect(x, y0, col, Math.max(dpr, y1 - y0))
      }
      g.globalAlpha = 1
    }
    // Click grid.
    if (L.bpm && L.gridStart != null) {
      const p = 60 / L.bpm
      g.fillStyle = accent
      for (let k = Math.max(0, Math.ceil((from - L.gridStart) / p)); ; k++) {
        const sec = L.gridStart + k * p
        if (sec > from + SPAN) break
        g.globalAlpha = 0.85
        g.fillRect(Math.round(X(sec)), 0, Math.max(1, Math.round(dpr * 1.5)), Hh)
      }
      g.globalAlpha = 1
    }
    // Tracked beats: small ticks at the bottom.
    g.fillStyle = fg
    g.globalAlpha = 0.55
    for (const b of L.beats) {
      if (b < from || b > from + SPAN) continue
      g.fillRect(Math.round(X(b)) - dpr, Hh - 8 * dpr, 2 * dpr, 8 * dpr)
    }
    g.globalAlpha = 1
    // Playhead.
    g.fillStyle = fg
    g.fillRect(Math.round(X(now)), 0, Math.max(1, Math.round(dpr)), Hh)
  }, [])

  useLayoutEffect(draw)
  useEffect(() => {
    if (!v.playing) return draw()
    let raf = 0
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [v.playing, v.position, draw])

  // Drag to scrub; click to jump.
  const drag = useRef<{ x: number; t: number } | null>(null)
  return (
    <div>
      <div
        ref={wrap}
        className="relative cursor-grab touch-none select-none overflow-hidden rounded-sm bg-ink/[0.02] active:cursor-grabbing"
        style={{ height: H }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, t: verifyTime() }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const dt = ((e.clientX - drag.current.x) / (wrap.current!.clientWidth || 1)) * SPAN
          seekVerify(drag.current.t - dt)
        }}
        onPointerUp={() => (drag.current = null)}
        role="img"
        aria-label="Beat view: waveform, tracked beats and click grid around the playhead. Drag to move."
      >
        <canvas ref={canvas} className="absolute inset-0 size-full" />
      </div>
      <div className="mt-2 flex items-center gap-4 text-meta text-fg-3">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-[2px] bg-accent" /> Click grid
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-[2px] bg-fg/60" /> Tracked beats
        </span>
        <Overview duration={duration} />
      </div>
    </div>
  )
}

function Overview({ duration }: { duration: number }) {
  const v = useVerify()
  const bar = useRef<HTMLDivElement>(null)
  const seek = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    seekVerify(((clientX - r.left) / r.width) * duration)
  }
  return (
    <div
      ref={bar}
      className="relative ml-auto h-2 w-[45%] cursor-pointer rounded-full bg-ink/[0.06]"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        seek(e.clientX)
      }}
      onPointerMove={(e) => e.buttons & 1 && seek(e.clientX)}
      aria-label="Position in the file"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(v.position)}
    >
      <span className="absolute inset-y-0 left-0 rounded-full bg-accent/50" style={{ width: `${(v.position / Math.max(1e-9, duration)) * 100}%` }} />
    </div>
  )
}

// ---------------- Tap & adjust ----------------

function TapPanel() {
  const lab = useLab()
  const work = lab.tempoWork
  const taps = useRef<number[]>([])
  const [tapped, setTapped] = useState<{ bpm: number | null; count: number }>({ bpm: null, count: 0 })
  const [flash, setFlash] = useState(0)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)

  const tap = useCallback(() => {
    const now = performance.now() // monotonic: unaffected by clock changes
    const last = taps.current[taps.current.length - 1]
    if (last != null && now - last > 2000) taps.current = [] // a pause starts a new count
    taps.current.push(now)
    if (taps.current.length > 16) taps.current.shift()
    setTapped({ bpm: tapBpm(taps.current), count: taps.current.length })
    setFlash((n) => n + 1)
  }, [])

  // T taps anywhere on the Tempo tool (except while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || el?.closest('input, textarea, [contenteditable]')) return
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        tap()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tap])

  useEffect(() => {
    if (!editing) setText(work ? String(Math.round(work.bpm * 100) / 100) : '')
  }, [work, editing])

  const commitText = () => {
    const n = Number(text.replace(',', '.'))
    if (Number.isFinite(n) && n >= 20 && n <= 400) tempoActions.setWork({ bpm: n, via: 'manual' })
    else setText(work ? String(work.bpm) : '')
  }
  const nudge = (d: number) => work && tempoActions.setWork({ bpm: work.bpm + d, via: 'manual' })

  return (
    <Panel solid>
      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div>
          <h2 className="text-section font-semibold">Tap Tempo</h2>
          <p className="mt-1 text-label text-fg-2">Tap along to the beat (or press T). After four taps you get a tempo; one off tap is ignored.</p>
          <div className="mt-4 flex items-center gap-4">
            <motion.button
              key={flash}
              initial={{ scale: flash ? 0.96 : 1 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.12 }}
              onPointerDown={(e) => {
                e.preventDefault()
                tap()
              }}
              className="flex size-20 shrink-0 flex-col items-center justify-center rounded-md border border-accent/60 bg-accent/10 text-fg transition-colors duration-150 hover:bg-accent/16 focus-visible:focus-halo"
              aria-label="Tap"
            >
              <Hand size={18} strokeWidth={1.75} className="text-accent" />
              <span className="mt-1 text-label font-medium">Tap</span>
            </motion.button>
            <div>
              <p className="tabular text-[24px] font-semibold leading-[30px]">{tapped.bpm ? bpmText(Math.round(tapped.bpm * 10) / 10) : '—'}</p>
              <p className="text-meta text-fg-3">{tapped.count === 0 ? 'No taps yet' : tapped.count < 4 ? `${tapped.count} tap${tapped.count > 1 ? 's' : ''}, keep going` : `${tapped.count} taps`}</p>
              <div className="mt-2 flex gap-1">
                <Button size="sm" disabled={!tapped.bpm} onClick={() => tapped.bpm && tempoActions.setWork({ bpm: Math.round(tapped.bpm * 10) / 10, via: 'tap' })}>
                  Use {tapped.bpm ? bpmText(Math.round(tapped.bpm * 10) / 10) : ''}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={tapped.count === 0}
                  onClick={() => {
                    taps.current = []
                    setTapped({ bpm: null, count: 0 })
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:border-l lg:border-line lg:pl-6">
          <h2 className="text-section font-semibold">Adjust</h2>
          <p className="mt-1 text-label text-fg-2">Type an exact tempo, nudge it, or switch between half- and double-time.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="flex h-9 items-center gap-1.5 rounded-sm border border-ink/[0.09] bg-ink/[0.025] px-2.5 focus-within:border-accent/55 focus-within:focus-halo">
              <Pencil size={12} strokeWidth={1.75} className="text-fg-3" />
              <input
                value={text}
                inputMode="decimal"
                onFocus={(e) => {
                  setEditing(true)
                  e.currentTarget.select()
                }}
                onBlur={() => {
                  setEditing(false)
                  commitText()
                }}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    nudge((e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowUp' ? 1 : -1))
                  }
                }}
                placeholder="BPM"
                aria-label="Tempo in BPM"
                className="tabular w-[72px] bg-transparent text-body font-medium outline-none placeholder:text-fg-3"
              />
              <span className="text-meta text-fg-3">BPM</span>
            </label>
            {[-1, -0.1, 0.1, 1].map((d) => (
              <Button key={d} size="sm" variant="ghost" disabled={!work} onClick={() => nudge(d)}>
                {d > 0 ? `+${d}` : d}
              </Button>
            ))}
            <Button size="sm" disabled={!work} onClick={() => work && tempoActions.setWork({ bpm: work.bpm / 2, via: 'manual' })} title="Half-time">
              ÷2
            </Button>
            <Button size="sm" disabled={!work} onClick={() => work && tempoActions.setWork({ bpm: work.bpm * 2, via: 'manual' })} title="Double-time">
              ×2
            </Button>
          </div>
          <p className="mt-3 text-meta text-fg-3">Changes are saved automatically for this file and show on the Key & BPM tab too. Use detected goes back to the automatic BPM.</p>
        </div>
      </div>
    </Panel>
  )
}
