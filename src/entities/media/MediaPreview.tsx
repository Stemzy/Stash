import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Clapperboard, Clock, Globe, Music2, User } from 'lucide-react'
import type { MediaInfo } from '@shared/types/media'
import { cn, formatDuration } from '@/shared/lib/format'
import { Skeleton } from '@/shared/ui/Feedback'
import { fadeUp, t } from '@/shared/lib/motion'

interface Props {
  media: MediaInfo
  shape: 'wide' | 'square'
  /** Extra line(s) under the metadata, e.g. what will be fetched. */
  footer?: ReactNode
}

/** Thumbnail or artwork, title, creator, duration and source site. */
export function MediaPreview({ media, shape, footer }: Props) {
  return (
    <motion.div {...fadeUp} transition={t.base} className="flex items-center gap-5 p-5">
      <Artwork src={media.thumbnailUrl} shape={shape} title={media.title} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="line-clamp-2 text-section font-semibold leading-[21px] tracking-[-0.005em]" title={media.title}>
          {media.title}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-label text-fg-2">
          {media.creator && <Meta icon={<User size={12} strokeWidth={1.75} />}>{media.creator}</Meta>}
          <Meta icon={<Clock size={12} strokeWidth={1.75} />} tabular>
            {formatDuration(media.durationSec)}
          </Meta>
          <Meta icon={<Globe size={12} strokeWidth={1.75} />}>{media.extractor}</Meta>
        </div>
        {/* Technical details: available, but quieter than the title and facts above. */}
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </motion.div>
  )
}

function Meta({ icon, children, tabular }: { icon: ReactNode; children: ReactNode; tabular?: boolean }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', tabular && 'tabular')}>
      <span className="shrink-0 text-fg-3">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  )
}

export function Artwork({ src, shape, title, size }: { src?: string; shape: 'wide' | 'square'; title?: string; size?: 'sm' | 'md' }) {
  const dims =
    size === 'sm'
      ? shape === 'wide'
        ? 'h-9 w-16'
        : 'size-9'
      : shape === 'wide'
        ? 'h-[99px] w-44'
        : 'size-[104px]'
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-sm bg-ink/[0.04] ring-1 ring-inset ring-ink/[0.08]', dims)}>
      {src ? (
        <img src={src} alt={title ? `Artwork for ${title}` : ''} className="size-full object-cover" draggable={false} />
      ) : (
        // No thumbnail from the site: a quiet placeholder instead of an empty box.
        <span className="flex size-full items-center justify-center text-fg-3">
          {shape === 'wide' ? <Clapperboard size={size === 'sm' ? 14 : 22} strokeWidth={1.5} /> : <Music2 size={size === 'sm' ? 14 : 22} strokeWidth={1.5} />}
        </span>
      )}
    </div>
  )
}

/** Same geometry as the finished panel (header + first options row), so nothing jumps when it arrives. */
export function MediaPreviewSkeleton({ shape }: { shape: 'wide' | 'square' }) {
  return (
    <div aria-busy aria-label="Analyzing link">
      <div className="flex items-center gap-5 p-5">
        <Skeleton className={shape === 'wide' ? 'h-[99px] w-44' : 'size-[104px]'} />
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="mt-1.5 h-2.5 w-1/2" />
        </div>
      </div>
      <div className="h-px bg-line" />
      <div className="flex flex-col gap-2 px-5 py-5">
        <Skeleton className="h-3 w-16" />
        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[46px] w-[88px]" />
          ))}
        </div>
      </div>
    </div>
  )
}
