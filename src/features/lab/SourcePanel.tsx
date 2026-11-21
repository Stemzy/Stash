import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, AudioLines, Clapperboard, Library, Music2, Pause, Play, Search, Upload, X } from 'lucide-react'
import type { LibraryItem } from '@shared/types/library'
import { reloadLibrary, useLibrary } from '@/features/player/library'
import { formatDuration } from '@/shared/lib/format'
import { t } from '@/shared/lib/motion'
import { Button, IconButton } from '@/shared/ui/Button'
import { ProgressBar, Skeleton } from '@/shared/ui/Feedback'
import { Panel } from '@/shared/ui/Layout'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { labActions, useLab } from './model'
import { labPlayer, useLabPlayer } from './player'
import { Waveform } from './Waveform'
import { formatTime, infoParts } from './format'

/** The file all LAB tools share: pick it, see what it is, hear it. */
/** `compact`: the tool shows its own waveform (Audio Prep), so only the file details are shown here. */
export function SourcePanel({ dragging, compact }: { dragging: boolean; compact?: boolean }) {
  const lab = useLab()
  const [choosing, setChoosing] = useState(false)
  const src = lab.source

  return (
    <Panel solid className="relative">
      <LibraryChooser open={choosing} onClose={() => setChoosing(false)} />
      {/* Drop highlight, drawn over the panel's own border. */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={t.fast}
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border border-accent/70 bg-accent/[0.07]"
          >
            <span className="glass-popover rounded-sm px-3 py-1.5 text-label font-medium text-fg">Drop to open in LAB</span>
          </motion.div>
        )}
      </AnimatePresence>

      {lab.openError && (
        <div role="alert" className="flex items-start gap-2 border-b border-line px-5 py-3 text-label text-danger">
          <AlertCircle size={14} strokeWidth={1.75} className="mt-px shrink-0" />
          <span className="flex-1">{lab.openError}</span>
          <IconButton label="Dismiss" onClick={labActions.dismissError} className="-my-1 size-6">
            <X size={13} strokeWidth={1.75} />
          </IconButton>
        </div>
      )}

      {!src ? (
        <div className="p-5">
          <div className="flex flex-col items-center rounded-md border border-dashed border-ink/[0.14] bg-ink/[0.015] px-6 py-9 text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-md border border-ink/[0.12] bg-ink/[0.03] text-accent">
              <AudioLines size={20} strokeWidth={1.75} />
            </span>
            <p className="text-section font-semibold">Choose a beat, sample or song</p>
            <p className="mt-1.5 max-w-[440px] text-label text-fg-2">
              Drop a file here, upload one, or pick something you've downloaded. Audio or video (its sound is used). Your original file is never changed.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <Button icon={<Upload size={14} strokeWidth={1.75} />} loading={lab.opening} onClick={() => void labActions.pickFile()}>
                Upload audio
              </Button>
              <Button icon={<Library size={14} strokeWidth={1.75} />} disabled={lab.opening} onClick={() => setChoosing(true)}>
                Choose from Library
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-5">
          <div className="flex items-center gap-3.5">
            <div className="relative size-12 shrink-0 overflow-hidden rounded-sm bg-gradient-to-br from-ink/[0.07] to-ink/[0.02]">
              {src.artworkUrl ? (
                <img src={src.artworkUrl} alt="" className="size-full object-cover" draggable={false} />
              ) : (
                <span className="flex size-full items-center justify-center text-fg-3">
                  {src.info.hasVideo ? <Clapperboard size={18} strokeWidth={1.5} /> : <Music2 size={18} strokeWidth={1.5} />}
                </span>
              )}
              <span className="pointer-events-none absolute inset-0 rounded-sm ring-1 ring-inset ring-ink/[0.08]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-semibold" title={src.title}>
                {src.title}
              </p>
              <p className="mt-0.5 truncate text-label text-fg-2">
                {[src.creator, formatDuration(src.info.durationSec), src.info.hasVideo ? 'Audio from video' : undefined].filter(Boolean).join('  ·  ')}
              </p>
              <p className="tabular mt-0.5 truncate text-meta text-fg-3">{infoParts(src.info).join('  ·  ')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" icon={<Upload size={13} strokeWidth={1.75} />} loading={lab.opening} onClick={() => void labActions.pickFile()}>
                Open file
              </Button>
              <Button size="sm" variant="ghost" icon={<Library size={13} strokeWidth={1.75} />} disabled={lab.opening} onClick={() => setChoosing(true)}>
                Library
              </Button>
              <IconButton label="Close file" onClick={labActions.close}>
                <X size={14} strokeWidth={1.75} />
              </IconButton>
            </div>
          </div>
          {!compact && <Transport />}
        </div>
      )}
    </Panel>
  )
}

