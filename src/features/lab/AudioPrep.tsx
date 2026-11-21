import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, Check, Download, FolderOpen, Pause, Play, RotateCcw } from 'lucide-react'
import type { ExportPreset, ExportSettings, LabAudioInfo } from '@shared/types/lab'
import { cn, formatBytes } from '@/shared/lib/format'
import { fadeUp, t } from '@/shared/lib/motion'
import { api } from '@/shared/api'
import { Button } from '@/shared/ui/Button'
import { ProgressBar, Skeleton } from '@/shared/ui/Feedback'
import { Panel } from '@/shared/ui/Layout'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { Select } from '@/shared/ui/Select'
import { prepActions, prepKey, presetSettings, useLab } from './model'
import { labPlayer, useLabPlayer } from './player'
import { RegionEditor } from './RegionEditor'
import { TimeInput } from './TimeInput'
import { formatTime } from './format'

const LOSSY = new Set(['mp3', 'aac', 'opus', 'vorbis', 'wmav2', 'wmav1', 'ac3', 'eac3', 'amr_nb', 'amr_wb'])
const isLossy = (i?: LabAudioInfo) => !!i?.codec && LOSSY.has(i.codec)
const codecName = (i?: LabAudioInfo) => (i?.codec === 'aac' ? 'AAC' : i?.codec === 'vorbis' ? 'Vorbis' : i?.codec === 'opus' ? 'Opus' : (i?.codec ?? '').toUpperCase())

/** Audio Prep: trim, fade, set the level, and export a new file. The original is never touched. */
export function AudioPrep() {
  const lab = useLab()
  if (!lab.source) {
    return (
      <Intro>
        <p className="text-label text-fg-2">Choose a file above to trim it, add fades, set its level and export a new copy for your DAW. Your original file is never changed.</p>
      </Intro>
    )
  }
  if (lab.waveform.status !== 'done' || !lab.waveform.value) {
    return (
      <Intro>
        {lab.waveform.status === 'error' ? <p className="text-label text-danger">{lab.waveform.error}</p> : <Skeleton className="h-[140px] w-full" />}
      </Intro>
    )
  }
  return (
    <motion.div {...fadeUp} transition={t.base} className="flex flex-col gap-4">
      <TrimPanel />
      <LevelPanel />
      <ExportPanel />
    </motion.div>
  )
}

function Intro({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...fadeUp} transition={t.base}>
      <Panel solid>
        <div className="p-5">
          <h2 className="mb-2 text-section font-semibold">Audio Prep</h2>
          {children}
        </div>
      </Panel>
    </motion.div>
  )
}

// ---------------- Trim ----------------

