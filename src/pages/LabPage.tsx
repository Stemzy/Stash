import { useEffect, useRef, useState, type DragEvent } from 'react'
import { motion } from 'motion/react'
import { Gauge, Music4 } from 'lucide-react'
import type { LabTool } from '@shared/types/lab'
import { labActions, useLab } from '@/features/lab/model'
import { labPlayer } from '@/features/lab/player'
import { SourcePanel } from '@/features/lab/SourcePanel'
import { KeyFinder } from '@/features/lab/KeyFinder'
import { TempoTool } from '@/features/lab/TempoTool'
import { stopVerify } from '@/features/lab/verify'
import { cn } from '@/shared/lib/format'
import { t } from '@/shared/lib/motion'
import { useActivePage } from '@/shared/model/navigation'
import { Page, PageHeader } from '@/shared/ui/Layout'

// LAB: producer tools that sit alongside downloading (never in its way).
// Every tool works on the same selected file. Only working tools get a tab.

const TOOLS: { id: LabTool; label: string; icon: typeof Gauge }[] = [
  { id: 'key', label: 'Key & BPM', icon: Music4 },
  { id: 'tempo', label: 'Tempo', icon: Gauge }
]

export function LabPage() {
  const lab = useLab()
  const active = useActivePage()
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  // The preview never keeps playing on another page.
  useEffect(() => {
    if (active !== 'lab') {
      labPlayer.pause()
      stopVerify()
    }
  }, [active])

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const drop = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      setDragging(true)
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) void labActions.openDropped(file)
    }
  }

  return (
    <Page>
      <div data-dropzone {...drop}>
        <PageHeader title="LAB" subtitle="Tools for beats, tempo, and audio production." />

        <div role="tablist" aria-label="LAB tools" className="-mt-1 mb-5 flex items-center gap-1 border-b border-line">
          {TOOLS.map((x) => {
            const on = x.id === lab.tool
            const Icon = x.icon
            return (
              <button
                key={x.id}
                role="tab"
                aria-selected={on}
                onClick={() => labActions.setTool(x.id)}
                className={cn('relative -mb-px flex h-9 items-center gap-2 px-3 text-body transition-colors duration-150', on ? 'text-fg' : 'text-fg-2 hover:text-fg')}
              >
                <Icon size={15} strokeWidth={1.75} className={cn('transition-colors duration-150', on ? 'text-accent' : 'text-fg-3')} />
                {x.label}
                {on && <motion.span layoutId="lab-tool" transition={t.base} className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" aria-hidden />}
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-4">
          <SourcePanel dragging={dragging} compact={lab.tool === 'tempo'} />
          <div role="tabpanel" aria-label={TOOLS.find((x) => x.id === lab.tool)?.label}>
            {lab.tool === 'tempo' ? <TempoTool /> : <KeyFinder />}
          </div>
        </div>
      </div>
    </Page>
  )
}
