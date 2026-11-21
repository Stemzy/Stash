import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { cn } from '@/shared/lib/format'
import { formatTime } from './format'

/** "1:02.500", "62.5", "0:12", "1:00:05.25" → seconds. null when it doesn't parse. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  const parts = t.split(':')
  if (parts.length > 3 || parts.some((p) => !/^\d*\.?\d*$/.test(p) || p === '' || p === '.')) return null
  const nums = parts.map(Number)
  const sec = nums.reduce((acc, n) => acc * 60 + n, 0)
  return Number.isFinite(sec) ? sec : null
}

/**
 * Millisecond time field. Type a time and press Enter (or leave the field).
 * ↑/↓ nudge by 10 ms, Shift by 100 ms, Alt by 1 ms.
 */
export function TimeInput({ label, value, onChange, min = 0, max }: { label: string; value: number; onChange: (sec: number) => void; min?: number; max?: number }) {
  const id = useId()
  const [text, setText] = useState(formatTime(value, true))
  const [editing, setEditing] = useState(false)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    if (!editing) setText(formatTime(value, true))
  }, [value, editing])

  const commit = () => {
    const sec = parseTime(text)
    if (sec == null) {
      setBad(true)
      setText(formatTime(value, true))
      setTimeout(() => setBad(false), 900)
      return
    }
    const v = Math.max(min, max != null ? Math.min(max, sec) : sec)
    onChange(Math.round(v * 1000) / 1000)
    setText(formatTime(v, true))
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      setText(formatTime(value, true))
      e.currentTarget.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const step = (e.altKey ? 0.001 : e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowUp' ? 1 : -1)
      const v = Math.max(min, max != null ? Math.min(max, value + step) : value + step)
      onChange(Math.round(v * 1000) / 1000)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-meta font-medium text-fg-2">
        {label}
      </label>
      <input
        id={id}
        value={text}
        inputMode="decimal"
        spellCheck={false}
        onFocus={(e) => {
          setEditing(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setEditing(false)
          commit()
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        title="m:ss.mmm  ·  ↑/↓ 10 ms, Shift 100 ms, Alt 1 ms"
        className={cn(
          'tabular h-8 w-[104px] rounded-sm border bg-ink/[0.025] px-2.5 text-body outline-none transition-[border-color,box-shadow] duration-150',
          'focus:border-accent/55 focus:focus-halo',
          bad ? 'border-danger/70' : 'border-ink/[0.09] hover:border-ink/[0.16]'
        )}
      />
    </div>
  )
}
