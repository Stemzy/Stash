import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Database, Download, Info, Palette, Search, Wrench, X } from 'lucide-react'
import type { ToolStatus } from '@shared/types/media'
import { api, isElectron } from '@/shared/api'
import { createStore, useStore } from '@/shared/lib/store'
import { cn } from '@/shared/lib/format'
import { t } from '@/shared/lib/motion'
import { useSettings, updateSettings, intensityFor, type BackdropStyle } from '@/entities/settings/model'
import { THEMES, THEME_ORDER, type ThemeId } from '@/entities/settings/themes'
import { Scrubber } from '@/shared/ui/Scrubber'
import { jobActions, useJobs, isActive } from '@/entities/job/model'
import { DestinationPicker } from '@/widgets/DownloadControls'
import { Button } from '@/shared/ui/Button'
import { Badge } from '@/shared/ui/Feedback'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { Select } from '@/shared/ui/Select'
import { Switch } from '@/shared/ui/Switch'
import { notify } from '@/shared/ui/toast'
import { appUpdateActions, useAppUpdate, useUpdates, updatesActions } from '@/entities/updates/model'

// Settings opens as a window over the app: the app behind is blurred and
// dimmed, the panel itself is semi-transparent. Sections on the left, a search
// box that finds any setting, and the chosen section on the right.

type SectionId = 'appearance' | 'downloads' | 'tools' | 'data' | 'about'

export const settingsUi = createStore<{ open: boolean; section: SectionId }>({ open: false, section: 'appearance' })
export const useSettingsUi = () => useStore(settingsUi)
export const openSettings = (section?: SectionId) => settingsUi.set((s) => ({ open: true, section: section ?? s.section }))
export const closeSettings = () => settingsUi.set((s) => ({ ...s, open: false }))

const SECTIONS: { group: string; items: { id: SectionId; label: string; subtitle: string; icon: ReactNode }[] }[] = [
  {
    group: 'Interface',
    items: [{ id: 'appearance', label: 'Appearance', subtitle: 'Theme, background and motion.', icon: <Palette size={15} strokeWidth={1.5} /> }]
  },
  {
    group: 'Downloads',
    items: [
      { id: 'downloads', label: 'Downloads', subtitle: 'Where files go and how many download at once.', icon: <Download size={15} strokeWidth={1.5} /> },
      { id: 'tools', label: 'Media tools', subtitle: 'yt-dlp, FFmpeg, FFprobe and Deno.', icon: <Wrench size={15} strokeWidth={1.5} /> }
    ]
  },
  {
    group: 'Application',
    items: [
      { id: 'data', label: 'Storage & data', subtitle: 'History and what the app keeps on disk.', icon: <Database size={15} strokeWidth={1.5} /> },
      { id: 'about', label: 'About', subtitle: 'Version and responsible use.', icon: <Info size={15} strokeWidth={1.5} /> }
    ]
  }
]
const ALL = SECTIONS.flatMap((g) => g.items)

/** One setting: title + description on the left, its control on the right. */
interface RowDef {
  section: SectionId
  title: string
  body?: string
  /** Extra words that should find this row in search. */
  keywords?: string
  control: ReactNode
  /** Wide controls (folder pickers) go under the text instead of beside it. */
  stacked?: boolean
}

function Row({ row }: { row: RowDef }) {
  return (
    <div className={cn('min-h-[60px] px-4 py-3.5', row.stacked ? 'flex flex-col gap-2.5' : 'flex items-center justify-between gap-8')}>
      <div className="min-w-0 max-w-[460px]">
        <p className="text-body font-medium text-fg">{row.title}</p>
        {row.body && <p className="mt-1 text-label leading-[17px] text-fg-2">{row.body}</p>}
      </div>
      {row.control && <div className={cn(row.stacked ? 'w-full' : 'flex shrink-0 items-center justify-end')}>{row.control}</div>}
    </div>
  )
}

/** A group of settings: one quiet surface, hairline dividers between rows. */
function Card({ rows }: { rows: RowDef[] }) {
  return (
    <div className="divide-y divide-ink/[0.055] rounded-md border border-ink/[0.07] bg-[var(--card-bg)] shadow-[inset_0_1px_0_var(--glass-highlight)]">
      {rows.map((r) => (
        <Row key={r.title} row={r} />
      ))}
    </div>
  )
}

