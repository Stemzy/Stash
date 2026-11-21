// Real-input FFT (radix-2), computed as a half-size complex FFT plus one
// post-processing pass. Pure TypeScript: no native code, no dependencies.

export class RealFFT {
  readonly n: number
  private readonly m: number
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly rev: Uint32Array
  private readonly cosT: Float64Array
  private readonly sinT: Float64Array
  private readonly postCos: Float64Array
  private readonly postSin: Float64Array

  constructor(n: number) {
    if (n < 4 || (n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two')
    this.n = n
    const m = (this.m = n >> 1)
    this.re = new Float64Array(m)
    this.im = new Float64Array(m)
    this.rev = new Uint32Array(m)
    const bits = Math.log2(m)
    for (let i = 0; i < m; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1)
      this.rev[i] = r
    }
    this.cosT = new Float64Array(m >> 1 || 1)
    this.sinT = new Float64Array(m >> 1 || 1)
    for (let k = 0; k < m >> 1; k++) {
      this.cosT[k] = Math.cos((2 * Math.PI * k) / m)
      this.sinT[k] = Math.sin((2 * Math.PI * k) / m)
    }
    this.postCos = new Float64Array(m + 1)
    this.postSin = new Float64Array(m + 1)
    for (let k = 0; k <= m; k++) {
      this.postCos[k] = Math.cos((2 * Math.PI * k) / n)
      this.postSin[k] = Math.sin((2 * Math.PI * k) / n)
    }
  }

  /** Magnitude spectrum |X[k]|, k = 0..n/2, of `input` (length n). */
  magnitudes(input: ArrayLike<number>, out: Float64Array): void {
    const { m, re, im, rev } = this
    for (let k = 0; k < m; k++) {
      const j = rev[k]!
      re[j] = input[2 * k]!
      im[j] = input[2 * k + 1]!
    }
    for (let size = 2; size <= m; size <<= 1) {
      const half = size >> 1
      const step = m / size
      for (let i = 0; i < m; i += size) {
        for (let j = 0; j < half; j++) {
          const wr = this.cosT[j * step]!
          const wi = -this.sinT[j * step]!
          const a = i + j
          const b = a + half
          const tr = wr * re[b]! - wi * im[b]!
          const ti = wr * im[b]! + wi * re[b]!
          re[b] = re[a]! - tr
          im[b] = im[a]! - ti
          re[a] = re[a]! + tr
          im[a] = im[a]! + ti
        }
      }
    }
    for (let k = 0; k <= m; k++) {
      const ka = k === m ? 0 : k
      const kb = k === 0 ? 0 : m - k
      const a = re[ka]!
      const b = im[ka]!
      const c = re[kb]!
      const d = im[kb]!
      const er = (a + c) / 2
      const ei = (b - d) / 2
      const or = (b + d) / 2
      const oi = -(a - c) / 2
      const cs = this.postCos[k]!
      const sn = this.postSin[k]!
      const xr = er + cs * or + sn * oi
      const xi = ei + cs * oi - sn * or
      out[k] = Math.sqrt(xr * xr + xi * xi)
    }
  }
}

/** 4-term Blackman-Harris window: low leakage, so neighbouring notes stay apart. */
export function blackmanHarris(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / (n - 1)
    w[i] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x)
  }
  return w
}