function TrimPanel() {
  const lab = useLab()
  const p = useLabPlayer()
  const src = lab.source!
  const prep = lab.prep
  const dur = src.info.durationSec ?? lab.waveform.value!.durationSec
  const [listen, setListen] = useState<'original' | 'processed'>('original')
  const len = prep.end - prep.start
  const rate = src.info.sampleRateHz
  const stale = lab.preview.status === 'ready' && lab.preview.for !== prepKey(prep)
  const rendering = lab.preview.status === 'rendering'
  const playingSelection = p.playing && (p.mode === 'preview' || !!p.range)

  // Hearing the processed version, then changing a setting: go back to the original until asked again.
  useEffect(() => {
    if (stale && p.mode === 'preview') labPlayer.useSource()
  }, [stale, p.mode])

  const play = () => {
    if (playingSelection) return labPlayer.pause()
    if (listen === 'processed') void prepActions.playProcessed()
    else prepActions.playOriginal()
  }

  return (
    <Panel solid>
      <div className="p-5">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-section font-semibold">Trim</h2>
          <span className="tabular text-label text-fg-2">
            Selection <span className="font-medium text-fg">{formatTime(len, true)}</span>
            <span className="text-fg-3"> of {formatTime(dur, true)}</span>
          </span>
        </div>

        <RegionEditor
          sourceId={src.id}
          overview={lab.waveform.value!}
          region={prep}
          onRegion={(r) => prepActions.set(r)}
          fadeInMs={prep.fadeInMs}
          fadeOutMs={prep.fadeOutMs}
        />

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <TimeInput label="Start" value={prep.start} max={dur} onChange={(start) => prepActions.set({ start })} />
          <TimeInput label="End" value={prep.end} max={dur} onChange={(end) => prepActions.set({ end })} />
          <TimeInput label="Length" value={len} min={0.01} max={dur - prep.start} onChange={(l) => prepActions.set({ end: prep.start + l })} />
          <div className="flex items-center gap-1 pb-px">
            <Button size="sm" variant="ghost" onClick={() => prepActions.set({ start: labPlayer.time() })} title="Move the start to the playhead">
              Start at playhead
            </Button>
            <Button size="sm" variant="ghost" onClick={() => prepActions.set({ end: labPlayer.time() })} title="Move the end to the playhead">
              End at playhead
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={12} strokeWidth={1.75} />} onClick={prepActions.reset}>
              Reset
            </Button>
          </div>
        </div>
        {rate && (
          <p className="tabular mt-2 text-meta text-fg-3">
            Exports exactly samples {Math.round(prep.start * rate).toLocaleString()} – {Math.round(prep.end * rate).toLocaleString()} at {+(rate / 1000).toFixed(1)} kHz (
            {(Math.round(prep.end * rate) - Math.round(prep.start * rate)).toLocaleString()} samples).
          </p>
        )}

        {/* Listening: the raw selection, or the processed render the export is made from. */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button
            variant="primary"
            icon={playingSelection ? <Pause size={12} strokeWidth={0} fill="currentColor" /> : <Play size={12} strokeWidth={0} fill="currentColor" />}
            loading={rendering}
            disabled={(listen === 'original' && p.error) || (!p.src && listen === 'original')}
            onClick={play}
          >
            {rendering ? 'Preparing preview…' : playingSelection ? 'Pause' : 'Play selection'}
          </Button>
          <SegmentedControl<'original' | 'processed'>
            ariaLabel="What to listen to"
            size="sm"
            value={listen}
            onChange={(v) => {
              setListen(v)
              if (p.playing) {
                labPlayer.pause()
                setTimeout(() => (v === 'processed' ? void prepActions.playProcessed() : prepActions.playOriginal()), 0)
              }
            }}
            options={[
              { value: 'original', label: 'Original' },
              { value: 'processed', label: 'Processed' }
            ]}
          />
          {rendering && (
            <Button size="sm" variant="ghost" onClick={prepActions.cancelPreview}>
              Cancel
            </Button>
          )}
          <span className="min-w-0 flex-1 text-meta text-fg-3">
            {lab.preview.status === 'error'
              ? <span className="text-danger">{lab.preview.error}</span>
              : listen === 'processed'
                ? 'Processed = the exact trim, fades and gain the export uses (rendered as 16-bit WAV; format encoding not included).'
                : 'The selection as it is in the original file.'}
          </span>
        </div>
      </div>
    </Panel>
  )
}

// ---------------- Fades & level ----------------

const FADES = [0, 10, 50, 100, 250, 500]

function FadeField({ label, value, onChange, max }: { label: string; value: number; onChange: (ms: number) => void; max: number }) {
  const preset = FADES.includes(value)
  const [custom, setCustom] = useState(!preset)
  useEffect(() => {
    if (!FADES.includes(value)) setCustom(true)
  }, [value])
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label font-medium text-fg-2">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <SegmentedControl<number | 'custom'>
          ariaLabel={label}
          size="sm"
          value={custom ? 'custom' : value}
          onChange={(v) => {
            if (v === 'custom') return setCustom(true)
            setCustom(false)
            onChange(v)
          }}
          options={[
            ...FADES.map((ms) => ({ value: ms as number | 'custom', label: ms === 0 ? 'None' : `${ms} ms`, disabled: ms > max })),
            { value: 'custom' as const, label: 'Custom' }
          ]}
        />
        {custom && (
          <label className="flex h-7 items-center gap-1.5 rounded-sm border border-ink/[0.09] bg-ink/[0.025] px-2 focus-within:border-accent/55 focus-within:focus-halo">
            <input
              type="number"
              min={0}
              max={Math.min(60000, Math.floor(max))}
              step={1}
              value={value}
              onChange={(e) => onChange(Number(e.target.value) || 0)}
              aria-label={`${label} in milliseconds`}
              className="tabular w-16 bg-transparent text-label outline-none"
            />
            <span className="text-meta text-fg-3">ms</span>
          </label>
        )}
      </div>
    </div>
  )
}

