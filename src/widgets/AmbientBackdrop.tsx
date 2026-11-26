import { memo, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { createStore, useStore } from '@/shared/lib/store'
import { prepareAmbientArt, type AmbientArt, type AmbientVariant } from '@/shared/lib/palette'
import { THEMES, type ThemeId } from '@/entities/settings/themes'
import { AtmosphereLight, atmosphereColors } from './AtmosphereLight'
import type { BackdropStyle } from '@/entities/settings/model'

// Which artwork each page wants behind it. Pages set this after a link is analyzed.
export const backdropStore = createStore<{
  videos?: string
  music?: string
  library?: string
  lab?: string
}>({})

export function setPageArtwork(page: 'videos' | 'music' | 'library' | 'lab', src?: string): void {
  backdropStore.set((s) => (s[page] === src ? s : { ...s, [page]: src }))
}

export function useBackdropFor(page: string): string | undefined {
  return useStore(backdropStore, (s) => (page === 'videos' || page === 'music' || page === 'library' || page === 'lab' ? s[page] : undefined))
}

// Faint noise so the soft gradients don't band on 8-bit panels.
const NOISE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"

/** Crossfade length between two backgrounds (new fades in over the old one, no dip). */
const XFADE = 1.4

export interface LiveBackdrop {
  mode: 'music' | 'video'
  /** The playing video, mirrored into the background (ambient mode). */
  video?: HTMLVideoElement
}

interface Scene {
  id: number
  style: 'blur' | 'glow'
  variant: AmbientVariant
  art: AmbientArt
}

let nextId = 1

/** True while the window is hidden or minimized: every animation here pauses. */
function useWindowHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return hidden
}

/**
 * Thumbnail-driven lighting behind the whole window.
 * Still by default; when `live` is set (media playing in the Library, and
 * Settings → Moving background is on) the light drifts slowly, colour pools
 * breathe gently with the beat, and a playing video tints the room.
 */
export const AmbientBackdrop = memo(
  function AmbientBackdrop({
    src,
    style,
    live,
    theme = 'default',
    intensity,
    orbit = true,
    stage = false
  }: {
    src?: string
    style: BackdropStyle
    live?: LiveBackdrop
    /** The theme is the room; the artwork supplies the light. */
    theme?: ThemeId
    /** 0–100. At the theme's default: the designed look. Lower fades the artwork; higher opens the light up. */
    intensity?: number
    /** The light slowly orbits behind the app (Settings → Moving background). */
    orbit?: boolean
    /** Now Playing: the cover's light at full strength, only darkened at the edges. */
    stage?: boolean
  }) {
    const treatment = THEMES[theme].ambient
    const variant = treatment.variant
    const level = intensity ?? treatment.defaultIntensity
    // Up to two scenes: the one fading in on top, and the previous one under it.
    const [scenes, setScenes] = useState<Scene[]>([])
    const [failed, setFailed] = useState(false)
    const hidden = useWindowHidden()

    useEffect(() => {
      if (style === 'off' || !src) return
      let alive = true
      // The previous scene stays on screen until the new artwork is ready: no flash.
      prepareAmbientArt(src, variant).then(
        (art) => {
          if (!alive) return
          setFailed(false)
          setScenes((list) => [...list.slice(-1), { id: nextId++, style, variant, art }])
        },
        () => alive && setFailed(true) // missing/broken thumbnail → plain Graphite
      )
      return () => {
        alive = false
      }
    }, [src, style, variant])

    const moving = !!live || stage
    const visible = style !== 'off' && level > 0 && ((!!src && !failed && scenes.length > 0) || moving)
    const top = scenes[scenes.length - 1]
    // Intensity: up to the theme default the artwork fades in; above it the readability layer opens up a little.
    const D = treatment.defaultIntensity
    const artOpacity = stage ? 1 : Math.min(1, level / D)
    const scrimOpacity = stage ? 0 : level <= D ? 1 : 1 - (0.45 * (level - D)) / (100 - D)
    const fade = 'opacity 300ms cubic-bezier(0.22, 1, 0.36, 1)'

    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden data-live-motion data-ambient-paused={hidden || undefined}>
        <motion.div
          className="absolute inset-0"
          initial={false}
          animate={{ opacity: visible ? 1 : 0 }}
          transition={{ duration: visible ? 0.6 : 0.8, ease: 'easeOut' }}
          // Once fully faded out, drop the old artwork so it can't flash back later.
          onAnimationComplete={() => !visible && setScenes([])}
        >
          <div
            className="absolute inset-0"
            // Now Playing lets the cover's colours come through richer, like a music app's full-screen player.
            style={{ opacity: artOpacity, transition: fade }}
          >
            {/* Rendered even while fading out; the outer opacity does the hiding. */}
            <AnimatePresence initial={false}>
              {scenes.map((sc) => (
                <motion.div
                  key={sc.id}
                  className="absolute inset-0"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: XFADE, ease: [0.4, 0, 0.2, 1] }}
                  // When the newest scene is fully in, the one beneath is no longer needed.
                  onAnimationComplete={() => sc === top && setScenes((list) => (list.length > 1 ? list.slice(-1) : list))}
                >
                  {/* "Blurred artwork" on the app's pages keeps a faint copy of the cover under the light;
                      Now Playing (and "Colour glow") is pure atmosphere, no picture. */}
                  {sc.style === 'blur' && !stage && (
                    <img src={sc.art.blurred} alt="" draggable={false} className="absolute inset-0 size-full object-cover" style={{ transform: 'scale(1.12)' }} />
                  )}
                  <AtmosphereLight
                    colors={atmosphereColors(sc.art.palette, sc.variant, stage)}
                    opacity={sc.style === 'blur' && !stage ? 0.7 : 1}
                    moving={orbit || stage}
                    paused={hidden}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Live layers ignore Windows' reduced-motion: Settings → Moving background is their switch. */}
            <MotionConfig reducedMotion="never">
              <AnimatePresence>
                {style !== 'off' && moving && live?.mode === 'video' && live.video && (
                  <VideoGlow key="vg" video={live.video} paused={hidden} variant={variant} orbit={orbit} />
                )}
              </AnimatePresence>
            </MotionConfig>
          </div>

          {/* Readability: theme-coloured edges, an open pool of light behind the content. */}
          <div className="absolute inset-0" style={{ background: treatment.scrim, opacity: scrimOpacity, transition: fade }} />
          {treatment.tint && <div className="absolute inset-0" style={{ background: treatment.tint, opacity: artOpacity, transition: fade }} />}
          {/* Now Playing: a faint darkening at the very edges, for depth. */}
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(130% 100% at 50% 45%, transparent 55%, rgb(0 0 0 / 0.3) 100%)', opacity: stage && variant !== 'light' ? 1 : 0, transition: 'opacity 600ms ease' }}
          />
          <div className="absolute inset-0 mix-blend-overlay" style={{ backgroundImage: NOISE, opacity: treatment.noise }} />
        </motion.div>
      </div>
    )
  },
  // App re-creates the `live` object on every render; only its contents matter.
  (a, b) =>
    a.src === b.src &&
    a.style === b.style &&
    a.theme === b.theme &&
    a.intensity === b.intensity &&
    a.orbit === b.orbit &&
    a.stage === b.stage &&
    a.live?.mode === b.live?.mode &&
    a.live?.video === b.live?.video
)

