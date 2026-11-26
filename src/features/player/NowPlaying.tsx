import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronDown,
  FlaskConical,
  ListMusic,
  Maximize,
  Minimize,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { LibraryItem } from '@shared/types/library'
import { createStore, useStore } from '@/shared/lib/store'
import { cn, formatDuration } from '@/shared/lib/format'
import { t } from '@/shared/lib/motion'
import { Scrubber } from '@/shared/ui/Scrubber'
import { navigate } from '@/shared/model/navigation'
import { labActions } from '@/features/lab/model'
import { player, playerStore, usePlayer } from './model'
import { libraryTabStore, useLibrary } from './library'

// Full-window "Now Playing": big artwork, the song, full controls and your Music
// list beside it, over the flowing light from the cover. Esc or the arrow closes it.

export const nowPlayingStore = createStore<{ open: boolean; list: boolean }>({ open: false, list: true })
export const useNowPlaying = () => useStore(nowPlayingStore)

export const nowPlaying = {
  open: () => playerStore.get().current && nowPlayingStore.set((s) => ({ ...s, open: true })),
  close: () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    nowPlayingStore.set((s) => ({ ...s, open: false }))
  },
  /** The down arrow: close and land on your Music list in the Library. */
  back: () => {
    nowPlaying.close()
    libraryTabStore.set('audio')
    navigate('library')
  },
  toggleList: () => nowPlayingStore.set((s) => ({ ...s, list: !s.list }))
}

// Close by itself if the music stops for good (song deleted, player closed).
playerStore.subscribe(() => {
  if (!playerStore.get().current && nowPlayingStore.get().open) nowPlaying.close()
})

function useFullscreen(): [boolean, () => void] {
  const [on, setOn] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const f = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }
  return [on, toggle]
}

