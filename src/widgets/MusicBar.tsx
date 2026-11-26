import type { ButtonHTMLAttributes } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { AlertCircle, Maximize2, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import { nowPlaying } from '@/features/player/NowPlaying'
import { player, usePlayer } from '@/features/player/model'
import { Artwork } from '@/entities/media/MediaPreview'
import { cn, formatDuration } from '@/shared/lib/format'
import { t } from '@/shared/lib/motion'
import { Scrubber } from '@/shared/ui/Scrubber'

/** Now-playing bar at the bottom of the window. Keeps playing across pages. */
export function MusicBar() {
  const s = usePlayer()
  const track = s.current
  const VolIcon = s.muted || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2

  return (
    <AnimatePresence>
      {track && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={t.panel}
          // Glass: dark enough to keep text crisp, a restrained blur, a hairline + faint top highlight.
          className={cn(
            'relative z-10 grid h-[68px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-4 px-4',
            'glass-bar glass-deep'
          )}
          aria-label="Now playing"
        >
          {/* Track */}
          <button
            onClick={nowPlaying.open}
            className="group/track -ml-1.5 flex min-w-0 items-center gap-3 rounded-sm py-1 pl-1.5 pr-2.5 text-left transition-colors duration-150 hover:bg-ink/[0.04]"
            title="Open the player"
          >
            <Artwork src={track.thumbnailUrl} shape="square" size="sm" />
            <div className="min-w-0 leading-none">
              <p className="truncate text-body font-medium text-fg" title={track.title}>
                {track.title}
              </p>
              <p className="mt-1 truncate text-label text-fg-2 transition-colors duration-150 group-hover/track:text-fg">{track.creator ?? track.extractor}</p>
            </div>
          </button>

          {/* Transport */}
          <div className="flex min-w-0 flex-col items-center gap-1">
            {s.error ? (
              <p className="inline-flex h-9 items-center gap-1.5 text-label text-danger">
                <AlertCircle size={14} strokeWidth={1.5} />
                This file can't be played. It may have been moved or deleted.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <BarButton label="Previous" onClick={player.previous}>
                  <SkipBack size={15} strokeWidth={1.75} fill="currentColor" />
                </BarButton>
                <button
                  aria-label={s.playing ? 'Pause' : 'Play'}
                  title={s.playing ? 'Pause' : 'Play'}
                  onClick={player.toggle}
                  className={cn(
                    'relative flex size-9 items-center justify-center rounded-full bg-fg text-[var(--color-base)]',
                    'shadow-[inset_0_-1px_0_rgb(0_0_0/0.12),0_1px_3px_rgb(0_0_0/0.35)]',
                    'transition-[background-color,transform] duration-150 ease-out-soft hover:bg-fg/90 active:scale-[0.94]'
                  )}
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={s.playing ? 'pause' : 'play'}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={t.fast}
                      className="flex"
                    >
                      {s.playing ? (
                        <Pause size={16} strokeWidth={0} fill="currentColor" />
                      ) : (
                        // Optical centring: a play triangle looks off-centre unless nudged right.
                        <Play size={16} strokeWidth={0} fill="currentColor" className="translate-x-[1px]" />
                      )}
                    </motion.span>
                  </AnimatePresence>
                </button>
                <BarButton label="Next" onClick={player.next} disabled={!player.hasNext()}>
                  <SkipForward size={15} strokeWidth={1.75} fill="currentColor" />
                </BarButton>
              </div>
            )}
            <div className="tabular flex w-full max-w-[480px] items-center gap-2.5 text-meta leading-none">
              <span className="w-10 text-right text-fg-2">{formatDuration(s.time)}</span>
              <Scrubber value={s.time} max={s.duration} step={5} ariaLabel="Seek" className="flex-1" onCommit={player.seek} />
              <span className="w-10 text-fg-3">{formatDuration(s.duration || undefined)}</span>
            </div>
          </div>

          {/* Volume + close */}
          <div className="flex items-center justify-end gap-1.5">
            <BarButton label={s.muted ? 'Unmute' : 'Mute'} onClick={player.toggleMute}>
              <VolIcon size={16} strokeWidth={1.75} />
            </BarButton>
            <Scrubber value={s.muted ? 0 : s.volume} max={1} step={0.1} ariaLabel="Volume" className="w-24" onCommit={player.setVolume} onChange={player.setVolume} />
            <span className="mx-1.5 h-5 w-px bg-ink/[0.08]" aria-hidden />
            <BarButton label="Open the player" onClick={nowPlaying.open}>
              <Maximize2 size={14} strokeWidth={1.75} />
            </BarButton>
            <BarButton label="Close player" onClick={player.stop}>
              <X size={15} strokeWidth={1.75} />
            </BarButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Secondary transport button: quiet until hovered, small press, no bounce. */
function BarButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-fg-2',
        'transition-[background-color,color,transform] duration-150 ease-out-soft',
        'hover:bg-ink/[0.07] hover:text-fg active:scale-[0.92] active:bg-ink/[0.1]',
        'disabled:pointer-events-none disabled:opacity-35',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
