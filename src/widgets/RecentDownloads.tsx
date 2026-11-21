import { AnimatePresence, motion } from 'motion/react'
import { Clapperboard, Music2 } from 'lucide-react'
import { useJobs, isActive } from '@/entities/job/model'
import { JobRow } from '@/entities/job/ui'
import { formatRelative } from '@/shared/lib/format'
import { navigate } from '@/shared/model/navigation'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/Feedback'
import { SectionTitle } from '@/shared/ui/Layout'
import { t } from '@/shared/lib/motion'

/** Last few finished jobs of one kind, newest first. */
export function RecentDownloads({ kind }: { kind: 'video' | 'audio' }) {
  const jobs = useJobs()
  const recent = jobs
    .filter((j) => j.spec.kind === kind && !isActive(j))
    .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt))
    .slice(0, 4)

  return (
    <section className="mt-10">
      <SectionTitle
        aside={
          recent.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => navigate('history')}>
              View all
            </Button>
          )
        }
      >
        Recent {kind === 'video' ? 'video' : 'audio'} downloads
      </SectionTitle>
      {recent.length === 0 ? (
        <EmptyState
          compact
          icon={kind === 'video' ? <Clapperboard size={18} strokeWidth={1.5} /> : <Music2 size={18} strokeWidth={1.5} />}
          title="Nothing here yet"
          body="Finished downloads will show up here."
        />
      ) : (
        <div className="flex flex-col border-t border-line">
          <AnimatePresence initial={false}>
            {recent.map((j) => (
              <motion.div
                key={j.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={t.base}
                // Hover fills a little wider than the column; the separator stays within it.
                className="group/row -mx-3 rounded-sm px-3 transition-colors duration-100 hover:bg-ink/[0.035]"
              >
                <div className="border-b border-line transition-colors duration-100 group-last/row:border-transparent group-hover/row:border-transparent [:has(+*:hover)>&]:border-transparent">
                  <JobRow
                    job={j}
                    dense
                    meta={
                      <>
                        <span className="text-fg-3">·</span>
                        <span className="shrink-0">{formatRelative(j.finishedAt ?? j.createdAt)}</span>
                      </>
                    }
                  />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  )
}