function LevelPanel() {
  const lab = useLab()
  const prep = lab.prep
  const lenMs = (prep.end - prep.start) * 1000
  const fadesClamped = prep.fadeInMs + prep.fadeOutMs > lenMs
  const settings = presetSettings(lab.exportCfg.preset, lab.source?.info, lab.exportCfg.custom)
  const float = settings.format === 'wav' && settings.bitDepth === 32
  const lossy = settings.format === 'mp3' || settings.format === 'm4a'
  const peak = lab.peak.status === 'done' ? lab.peak.peakDb : undefined
  const after = peak != null ? peak + prep.gainDb : undefined

  let warning: { tone: 'danger' | 'warning'; text: string } | null = null
  if (after != null && after > 0) {
    warning = float
      ? { tone: 'warning', text: `Peaks will go about ${after.toFixed(1)} dB above 0 dBFS. The 32-bit float file keeps them, but they'll clip when played or converted to 16/24-bit unless turned down.` }
      : { tone: 'danger', text: `This will clip: peaks go about ${after.toFixed(1)} dB over full scale. Set gain to ${(-peak!).toFixed(1)} dB or lower to avoid it.` }
  } else if (after != null && lossy && after > -1) {
    warning = { tone: 'warning', text: 'Within 1 dB of full scale. MP3 and AAC encoding can push peaks slightly higher and clip. Lower the gain by 1 dB to be safe.' }
  }

  return (
    <Panel solid>
      <div className="p-5">
        <h2 className="mb-4 text-section font-semibold">Fades & level</h2>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <FadeField label="Fade in" value={prep.fadeInMs} max={lenMs} onChange={(fadeInMs) => prepActions.set({ fadeInMs })} />
          <FadeField label="Fade out" value={prep.fadeOutMs} max={lenMs} onChange={(fadeOutMs) => prepActions.set({ fadeOutMs })} />
        </div>
        <p className="mt-2 text-meta text-fg-3">
          {fadesClamped
            ? <span className="text-warning">The fades are longer than the selection; they'll be shortened to fit (fade-in first).</span>
            : 'Linear fades inside the selection. A 10 ms fade removes clicks at cut points; longer fades are for musical transitions.'}
        </p>

        <div className="mt-5 border-t border-line pt-5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-label font-medium text-fg-2">Gain</span>
            <span className="tabular text-meta text-fg-3">
              {lab.peak.status === 'measuring'
                ? 'Measuring peak…'
                : peak === null
                  ? 'Selection is silent'
                  : peak != null
                    ? `Selection peak ${peak.toFixed(1)} dBFS → ${after!.toFixed(1)} dBFS after gain (sample peak)`
                    : ''}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              type="range"
              min={-24}
              max={12}
              step={0.1}
              value={Math.max(-24, Math.min(12, prep.gainDb))}
              onChange={(e) => prepActions.set({ gainDb: Number(e.target.value) })}
              aria-label="Gain in decibels"
              className="lab-range h-1 min-w-[180px] flex-1 cursor-pointer accent-[var(--color-accent)]"
            />
            <label className="flex h-8 items-center gap-1.5 rounded-sm border border-ink/[0.09] bg-ink/[0.025] px-2 focus-within:border-accent/55 focus-within:focus-halo">
              <input
                type="number"
                min={-48}
                max={24}
                step={0.1}
                value={prep.gainDb}
                onChange={(e) => prepActions.set({ gainDb: Number(e.target.value) || 0 })}
                aria-label="Gain in dB"
                className="tabular w-14 bg-transparent text-body outline-none"
              />
              <span className="text-meta text-fg-3">dB</span>
            </label>
            <SegmentedControl<number>
              ariaLabel="Gain presets"
              size="sm"
              value={[-6, -3, 0, 3, 6].includes(prep.gainDb) ? prep.gainDb : Number.NaN}
              onChange={(gainDb) => prepActions.set({ gainDb })}
              options={[-6, -3, 0, 3, 6].map((v) => ({ value: v, label: v > 0 ? `+${v}` : String(v) }))}
            />
          </div>
          {warning ? (
            <p role="alert" className={cn('mt-2.5 flex items-start gap-1.5 text-label', warning.tone === 'danger' ? 'text-danger' : 'text-warning')}>
              <AlertTriangle size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              {warning.text}
            </p>
          ) : (
            <p className="mt-2.5 text-meta text-fg-3">Plain gain: no limiter, compression or normalization is added. Louder isn't better quality.</p>
          )}
        </div>
      </div>
    </Panel>
  )
}

// ---------------- Export ----------------

const PRESETS: { value: ExportPreset; label: string }[] = [
  { value: 'producer', label: 'Producer WAV' },
  { value: 'hq', label: 'High quality' },
  { value: 'mp3', label: 'Standard MP3' },
  { value: 'custom', label: 'Custom' }
]