function Transport() {
  const { waveform } = useLab()
  const p = useLabPlayer()
  const [, tick] = useState(0)
  // Re-render the time readout a few times a second while playing.
  useEffect(() => {
    if (!p.playing) return
    const id = setInterval(() => tick((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [p.playing])
  const duration = waveform.value?.durationSec ?? p.duration

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-center gap-3">
        <IconButton
          label={p.playing ? 'Pause preview' : 'Play preview'}
          onClick={labPlayer.toggle}
          disabled={!p.src || p.error}
          className="size-8 rounded-full border border-line-strong bg-ink/[0.04] text-fg hover:bg-ink/[0.08]"
        >
          {p.playing ? <Pause size={13} strokeWidth={0} fill="currentColor" /> : <Play size={13} strokeWidth={0} fill="currentColor" className="translate-x-px" />}
        </IconButton>
        <div className="min-w-0 flex-1 pt-4">
          {waveform.status === 'done' && waveform.value ? (
            <Waveform data={waveform.value} height={72} />
          ) : waveform.status === 'error' ? (
            <p className="flex h-[72px] items-center text-label text-danger">{waveform.error}</p>
          ) : (
            <div className="flex h-[72px] flex-col justify-center gap-2">
              <Skeleton className="h-8 w-full" />
              <div className="flex items-center gap-3">
                <span className="text-meta text-fg-3">Reading audio…</span>
                <ProgressBar value={(waveform.progress?.fraction ?? 0) * 100} indeterminate={waveform.progress?.fraction == null} className="max-w-[160px]" />
              </div>
            </div>
          )}
        </div>
        <span className="tabular w-[88px] shrink-0 text-right text-label text-fg-2">
          {formatTime(labPlayer.time())} <span className="text-fg-3">/ {formatTime(duration)}</span>
        </span>
      </div>
      {p.error && <p className="mt-2 pl-11 text-meta text-fg-3">This format can't be previewed in the app. Analysis still works.</p>}
    </div>
  )
}

type Kind = 'audio' | 'video'

/** Pick something already downloaded. */
function LibraryChooser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, loaded } = useLibrary()
  const [kind, setKind] = useState<Kind>('audio')
  const [q, setQ] = useState('')
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    void reloadLibrary()
    setQ('')
    setTimeout(() => search.current?.focus(), 30)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const query = q.trim().toLowerCase()
  const list = useMemo(() => items.filter((i) => i.kind === kind && (!query || `${i.title} ${i.creator ?? ''}`.toLowerCase().includes(query))), [items, kind, query])
  const choose = (i: LibraryItem) => {
    onClose()
    void labActions.openLibrary(i.id)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="glass-scrim fixed inset-0 z-[60] flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.16 } }}
          transition={t.panel}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Choose from Library"
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99, transition: { duration: 0.14 } }}
            transition={t.panel}
            className="glass-panel flex max-h-[min(560px,80vh)] w-full max-w-[520px] flex-col rounded-[14px]"
          >
            <div className="flex items-center justify-between px-5 pb-3 pt-4">
              <h2 className="text-section font-semibold">Choose from Library</h2>
              <IconButton label="Close" onClick={onClose}>
                <X size={14} strokeWidth={1.75} />
              </IconButton>
            </div>
            <div className="flex items-center gap-2 px-5 pb-3">
              <SegmentedControl<Kind>
                ariaLabel="Library section"
                size="sm"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'audio', label: 'Music' },
                  { value: 'video', label: 'Videos' }
                ]}
              />
              <label className="flex h-8 flex-1 items-center gap-2 rounded-sm border border-ink/[0.09] bg-ink/[0.025] px-2.5 transition-[border-color,box-shadow] duration-150 focus-within:border-accent/55 focus-within:focus-halo">
                <Search size={14} strokeWidth={1.75} className="shrink-0 text-fg-3" />
                <input
                  ref={search}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search"
                  aria-label="Search library"
                  className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-fg-3 focus-visible:outline-none"
                />
              </label>
            </div>
            <div className="min-h-[160px] overflow-y-auto border-t border-line px-2 py-2">
              {!loaded ? null : list.length === 0 ? (
                <p className="px-3 py-10 text-center text-label text-fg-2">
                  {items.some((i) => i.kind === kind) ? 'No matches.' : kind === 'audio' ? 'No music downloads yet.' : 'No video downloads yet.'}
                </p>
              ) : (
                list.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => choose(i)}
                    className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors duration-150 hover:bg-ink/[0.05] focus-visible:bg-ink/[0.05]"
                  >
                    <span className="relative size-9 shrink-0 overflow-hidden rounded-sm bg-gradient-to-br from-ink/[0.07] to-ink/[0.02]">
                      {i.thumbnailUrl ? (
                        <img src={i.thumbnailUrl} alt="" className="size-full object-cover" draggable={false} />
                      ) : (
                        <span className="flex size-full items-center justify-center text-fg-3">{kind === 'audio' ? <Music2 size={14} /> : <Clapperboard size={14} />}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium">{i.title}</span>
                      <span className="block truncate text-meta text-fg-2">{[i.creator ?? i.extractor, i.ext.toUpperCase()].join('  ·  ')}</span>
                    </span>
                    <span className="tabular shrink-0 text-label text-fg-3">{formatDuration(i.durationSec)}</span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

