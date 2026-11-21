import type { ReactNode } from 'react'
import { BIT_DEPTHS } from '@shared/audio-presets'
import { cn, formatBytes, formatEta, formatSpeed } from '@/shared/lib/format'
import { Badge, ProgressBar } from '@/shared/ui/Feedback'
import { Artwork } from '@/entities/media/MediaPreview'
import type { UiJob } from './model'

const STATUS: Record<UiJob['status'], { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }> = {
  queued: { label: 'Waiting', tone: 'neutral' },
  downloading: { label: 'Downloading', tone: 'accent' },
  merging: { label: 'Merging', tone: 'accent' },
  converting: { label: 'Converting', tone: 'accent' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  canceled: { label: 'Canceled', tone: 'neutral' }
}

export function JobStatusBadge({ job }: { job: UiJob }) {
  const s = STATUS[job.status]
  // A finished simulation must never read like a real, saved file.
  const label = job.status === 'completed' && job.simulated && !job.sample ? 'Simulation done' : s.label
  return (
    <Badge tone={s.tone} className="gap-1.5 border-transparent bg-ink/[0.04] pl-1.5 pr-2">
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          { neutral: 'bg-fg-3', accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[s.tone]
        )}
      />
      {label}
    </Badge>
  )
}

/** Marks jobs that don't write a real file (simulated video jobs and sample rows). */
export function SimulatedTag({ job }: { job: UiJob }) {
  if (!job.simulated) return null
  return (
    <Badge tone="neutral" className="border-dashed">
      {job.sample ? 'Sample' : 'Simulated'}
    </Badge>
  )
}

/** "1080p MP4", "MP3 · 192 kbps", "FLAC · 16-bit". */
export function specSummary(job: Pick<UiJob, 'spec'>): string {
  const s = job.spec
  if (s.kind === 'video') return `${s.height}p · ${s.container.toUpperCase()}`
  const fmt = s.format === 'm4a' ? 'M4A' : s.format === 'opus' ? 'Opus' : s.format.toUpperCase()
  const q = s.quality
  if (q.mode === 'original') return `${fmt} · Original`
  if (q.mode === 'bitrate') return `${fmt} · ${q.kbps} kbps`
  const depth = BIT_DEPTHS[s.format === 'flac' ? 'flac' : 'wav'].find((d) => d.value === q.bitDepth)?.label
  const rate = q.sampleRateHz === 'source' ? '' : ` · ${q.sampleRateHz / 1000} kHz`
  return `${fmt} · ${depth}${rate}`
}

/** Percent, speed, ETA and phase for a running job. */
export function JobProgress({ job }: { job: UiJob }) {
  const indeterminate = job.status === 'merging'
  const tone = job.status === 'paused' ? 'muted' : 'accent'
  const size = job.output.sizeBytes
  return (
    <div className="flex flex-col gap-1.5">
      <ProgressBar value={job.percent} tone={tone} indeterminate={indeterminate} />
      <div className="tabular flex justify-between text-meta text-fg-2">
        <span>
          {job.status === 'downloading' &&
            (size
              ? `${Math.floor(job.percent)}% · ${formatBytes((size * job.percent) / 100)} of ${formatBytes(size, true)}`
              : `Downloading · ${Math.floor(job.percent)}%`)}
          {job.status === 'merging' && 'Merging video and audio'}
          {job.status === 'converting' && (job.percent >= 100 ? 'Saving' : `Converting · ${Math.floor(job.percent)}%`)}
          {job.status === 'paused' && `Paused at ${Math.floor(job.percent)}%`}
          {job.status === 'queued' && 'Waiting for a free slot'}
        </span>
        <span>{job.status === 'downloading' && [formatSpeed(job.speedBps), formatEta(job.etaSec)].filter(Boolean).join(' · ')}</span>
      </div>
    </div>
  )
}

/** One look for a job everywhere: queue, drawer, history, recent lists. */
export function JobRow({
  job,
  actions,
  showProgress,
  dense,
  meta
}: {
  job: UiJob
  actions?: ReactNode
  showProgress?: boolean
  dense?: boolean
  meta?: ReactNode
}) {
  const shape = job.spec.kind === 'video' ? 'wide' : 'square'
  return (
    <div className={cn('group flex items-center gap-3', dense ? 'py-2' : 'py-3')}>
      <Artwork src={job.source.thumbnailUrl} shape={shape} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-body font-medium">{job.source.title}</p>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-meta text-fg-2">
          {job.source.creator && (
            <>
              <span className="truncate">{job.source.creator}</span>
              <span className="text-fg-3">·</span>
            </>
          )}
          <span className="tabular shrink-0">{specSummary(job)}</span>
          {meta}
        </div>
        {job.status === 'failed' && job.error && <p className="mt-1 text-meta text-danger">{job.error.message}</p>}
        {job.status === 'paused' && job.note && <p className="mt-1 text-meta text-fg-2">{job.note}</p>}
        {showProgress && (
          <div className="mt-2">
            <JobProgress job={job} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SimulatedTag job={job} />
        {!showProgress && <JobStatusBadge job={job} />}
        {actions && <div className="flex items-center gap-0.5">{actions}</div>}
      </div>
    </div>
  )
}
