import type { WaveformData } from '../../../../shared/types/lab'

export const WAVEFORM_VERSION = 1

/** Min/max per column for drawing. 3000 columns keeps detail when zoomed on wide windows. */
export function waveformPeaks(x: Float32Array, sampleRate: number, columns = 3000): WaveformData {
  const n = Math.max(1, Math.min(columns, x.length))
  const min: number[] = new Array(n)
  const max: number[] = new Array(n)
  let peak = 0
  for (let c = 0; c < n; c++) {
    const a = Math.floor((c * x.length) / n)
    const b = Math.max(a + 1, Math.floor(((c + 1) * x.length) / n))
    let lo = 0
    let hi = 0
    for (let i = a; i < b && i < x.length; i++) {
      const v = x[i]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[c] = Math.round(lo * 1000) / 1000
    max[c] = Math.round(hi * 1000) / 1000
    peak = Math.max(peak, -lo, hi)
  }
  return { version: WAVEFORM_VERSION, durationSec: x.length / sampleRate, min, max, peak: Math.round(peak * 1000) / 1000 }
}
