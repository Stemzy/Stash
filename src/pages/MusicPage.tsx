import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Music2 } from 'lucide-react'
import type { AudioFormat, AudioQuality } from '@shared/types/job'
import type { AudioStream, MediaInfo } from '@shared/types/media'
import { AUDIO_FORMATS, estimateAudioBytes, sanitizeQuality } from '@shared/audio-presets'
import { useAnalyze } from '@/features/analyze-link/useAnalyze'
import { FormatSelector, QualitySelector, SourceStreamInfo } from '@/features/audio-options/AudioOptions'
import { MediaPreview, MediaPreviewSkeleton } from '@/entities/media/MediaPreview'
import { enqueueReal, enqueueSimulated } from '@/entities/job/model'
import { isElectron } from '@/shared/api'
import { specSummary } from '@/entities/job/ui'
import { useSettings, updateSettings } from '@/entities/settings/model'
import { LinkInput } from '@/widgets/LinkInput'
import { suggestLinkFix } from '@shared/link'
import { ErrorBanner } from '@/widgets/ErrorBanner'
import { DestinationPicker, DownloadAction, DownloadSummary, FilenameField } from '@/widgets/DownloadControls'
import { RecentDownloads } from '@/widgets/RecentDownloads'
import { setPageArtwork } from '@/widgets/AmbientBackdrop'
import { formatBytes, sanitizeFilename, shortPath } from '@/shared/lib/format'
import { navigate } from '@/shared/model/navigation'
import { notify } from '@/shared/ui/toast'
import { t } from '@/shared/lib/motion'
import { EmptyState } from '@/shared/ui/Feedback'
import { Divider, Field, Page, PageHeader, Panel } from '@/shared/ui/Layout'

const CODEC: Partial<Record<AudioFormat, string>> = { m4a: 'aac', opus: 'opus', mp3: 'mp3' }

/** Use the stream whose codec matches the output (so "Original" is possible), else the best one. */
function sourceFor(media: MediaInfo, format: AudioFormat): AudioStream | undefined {
  const match = media.audioStreams.find((a) => a.acodec === CODEC[format])
  return match ?? [...media.audioStreams].sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0))[0]
}

export function MusicPage() {
  const { state, analyze, cancel, reset, pulse } = useAnalyze('audio')
  const settings = useSettings()
  const [link, setLink] = useState('')
  const [lastUrl, setLastUrl] = useState('')
  const [format, setFormat] = useState<AudioFormat>('mp3')
  // Each format remembers its own quality, so switching back and forth keeps choices.
  const [qualities, setQualities] = useState<Partial<Record<AudioFormat, AudioQuality>>>({})
  const [filename, setFilename] = useState('')

  const media = state.status === 'ready' ? state.media : undefined
  const source = media ? sourceFor(media, format) : undefined
  const quality = useMemo(() => sanitizeQuality(format, qualities[format], source), [format, qualities, source])
  const ext = AUDIO_FORMATS.find((f) => f.id === format)!.ext

  useEffect(() => {
    if (media) setFilename(sanitizeFilename(`${media.creator ? `${media.creator} - ` : ''}${media.title}`))
  }, [media])

  useEffect(() => setPageArtwork('music', media?.thumbnailUrl), [media])

  // A typo like ww.youtube.com: offer the corrected link with the error.
  const fix = state.status === 'error' && state.code !== 'INVALID_URL' ? suggestLinkFix(lastUrl) : null

  const run = (url: string) => {
    setLastUrl(url)
    analyze(url)
  }
  const clear = () => {
    setLink('')
    setFilename('')
    reset()
  }

  const est = media ? estimateAudioBytes(format, quality, media.durationSec ?? 0, source) : undefined

  const [starting, setStarting] = useState(false)

  const download = async () => {
    if (!media) return
    const name = sanitizeFilename(filename) || 'audio'
    if (!isElectron) {
      // Plain-browser preview has no main process: keep the old simulation.
      enqueueSimulated({
        source: media,
        spec: { kind: 'audio', format, quality },
        output: { directory: settings.folders.music, filename: `${name}.${ext}`, sizeBytes: est }
      })
      notify({ tone: 'info', title: 'Added to queue (simulated)', body: 'Browser preview: no file will be written.' })
      clear()
      return
    }
    setStarting(true)
    const err = await enqueueReal(
      {
        kind: 'audio',
        req: {
          url: media.url,
          sourceFormatId: source?.formatId,
          spec: { kind: 'audio', format, quality },
          directory: settings.folders.music,
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
      body: `Saving to ${shortPath(settings.folders.music, 34)}`,
      action: { label: 'View queue', run: () => navigate('queue') }
    })
    clear()
  }

  return (
    <Page>
      <PageHeader title="Music" subtitle="Save the audio from a link, in the format you choose." />

      <LinkInput
        value={link}
        onValueChange={setLink}
        placeholder="Paste any audio or video link: SoundCloud, YouTube, a direct .mp3, Dropbox…"
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
              icon={<Music2 size={18} strokeWidth={1.5} />}
              title="Paste a link to get started"
              body="You'll see the artwork and the source audio quality before choosing a format."
            />
          )}
          {state.status === 'analyzing' && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.fast}>
              <Panel solid>
                <MediaPreviewSkeleton shape="square" />
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
                <MediaPreview media={media} shape="square" footer={<SourceStreamInfo source={source} />} />
                <Divider />
                <div className="flex flex-col gap-5 p-5">
                  <Field label="Format">
                    <FormatSelector value={format} onChange={setFormat} />
                  </Field>
                  <QualitySelector
                    format={format}
                    quality={quality}
                    source={source}
                    durationSec={media.durationSec ?? 0}
                    onChange={(q) => setQualities((all) => ({ ...all, [format]: q }))}
                  />
                </div>
                <Divider />
                <div className="flex flex-col gap-4 p-5">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="File name">
                      <FilenameField value={filename} ext={ext} onChange={setFilename} />
                    </Field>
                    <Field label="Save to">
                      <DestinationPicker path={settings.folders.music} onChange={(music) => updateSettings({ folders: { ...settings.folders, music } })} />
                    </Field>
                  </div>
                  <DownloadAction
                    label="Download Audio"
                    disabled={!sanitizeFilename(filename) || starting}
                    onDownload={() => void download()}
                    summary={
                      <DownloadSummary
                        size={formatBytes(est, true)}
                        parts={[specSummary({ spec: { kind: 'audio', format, quality } }), `to ${shortPath(settings.folders.music, 30)}`]}
                      />
                    }
                  />
                </div>
              </Panel>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <RecentDownloads kind="audio" />
    </Page>
  )
}
