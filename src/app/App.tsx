import { installClickSounds } from '@/features/sounds/sounds'
import { useEffect, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useActivePage, type PageId } from '@/shared/model/navigation'
import { cn } from '@/shared/lib/format'
import { t } from '@/shared/lib/motion'
import { useSettings, intensityFor } from '@/entities/settings/model'
import { seedSamples } from '@/entities/job/model'
import { TitleBar, Sidebar } from '@/widgets/Chrome'
import { AmbientBackdrop, useBackdropFor } from '@/widgets/AmbientBackdrop'
import { BackgroundArt } from '@/widgets/BackgroundArt'
import { useLive } from '@/features/player/live'
import { QueueStrip } from '@/widgets/QueueStrip'
import { Toaster } from '@/widgets/Toaster'
import { UpdateBanner } from '@/widgets/UpdateBanner'
import { VideosPage } from '@/pages/VideosPage'
import { MusicPage } from '@/pages/MusicPage'
import { QueuePage } from '@/pages/QueuePage'
import { HistoryPage } from '@/pages/HistoryPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { LabPage } from '@/pages/LabPage'
import { MusicBar } from '@/widgets/MusicBar'
import { SettingsModal } from '@/widgets/SettingsModal'

const PAGES: Record<PageId, () => ReactNode> = {
  videos: VideosPage,
  music: MusicPage,
  library: LibraryPage,
  lab: LabPage,
  queue: QueuePage,
  history: HistoryPage
}

export function App() {
  const active = useActivePage()
  const settings = useSettings()
  const { backdrop, liveBackdrop, theme, backgroundArt } = settings
  const intensity = intensityFor(settings, theme)
  const live = useLive()
  const artwork = useBackdropFor(active)

  useEffect(seedSamples, [])
  useEffect(installClickSounds, [])

  return (
    <div className="relative flex h-full flex-col bg-base text-fg">
      <AmbientBackdrop
        src={artwork}
        style={backdrop}
        theme={theme}
        intensity={intensity}
        orbit={liveBackdrop}
        // Moving background only in the Library, while something plays.
        live={active === 'library' && liveBackdrop && live.mode !== 'none' ? { mode: live.mode, video: live.video } : undefined}
      />
      {/* Above the artwork tint, below every piece of UI. */}
      {backgroundArt && <BackgroundArt theme={theme} />}
      <TitleBar />
      <div className="relative flex min-h-0 flex-1 border-t border-line">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {/* Pages stay mounted so a half-finished link survives switching pages. */}
            {(Object.keys(PAGES) as PageId[]).map((id) => {
              const PageView = PAGES[id]
              const on = id === active
              return (
                <motion.div
                  key={id}
                  aria-hidden={!on}
                  initial={false}
                  animate={{ opacity: on ? 1 : 0, y: on ? 0 : 4 }}
                  transition={t.base}
                  className={cn('absolute inset-0 overflow-y-auto', !on && 'pointer-events-none invisible')}
                >
                  <PageView />
                </motion.div>
              )
            })}
          </div>
          {(active === 'videos' || active === 'music') && <QueueStrip />}
          <MusicBar />
        </main>
      </div>
      <SettingsModal />
      <Toaster />
      <UpdateBanner />
    </div>
  )
}
