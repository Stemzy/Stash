import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ExternalLink, Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { LibraryItem } from '@shared/types/library'
import { api } from '@/shared/api'
import { cn, formatDuration } from '@/shared/lib/format'
import { t } from '@/shared/lib/motion'
import { Button, IconButton } from '@/shared/ui/Button'
import { Scrubber } from '@/shared/ui/Scrubber'
import { Spinner } from '@/shared/ui/Spinner'
import { notify } from '@/shared/ui/toast'
import { player, playerStore, setOnMusicStart } from './model'
import { analyse, liveStore } from './live'

/**
 * In-app video player with themed controls. Controls fade out after a few
 * seconds of playback and come back on mouse move. Keyboard: Space/K play,
 * ←/→ 5 s, F fullscreen (Esc or double-click to leave), M mute.
 */
export function VideoPlayer({ item, autoPlay = true }: { item: LibraryItem; autoPlay?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(item.durationSec ?? 0)
  const [buffered, setBuffered] = useState(0)
  const [waiting, setWaiting] = useState(true)
  const [error, setError] = useState(false)
  const [full, setFull] = useState(false)
  const [controls, setControls] = useState(true)
  const vol = playerStore.get()
  const [volume, setVolume] = useState(vol.volume)
  const [muted, setMuted] = useState(vol.muted)

  // Music and video never play at the same time.
  useEffect(() => {
    setOnMusicStart(() => video.current?.pause())
    return () => {
      setOnMusicStart(undefined)
      if (liveStore.get().mode === 'video') liveStore.set({ mode: 'none' })
    }
  }, [])

  useEffect(() => {
    const v = video.current
    if (!v) return
    v.volume = volume
    v.muted = muted
  }, [volume, muted])

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === wrap.current)
    // Electron doesn't leave full screen on Esc by itself (Chrome does): do it here, wherever focus is.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.fullscreenElement === wrap.current) void document.exitFullscreen().catch(() => undefined)
    }
    document.addEventListener('fullscreenchange', onFs)
    window.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      window.removeEventListener('keydown', onEsc)
    }
  }, [])

  const poke = useCallback(() => {
    setControls(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => !video.current?.paused && setControls(false), 2600)
  }, [])

  const toggle = useCallback(() => {
    const v = video.current
    if (!v || error) return
    if (v.paused) {
      player.pause()
      void v.play().catch(() => undefined)
    } else v.pause()
    poke()
  }, [error, poke])

  const seekBy = (d: number) => {
    const v = video.current
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d))
    poke()
  }

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void wrap.current?.requestFullscreen().catch(() => undefined)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).getAttribute('role') === 'slider') return
    const k = e.key.toLowerCase()
    if (k === ' ' || k === 'k') toggle()
    else if (k === 'arrowright') seekBy(5)
    else if (k === 'arrowleft') seekBy(-5)
    else if (k === 'f') toggleFull()
    else if (k === 'm') setMuted((m) => !m)
    else return
    e.preventDefault()
  }

  const openExternal = async () => {
    if (!(await api.library.openExternal(item.id))) notify({ tone: 'error', title: "Couldn't open the file", body: 'It may have been moved or deleted.' })
  }

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      ref={wrap}
      tabIndex={0}
      onKeyDown={onKey}
      onMouseMove={poke}
      onMouseLeave={() => playing && setControls(false)}
      className={cn(
        'media-dark group/player relative w-full overflow-hidden bg-black outline-none',
        full ? 'h-full' : 'aspect-video rounded-md ring-1 ring-line-strong',
        !controls && playing && 'cursor-none'
      )}
    >
      <video
        ref={video}
        key={item.id}
        src={item.mediaUrl}
        autoPlay={autoPlay}
        playsInline
        crossOrigin="anonymous"
        onClick={toggle}
        onDoubleClick={toggleFull}
        onPlay={(e) => {
          player.pause()
          setPlaying(true)
          poke()
          analyse(e.currentTarget)
          liveStore.set({ mode: 'video', video: e.currentTarget })
        }}
        onPause={() => {
          setPlaying(false)
          setControls(true)
          if (liveStore.get().mode === 'video') liveStore.set({ mode: 'none' })
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered
          if (b.length) setBuffered(b.end(b.length - 1))
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onPlaying={() => setWaiting(false)}
        onError={() => {
          setError(true)
          setWaiting(false)
        }}
        className="size-full object-contain"
      />

      {waiting && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-fg">
          <Spinner size={28} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-base/90 p-6 text-center">
          <p className="text-body font-medium">This file can't play inside the app.</p>
          <p className="max-w-[360px] text-label text-fg-2">
            Its video format ({item.ext.toUpperCase()}) isn't supported by the built-in player. It will play in a player like VLC.
          </p>
          <Button variant="primary" icon={<ExternalLink size={14} strokeWidth={1.5} />} onClick={() => void openExternal()}>
            Open in default player
          </Button>
        </div>
      )}

      {/* Big centered play button while paused */}
      <AnimatePresence>
        {!playing && !error && !waiting && (
          <motion.button
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={t.fast}
            onClick={toggle}
            aria-label="Play"
            className="absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-fg backdrop-blur-md transition-colors hover:bg-black/60"
          >
            <Play size={24} strokeWidth={1.5} className="translate-x-0.5" fill="currentColor" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Controls */}
      <AnimatePresence>
        {(controls || !playing) && !error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={t.base}
            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-3 pt-10"
          >
            <Scrubber value={time} max={duration} buffered={buffered} step={5} ariaLabel="Seek" onCommit={(v) => video.current && (video.current.currentTime = v)} />
            <div className="mt-1.5 flex items-center gap-1 text-fg">
              <IconButton label={playing ? 'Pause' : 'Play'} onClick={toggle} className="text-fg hover:bg-white/10">
                {playing ? <Pause size={16} strokeWidth={1.5} fill="currentColor" /> : <Play size={16} strokeWidth={1.5} fill="currentColor" />}
              </IconButton>
              <IconButton label="Back 10 seconds" onClick={() => seekBy(-10)} className="text-fg hover:bg-white/10">
                <RotateCcw size={15} strokeWidth={1.5} />
              </IconButton>
              <IconButton label="Forward 10 seconds" onClick={() => seekBy(10)} className="text-fg hover:bg-white/10">
                <RotateCw size={15} strokeWidth={1.5} />
              </IconButton>
              <div className="group/vol flex items-center">
                <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((m) => !m)} className="text-fg hover:bg-white/10">
                  <VolIcon size={16} strokeWidth={1.5} />
                </IconButton>
                <div className="w-0 overflow-hidden transition-[width] duration-200 group-hover/vol:w-20 group-focus-within/vol:w-20">
                  <Scrubber value={muted ? 0 : volume} max={1} step={0.1} ariaLabel="Volume" className="mx-2" onChange={(v) => { setVolume(v); setMuted(v === 0) }} onCommit={(v) => { setVolume(v); setMuted(v === 0); player.setVolume(v) }} />
                </div>
              </div>
              <span className="tabular ml-2 text-label text-fg/85">
                {formatDuration(time)} / {formatDuration(duration || undefined)}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <IconButton label={full ? 'Exit full screen' : 'Full screen'} onClick={toggleFull} className="text-fg hover:bg-white/10">
                  {full ? <Minimize2 size={15} strokeWidth={1.5} /> : <Maximize2 size={15} strokeWidth={1.5} />}
                </IconButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