/**
 * Slowly circles its contents around their resting place. Off = the same layer,
 * standing still. Each light gets its own radius, speed and direction, so they
 * never move in lockstep.
 */
function Orbit({ on, r, t, reverse, children }: { on: boolean; r: string; t: string; reverse?: boolean; children: React.ReactNode }) {
  if (!on) return <div className="absolute inset-0">{children}</div>
  return (
    <div className="ambient-orbit-x absolute inset-0 will-change-transform" style={{ '--orbit-r': r, '--orbit-t': t } as React.CSSProperties}>
      <div className="ambient-orbit-y absolute inset-0 will-change-transform" data-reverse={reverse || undefined}>
        {children}
      </div>
    </div>
  )
}

/**
 * Video ambient light: ~8 times a second the frame is blended into a tiny
 * buffer (so cuts fade instead of flashing), then softened once into a small
 * canvas. Only that small bitmap is blurred, never the whole window.
 */
function VideoGlow({ video, paused, variant, orbit }: { video: HTMLVideoElement; paused: boolean; variant: AmbientVariant; orbit: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const out = canvas.current?.getContext('2d')
    const small = document.createElement('canvas')
    small.width = 32
    small.height = 18
    const acc = small.getContext('2d')
    if (!out || !acc || paused) return
    const light = variant === 'light'
    out.filter = light
      ? 'blur(6px) saturate(0.8) brightness(1.08)'
      : variant === 'night'
        ? 'blur(6px) saturate(1.1) brightness(0.62)'
        : 'blur(6px) saturate(1.15) brightness(0.55)'
    let raf = 0
    let last = 0
    let first = true
    const draw = (now: number) => {
      if (now - last > 120 && video.readyState >= 2 && (!video.paused || first)) {
        last = now
        try {
          acc.globalAlpha = first ? 1 : 0.3 // temporal smoothing
          acc.drawImage(video, 0, 0, 32, 18)
          out.clearRect(0, 0, 128, 72)
          out.drawImage(small, -8, -8, 144, 88)
          if (light) {
            // Pastel wash, like the artwork in light themes.
            out.save()
            out.filter = 'none'
            out.globalCompositeOperation = 'source-atop'
            out.fillStyle = 'rgb(255 255 255 / 0.4)'
            out.fillRect(0, 0, 128, 72)
            out.restore()
          }
          first = false
        } catch {
          /* frame not ready */
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [video, paused, variant])

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.75 }} exit={{ opacity: 0 }} transition={{ duration: 1.2 }} className="absolute inset-0">
      <Orbit on={orbit} r="2.4vmax" t="17s">
        <canvas ref={canvas} width={128} height={72} className="absolute inset-0 size-full" style={{ transform: 'scale(1.1)' }} />
      </Orbit>
    </motion.div>
  )
}
