import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Download, FolderOpen } from 'lucide-react'
import { api, isElectron } from '@/shared/api'
import { shortPath } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { notify } from '@/shared/ui/toast'
import { t } from '@/shared/lib/motion'

/** Shows the folder and opens the native folder picker. */
export function DestinationPicker({ path, onChange }: { path: string; onChange: (p: string) => void }) {
  const pick = async () => {
    const next = await api.system.pickFolder(path)
    if (next) onChange(next)
    else if (!isElectron) notify({ tone: 'info', title: 'Folder picker needs the desktop app', body: 'Run the app with npm run dev to choose a folder.' })
  }
  return (
    <div className="flex h-9 items-center gap-2.5 rounded-sm border border-ink/[0.09] bg-ink/[0.025] pl-3 pr-1 transition-colors duration-100 hover:border-ink/[0.14]">
      <FolderOpen size={15} strokeWidth={1.5} className="shrink-0 text-fg-3" />
      <span className="min-w-0 flex-1 truncate text-body text-fg" title={path}>
        {path ? shortPath(path) : 'Loading…'}
      </span>
      <Button size="sm" variant="secondary" onClick={pick} className="h-7 px-3">
        Change
      </Button>
    </div>
  )
}

/** Editable output filename with the extension shown (and kept) separately. */
export function FilenameField({
  value,
  ext,
  onChange
}: {
  value: string
  ext: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex h-9 items-center rounded-sm border border-ink/[0.09] bg-ink/[0.025] pl-3 pr-3 transition-[border-color,box-shadow] duration-150 hover:border-ink/[0.14] focus-within:border-accent/55 focus-within:focus-halo focus-within:hover:border-accent/55">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label="File name"
        className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-fg-3 focus-visible:outline-none"
        placeholder="File name"
      />
      <motion.span key={ext} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t.fast} className="text-body text-fg-3">
        .{ext}
      </motion.span>
    </div>
  )
}

/** "~240 MB · MP4 · to Videos": the size stands out, the rest stays quiet. */
export function DownloadSummary({ size, parts }: { size: string; parts: ReactNode[] }) {
  return (
    <span className="tabular flex min-w-0 items-center gap-2 text-label text-fg-2">
      <span className="shrink-0 font-semibold text-fg">{size}</span>
      {parts.map((p, i) => (
        <span key={i} className="flex min-w-0 items-center gap-2">
          <span className="text-fg-3" aria-hidden>
            ·
          </span>
          <span className="truncate">{p}</span>
        </span>
      ))}
    </span>
  )
}

/** Summary of what will be saved + the primary button. */
export function DownloadAction({
  label,
  summary,
  disabled,
  onDownload
}: {
  label: string
  summary: ReactNode
  disabled?: boolean
  onDownload: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
      <div className="min-w-0">{summary}</div>
      <Button variant="solid" size="lg" icon={<Download size={16} strokeWidth={2} />} disabled={disabled} onClick={onDownload} className="px-5">
        {label}
      </Button>
    </div>
  )
}
