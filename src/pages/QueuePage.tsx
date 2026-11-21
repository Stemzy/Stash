import { AnimatePresence, Reorder, motion } from 'motion/react'
import { Download, GripVertical, Pause, Play, X } from 'lucide-react'
import { useJobs, jobActions, type UiJob } from '@/entities/job/model'
import { JobRow } from '@/entities/job/ui'
import { navigate } from '@/shared/model/navigation'
import { Button, IconButton } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/Feedback'
import { Page, PageHeader, SectionTitle } from '@/shared/ui/Layout'
import { t } from '@/shared/lib/motion'
import { useSettings } from '@/entities/settings/model'

function Controls({ job }: { job: UiJob }) {
  return (
    <>
      {job.status === 'paused' ? (
        <IconButton label="Resume" onClick={() => jobActions.resume(job.id)}>
          <Play size={14} strokeWidth={1.5} />
        </IconButton>
      ) : (
        <IconButton label="Pause" disabled={job.status !== 'downloading'} onClick={() => jobActions.pause(job.id)}>
          <Pause size={14} strokeWidth={1.5} />
        </IconButton>
      )}
      <IconButton label="Cancel" onClick={() => jobActions.cancel(job.id)}>
        <X size={14} strokeWidth={1.5} />
      </IconButton>
    </>
  )
}

export function QueuePage() {
  const jobs = useJobs()
  const { concurrency } = useSettings()
  const running = jobs.filter((j) => ['downloading', 'merging', 'converting'].includes(j.status))
  const waiting = jobs.filter((j) => j.status === 'queued' || j.status === 'paused')

  return (
    <Page>
      <PageHeader
        title="Queue"
        subtitle={`Up to ${concurrency} at a time. Paused downloads keep their progress.`}
      />

      {running.length === 0 && waiting.length === 0 ? (
        <EmptyState
          icon={<Download size={18} strokeWidth={1.5} />}
          title="The queue is empty"
          body="Analyze a link on Videos or Music and add it to the queue."
          action={
            <div className="flex gap-2">
              <Button onClick={() => navigate('videos')}>Go to Videos</Button>
              <Button onClick={() => navigate('music')}>Go to Music</Button>
            </div>
          }
        />
      ) : (
        <>
          <section>
            <SectionTitle>Active</SectionTitle>
            {running.length === 0 ? (
              <p className="border-y border-line py-4 text-label text-fg-2">Nothing is running right now.</p>
            ) : (
              <div className="divide-y divide-line border-y border-line">
                <AnimatePresence initial={false}>
                  {running.map((j) => (
                    <motion.div key={j.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.base}>
                      <JobRow job={j} showProgress actions={<Controls job={j} />} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          <section className="mt-8">
            <SectionTitle aside={waiting.length > 1 && <span className="text-meta text-fg-2">Drag to reorder</span>}>
              Waiting
            </SectionTitle>
            {waiting.length === 0 ? (
              <p className="border-y border-line py-4 text-label text-fg-2">No jobs are waiting.</p>
            ) : (
              <Reorder.Group
                axis="y"
                values={waiting.map((j) => j.id)}
                onReorder={jobActions.reorderWaiting}
                className="divide-y divide-line border-y border-line"
              >
                {waiting.map((j) => (
                  <Reorder.Item key={j.id} value={j.id} transition={t.base} className="flex items-center gap-1 bg-base/0">
                    <GripVertical size={14} strokeWidth={1.5} className="-ml-1 shrink-0 cursor-grab text-fg-3" />
                    <div className="min-w-0 flex-1">
                      <JobRow job={j} showProgress={j.status === 'paused'} actions={<Controls job={j} />} />
                    </div>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            )}
          </section>
        </>
      )}
    </Page>
  )
}
