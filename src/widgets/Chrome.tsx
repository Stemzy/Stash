import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Clapperboard, FlaskConical, Download, History, Library, Music2, Settings } from 'lucide-react'
import { navigate, useActivePage, type PageId } from '@/shared/model/navigation'
import { cn } from '@/shared/lib/format'
import { t } from '@/shared/lib/motion'
import { useJobs, isActive } from '@/entities/job/model'
import { isElectron } from '@/shared/api'
import { openSettings, useSettingsUi } from '@/widgets/SettingsModal'

/** 36px draggable title bar. Windows draws its own caption buttons on the right. */
export function TitleBar() {
  return (
    <div className="drag relative z-20 flex h-9 shrink-0 items-center gap-3 pl-4 pr-[150px]">
      <div className="flex items-center gap-2">
        <span className="flex size-4 items-center justify-center rounded-[4px] bg-accent/20 text-accent">
          <Download size={11} strokeWidth={2} />
        </span>
        <span className="text-label font-semibold">Stash</span>
      </div>
      {!isElectron && (
        <span className="no-drag rounded-[4px] border border-dashed border-line-strong px-1.5 text-meta text-fg-2">
          Browser preview · downloads are simulated
        </span>
      )}
    </div>
  )
}

const MAIN: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: 'videos', label: 'Videos', icon: <Clapperboard size={16} strokeWidth={1.5} /> },
  { id: 'music', label: 'Music', icon: <Music2 size={16} strokeWidth={1.5} /> }
]

export function Sidebar() {
  const active = useActivePage()
  const jobs = useJobs()
  const activeCount = jobs.filter(isActive).length
  const settingsOpen = useSettingsUi().open

  return (
    <nav aria-label="Main" className="flex w-[176px] shrink-0 flex-col border-r border-line bg-sidebar/70 px-3 pb-3 pt-3 backdrop-blur-xl">
      <div className="flex flex-col gap-0.5">
        {MAIN.map((i) => (
          <SidebarItem key={i.id} {...i} active={active === i.id} />
        ))}
      </div>
      <div className="my-3 h-px bg-line" />
      <div className="flex flex-col gap-0.5">
        <SidebarItem id="library" label="Library" icon={<Library size={16} strokeWidth={1.5} />} active={active === 'library'} />
        <SidebarItem id="lab" label="LAB" icon={<FlaskConical size={16} strokeWidth={1.5} />} active={active === 'lab'} />
      </div>
      <div className="my-3 h-px bg-line" />
      <div className="flex flex-col gap-0.5">
        <SidebarItem
          id="queue"
          label="Queue"
          icon={<Download size={16} strokeWidth={1.5} />}
          active={active === 'queue'}
          badge={activeCount || undefined}
        />
        <SidebarItem id="history" label="History" icon={<History size={16} strokeWidth={1.5} />} active={active === 'history'} />
      </div>
      <div className="mt-auto flex flex-col">
        <SidebarItem id="settings" label="Settings" icon={<Settings size={16} strokeWidth={1.5} />} active={settingsOpen} onClick={() => openSettings()} />
      </div>
    </nav>
  )
}

function SidebarItem({
  id,
  label,
  icon,
  active,
  badge,
  onClick
}: {
  id: PageId | 'settings'
  label: string
  icon: ReactNode
  active: boolean
  badge?: number
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick ?? (() => navigate(id as PageId))}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-8 items-center gap-2.5 rounded-sm px-2.5 text-body transition-colors duration-150',
        active ? 'text-fg' : 'text-fg-2 hover:bg-ink/[0.04] hover:text-fg'
      )}
    >
      {active && (
        // Settings is a window, not a page: it gets its own highlight instead of taking the page's.
        <motion.span layoutId={id === 'settings' ? undefined : 'sidebar-active'} transition={t.base} className="absolute inset-0 rounded-sm bg-accent/12" aria-hidden />
      )}
      <span className={cn('relative', active && 'text-accent')}>{icon}</span>
      <span className={cn('relative flex-1 text-left', active && 'font-medium')}>{label}</span>
      {badge != null && (
        <span className="tabular relative min-w-[20px] rounded-full border border-line-strong px-1.5 text-center text-meta text-fg">
          {badge}
        </span>
      )}
    </button>
  )
}
