// Halves the sample rate with a windowed-sinc low-pass first, so nothing above
// the new Nyquist folds back as false notes.

export function decimate2(x: Float32Array, sampleRate: number, cutoffHz = 0.45 * (sampleRate / 2)): Float32Array {
  const taps = 95
  const mid = (taps - 1) / 2
  const fc = cutoffHz / sampleRate // cycles per input sample
  const h = new Float64Array(taps)
  let sum = 0
  for (let i = 0; i < taps; i++) {
    const t = i - mid
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t)
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1)) // Blackman
    h[i] = sinc * w
    sum += h[i]!
  }
  for (let i = 0; i < taps; i++) h[i]! /= sum
  const outLen = Math.floor(x.length / 2)
  const y = new Float32Array(outLen)
  for (let m = 0; m < outLen; m++) {
    const c = 2 * m
    let acc = 0
    const lo = Math.max(0, mid - c)
    const hi = Math.min(taps, x.length - c + mid)
    for (let j = lo; j < hi; j++) acc += h[j]! * x[c + j - mid]!
    y[m] = acc
  }
  return y
}