function describe(x: ExportSettings, info?: LabAudioInfo): string {
  const rate = x.sampleRate === 'source' ? info?.sampleRateHz : x.sampleRate
  const ch = x.channels === 'source' ? info?.channels : x.channels
  const fmt =
    x.format === 'wav' ? `WAV · ${x.bitDepth === 32 ? '32-bit float' : `${x.bitDepth}-bit PCM`}` : x.format === 'flac' ? `FLAC · ${x.bitDepth}-bit lossless` : x.format === 'mp3' ? `MP3 · ${x.bitrateKbps} kbps CBR` : `M4A (AAC) · ${x.bitrateKbps} kbps`
  return [fmt, rate ? `${+(rate / 1000).toFixed(1)} kHz` : undefined, ch ? (ch === 1 ? 'Mono' : ch === 2 ? 'Stereo' : `${ch} ch`) : undefined].filter(Boolean).join(' · ')
}

function estimate(x: ExportSettings, info: LabAudioInfo | undefined, sec: number): string | undefined {
  const rate = x.sampleRate === 'source' ? info?.sampleRateHz : x.sampleRate
  const ch = x.channels === 'source' ? info?.channels : x.channels
  if (x.format === 'wav' && rate && ch) return formatBytes(rate * ch * (x.bitDepth / 8) * sec)
  if (x.format === 'mp3' || x.format === 'm4a') return formatBytes((x.bitrateKbps * 1000 * sec) / 8, true)
  return undefined // FLAC size depends on the music
}

const PRESET_NOTE: Record<ExportPreset, string> = {
  producer: 'Uncompressed 24-bit WAV at the source sample rate, for importing into FL Studio, Ableton, BandLab and most DAWs.',
  hq: "Lossless FLAC at the source's sample rate (and 16-bit when the source is 16-bit). Smaller than WAV, same audio.",
  mp3: '320 kbps MP3: small and plays almost anywhere. Lossy, so keep a WAV for production.',
  custom: 'Choose the format and settings yourself.'
}

