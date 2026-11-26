import { nowPlaying } from '@/features/player/NowPlaying'
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, AudioLines, Clapperboard, FlaskConical, FolderOpen, Music2, Pause, Play, Search, Trash2 } from 'lucide-react'
import type { LibraryItem } from '@shared/types/library'
import { useLibrary, reloadLibrary, libraryTabStore, useLibraryTab } from '@/features/player/library'
import { player, usePlayer } from '@/features/player/model'
import { VideoPlayer } from '@/features/player/VideoPlayer'
import { jobActions } from '@/entities/job/model'
import { setPageArtwork } from '@/widgets/AmbientBackdrop'
import { cn, formatBytes, formatDuration, formatRelative } from '@/shared/lib/format'
import { navigate, useActivePage } from '@/shared/model/navigation'
import { fadeUp, t } from '@/shared/lib/motion'
import { Button, IconButton } from '@/shared/ui/Button'
import { Badge, EmptyState } from '@/shared/ui/Feedback'
import { Page, PageHeader } from '@/shared/ui/Layout'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { notify } from '@/shared/ui/toast'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { labActions } from '@/features/lab/model'

type Tab = 'video' | 'audio'

/** Playing a song from the list opens the full player. */
function playAndOpen(track: LibraryItem, list: LibraryItem[]) {
  player.play(track, list)
  nowPlaying.open()
}

