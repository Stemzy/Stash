// Tempo helpers shared by the UI and tests.

/** "140" when it's within 0.05 of a whole number, else "128.5". */
export function bpmText(b: number): string {
  return Math.abs(b - Math.round(b)) < 0.05 ? String(Math.round(b)) : b.toFixed(1)
}

/**
 * Tap Tempo from tap times in ms (a monotonic clock such as performance.now()).
 * Uses the median interval and ignores taps more than 20% off it, so one late or
 * early tap doesn't skew the result. null until there are 4 usable taps.
 */
export function tapBpm(times: number[]): number | null {
  if (times.length < 4) return null
  const iv = times.slice(1).map((t, i) => t - times[i]!)
  const sorted = [...iv].sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]!
  if (!(med > 0)) return null
  const keep = iv.filter((d) => Math.abs(d / med - 1) <= 0.2)
  if (keep.length < 3) return null
  const mean = keep.reduce((s, d) => s + d, 0) / keep.length
  return 60000 / mean
}
