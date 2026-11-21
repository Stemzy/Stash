import type { AudioStream, MediaInfo, VideoStream } from '@shared/types/media'
import type { VideoContainer } from '@shared/types/job'
import { codecLabel, formatBytes, resolutionLabel } from '@/shared/lib/format'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { Field } from '@/shared/ui/Layout'

export interface VideoChoice {
  height: number
  container: VideoContainer
}

/**
 * MP4 is offered when there is an H.264 stream at this resolution (plays everywhere),
 * or when the site's only stream is already an MP4 file with unknown codecs.
 */
export function mp4Allowed(v?: VideoStream): boolean {
  if (!v) return false
  return v.vcodec === 'h264' || !!v.mp4Alt || (v.vcodec === 'unknown' && v.ext === 'mp4')
}

/** The stream actually used: for MP4, the H.264 variant at the same height. */
export function effectiveVideo(v: VideoStream | undefined, container: VideoContainer): VideoStream | undefined {
  if (!v || container !== 'mp4' || !v.mp4Alt) return v
  return { ...v, formatId: v.mp4Alt.formatId, vcodec: v.mp4Alt.vcodec, ext: 'mp4', fps: v.mp4Alt.fps ?? v.fps, sizeBytes: v.mp4Alt.sizeBytes, mp4Alt: undefined }
}

export function heightLabel(h: number): string {
  if (h === 0) return 'Original'
  return h >= 2160 ? resolutionLabel(h) : `${h}p`
}

export function pickStreams(media: MediaInfo, choice: VideoChoice): { video?: VideoStream; audio?: AudioStream } {
  const video = effectiveVideo(media.videoStreams.find((s) => s.height === choice.height), choice.container)
  if (video?.hasAudio) return { video } // progressive stream: audio is already inside
  // MP4 pairs best with AAC; MKV takes the highest-quality audio as-is.
  const byRate = [...media.audioStreams].sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0))
  const own = byRate.filter((a) => !a.fromMuxed)
  const audio = choice.container === 'mp4' ? own.find((a) => a.acodec === 'aac') ?? own[0] : own[0]
  return { video, audio }
}

export function estimateVideoBytes(media: MediaInfo, choice: VideoChoice): number | undefined {
  const { video, audio } = pickStreams(media, choice)
  if (!video?.sizeBytes) return undefined
  const audioBytes = audio ? audio.sizeBytes ?? ((audio.bitrateKbps ?? 128) * 1000 * (media.durationSec ?? 0)) / 8 : 0
  return video.sizeBytes + audioBytes
}

/** "Fetches AV1 2160p60 + Opus 160 kbps · merged, no re-encode" */
export function FetchLine({ media, choice }: { media: MediaInfo; choice: VideoChoice }) {
  const { video, audio } = pickStreams(media, choice)
  if (!video) return null
  const res = video.height ? ` ${video.height}p${video.fps ?? ''}` : ''
  return (
    <p className="tabular text-meta text-fg-2">
      <span className="text-fg-3">Fetches </span>
      {codecLabel(video.vcodec)}
      {res}
      {audio && ` + ${codecLabel(audio.acodec)}${audio.bitrateKbps ? ` ${audio.bitrateKbps} kbps` : ''}`}
      {audio ? ' · merged, no re-encode' : video.hasAudio ? ' · video and audio in one stream' : ''}
    </p>
  )
}

export function VideoOptions({
  media,
  value,
  onChange
}: {
  media: MediaInfo
  value: VideoChoice
  onChange: (v: VideoChoice) => void
}) {
  const streams = [...media.videoStreams].sort((a, b) => b.height - a.height)
  const current = streams.find((s) => s.height === value.height)
  const canMp4 = mp4Allowed(current)

  return (
    <div className="flex flex-col gap-5 px-5 py-5">
      <Field label="Resolution">
        <SegmentedControl
          ariaLabel="Resolution"
          value={value.height}
          onChange={(height) => {
            const s = streams.find((x) => x.height === height)
            // Switch to MKV automatically if MP4 isn't possible at this resolution.
            onChange({ height, container: value.container === 'mp4' && !mp4Allowed(s) ? 'mkv' : value.container })
          }}
          options={streams.map((s, i) => {
            const label = heightLabel(s.height)
            const est = estimateVideoBytes(media, { height: s.height, container: value.container })
            const detail = [s.height >= 2160 ? `${s.height}p` : null, s.fps ? `${s.fps}fps` : null, formatBytes(est, true)]
              .filter((x) => x && x !== '—')
              .join(' · ')
            return {
              value: s.height,
              label: i === 0 && streams.length > 1 ? <>{label} <span className="font-normal text-fg-2">· Best</span></> : label,
              detail: detail || undefined
            }
          })}
        />
      </Field>
      <Field
        label="Format"
        hint={
          !canMp4 && current ? (
            current.vcodec === 'unknown' ? (
              <>The site doesn't say which codec this video uses, so MKV is the safe choice.</>
            ) : (
              <>This quality uses {codecLabel(current.vcodec)} video, which many players can't open as MP4. MKV keeps it as-is.</>
            )
          ) : undefined
        }
      >
        <SegmentedControl
          ariaLabel="Output format"
          value={value.container}
          onChange={(container) => onChange({ ...value, container })}
          options={[
            {
              value: 'mp4' as const,
              label: 'MP4',
              disabled: !canMp4,
              reason: canMp4 ? undefined : `${codecLabel(current?.vcodec ?? '')} at this resolution: choose MKV, or a resolution with H.264.`
            },
            { value: 'mkv' as const, label: 'MKV' }
          ]}
        />
      </Field>
    </div>
  )
}