export function LibraryPage() {
  const { items, loaded } = useLibrary()
  const active = useActivePage()
  const music = usePlayer()
  const tab = useLibraryTab()
  const setTab = (t: Tab) => libraryTabStore.set(t)
  const [query, setQuery] = useState('')
  const [watching, setWatching] = useState<LibraryItem | null>(null)
  const [toDelete, setToDelete] = useState<LibraryItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Re-check files each time the page opens (they may have been moved or deleted).
  useEffect(() => {
    if (active === 'library') void reloadLibrary()
    else setWatching(null) // leaving the page stops the video
  }, [active])

  // Background tint: the video you're watching, else the song that's playing.
  useEffect(() => setPageArtwork('library', watching?.thumbnailUrl ?? music.current?.thumbnailUrl), [watching, music.current])

  // If the open video disappears from the library, close it.
  useEffect(() => {
    if (watching && !items.some((i) => i.id === watching.id)) setWatching(null)
  }, [items, watching])

  const q = query.trim().toLowerCase()
  const list = useMemo(
    () => items.filter((i) => i.kind === tab && (!q || `${i.title} ${i.creator ?? ''}`.toLowerCase().includes(q))),
    [items, tab, q]
  )
  const counts = { video: items.filter((i) => i.kind === 'video').length, audio: items.filter((i) => i.kind === 'audio').length }

  /** Opens the file in LAB. Nothing is analyzed until you choose a tool and ask. */
  const openInLab = (item: LibraryItem) => {
    if (watching?.id === item.id) setWatching(null)
    navigate('lab')
    void labActions.openLibrary(item.id)
  }

  const reveal = async (id: string) => {
    if (!(await jobActions.reveal(id))) notify({ tone: 'error', title: 'File not found', body: 'It may have been moved, renamed or deleted.' })
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    const item = toDelete
    setDeleting(true)
    if (watching?.id === item.id) setWatching(null) // release the file before deleting it
    if (music.current?.id === item.id) player.stop()
    // Give the player a moment to let go of the file (Windows won't delete open files).
    if (watching?.id === item.id || music.current?.id === item.id) await new Promise((r) => setTimeout(r, 400))
    const r = await jobActions.deleteDownload(item.id)
    setDeleting(false)
    setToDelete(null)
    await reloadLibrary()
    if (r === 'ok') notify({ tone: 'success', title: 'Deleted', body: `"${item.title}" was moved to the Recycle Bin.` })
    else if (r === 'missing') notify({ tone: 'info', title: 'Removed from Library', body: 'The file was already gone, so only the entry was removed.' })
    else notify({ tone: 'error', title: "Couldn't delete the file", body: 'It may be open in another program. Close it and try again.' })
  }

  const dialog = (
    <ConfirmDialog
      open={!!toDelete}
      busy={deleting}
      title={`Delete ${toDelete?.kind === 'video' ? 'video' : 'song'}?`}
      confirmLabel="Delete"
      onCancel={() => setToDelete(null)}
      onConfirm={() => void confirmDelete()}
      body={
        <>
          <span className="font-medium text-fg">{toDelete?.title}</span> will be moved to the Recycle Bin and removed from your Library and History.
        </>
      }
    />
  )

  if (watching) {
    return (
      <Page>
        {dialog}
        <motion.div {...fadeUp} transition={t.base}>
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} strokeWidth={1.5} />} onClick={() => setWatching(null)} className="-ml-2 mb-4">
            Library
          </Button>
          <VideoPlayer item={watching} />
          <div className="mt-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-section font-semibold">{watching.title}</h1>
              <p className="mt-1 text-label text-fg-2">
                {[watching.creator, watching.extractor, formatBytes(watching.sizeBytes), watching.ext.toUpperCase()].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" icon={<FlaskConical size={14} strokeWidth={1.5} />} onClick={() => openInLab(watching)}>
                Open in LAB
              </Button>
              <Button size="sm" icon={<FolderOpen size={14} strokeWidth={1.5} />} onClick={() => void reveal(watching.id)}>
                Show in folder
              </Button>
              <Button size="sm" variant="danger" icon={<Trash2 size={14} strokeWidth={1.5} />} onClick={() => setToDelete(watching)}>
                Delete
              </Button>
            </div>
          </div>
        </motion.div>
      </Page>
    )
  }

  return (
    <Page>
      {dialog}
      <PageHeader title="Library" subtitle="Everything you've downloaded, ready to play." />

      <div className="mb-5 flex items-center justify-between gap-4">
        <SegmentedControl<Tab>
          ariaLabel="Library section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'video', label: <TabLabel name="Videos" count={counts.video} /> },
            { value: 'audio', label: <TabLabel name="Music" count={counts.audio} /> }
          ]}
        />
        <div className="flex items-center gap-2">
          {tab === 'audio' && list.length > 0 && (
            <Button variant="primary" icon={<Play size={12} strokeWidth={0} fill="currentColor" />} onClick={() => playAndOpen(list[0]!, list)} className="px-3">
              Play all
            </Button>
          )}
          <label
            className={cn(
              'group/search flex h-8 w-[248px] items-center gap-2 rounded-sm border border-ink/[0.09] bg-ink/[0.025] px-2.5',
              'transition-[border-color,box-shadow] duration-150 hover:border-ink/[0.14]',
              'focus-within:border-accent/55 focus-within:focus-halo focus-within:hover:border-accent/55'
            )}
          >
            <Search size={14} strokeWidth={1.75} className="shrink-0 text-fg-3 transition-colors duration-150 group-focus-within/search:text-accent" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title or creator"
              aria-label="Search library"
              className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-fg-3 focus-visible:outline-none"
            />
          </label>
        </div>
      </div>

      {!loaded ? null : items.filter((i) => i.kind === tab).length === 0 ? (
        <EmptyState
          icon={tab === 'video' ? <Clapperboard size={18} strokeWidth={1.5} /> : <Music2 size={18} strokeWidth={1.5} />}
          title={tab === 'video' ? 'No videos yet' : 'No music yet'}
          body={`Finished ${tab === 'video' ? 'video' : 'music'} downloads show up here.`}
          action={<Button onClick={() => navigate(tab === 'video' ? 'videos' : 'music')}>Go to {tab === 'video' ? 'Videos' : 'Music'}</Button>}
        />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<Search size={18} strokeWidth={1.5} />} title="No matches" body="Try another search." />
      ) : tab === 'video' ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-7 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {list.map((v) => (
              <motion.div
                key={v.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={t.base}
                className="group relative"
              >
                <button onClick={() => setWatching(v)} className="w-full rounded-md text-left">
                  <div className="relative aspect-video overflow-hidden rounded-md bg-gradient-to-br from-ink/[0.06] to-ink/[0.02]">
                    {v.thumbnailUrl ? (
                      <img
                        src={v.thumbnailUrl}
                        alt=""
                        className="size-full object-cover brightness-[0.94] transition-[filter] duration-200 ease-out-soft group-hover:brightness-105"
                        draggable={false}
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-fg-3">
                        <Clapperboard size={24} strokeWidth={1.25} />
                      </span>
                    )}
                    {/* Play affordance: a light dim and a small glass button, no zoom. */}
                    <div className="absolute inset-0 flex items-center justify-center bg-shade/0 opacity-0 transition-[opacity,background-color] duration-200 ease-out-soft group-hover:bg-shade/20 group-hover:opacity-100">
                      <span className="media-dark flex size-10 items-center justify-center rounded-full border border-ink/[0.18] bg-shade/40 text-fg backdrop-blur-md">
                        <Play size={15} strokeWidth={0} fill="currentColor" className="translate-x-px" />
                      </span>
                    </div>
                    {v.durationSec && (
                      <span className="media-dark tabular absolute bottom-2 right-2 flex h-[18px] items-center rounded-[4px] bg-shade/65 px-1.5 text-meta font-medium text-fg backdrop-blur-sm">
                        {formatDuration(v.durationSec)}
                      </span>
                    )}
                    {/* Hairline frame drawn on top so it stays crisp over any thumbnail. */}
                    <span className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-ink/[0.08] transition-[box-shadow] duration-200 group-hover:ring-ink/[0.2]" />
                  </div>
                  <p className="mt-2.5 line-clamp-2 text-body font-medium leading-[18px]" title={v.title}>
                    {v.title}
                  </p>
                  <p className="mt-1 truncate text-meta text-fg-2">
                    {[v.creator, v.ext.toUpperCase(), formatRelative(v.addedAt)].filter(Boolean).join('  ·  ')}
                  </p>
                </button>
                <IconButton
                  label={`Delete ${v.title}`}
                  onClick={() => setToDelete(v)}
                  className="media-dark absolute right-2 top-2 rounded-full bg-shade/55 text-fg opacity-0 backdrop-blur-md transition-[opacity,background-color] duration-150 hover:bg-danger/85 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </IconButton>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-col border-t border-line pt-1">
          {list.map((s, idx) => {
            const isCurrent = music.current?.id === s.id
            const playingThis = isCurrent && music.playing
            const playToggle = () => (isCurrent ? player.toggle() : playAndOpen(s, list))
            return (
              <div
                key={s.id}
                onDoubleClick={() => playAndOpen(s, list)}
                aria-current={isCurrent || undefined}
                className={cn(
                  'group/row -mx-3 flex items-center gap-3.5 rounded-sm px-3 py-2.5 transition-colors duration-150',
                  isCurrent ? 'bg-accent/[0.07]' : 'hover:bg-ink/[0.035]',
                  // Hairline separators, hidden next to a highlighted row.
                  'relative after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-line after:transition-opacity after:duration-150 last:after:opacity-0',
                  'hover:after:opacity-0 [&:has(+[aria-current])]:after:opacity-0 [&:has(+*:hover)]:after:opacity-0',
                  isCurrent && 'after:opacity-0'
                )}
              >
                {/* Number → play on hover; the current song shows a small accent indicator. */}
                <button
                  onClick={playToggle}
                  aria-label={playingThis ? `Pause ${s.title}` : `Play ${s.title}`}
                  className="relative flex size-6 shrink-0 items-center justify-center rounded-full text-fg-3 transition-colors duration-150 hover:bg-ink/[0.08] hover:text-fg"
                >
                  <span className={cn('tabular text-label transition-opacity duration-150 group-hover/row:opacity-0', isCurrent && 'opacity-0')}>{idx + 1}</span>
                  <span
                    className={cn(
                      'absolute inset-0 flex items-center justify-center transition-opacity duration-150',
                      isCurrent ? 'text-accent opacity-100 group-hover/row:opacity-0' : 'opacity-0'
                    )}
                  >
                    {playingThis ? <AudioLines size={15} strokeWidth={1.75} /> : <Pause size={12} strokeWidth={0} fill="currentColor" />}
                  </span>
                  <span className="absolute inset-0 flex items-center justify-center text-fg opacity-0 transition-opacity duration-150 group-hover/row:opacity-100">
                    {playingThis ? <Pause size={12} strokeWidth={0} fill="currentColor" /> : <Play size={12} strokeWidth={0} fill="currentColor" className="translate-x-px" />}
                  </span>
                </button>

                <button onClick={playToggle} tabIndex={-1} aria-hidden className="relative size-10 shrink-0 overflow-hidden rounded-sm bg-gradient-to-br from-ink/[0.07] to-ink/[0.02]">
                  {s.thumbnailUrl ? (
                    <img src={s.thumbnailUrl} alt="" className="size-full object-cover" draggable={false} />
                  ) : (
                    <span className="flex size-full items-center justify-center text-fg-3">
                      <Music2 size={15} strokeWidth={1.5} />
                    </span>
                  )}
                  <span className="pointer-events-none absolute inset-0 rounded-sm ring-1 ring-inset ring-ink/[0.08]" />
                </button>

                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-body font-medium transition-colors duration-150', isCurrent ? 'text-accent' : 'text-fg')} title={s.title}>
                    {s.title}
                  </p>
                  <p className="mt-0.5 truncate text-label text-fg-2">{s.creator ?? s.extractor}</p>
                </div>

                <span className="w-12 shrink-0 text-right">
                  <Badge className="border-transparent bg-ink/[0.045] text-fg-3">{s.ext.toUpperCase()}</Badge>
                </span>
                <span className={cn('tabular w-11 shrink-0 text-right text-label', isCurrent ? 'text-fg-2' : 'text-fg-3')}>{formatDuration(s.durationSec)}</span>
                {/* Fixed-width slot, so revealing the actions never moves the columns. */}
                <div className="flex w-[88px] shrink-0 justify-end opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/row:opacity-100">
                  <IconButton label="Open in LAB" onClick={() => openInLab(s)}>
                    <FlaskConical size={14} strokeWidth={1.5} />
                  </IconButton>
                  <IconButton label="Show in folder" onClick={() => void reveal(s.id)}>
                    <FolderOpen size={14} strokeWidth={1.5} />
                  </IconButton>
                  <IconButton label={`Delete ${s.title}`} onClick={() => setToDelete(s)} className="hover:text-danger">
                    <Trash2 size={14} strokeWidth={1.5} />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}

function TabLabel({ name, count }: { name: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {name}
      <span className="tabular text-meta font-normal text-fg-3">{count}</span>
    </span>
  )
}
