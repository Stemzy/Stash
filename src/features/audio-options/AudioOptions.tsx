import { AnimatePresence, motion } from 'motion/react'
import { Info } from 'lucide-react'
import type { AudioFormat, AudioQuality } from '@shared/types/job'
import type { AudioStream } from '@shared/types/media'
import {
  AUDIO_FORMATS,
  BITRATES,
  BIT_DEPTHS,
  SAMPLE_RATES,
  canKeepOriginal,
  estimateAudioBytes
} from '@shared/audio-presets'
import { codecLabel, formatBytes, formatDuration } from '@/shared/lib/format'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { Select } from '@/shared/ui/Select'
import { Field } from '@/shared/ui/Layout'
import { t } from '@/shared/lib/motion'

/** Read-only facts about the source stream, kept apart from the output settings. */
export function SourceStreamInfo({ source }: { source?: AudioStream }) {
  if (!source) return null
  const parts = [
    codecLabel(source.acodec),
    source.bitrateKbps ? `~${source.bitrateKbps} kbps` : 'bitrate unknown',
    source.sampleRateHz ? `${source.sampleRateHz / 1000} kHz` : null,
    source.channels === 1 ? 'mono' : source.channels === 2 ? 'stereo' : null
  ].filter(Boolean)
  return (
    <p className="tabular text-meta text-fg-2">
      <span className="text-fg-3">Source audio </span>
      {parts.join(' · ')}
    </p>
  )
}

export function FormatSelector({ value, onChange }: { value: AudioFormat; onChange: (f: AudioFormat) => void }) {
  return (
    <SegmentedControl
      ariaLabel="Audio format"
      value={value}
      onChange={onChange}
      options={AUDIO_FORMATS.map((f) => ({ value: f.id, label: f.label }))}
    />
  )
}

interface QualityProps {
  format: AudioFormat
  quality: AudioQuality
  source?: AudioStream
  durationSec: number
  onChange: (q: AudioQuality) => void
}

/**
 * Changes with the format (plan section 6):
 * MP3 / M4A / Opus -> bitrate presets (+ "Original" when the codec matches the source).
 * FLAC / WAV       -> sample rate + bit depth (+ FLAC compression). No bitrates.
 */
export function QualitySelector(props: QualityProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={props.format === 'flac' || props.format === 'wav' ? `pcm-${props.format}` : `rate-${props.format}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        transition={t.fast}
      >
        {props.format === 'flac' || props.format === 'wav' ? <PcmQuality {...props} /> : <BitrateQuality {...props} />}
      </motion.div>
    </AnimatePresence>
  )
}

function BitrateQuality({ format, quality, source, durationSec, onChange }: QualityProps) {
  const rates = BITRATES[format as 'mp3' | 'm4a' | 'opus']
  const original = canKeepOriginal(format, source)
  const value = quality.mode === 'original' ? 'original' : quality.mode === 'bitrate' ? String(quality.kbps) : ''
  const sourceKbps = source?.bitrateKbps
  const aboveSource = quality.mode === 'bitrate' && sourceKbps != null && quality.kbps > sourceKbps

  const options = [
    ...(original
      ? [{ value: 'original', label: 'Original', detail: 'No re-encode · Best' }]
      : []),
    ...rates.map((k) => ({
      value: String(k),
      label: `${k} kbps`,
      detail: formatBytes(estimateAudioBytes(format, { mode: 'bitrate', kbps: k }, durationSec, source), true)
    }))
  ]

  return (
    <Field
      label="Quality"
      hint={
        <div className="flex flex-col gap-1">
          {quality.mode === 'original' && (
            <span>Keeps the exact source stream: lossless and instant.</span>
          )}
          {aboveSource && (
            <span className="inline-flex items-center gap-1.5">
              <Info size={12} strokeWidth={1.5} />
              Higher than the source (~{sourceKbps} kbps). The file gets bigger, not better.
            </span>
          )}
          {sourceKbps == null && <span>Source bitrate unknown.</span>}
        </div>
      }
    >
      <SegmentedControl
        ariaLabel="Bitrate"
        value={value}
        onChange={(v) => onChange(v === 'original' ? { mode: 'original' } : { mode: 'bitrate', kbps: Number(v) })}
        options={options}
      />
    </Field>
  )
}

function PcmQuality({ format, quality, source, durationSec, onChange }: QualityProps) {
  const q = quality.mode === 'pcm' ? quality : { mode: 'pcm' as const, sampleRateHz: 'source' as const, bitDepth: 16 as const }
  const depths = BIT_DEPTHS[format as 'flac' | 'wav']
  const resamples = q.sampleRateHz !== 'source' && source?.sampleRateHz != null && q.sampleRateHz !== source.sampleRateHz
  const est = estimateAudioBytes(format, q, durationSec, source)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <Field label="Sample rate" className="w-[230px]">
          <Select
            ariaLabel="Sample rate"
            value={q.sampleRateHz}
            onChange={(sampleRateHz) => onChange({ ...q, sampleRateHz })}
            options={SAMPLE_RATES.map((r) => ({
              value: r.value,
              label: r.value === 'source' && source?.sampleRateHz ? `Match source (${source.sampleRateHz / 1000} kHz)` : r.label
            }))}
          />
        </Field>
        <Field label="Bit depth">
          <SegmentedControl
            ariaLabel="Bit depth"
            value={q.bitDepth}
            onChange={(bitDepth) => onChange({ ...q, bitDepth })}
            options={depths.map((d) => ({ value: d.value, label: d.label, detail: d.hint }))}
          />
        </Field>
        {format === 'flac' && (
          <Field label="Compression" className="w-[200px]">
            <Select
              ariaLabel="FLAC compression level"
              value={q.flacLevel ?? 5}
              onChange={(flacLevel) => onChange({ ...q, flacLevel })}
              options={[0, 1, 2, 3, 4, 5, 6, 7, 8].map((l) => ({
                value: l,
                label: `Level ${l}`,
                hint: l === 0 ? 'Fastest' : l === 5 ? 'Default' : l === 8 ? 'Smallest' : undefined
              }))}
            />
          </Field>
        )}
      </div>
      <div className="flex flex-col gap-1 text-meta text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          <Info size={12} strokeWidth={1.5} className="shrink-0" />
          Lossless container. Preserves the decoded source exactly; does not restore detail lost in the original.
        </span>
        {resamples && <span className="text-warning">Resamples the audio from {source!.sampleRateHz! / 1000} kHz.</span>}
        <span className="tabular">
          About {formatBytes(est, true)} for {formatDuration(durationSec)}
        </span>
      </div>
    </div>
  )
}