function ExportPanel() {
  const lab = useLab()
  const info = lab.source!.info
  const { preset, custom } = lab.exportCfg
  const x = presetSettings(preset, info, custom)
  const len = lab.prep.end - lab.prep.start
  const ex = lab.exporting
  const rate = x.sampleRate === 'source' ? info.sampleRateHz : x.sampleRate
  const processed = lab.prep.start > 0.0005 || (info.durationSec != null && lab.prep.end < info.durationSec - 0.0005) || lab.prep.fadeInMs > 0 || lab.prep.fadeOutMs > 0 || lab.prep.gainDb !== 0
  const name = `${lab.source!.title}${processed ? ' (edit)' : ''}`

  const notes: string[] = []
  if (isLossy(info) && (x.format === 'wav' || x.format === 'flac'))
    notes.push(`The source is ${codecName(info)} (lossy). ${x.format.toUpperCase()} keeps exactly what's decoded, but can't bring back detail lost to compression.`)
  if (rate && info.sampleRateHz && rate > info.sampleRateHz) notes.push(`Raising the sample rate (${+(info.sampleRateHz / 1000).toFixed(1)} → ${+(rate / 1000).toFixed(1)} kHz) doesn't add detail; only use it if your project needs that rate.`)
  if (x.format === 'mp3' || x.format === 'm4a') notes.push(`${x.format === 'mp3' ? 'MP3' : 'AAC'} encoders add a few milliseconds of silence at the start, so the length isn't sample-exact. Use WAV or FLAC for loops and samples.`)
  if (x.format === 'wav' && x.bitDepth === 32) notes.push("32-bit float WAV keeps levels above 0 dBFS, but some programs and devices can't open it.")

  return (
    <Panel solid>
      <div className="p-5">
        <h2 className="mb-3 text-section font-semibold">Export</h2>
        <SegmentedControl<ExportPreset> ariaLabel="Export preset" value={preset} onChange={prepActions.setPreset} options={PRESETS} />
        <p className="mt-2 text-label text-fg-2">{PRESET_NOTE[preset]}</p>

        {preset === 'custom' && <CustomFields x={custom} info={info} />}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line bg-ink/[0.02] px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="tabular text-body font-medium">{describe(x, info)}</p>
            <p className="tabular mt-0.5 text-meta text-fg-3">
              {formatTime(len, true)} long{estimate(x, info, len) ? ` · about ${estimate(x, info, len)}` : ''} · re-encoded with FFmpeg (never a copy of the original)
            </p>
          </div>
          {ex.status === 'running' ? (
            <div className="flex w-[260px] items-center gap-3">
              <ProgressBar value={(ex.progress?.fraction ?? 0) * 100} className="flex-1" />
              <Button size="sm" variant="ghost" onClick={prepActions.cancelExport}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="solid" icon={<Download size={14} strokeWidth={1.75} />} onClick={() => void prepActions.exportNow(name)}>
              Export…
            </Button>
          )}
        </div>

        {notes.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {notes.map((n) => (
              <li key={n} className="text-meta text-fg-2">
                {n}
              </li>
            ))}
          </ul>
        )}

        {ex.status === 'error' && (
          <p role="alert" className="mt-3 text-label text-danger">
            Export failed: {ex.error}
          </p>
        )}
        {ex.status === 'done' && ex.value && (
          <div className="mt-3 flex items-center gap-3 rounded-sm bg-success/[0.07] px-3.5 py-2.5">
            <Check size={15} strokeWidth={2} className="shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium" title={ex.value.path}>
                {ex.value.name}
              </p>
              <p className="tabular text-meta text-fg-2">
                Checked:{' '}
                {[
                  ex.value.output.durationSec != null ? formatTime(ex.value.output.durationSec, true) : undefined,
                  ex.value.output.codec,
                  ex.value.output.bitDepth ? `${ex.value.output.bitDepth}-bit` : undefined,
                  ex.value.output.sampleRateHz ? `${+(ex.value.output.sampleRateHz / 1000).toFixed(1)} kHz` : undefined,
                  ex.value.output.channels === 1 ? 'Mono' : ex.value.output.channels === 2 ? 'Stereo' : undefined,
                  formatBytes(ex.value.output.sizeBytes)
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Button size="sm" variant="ghost" icon={<FolderOpen size={13} strokeWidth={1.75} />} onClick={() => void api.lab.revealExport(ex.value!.path)}>
              Show in folder
            </Button>
          </div>
        )}
      </div>
    </Panel>
  )
}

function CustomFields({ x, info }: { x: ExportSettings; info: LabAudioInfo }) {
  const lossless = x.format === 'wav' || x.format === 'flac'
  const srcRate = info.sampleRateHz ? `Source (${+(info.sampleRateHz / 1000).toFixed(1)} kHz)` : 'Source'
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Labeled label="Format">
        <SegmentedControl<ExportSettings['format']>
          ariaLabel="Format"
          size="sm"
          value={x.format}
          onChange={(format) => prepActions.setCustom({ format })}
          options={[
            { value: 'wav', label: 'WAV' },
            { value: 'flac', label: 'FLAC' },
            { value: 'mp3', label: 'MP3' },
            { value: 'm4a', label: 'M4A' }
          ]}
        />
      </Labeled>
      {lossless ? (
        <Labeled label="Bit depth">
          <SegmentedControl<ExportSettings['bitDepth']>
            ariaLabel="Bit depth"
            size="sm"
            value={x.bitDepth}
            onChange={(bitDepth) => prepActions.setCustom({ bitDepth })}
            options={[
              { value: 16, label: '16-bit' },
              { value: 24, label: '24-bit' },
              ...(x.format === 'wav' ? [{ value: 32 as const, label: '32-bit float' }] : [])
            ]}
          />
        </Labeled>
      ) : (
        <Labeled label="Bitrate">
          <SegmentedControl<ExportSettings['bitrateKbps']>
            ariaLabel="Bitrate"
            size="sm"
            value={x.bitrateKbps}
            onChange={(bitrateKbps) => prepActions.setCustom({ bitrateKbps })}
            options={[192, 256, 320].map((v) => ({ value: v as ExportSettings['bitrateKbps'], label: `${v} kbps` }))}
          />
        </Labeled>
      )}
      <Labeled label="Sample rate">
        <Select<string>
          ariaLabel="Sample rate"
          value={String(x.sampleRate)}
          onChange={(v) => prepActions.setCustom({ sampleRate: v === 'source' ? 'source' : (Number(v) as 44100 | 48000 | 96000) })}
          options={[
            { value: 'source', label: srcRate },
            { value: '44100', label: '44.1 kHz' },
            { value: '48000', label: '48 kHz' },
            ...(x.format === 'mp3' ? [] : [{ value: '96000', label: '96 kHz' }])
          ]}
          className="w-[200px]"
        />
      </Labeled>
      <Labeled label="Channels">
        <SegmentedControl<string>
          ariaLabel="Channels"
          size="sm"
          value={String(x.channels)}
          onChange={(v) => prepActions.setCustom({ channels: v === 'source' ? 'source' : (Number(v) as 1 | 2) })}
          options={[
            { value: 'source', label: info.channels === 1 ? 'Source (mono)' : info.channels === 2 ? 'Source (stereo)' : 'Source' },
            { value: '2', label: 'Stereo' },
            { value: '1', label: 'Mono' }
          ]}
        />
      </Labeled>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label font-medium text-fg-2">{label}</span>
      {children}
    </div>
  )
}