export function NowPlaying() {
  const np = useNowPlaying()
  const s = usePlayer()
  const { items } = useLibrary()
  const music = items.filter((i) => i.kind === 'audio')
  const [full, toggleFull] = useFullscreen()
  const track = s.current

  useEffect(() => {
    if (!np.open) return
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') {
        e.preventDefault()
        if (document.fullscreenElement) void document.exitFullscreen()
        else nowPlaying.back()
      } else if (typing) return
      else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        player.toggle()
      } else if (e.key === 'f' || e.key === 'F') toggleFull()
      else if (e.key === 'ArrowRight') player.seek(playerStore.get().time + 5)
      else if (e.key === 'ArrowLeft') player.seek(playerStore.get().time - 5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [np.open])

  return (
    <AnimatePresence>
      {np.open && track && (
        <motion.div
          key="np"
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.985 }}
          transition={t.panel}
          className="absolute inset-0 z-30 flex flex-col"
          role="dialog"
          aria-label="Now playing"
        >
          {/* Top bar */}
          <div className="flex h-12 shrink-0 items-center justify-end px-3">
            <div className="flex items-center gap-1">
              <RoundButton label={np.list ? 'Hide list' : 'Show list'} onClick={nowPlaying.toggleList} active={np.list}>
                <ListMusic size={16} strokeWidth={1.75} />
              </RoundButton>
              <RoundButton label={full ? 'Exit full screen (F)' : 'Full screen (F)'} onClick={toggleFull}>
                {full ? <Minimize size={15} strokeWidth={1.75} /> : <Maximize size={15} strokeWidth={1.75} />}
              </RoundButton>
              <RoundButton label="Back to your music (Esc)" onClick={nowPlaying.back}>
                <ChevronDown size={18} strokeWidth={1.75} />
              </RoundButton>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Stage: stacked when the list is open, side by side when it isn't */}
            <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden px-8 pb-10">
              <motion.div layout transition={t.panel} className={cn('flex items-center', np.list ? 'flex-col gap-7' : 'gap-10')}>
                <Cover src={track.thumbnailUrl} title={track.title} size={np.list ? 'min(38vh, 340px)' : 'min(34vh, 300px)'} />
                <div className="w-[min(440px,80vw)]">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[22px] font-semibold leading-tight tracking-tight" title={track.title}>
                        {track.title}
                      </p>
                      <p className="mt-1 truncate text-body text-fg-2">{track.creator ?? track.extractor}</p>
                    </div>
                    <button
                      onClick={() => {
                        labActions.setTool('key')
                        void labActions.openLibrary(track.id)
                        nowPlaying.close()
                        navigate('lab')
                      }}
                      title="Find the key and BPM of this song in LAB"
                      className={cn(
                        'mt-0.5 flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-ink/[0.12] bg-ink/[0.06] px-2.5 text-label font-medium text-fg-2',
                        'transition-[background-color,color] duration-150 hover:bg-ink/[0.1] hover:text-fg'
                      )}
                    >
                      <FlaskConical size={13} strokeWidth={1.75} />
                      LAB
                    </button>
                  </div>

                  <div>
                    {/* Progress */}
                    <div className="mt-5">
                      <Scrubber value={s.time} max={s.duration} step={5} ariaLabel="Seek" onCommit={player.seek} />
                      <div className="tabular mt-1.5 flex justify-between text-meta text-fg-3">
                        <span>{formatDuration(s.time)}</span>
                        <span>{formatDuration(s.duration || undefined)}</span>
                      </div>
                    </div>

                    {/* Transport: shuffle, back, play, next, repeat */}
                    <div className="mt-3 flex items-center justify-center gap-4">
                      <RoundButton label={s.shuffle ? 'Shuffle: on' : 'Shuffle: off'} onClick={player.toggleShuffle} active={s.shuffle} dot>
                        <Shuffle size={16} strokeWidth={1.75} />
                      </RoundButton>
                      <RoundButton label="Previous" onClick={player.previous}>
                        <SkipBack size={18} strokeWidth={1.75} fill="currentColor" />
                      </RoundButton>
                      <button
                        aria-label={s.playing ? 'Pause' : 'Play'}
                        title={s.playing ? 'Pause (Space)' : 'Play (Space)'}
                        onClick={player.toggle}
                        className="flex size-12 items-center justify-center rounded-full bg-fg text-[var(--color-base)] shadow-[0_2px_10px_rgb(0_0_0/0.35)] transition-[background-color,transform] duration-150 hover:bg-fg/90 active:scale-[0.94]"
                      >
                        {s.playing ? (
                          <Pause size={20} strokeWidth={0} fill="currentColor" />
                        ) : (
                          <Play size={20} strokeWidth={0} fill="currentColor" className="translate-x-[1.5px]" />
                        )}
                      </button>
                      <RoundButton label="Next" onClick={player.next} disabled={!player.hasNext()}>
                        <SkipForward size={18} strokeWidth={1.75} fill="currentColor" />
                      </RoundButton>
                      <RoundButton
                        label={s.repeat === 'one' ? 'Repeat: this song' : s.repeat === 'all' ? 'Repeat: all' : 'Repeat: off'}
                        onClick={player.cycleRepeat}
                        active={s.repeat !== 'off'}
                        dot
                      >
                        {s.repeat === 'one' ? <Repeat1 size={16} strokeWidth={1.75} /> : <Repeat size={16} strokeWidth={1.75} />}
                      </RoundButton>
                    </div>

                    {/* Volume */}
                    <VolumeRow />
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Your Music list */}
            <AnimatePresence initial={false}>
              {np.list && (
                <motion.aside
                  key="list"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 340, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={t.panel}
                  className="glass-deep relative shrink-0 overflow-hidden border-l border-line bg-sidebar/55"
                  aria-label="Music"
                >
                  <SongList music={music} current={track} playing={s.playing} />
                </motion.aside>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Cover({ src, title, size }: { src?: string; title: string; size: string }) {
  return (
    <motion.div
      layout
      transition={t.panel}
      className="relative shrink-0 overflow-hidden rounded-md bg-ink/[0.06] shadow-[0_18px_50px_rgb(0_0_0/0.45)] ring-1 ring-ink/[0.1]"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={`Artwork for ${title}`} className="size-full object-cover" draggable={false} />
      ) : (
        <div className="flex size-full items-center justify-center text-fg-3">
          <Music2 size={48} strokeWidth={1.25} />
        </div>
      )}
    </motion.div>
  )
}

function VolumeRow() {
  const s = usePlayer()
  const Icon = s.muted || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2
  return (
    <div className="mt-4 flex items-center justify-center gap-2.5">
      <RoundButton label={s.muted ? 'Unmute' : 'Mute'} onClick={player.toggleMute} small>
        <Icon size={15} strokeWidth={1.75} />
      </RoundButton>
      <Scrubber value={s.muted ? 0 : s.volume} max={1} step={0.05} ariaLabel="Volume" className="w-[200px]" onCommit={player.setVolume} onChange={player.setVolume} />
    </div>
  )
}

function SongList({ music, current, playing }: { music: LibraryItem[]; current: LibraryItem; playing: boolean }) {
  const listRef = useRef<HTMLDivElement>(null)
  // Bring the playing song into view when the list opens or the song changes.
  useEffect(() => {
    listRef.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current.id])
  return (
    <div className="flex h-full w-[340px] flex-col">
      <div className="flex items-baseline justify-between px-5 pb-2 pt-4">
        <p className="text-body font-semibold">Music</p>
        <p className="text-label text-fg-3">{music.length === 1 ? '1 song' : `${music.length} songs`}</p>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {music.length === 0 && <p className="px-3 py-6 text-label text-fg-3">Finished music downloads show up here.</p>}
        {music.map((m) => {
          const on = m.id === current.id
          return (
            <button
              key={m.id}
              data-current={on || undefined}
              onClick={() => (on ? player.toggle() : player.play(m, music))}
              className={cn(
                'group flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors duration-150',
                on ? 'bg-ink/[0.08]' : 'hover:bg-ink/[0.05]'
              )}
              title={on ? (playing ? 'Pause' : 'Play') : `Play ${m.title}`}
            >
              <div className="relative size-10 shrink-0 overflow-hidden rounded-[4px] bg-ink/[0.06]">
                {m.thumbnailUrl ? <img src={m.thumbnailUrl} alt="" className="size-full object-cover" draggable={false} /> : <Music2 size={16} className="m-3 text-fg-3" />}
                {on && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                    {playing ? <Bars /> : <Play size={14} strokeWidth={0} fill="white" />}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className={cn('truncate text-body', on ? 'font-medium text-accent' : 'text-fg')}>{m.title}</p>
                <p className="mt-0.5 truncate text-label text-fg-3">{m.creator ?? m.extractor}</p>
              </div>
              <span className="tabular shrink-0 text-meta text-fg-3">{formatDuration(m.durationSec)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Little bouncing equaliser bars for the song that's playing. */
function Bars() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="np-bar w-[3px] rounded-full bg-white" style={{ animationDelay: `${i * -0.25}s` }} />
      ))}
    </span>
  )
}

function RoundButton({
  label,
  active,
  dot,
  small,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; dot?: boolean; small?: boolean; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-[0.92]',
        small ? 'size-8' : 'size-10',
        active ? 'text-accent' : 'text-fg-2 hover:text-fg',
        'hover:bg-ink/[0.08] disabled:pointer-events-none disabled:opacity-35',
        className
      )}
      {...rest}
    >
      {children}
      {dot && active && <span className="absolute bottom-1 size-1 rounded-full bg-accent" />}
    </button>
  )
}
