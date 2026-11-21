import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, HelpCircle, Pause, Pencil, Play, RotateCcw, Undo2 } from 'lucide-react'
import type { KeyAlternative, KeyAnalysis, KeyCandidate, KeyMode, KeyReason, TempoAnalysis } from '@shared/types/lab'
import { defaultSpelling, isEnharmonicRoot, keyName, modeLabel, noteText, pcNameInKey, relativeOf, rootName, scaleNotes, type Spelling } from '@shared/music'
import { bpmText } from '@shared/tempo'
import { cn, formatRelative } from '@/shared/lib/format'
import { fadeUp, t } from '@/shared/lib/motion'
import { Button } from '@/shared/ui/Button'
import { ProgressBar } from '@/shared/ui/Feedback'
import { Panel } from '@/shared/ui/Layout'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { notify } from '@/shared/ui/toast'
import { labActions, tempoActions, useLab } from './model'
import { labPlayer, useLabPlayer } from './player'
import { formatTime } from './format'

type Draft = { tonic: number; mode: KeyMode; spelling: Spelling }

/**
 * Key & BPM: both are found automatically when a file opens and shown side by side.
 * "Not sure?" takes the same file to the Tempo tab to tap or adjust the BPM; whatever
 * is set there shows here too.
 */
export function KeyFinder() {
  const lab = useLab()
  const [draft, setDraft] = useState<Draft | null>(null)
  const a = lab.key.value

  // A new file starts fresh.
  useEffect(() => setDraft(null), [lab.source?.id])

  if (!lab.source) {
    return (
      <motion.div {...fadeUp} transition={t.base}>
        <Panel solid>
          <div className="p-5">
            <h2 className="mb-2 text-section font-semibold">Key & BPM</h2>
            <p className="text-label text-fg-2">Choose a file above. Its key and BPM are found automatically.</p>
          </div>
        </Panel>
      </motion.div>
    )
  }

  const keyShown: KeyCandidate | Draft | undefined = draft ?? lab.user.key ?? a?.best
  const spelling: Spelling | undefined = draft?.spelling ?? lab.user.key?.spelling ?? (a?.best ? defaultSpelling(a.best.tonic, a.best.mode) : undefined)
  const startEdit = (k?: { tonic: number; mode: KeyMode }) => {
    const base = k ?? lab.user.key ?? a?.best ?? { tonic: 0, mode: 'minor' as KeyMode }
    setDraft({ tonic: base.tonic, mode: base.mode, spelling: defaultSpelling(base.tonic, base.mode) })
  }
  const busy = lab.key.status === 'running' || lab.tempo.status === 'running'
  const analyzedAt = a?.analyzedAt ?? lab.tempo.value?.analyzedAt

  return (
    <motion.div {...fadeUp} transition={t.base} className="flex flex-col gap-4">
      <Panel solid>
        <div className="p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <KeyCard draft={draft} onEdit={() => startEdit()} />
            <BpmCard />
          </div>
          <BothRow keyText={!draft && keyShown && spelling ? keyName(keyShown, spelling, true) : undefined} />
          {draft && (
            <div className="mt-5 border-t border-line pt-5">
              <Editor draft={draft} setDraft={setDraft} />
            </div>
          )}
          {a && (
            <div className="mt-5 border-t border-line pt-4">
              <PitchClasses chroma={a.chroma} k={keyShown} spelling={spelling} />
            </div>
          )}
        </div>
      </Panel>

      {!draft && a && a.alternatives.length > 0 && (
        <Panel solid>
          <div className="p-5">
            <h3 className="text-body font-semibold">{a.status === 'inconclusive' ? 'Weak key leads' : 'Other possible keys'}</h3>
            <p className="mt-0.5 text-label text-fg-2">
              {a.status === 'inconclusive'
                ? "Not reliable. Shown only as a starting point if you're setting the key by ear."
                : a.keyChange
                  ? 'The relative key, and the keys other sections point to.'
                  : 'Listed by how well they fit, best first.'}
            </p>
            <div className="mt-3 flex flex-col">
              {a.alternatives.map((alt) => (
                <AltRow key={`${alt.tonic}${alt.mode}`} alt={alt} best={a.best} ranked={!a.keyChange} onUse={() => startEdit(alt)} />
              ))}
            </div>
          </div>
        </Panel>
      )}

      {!draft && a && a.sections.length > 1 && <Sections a={a} />}

      <div className="flex items-center justify-between px-1 text-meta text-fg-3">
        <span>
          {busy ? 'Analyzing…' : analyzedAt ? `${lab.key.cached ? 'Analyzed earlier' : 'Analyzed'} ${formatRelative(analyzedAt)}` : ''}
          {a && Math.abs(a.tuningCents) >= 3 && ` · Tuning ${a.tuningCents > 0 ? '+' : ''}${Math.round(a.tuningCents)} cents from A440`}
          {(lab.user.key || lab.user.tempo) && ' · Your changes are saved with this file in LAB (the file itself isn’t changed)'}
        </span>
        <span className="flex items-center gap-1">
          {busy ? (
            <Button size="sm" variant="ghost" onClick={labActions.cancel}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={12} strokeWidth={1.75} />} onClick={() => void labActions.analyzeKey(true)}>
              Analyze again
            </Button>
          )}
        </span>
      </div>
    </motion.div>
  )
}