/** Status pill with a dot, matching the download status badges. */
function Status({ tone, children }: { tone: 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return (
    <Badge tone={tone} className="gap-1.5 border-transparent bg-ink/[0.04] pl-1.5 pr-2">
      <span aria-hidden className={cn('size-1.5 rounded-full', { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone])} />
      {children}
    </Badge>
  )
}

export function SettingsModal() {
  const { open, section } = useSettingsUi()
  const s = useSettings()
  const upd = useUpdates()
  const appUpd = useAppUpdate()
  const [appChecking, setAppChecking] = useState(false)
  const [updChecking, setUpdChecking] = useState(false)
  const historyCount = useJobs().filter((j) => !isActive(j)).length
  const [query, setQuery] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Media tools status, loaded when the window opens.
  const [tools, setTools] = useState<ToolStatus[] | null>(null)
  const [checking, setChecking] = useState(false)
  const loadTools = useCallback(async (refresh: boolean) => {
    setChecking(true)
    setTools(await api.system.toolsStatus(refresh))
    setChecking(false)
  }, [])
  useEffect(() => {
    if (open) {
      void loadTools(false)
      setQuery('')
      window.setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open, loadTools])

  // Esc closes (unless a dropdown inside handled it first).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const toolInfo: Record<ToolStatus['name'], string> = {
    'yt-dlp': 'Reads links and downloads media.',
    ffmpeg: 'Merges video and audio, converts audio formats.',
    ffprobe: 'Checks downloaded and finished files.',
    deno: 'Optional. yt-dlp needs it for full YouTube support.'
  }
  const missing = tools?.some((x) => !x.ok && !x.optional)

  const rows: RowDef[] = useMemo(
    () => [
      {
        section: 'appearance',
        title: 'Theme',
        body: 'Changes the whole app. The artwork background adapts to each theme.',
        keywords: 'theme dark light night pink ocean blue colour color mode appearance',
        stacked: true,
        control: <ThemePicker value={s.theme} onChange={(theme) => updateSettings({ theme })} />
      },
      {
        section: 'appearance',
        title: 'Background',
        body: 'Tints Videos, Music and Library with the current thumbnail.',
        keywords: 'blur glow artwork theme color colour',
        control: (
          <SegmentedControl<BackdropStyle>
            ariaLabel="Background style"
            size="sm"
            value={s.backdrop}
            onChange={(backdrop) => updateSettings({ backdrop })}
            options={[
              { value: 'blur', label: 'Blurred artwork' },
              { value: 'glow', label: 'Color glow' },
              { value: 'off', label: 'Off' }
            ]}
          />
        )
      },
      {
        section: 'appearance',
        title: 'Background illustration',
        body: 'A very faint drawing behind the whole app. It takes on the colours of the current theme.',
        keywords: 'wallpaper art image drawing lily ambient 2000s',
        control: <Switch ariaLabel="Background illustration" checked={s.backgroundArt} onChange={(backgroundArt) => updateSettings({ backgroundArt })} />
      },
      {
        section: 'appearance',
        title: 'Moving background',
        body: 'The ambient light slowly orbits behind the app. In the Library it also pulses with the beat while music or a video plays. Works even if Windows animations are off.',
        keywords: 'animation motion live ambient beat pulse immersive',
        control: <Switch ariaLabel="Moving background" checked={s.liveBackdrop} onChange={(liveBackdrop) => updateSettings({ liveBackdrop })} />
      },
      {
        section: 'appearance',
        title: 'Ambient intensity',
        body:
          s.backdrop === 'off'
            ? 'Background is off, so no artwork lighting is shown.'
            : `How strongly the artwork colours the background in ${THEMES[s.theme].name}. Saved for each theme.`,
        keywords: 'strength ambient artwork glow amount',
        control: (
          <IntensitySlider
            value={intensityFor(s, s.theme)}
            fallback={THEMES[s.theme].ambient.defaultIntensity}
            disabled={s.backdrop === 'off'}
            onChange={(v) => updateSettings({ ambientIntensity: { ...s.ambientIntensity, [s.theme]: v } })}
          />
        )
      },
      {
        section: 'downloads',
        title: 'Video folder',
        body: 'Where video downloads are saved.',
        keywords: 'destination path location save',
        stacked: true,
        control: <DestinationPicker path={s.folders.videos} onChange={(videos) => updateSettings({ folders: { ...s.folders, videos } })} />
      },
      {
        section: 'downloads',
        title: 'Music folder',
        body: 'Where audio downloads are saved.',
        keywords: 'destination path location save',
        stacked: true,
        control: <DestinationPicker path={s.folders.music} onChange={(music) => updateSettings({ folders: { ...s.folders, music } })} />
      },
      {
        section: 'downloads',
        title: 'Downloads at the same time',
        body: 'The rest wait in the queue.',
        keywords: 'concurrency parallel simultaneous queue limit',
        control: (
          <Select
            ariaLabel="Downloads at the same time"
            className="w-[120px]"
            value={s.concurrency}
            onChange={(concurrency) => updateSettings({ concurrency })}
            options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n), hint: n === 2 ? 'Default' : undefined }))}
          />
        )
      },
      ...(!isElectron
        ? [{ section: 'tools' as const, title: 'Media tools', body: 'Only available in the desktop app.', control: <Badge>Browser preview</Badge> }]
        : (tools ?? []).map((x): RowDef => ({
            section: 'tools',
            title: x.name === 'yt-dlp' ? 'yt-dlp' : x.name === 'ffmpeg' ? 'FFmpeg' : x.name === 'ffprobe' ? 'FFprobe' : 'Deno',
            body: toolInfo[x.name],
            keywords: 'binaries version update',
            control: x.ok ? (
              <Status tone="success">Ready · {x.version}</Status>
            ) : (
              <Status tone={x.optional ? 'warning' : 'danger'}>{x.optional ? 'Not installed' : 'Missing'}</Status>
            )
          }))),
      ...(isElectron
        ? [
            {
              section: 'tools' as const,
              title: 'Keep tools up to date',
              body: 'Automatically installs new versions of yt-dlp, Deno and FFmpeg from their official GitHub pages. Each one is checked before use, and downloads in progress are never interrupted.',
              keywords: 'update auto automatic upgrade yt-dlp ffmpeg deno latest version',
              control: <Switch ariaLabel="Keep tools up to date" checked={upd.state?.auto === true} onChange={(on) => void updatesActions.setAuto(on)} />
            },
            {
              section: 'tools' as const,
              title: 'Check for updates',
              body: updateSummary(upd.state),
              keywords: 'update upgrade latest version check now',
              control: (
                <Button
                  size="sm"
                  loading={updChecking || upd.progress.phase !== 'idle'}
                  onClick={async () => {
                    setUpdChecking(true)
                    const st = await updatesActions.checkNow()
                    setUpdChecking(false)
                    await loadTools(true)
                    const l = st.last
                    if (l && !l.updated.length && !l.error) notify(l.checkError ? { tone: 'error', title: "Couldn't check for updates", body: 'Check your internet connection and try again.' } : { tone: 'success', title: 'Everything is up to date' })
                  }}
                >
                  Check now
                </Button>
              )
            },
            {
              section: 'tools' as const,
              title: missing ? 'Some tools are missing' : 'Check again',
              body: missing
                ? 'Run npm run fetch-binaries in the project folder, then check again.'
                : 'Re-check after updating the tools with npm run fetch-binaries.',
              keywords: 'refresh binaries',
              control: (
                <Button size="sm" loading={checking} onClick={() => void loadTools(true)}>
                  Check again
                </Button>
              )
            }
          ]
        : []),
      {
        section: 'data',
        title: 'Download history',
        body: `${historyCount} ${historyCount === 1 ? 'entry' : 'entries'}. Clearing keeps the files on disk.`,
        keywords: 'clear history storage',
        control: (
          <Button
            variant="danger"
            size="sm"
            disabled={historyCount === 0}
            onClick={() => {
              jobActions.clearHistory()
              notify({ tone: 'success', title: 'History cleared' })
            }}
          >
            Clear history
          </Button>
        )
      },
      {
        section: 'data',
        title: 'Where data is kept',
        body: 'Queue, history and thumbnails: %APPDATA%\\Stash. Partial downloads: %TEMP%\\Stash (cleaned automatically).',
        keywords: 'appdata temp folder location storage cache',
        control: null
      },
      {
        section: 'about',
        title: 'Stash',
        body: `Version ${__APP_VERSION__}. Built on yt-dlp, FFmpeg and Electron.`,
        keywords: 'version app',
        control: null
      },
      {
        section: 'about',
        title: 'App updates',
        body:
          appUpd.status.phase === 'unsupported'
            ? 'Stash checks for new versions when it is installed (not while running from the project folder).'
            : appUpd.status.phase === 'ready'
              ? `Stash ${appUpd.status.version} is downloaded and installs when you restart.`
              : 'Stash checks for new versions on its own and asks before downloading anything.',
        keywords: 'update upgrade new version release patch',
        control:
          appUpd.status.phase === 'ready' ? (
            <Button size="sm" variant="primary" onClick={appUpdateActions.install}>
              Restart now
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={appUpd.status.phase === 'unsupported' || appUpd.status.phase === 'downloading'}
              loading={appChecking}
              onClick={async () => {
                setAppChecking(true)
                const st = await appUpdateActions.check()
                setAppChecking(false)
                if (st.phase === 'idle') notify({ tone: 'success', title: 'Stash is up to date', body: `You have the latest version (${st.current}).` })
              }}
            >
              Check for updates
            </Button>
          )
      },
      {
        section: 'about',
        title: 'Responsible use',
        body: 'Only download content you own or have permission to save. Copy-protected (DRM) content is not supported.',
        keywords: 'legal copyright drm',
        control: null
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, upd, updChecking, appUpd, appChecking, historyCount, tools, checking, missing]
  )

  const q = query.trim().toLowerCase()
  const results = q ? rows.filter((r) => `${r.title} ${r.body ?? ''} ${r.keywords ?? ''}`.toLowerCase().includes(q)) : []
  const current = ALL.find((x) => x.id === section)!

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          // The app behind: dimmed and softly blurred.
          className="glass-scrim fixed inset-0 z-[55] flex items-center justify-center p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.16 } }}
          transition={t.panel}
          onMouseDown={(e) => e.target === e.currentTarget && closeSettings()}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            // Fade with a short rise; a hair of scale, no bounce. Reduced motion → fade only.
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99, transition: { duration: 0.14 } }}
            transition={t.panel}
            className="glass-panel flex h-[min(640px,100%)] w-[min(920px,100%)] overflow-hidden rounded-[14px]"
          >
            {/* Sections */}
            <nav aria-label="Settings sections" className="flex w-[232px] shrink-0 flex-col border-r border-ink/[0.06] bg-shade/[0.18] px-3 pb-3 pt-4">
              <label
                className={cn(
                  'group/search mb-5 flex h-8 items-center gap-2 rounded-sm border border-ink/[0.08] bg-ink/[0.04] px-2.5',
                  'transition-[border-color,box-shadow] duration-150 hover:border-ink/[0.14]',
                  'focus-within:border-accent/55 focus-within:focus-halo focus-within:hover:border-accent/55'
                )}
              >
                <Search size={14} strokeWidth={1.75} className="shrink-0 text-fg-3 transition-colors duration-150 group-focus-within/search:text-accent" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search settings…"
                  aria-label="Search settings"
                  className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-fg-3 focus-visible:outline-none"
                />
              </label>
              {SECTIONS.map((g) => (
                <div key={g.group} className="mb-4">
                  <p className="small-caps mb-1.5 px-2.5 text-fg-3">{g.group}</p>
                  {g.items.map((it) => {
                    const on = !q && it.id === section
                    return (
                      <button
                        key={it.id}
                        onClick={() => {
                          setQuery('')
                          settingsUi.set((x) => ({ ...x, section: it.id }))
                        }}
                        aria-current={on ? 'page' : undefined}
                        className={cn(
                          'relative flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-body transition-colors duration-150',
                          on ? 'text-fg' : 'text-fg-2 hover:bg-ink/[0.045] hover:text-fg'
                        )}
                      >
                        {on && (
                          <motion.span
                            layoutId="settings-nav"
                            transition={t.base}
                            className="absolute inset-0 rounded-sm bg-ink/[0.07] shadow-[inset_0_1px_0_var(--glass-highlight)]"
                            aria-hidden
                          />
                        )}
                        {/* Windows-style accent pill marking the current section. */}
                        {on && (
                          <motion.span
                            layoutId="settings-nav-pill"
                            transition={t.base}
                            className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent"
                            aria-hidden
                          />
                        )}
                        <span className={cn('relative transition-colors duration-150', on ? 'text-accent' : 'text-fg-3')}>{it.icon}</span>
                        <span className="relative">{it.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>

            {/* Content */}
            <div className="relative flex min-w-0 flex-1 flex-col">
              <header className="flex items-start justify-between gap-4 px-7 pb-5 pt-6">
                <div>
                  <h2 className="text-[18px] font-semibold leading-6 tracking-[-0.01em]">{q ? 'Search' : current.label}</h2>
                  <p className="mt-1 text-label text-fg-2">
                    {q ? `${results.length} ${results.length === 1 ? 'setting' : 'settings'} matching "${query.trim()}"` : current.subtitle}
                  </p>
                </div>
                <button
                  aria-label="Close settings"
                  onClick={closeSettings}
                  title="Close (Esc)"
                  className="-mr-2 -mt-1 flex size-8 items-center justify-center rounded-sm text-fg-2 transition-[background-color,color,transform] duration-150 hover:bg-ink/[0.07] hover:text-fg active:scale-[0.94]"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={q ? 'search' : section}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={t.fast}
                  >
                    {q ? (
                      results.length === 0 ? (
                        <p className="py-10 text-center text-label text-fg-2">No settings match that search.</p>
                      ) : (
                        <div className="flex flex-col gap-4">
                          {ALL.filter((sec) => results.some((r) => r.section === sec.id)).map((sec) => (
                            <div key={sec.id}>
                              <p className="small-caps mb-2 text-fg-3">{sec.label}</p>
                              <Card rows={results.filter((r) => r.section === sec.id)} />
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      <Card rows={rows.filter((r) => r.section === section)} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Five compact preview tiles: base, sidebar, panel with text lines, and the accent. */
function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (t: ThemeId) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-5 gap-2.5">
      {THEME_ORDER.map((id) => {
        const t = THEMES[id]
        const p = t.preview
        const on = id === value
        return (
          <button
            key={id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(id)}
            className="group/tile flex flex-col gap-1.5 rounded-md text-left outline-offset-4"
          >
            <span
              className={cn(
                'relative block h-[58px] overflow-hidden rounded-sm border transition-[border-color,box-shadow] duration-150 ease-out-soft',
                on ? 'border-accent shadow-[0_0_0_2px_var(--focus-halo)]' : 'border-ink/[0.12] group-hover/tile:border-ink/[0.24]'
              )}
              style={{ background: p.base }}
              aria-hidden
            >
              {/* sidebar */}
              <span className="absolute inset-y-0 left-0 w-[24%]" style={{ background: p.sidebar }}>
                <span className="absolute left-[18%] top-[22%] h-[5px] w-[56%] rounded-full" style={{ background: p.accent, opacity: 0.85 }} />
                <span className="absolute left-[18%] top-[42%] h-[4px] w-[48%] rounded-full" style={{ background: p.muted, opacity: 0.6 }} />
                <span className="absolute left-[18%] top-[58%] h-[4px] w-[52%] rounded-full" style={{ background: p.muted, opacity: 0.6 }} />
              </span>
              {/* content panel */}
              <span
                className="absolute bottom-[16%] left-[32%] right-[9%] top-[18%] rounded-[3px]"
                style={{ background: p.panel, boxShadow: t.mode === 'light' ? '0 1px 2px rgb(0 0 0 / 0.06)' : 'inset 0 0 0 1px rgb(255 255 255 / 0.05)' }}
              >
                <span className="absolute left-[10%] top-[22%] h-[4px] w-[52%] rounded-full" style={{ background: p.text, opacity: 0.8 }} />
                <span className="absolute left-[10%] top-[46%] h-[3px] w-[36%] rounded-full" style={{ background: p.muted }} />
                <span className="absolute bottom-[18%] right-[8%] h-[7px] w-[30%] rounded-[2px]" style={{ background: p.accent }} />
              </span>
              {on && (
                <span className="absolute right-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-accent text-on-accent">
                  <Check size={9} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className={cn('truncate text-label transition-colors duration-150', on ? 'font-medium text-fg' : 'text-fg-2 group-hover/tile:text-fg')}>
              {t.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** "Last checked 3 hours ago" style line for the update row. */
function updateSummary(st: import('@shared/types/media').ToolUpdateState | null): string {
  if (!st?.lastCheck) return 'Not checked yet.'
  const mins = Math.round((Date.now() - st.lastCheck) / 60_000)
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`
  const res = st.last?.updated.length ? ` Updated ${st.last.updated.join(', ')}.` : st.last?.error ? ` ${st.last.error}` : ''
  return `Last checked ${when}.${res}`
}

/** 0–100 slider with the value shown; double-click the number to reset to the theme's default. */
function IntensitySlider({ value, fallback, disabled, onChange }: { value: number; fallback: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <div className={cn('flex w-[220px] items-center gap-3', disabled && 'pointer-events-none opacity-45')} aria-disabled={disabled}>
      <Scrubber
        value={value}
        max={100}
        step={5}
        ariaLabel="Ambient intensity"
        className="flex-1"
        onChange={(v) => onChange(Math.round(v))}
        onCommit={(v) => onChange(Math.round(v))}
      />
      <button
        onDoubleClick={() => onChange(fallback)}
        title={`Double-click to reset (${fallback})`}
        className="tabular w-8 shrink-0 rounded-sm text-right text-label text-fg-2"
      >
        {value}
      </button>
    </div>
  )
}
