import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Clapperboard } from 'lucide-react'
import { useAnalyze } from '@/features/analyze-link/useAnalyze'
import { VideoOptions, FetchLine, estimateVideoBytes, mp4Allowed, pickStreams, type VideoChoice } from '@/features/video-options/VideoOptions'
import { MediaPreview, MediaPreviewSkeleton } from '@/entities/media/MediaPreview'
import { enqueueReal, enqueueSimulated } from '@/entities/job/model'
import { isElectron } from '@/shared/api'
import { useSettings, updateSettings } from '@/entities/settings/model'
import { LinkInput } from '@/widgets/LinkInput'
import { suggestLinkFix } from '@shared/link'
import { ErrorBanner } from '@/widgets/ErrorBanner'
import { DestinationPicker, DownloadAction, DownloadSummary } from '@/widgets/DownloadControls'
import { RecentDownloads } from '@/widgets/RecentDownloads'
import { setPageArtwork } from '@/widgets/AmbientBackdrop'
import { formatBytes, sanitizeFilename, shortPath } from '@/shared/lib/format'
import { navigate } from '@/shared/model/navigation'
import { notify } from '@/shared/ui/toast'
import { t } from '@/shared/lib/motion'
import { EmptyState } from '@/shared/ui/Feedback'
import { Divider, Field, Page, PageHeader, Panel } from '@/shared/ui/Layout'

export function VideosPage() {
  const { state, analyze, cancel, reset, pulse } = useAnalyze('video')
  const settings = useSettings()
  const [link, setLink] = useState('')
  const [choice, setChoice] = useState<VideoChoice>({ height: 0, container: 'mp4' })
  const [lastUrl, setLastUrl] = useState('')

  const media = state.status === 'ready' ? state.media : undefined

  // Best available resolution by default; keep MP4 when it's possible.
  useEffect(() => {
    if (!media) return
    const best = [...media.videoStreams].sort((a, b) => b.height - a.height)[0]
    if (best) setChoice((c) => ({ height: best.height, container: c.container === 'mp4' && !mp4Allowed(best) ? 'mkv' : c.container }))
  }, [media])

  useEffect(() => setPageArtwork('videos', media?.thumbnailUrl), [media])

  // A typo like ww.youtube.com: offer the corrected link with the error.
  const fix = state.status === 'error' && state.code !== 'INVALID_URL' ? suggestLinkFix(lastUrl) : null

  const run = (url: string) => {
    setLastUrl(url)
    analyze(url)
  }
  const clear = () => {
    setLink('')
    reset()
  }

  const [starting, setStarting] = useState(false)

  const download = async () => {
    if (!media) return
    const name = sanitizeFilename(`${media.creator ? `${media.creator} - ` : ''}${media.title}`) || 'video'
    if (!isElectron) {
      // Plain-browser preview has no main process: keep the simulation.
      enqueueSimulated({
        source: media,
        spec: { kind: 'video', height: choice.height, container: choice.container },
        output: { directory: settings.folders.videos, filename: `${name}.${choice.container}`, sizeBytes: estimateVideoBytes(media, choice) }
      })
      notify({ tone: 'info', title: 'Added to queue (simulated)', body: 'Browser preview: no file will be written.' })
      clear()
      return
    }
    const { video, audio } = pickStreams(media, choice)
    setStarting(true)
    const err = await enqueueReal(
      {
        kind: 'video',
        req: {
          url: media.url,
          spec: { kind: 'video', height: choice.height, container: choice.container },
          videoFormatId: video?.formatId,
          audioFormatId: video?.hasAudio ? undefined : audio?.formatId,
          expectedBytes: { video: video?.sizeBytes, audio: audio?.sizeBytes },
          directory: settings.folders.videos,
          filename: name,
          meta: { title: media.title, creator: media.creator, durationSec: media.durationSec, extractor: media.extractor }
        }
      },
      media.thumbnailUrl
    )
    setStarting(false)
    if (err) {
      notify({ tone: 'error', title: "Couldn't start the download", body: err })
      return
    }
    notify({
      tone: 'info',
      title: 'Added to queue',
      body: `Saving to ${shortPath(settings.folders.videos, 34)}`,
      action: { label: 'View queue', run: () => navigate('queue') }
    })
    clear()
  }

  const est = media ? estimateVideoBytes(media, choice) : undefined

  return (
    <Page>
      <PageHeader title="Videos" subtitle="Paste a link to download a video." />

      <LinkInput
        value={link}
        onValueChange={setLink}
        placeholder="Paste any video link: YouTube, TikTok, a direct .mp4, Dropbox, Google Drive…"
        analyzing={state.status === 'analyzing'}
        canCancel={state.status === 'analyzing' && state.slow}
        onAnalyze={run}
        onCancel={cancel}
        onClear={clear}
        pulse={pulse}
      />

      <div className="mt-4">
        <AnimatePresence mode="wait" initial={false}>
          {state.status === 'idle' && (
            <EmptyState
              key="idle"
              icon={<Clapperboard size={18} strokeWidth={1.5} />}
              title="Paste a link to get started"
              body="You'll see the title, creator and every available resolution before anything downloads."
            />
          )}
          {state.status === 'analyzing' && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.fast}>
              <Panel solid>
                <MediaPreviewSkeleton shape="wide" />
              </Panel>
            </motion.div>
          )}
          {state.status === 'error' && (
            <ErrorBanner
              key="error"
              code={state.code}
              onClear={clear}
              onRetry={() => run(lastUrl)}
              suggestion={
                fix
                  ? {
                      link: fix,
                      onUse: () => {
                        setLink(fix)
                        run(fix)
                      }
                    }
                  : undefined
              }
            />
          )}
          {media && (
            <motion.div key={media.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={t.base}>
              <Panel solid className="overflow-visible">
                <MediaPreview media={media} shape="wide" footer={choice.height > 0 && <FetchLine media={media} choice={choice} />} />
                <Divider />
                {choice.height > 0 && <VideoOptions media={media} value={choice} onChange={setChoice} />}
                <Divider />
                <div className="flex flex-col gap-4 p-5">
                  <Field label="Save to">
                    <DestinationPicker path={settings.folders.videos} onChange={(videos) => updateSettings({ folders: { ...settings.folders, videos } })} />
                  </Field>
                  <DownloadAction
                    label="Download"
                    disabled={starting}
                    onDownload={() => void download()}
                    summary={
                      <DownloadSummary size={formatBytes(est, true)} parts={[choice.container.toUpperCase(), `to ${shortPath(settings.folders.videos, 30)}`]} />
                    }
                  />
                </div>
              </Panel>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <RecentDownloads kind="video" />
    </Page>
  )
}