const STATUS: Record<KeyAnalysis['status'], { label: string; dot: string }> = {
  clear: { label: 'Clear tonal center', dot: 'bg-success' },
  estimated: { label: 'Estimated · worth a listen', dot: 'bg-warning' },
  inconclusive: { label: 'Inconclusive', dot: 'bg-fg-3' }
}
const TEMPO_STATUS: Record<TempoAnalysis['status'], { label: string; dot: string }> = {
  strong: { label: 'Steady beat', dot: 'bg-success' },
  ambiguous: { label: 'Could also be half/double time', dot: 'bg-warning' },
  uncertain: { label: 'Estimated · worth checking', dot: 'bg-warning' }
}

function reasonText(r: KeyReason, a: KeyAnalysis): string {
  const rel = a.best ? keyName(relativeOf(a.best)) : ''
  const second = a.alternatives.find((x) => x.relation !== 'relative')
  switch (r) {
    case 'relative-close':
      return `${rel} fits almost as well (same notes, different home note).`
    case 'neighbor-close':
      return `${second ? keyName(second) : 'Another key'} fits nearly as well.`
    case 'key-change':
      return 'The key seems to change during the track. See the sections below.'
    case 'short':
      return 'A short clip gives little to go on.'
    case 'silent':
      return 'The audio is silent.'
    case 'little-tonal':
      return "Not enough melody, bass or harmony to name a key (common with drum loops and speech)."
    case 'weak-match':
    case 'flat-notes':
      return "The notes don't point clearly to one major or minor key."
  }
}

/** One half of the result: a label, the big value, its status, and buttons. */
function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="flex min-h-[168px] flex-col rounded-md border border-line bg-ink/[0.02] p-4">
      {children}
    </section>
  )
}

function Big({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.p
        key={value}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={t.base}
        className={cn('mt-1 text-[34px] font-semibold leading-[40px] tracking-[-0.015em]', muted && 'text-fg-2')}
        data-testid="big-value"
      >
        {value}
      </motion.p>
    </AnimatePresence>
  )
}

function Working({ text, fraction }: { text: string; fraction?: number }) {
  return (
    <div className="mt-3 flex flex-1 flex-col justify-center gap-2.5">
      <span className="h-9 w-40 animate-pulse rounded-sm bg-ink/[0.07]" aria-hidden />
      <span className="text-label text-fg-2">{text}</span>
      <ProgressBar value={(fraction ?? 0) * 100} indeterminate={fraction == null} className="max-w-[220px]" />
    </div>
  )
}

