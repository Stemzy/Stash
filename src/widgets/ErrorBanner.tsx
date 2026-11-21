import { motion } from 'motion/react'
import { AlertCircle, Lock, ShieldOff, WifiOff, Globe, Ban, RefreshCw, ListVideo, Radio, Wrench } from 'lucide-react'
import type { MediaErrorCode } from '@shared/types/media'
import { Button } from '@/shared/ui/Button'
import { fadeUp, t } from '@/shared/lib/motion'

// Plain-language messages from the plan (section 5). One action each at most.
const COPY: Record<MediaErrorCode, { title: string; body: string; icon: typeof AlertCircle; action?: 'clear' | 'retry' }> = {
  INVALID_URL: {
    title: "That doesn't look like a link.",
    body: 'Paste a web address, like youtube.com/watch?v=… or a link copied from a share button.',
    icon: AlertCircle,
    action: 'clear'
  },
  UNSUPPORTED_SITE: {
    title: 'No video or audio found at this link.',
    body: "If it's a webpage, try the direct link to the file instead (right-click the video and choose Copy video address).",
    icon: Globe
  },
  ENCRYPTED: { title: "Mega links are encrypted and can't be downloaded here.", body: 'Download the file in your browser instead.', icon: Lock },
  DRM_PROTECTED: {
    title: "This video is copy-protected (DRM) and can't be downloaded.",
    body: "If it's your own upload, use the site's download option for creators (for example YouTube Studio → Download). If it should not be protected, run npm run fetch-binaries to update yt-dlp and try again.",
    icon: ShieldOff
  },
  AUTH_REQUIRED: { title: 'This video needs you to be signed in.', body: 'Private, members-only and age-restricted videos are not supported yet.', icon: Lock },
  UNAVAILABLE: { title: "This video isn't available.", body: 'It may have been removed or blocked in your region.', icon: Ban, action: 'retry' },
  NETWORK: { title: "Couldn't reach the site.", body: 'Check your connection and try again.', icon: WifiOff, action: 'retry' },
  EXTRACTOR_OUTDATED: {
    title: 'The site changed. An update may fix this.',
    body: 'Run npm run fetch-binaries to get the latest yt-dlp, then try again.',
    icon: RefreshCw,
    action: 'retry'
  },
  PLAYLIST: { title: "Playlists aren't supported yet.", body: 'Paste a link to a single video or track.', icon: ListVideo, action: 'clear' },
  LIVE: { title: "Live streams can't be downloaded while they're live.", body: 'Try again after the stream has ended.', icon: Radio },
  NO_MEDIA: {
    title: 'No video or audio found at this link.',
    body: "The link may point to a different kind of file, or the page doesn't contain a player.",
    icon: Ban
  },
  TOOLS_MISSING: {
    title: 'Media tools are missing.',
    body: 'Run npm run fetch-binaries in the project folder, then try again.',
    icon: Wrench,
    action: 'retry'
  },
  CANCELED: { title: 'Canceled.', body: '', icon: AlertCircle },
  UNKNOWN: { title: 'Something went wrong.', body: 'Try again. If it keeps happening, the link may not be supported.', icon: AlertCircle, action: 'retry' }
}

export function ErrorBanner({
  code,
  onClear,
  onRetry,
  suggestion
}: {
  code: MediaErrorCode
  onClear: () => void
  onRetry: () => void
  /** A likely typo fix for the link, e.g. ww. → www. */
  suggestion?: { link: string; onUse: () => void }
}) {
  const c = COPY[code]
  const Icon = c.icon
  return (
    <motion.div
      {...fadeUp}
      transition={t.base}
      role="alert"
      className="flex items-center gap-3 rounded-md border border-danger/20 bg-surface py-3 pl-3.5 pr-3 shadow-[inset_2px_0_0_var(--color-danger)]"
    >
      <Icon size={15} strokeWidth={1.75} className="shrink-0 self-start text-danger mt-px" />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">{suggestion ? "That address may have a typo." : c.title}</p>
        {c.body && !suggestion && <p className="mt-0.5 text-label text-fg-2">{c.body}</p>}
        {suggestion && (
          <p className="mt-0.5 text-label text-fg-2">
            Did you mean <span className="font-medium text-fg">{suggestion.link.replace(/^https?:\/\//, '')}</span>?
          </p>
        )}
      </div>
      {suggestion && (
        <Button size="sm" variant="primary" onClick={suggestion.onUse}>
          Use this link
        </Button>
      )}
      {c.action === 'clear' && (
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      )}
      {c.action === 'retry' && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </motion.div>
  )
}
