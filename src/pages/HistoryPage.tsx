import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FolderOpen, History, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useJobs, isActive, jobActions } from '@/entities/job/model'
import { JobRow } from '@/entities/job/ui'
import { formatBytes, formatRelative } from '@/shared/lib/format'
import { IconButton } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/Feedback'
import { Page, PageHeader } from '@/shared/ui/Layout'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { notify } from '@/shared/ui/toast'
import { t } from '@/shared/lib/motion'

type Filter = 'all' | 'video' | 'audio'

export function HistoryPage() {
  const jobs = useJobs()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const all = jobs.filter((j) => !isActive(j))
  const q = query.trim().toLowerCase()
  const shown = all
    .filter((j) => filter === 'all' || j.spec.kind === filter)
    .filter((j) => !q || `${j.source.title} ${j.source.creator ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt))

  return (
    <Page>
      <PageHeader title="History" subtitle="Finished, failed and canceled downloads." />

      <div className="mb-4 flex items-center justify-between gap-4">
        <SegmentedControl<Filter>
          ariaLabel="Filter"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'video', label: 'Videos' },
            { value: 'audio', label: 'Music' }
          ]}
        />
        <label className="flex h-8 w-[260px] items-center gap-2 rounded-sm border border-line-strong bg-ink/[0.02] px-2.5 transition-colors focus-within:border-accent/60">
          <Search size={14} strokeWidth={1.5} className="text-fg-2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or creator"
            aria-label="Search history"
            className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-fg-3"
          />
        </label>
      </div>

      {all.length === 0 ? (
        <EmptyState icon={<History size={18} strokeWidth={1.5} />} title="No history yet" body="Finished downloads will be listed here." />
      ) : shown.length === 0 ? (
        <EmptyState compact icon={<Search size={18} strokeWidth={1.5} />} title="No matches" body="Try another search or filter." />
      ) : (
        <div className="divide-y divide-line border-y border-line">
          <AnimatePresence initial={false}>
            {shown.map((j) => (
              <motion.div key={j.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.base}>
                <JobRow
                  job={j}
                  meta={
                    <>
                      {j.status === 'completed' && (
                        <>
                          <span className="text-fg-3">·</span>
                          <span className="tabular shrink-0">{formatBytes(j.output.sizeBytes, !!j.simulated)}</span>
                        </>
                      )}
                      <span className="text-fg-3">·</span>
                      <span className="shrink-0">{formatRelative(j.finishedAt ?? j.createdAt)}</span>
                    </>
                  }
                  actions={
                    <>
                      <IconButton
                        label={j.simulated ? 'Show in folder (no file: simulated)' : 'Show in folder'}
                        disabled={j.simulated || j.status !== 'completed'}
                        onClick={async () => {
                          if (!(await jobActions.reveal(j.id)))
                            notify({ tone: 'error', title: 'File not found', body: 'It may have been moved, renamed or deleted.' })
                        }}
                      >
                        <FolderOpen size={14} strokeWidth={1.5} />
                      </IconButton>
                      <IconButton
                        label={j.status === 'completed' ? 'Download again' : 'Retry'}
                        onClick={async () => {
                          const retry = j.status !== 'completed'
                          const err = await jobActions.again(j)
                          if (err) notify({ tone: 'error', title: "Couldn't start the download", body: err })
                          else notify({ tone: 'info', title: retry ? 'Retrying' : 'Added to queue again', body: j.simulated ? 'Simulated: no file will be written.' : undefined })
                        }}
                      >
                        <RotateCcw size={14} strokeWidth={1.5} />
                      </IconButton>
                      <IconButton label="Remove from list" onClick={() => jobActions.remove(j.id)}>
                        <Trash2 size={14} strokeWidth={1.5} />
                      </IconButton>
                    </>
                  }
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </Page>
  )
}