function KeyCard({ draft, onEdit }: { draft: Draft | null; onEdit: () => void }) {
  const lab = useLab()
  const task = lab.key
  const a = task.value
  const mine = lab.user.key
  const shown = draft ?? mine ?? a?.best
  const spelling = draft?.spelling ?? mine?.spelling ?? (a?.best ? defaultSpelling(a.best.tonic, a.best.mode) : undefined)
  const status = a ? STATUS[a.status] : undefined
  const reason = a && a.status !== 'clear' ? a.reasons[0] : undefined

  return (
    <Card label="Key">
      <p className="text-label font-medium text-fg-2">{draft ? 'Choosing a key' : mine ? 'Key · set by you' : 'Key'}</p>
      {task.status === 'running' && !shown ? (
        <Working text={task.progress?.stage === 'analyzing' ? 'Listening for notes and chords…' : 'Reading audio…'} fraction={task.progress?.fraction} />
      ) : task.status === 'error' && !shown ? (
        <div className="mt-3 flex flex-1 flex-col items-start gap-3">
          <p role="alert" className="text-label text-danger">
            {task.error}
          </p>
          <Button size="sm" onClick={() => void labActions.analyzeKey(true)}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Big value={shown && spelling ? keyName(shown, spelling) : a ? 'No clear key' : '—'} muted={!shown} />
          <div className="mt-1.5 flex-1">
            {mine && !draft ? (
              <p className="text-label text-fg-2">Detected: {a?.best ? keyName(a.best) : 'no clear key'}</p>
            ) : status && !draft ? (
              <>
                <p className="flex items-center gap-2 text-label text-fg">
                  <span className={cn('size-1.5 rounded-full', status.dot)} aria-hidden />
                  {status.label}
                </p>
                {reason && a && <p className="mt-1 text-meta text-fg-2">{reasonText(reason, a)}</p>}
              </>
            ) : null}
          </div>
          {!draft && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {shown && spelling && <CopyButton k={shown} spelling={spelling} />}
              <Button size="sm" variant="ghost" icon={<Pencil size={13} strokeWidth={1.75} />} onClick={onEdit}>
                {shown ? 'Change' : 'Set key'}
              </Button>
              {mine && (
                <Button size="sm" variant="ghost" icon={<Undo2 size={12} strokeWidth={1.75} />} onClick={() => void labActions.confirmKey(undefined)}>
                  Use detected
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function BpmCard() {
  const lab = useLab()
  const task = lab.tempo
  const a = task.value
  const mine = lab.user.tempo
  const bpm = lab.tempoWork?.bpm
  const status = a ? TEMPO_STATUS[a.status] : undefined
  const [copied, setCopied] = useState(false)

  return (
    <Card label="BPM">
      <p className="text-label font-medium text-fg-2">{mine ? 'BPM · set by you' : 'BPM'}</p>
      {task.status === 'running' && bpm == null ? (
        <Working text="Finding the beat…" fraction={task.progress?.stage === 'analyzing' ? task.progress.fraction : undefined} />
      ) : task.status === 'error' && bpm == null ? (
        <div className="mt-3 flex flex-1 flex-col items-start gap-3">
          <p role="alert" className="text-label text-danger">
            {task.error}
          </p>
          <Button size="sm" onClick={() => void tempoActions.analyze(true)}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Big value={bpm != null ? `${bpmText(bpm)} BPM` : a ? 'No beat found' : '—'} muted={bpm == null} />
          <div className="mt-1.5 flex-1">
            {mine ? (
              <p className="text-label text-fg-2">Detected: {a?.bpm != null ? `${bpmText(a.bpm)} BPM` : 'no beat found'}</p>
            ) : bpm == null && a ? (
              <p className="text-label text-fg-2">There’s no beat to measure in this audio. Tap along on the Tempo tab to set one.</p>
            ) : status ? (
              <p className="flex items-center gap-2 text-label text-fg">
                <span className={cn('size-1.5 rounded-full', status.dot)} aria-hidden />
                {status.label}
              </p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {bpm != null && (
              <Button
                size="sm"
                icon={copied ? <Check size={13} strokeWidth={2} className="text-success" /> : <Copy size={13} strokeWidth={1.75} />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(bpmText(bpm))
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1400)
                  } catch {
                    notify({ tone: 'error', title: "Couldn't copy", body: bpmText(bpm) })
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy BPM'}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<HelpCircle size={13} strokeWidth={1.75} />} onClick={() => labActions.setTool('tempo')}>
              Not sure?
            </Button>
            {mine && (
              <Button size="sm" variant="ghost" icon={<Undo2 size={12} strokeWidth={1.75} />} onClick={() => void tempoActions.unconfirm()}>
                Use detected
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

/** "C# Minor, 140 BPM" in one click. */
function BothRow({ keyText }: { keyText?: string }) {
  const lab = useLab()
  const bpm = lab.tempoWork?.bpm
  const [copied, setCopied] = useState(false)
  if (!keyText || bpm == null) return null
  const text = `${keyText}, ${bpmText(bpm)} BPM`
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <span className="tabular text-meta text-fg-3">{text}</span>
      <Button
        size="sm"
        variant="ghost"
        icon={copied ? <Check size={13} strokeWidth={2} className="text-success" /> : <Copy size={13} strokeWidth={1.75} />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          } catch {
            notify({ tone: 'error', title: "Couldn't copy", body: text })
          }
        }}
      >
        {copied ? 'Copied' : 'Copy both'}
      </Button>
    </div>
  )
}

function CopyButton({ k, spelling }: { k: { tonic: number; mode: KeyMode }; spelling: Spelling }) {
  const [done, setDone] = useState(false)
  const text = keyName(k, spelling, true) // "Eb Minor": typeable in any DAW's notes field
  return (
    <Button
      size="sm"
      icon={done ? <Check size={13} strokeWidth={2} className="text-success" /> : <Copy size={13} strokeWidth={1.75} />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } catch {
          notify({ tone: 'error', title: "Couldn't copy", body: text })
        }
      }}
      title={`Copy "${text}"`}
    >
      {done ? 'Copied' : 'Copy key'}
    </Button>
  )
}

const RELATION: Record<KeyAlternative['relation'], (k: KeyAlternative) => string> = {
  relative: (k) => `Relative ${k.mode} · same notes, different home note`,
  parallel: (k) => `Parallel ${k.mode} · same home note`,
  dominant: () => 'A fifth above',
  subdominant: () => 'A fifth below',
  section: () => 'The key of another part of the track',
  other: () => ''
}

function AltRow({ alt, best, ranked, onUse }: { alt: KeyAlternative; best?: KeyCandidate; ranked: boolean; onUse: () => void }) {
  const gap = best ? best.score - alt.score : 1
  const fit = !best || !ranked ? '' : gap < 0.03 ? 'About as likely' : gap < 0.08 ? 'Close second' : 'Less likely'
  return (
    <div className="group/alt -mx-2 flex items-center gap-3 rounded-sm px-2 py-2 transition-colors duration-150 hover:bg-ink/[0.035]">
      <span className="w-[120px] shrink-0 text-body font-semibold">{keyName(alt)}</span>
      <span className="min-w-0 flex-1 truncate text-label text-fg-2">{[RELATION[alt.relation](alt), fit].filter(Boolean).join('  ·  ')}</span>
      <Button size="sm" variant="ghost" onClick={onUse} className="opacity-70 group-hover/alt:opacity-100">
        Use this
      </Button>
    </div>
  )
}

/** The 12 pitch classes: how much each sounds, and which belong to the chosen key. */
function PitchClasses({ chroma, k, spelling }: { chroma: number[]; k?: { tonic: number; mode: KeyMode }; spelling?: Spelling }) {
  const scale = k && spelling ? scaleNotes(k.tonic, k.mode, spelling) : []
  const inScale = new Set(scale.map((n) => n.pc))
  const order = Array.from({ length: 12 }, (_, i) => (k ? (k.tonic + i) % 12 : i)) // start from the root
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="text-label font-medium text-fg-2">Notes heard in the audio</h3>
        {k && spelling && (
          <span className="text-meta text-fg-3">
            Highlighted: {keyName(k, spelling)} scale ({scale.map((n) => noteText(n.name)).join(' ')})
          </span>
        )}
      </div>
      <div className="grid grid-cols-12 gap-1" role="list">
        {order.map((pc) => {
          const v = chroma[pc] ?? 0
          const on = inScale.has(pc)
          const root = k?.tonic === pc
          const label = noteText(pcNameInKey(pc, k, spelling))
          return (
            <div key={pc} role="listitem" aria-label={`${label}${on ? ', in scale' : ''}${root ? ', root' : ''}: ${Math.round(v * 100)}% of the strongest note`} className="flex flex-col items-center gap-1.5">
              <div className="relative flex h-14 w-full items-end overflow-hidden rounded-[4px] bg-ink/[0.035]">
                <motion.div
                  initial={false}
                  animate={{ height: `${Math.max(3, v * 100)}%` }}
                  transition={t.panel}
                  className={cn('w-full rounded-[3px]', on ? (root ? 'bg-accent' : 'bg-accent/55') : 'bg-fg-3/35')}
                />
              </div>
              <span className={cn('text-meta', root ? 'font-semibold text-accent' : on ? 'font-medium text-fg' : 'text-fg-3')}>{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Editor({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft | null) => void }) {
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<Draft>) => {
    const next = { ...draft, ...p }
    // A new root or mode gets its usual spelling unless the user picks one.
    if (p.tonic != null || p.mode != null) next.spelling = p.spelling ?? defaultSpelling(next.tonic, next.mode)
    setDraft(next)
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-label font-medium text-fg-2">Root note</p>
        <div className="grid grid-cols-12 gap-1" role="radiogroup" aria-label="Root note">
          {Array.from({ length: 12 }, (_, pc) => {
            const on = draft.tonic === pc
            const name = noteText(rootName(pc, on ? draft.spelling : defaultSpelling(pc, draft.mode)))
            return (
              <button
                key={pc}
                role="radio"
                aria-checked={on}
                onClick={() => set({ tonic: pc })}
                className={cn(
                  'h-8 rounded-sm border text-label font-medium transition-colors duration-150',
                  on ? 'border-accent/70 bg-accent/14 text-fg' : 'border-line-strong bg-ink/[0.02] text-fg-2 hover:bg-ink/[0.06] hover:text-fg'
                )}
              >
                {name}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="mb-2 text-label font-medium text-fg-2">Scale</p>
          <SegmentedControl<KeyMode>
            ariaLabel="Major or minor"
            size="sm"
            value={draft.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'major', label: modeLabel('major') },
              { value: 'minor', label: modeLabel('minor') }
            ]}
          />
        </div>
        {isEnharmonicRoot(draft.tonic) && (
          <div>
            <p className="mb-2 text-label font-medium text-fg-2">Spelling</p>
            <SegmentedControl<Spelling>
              ariaLabel="Note spelling"
              size="sm"
              value={draft.spelling}
              onChange={(spelling) => setDraft({ ...draft, spelling })}
              options={[
                { value: 'sharp', label: noteText(rootName(draft.tonic, 'sharp')) },
                { value: 'flat', label: noteText(rootName(draft.tonic, 'flat')) }
              ]}
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="solid"
            icon={<Check size={14} strokeWidth={2} />}
            loading={saving}
            onClick={async () => {
              setSaving(true)
              const ok = await labActions.confirmKey(draft)
              setSaving(false)
              if (ok) setDraft(null)
              else notify({ tone: 'error', title: "Couldn't save your key", body: 'Try again.' })
            }}
          >
            Confirm {keyName(draft, draft.spelling)}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Sections({ a }: { a: KeyAnalysis }) {
  const p = useLabPlayer()
  const [playing, setPlaying] = useState<number | null>(null)
  useEffect(() => {
    if (!p.playing) setPlaying(null)
  }, [p.playing])
  return (
    <Panel solid>
      <div className="p-5">
        <h3 className="text-body font-semibold">By section</h3>
        <p className="mt-0.5 text-label text-fg-2">{a.keyChange ? 'Different parts point to different keys. Listen to each to decide.' : 'Each part of the track, estimated on its own.'}</p>
        <div className="mt-3 flex flex-col">
          {a.sections.map((s, i) => {
            const on = playing === i && p.playing
            return (
              <div key={i} className="-mx-2 flex items-center gap-3 rounded-sm px-2 py-1.5 transition-colors duration-150 hover:bg-ink/[0.035]">
                <button
                  aria-label={on ? 'Pause' : `Listen to ${formatTime(s.startSec)} to ${formatTime(s.endSec)}`}
                  disabled={p.error || !p.src}
                  onClick={() => {
                    if (on) return labPlayer.pause()
                    setPlaying(i)
                    labPlayer.play(s.startSec, s.endSec)
                  }}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-fg-2 transition-colors duration-150 hover:bg-ink/[0.08] hover:text-fg disabled:opacity-35"
                >
                  {on ? <Pause size={11} strokeWidth={0} fill="currentColor" /> : <Play size={11} strokeWidth={0} fill="currentColor" className="translate-x-px" />}
                </button>
                <span className="tabular w-[104px] shrink-0 text-label text-fg-2">
                  {formatTime(s.startSec)} – {formatTime(s.endSec)}
                </span>
                <span className={cn('text-body', s.key ? 'font-medium' : 'text-fg-3')}>{s.key ? keyName(s.key) : 'Unclear'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}
