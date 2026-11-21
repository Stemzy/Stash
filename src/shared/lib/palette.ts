// Pulls a few dominant colors out of a thumbnail for the ambient background,
// then mutes them so even a neon thumbnail gives a calm glow.

export interface Palette {
  colors: string[] // muted CSS colors, most dominant first
  /** The same dominant colours, untoned (h 0–360, s/l 0–1), for theme-specific treatments. */
  hsl: [number, number, number][]
  luminance: number // 0..1 average brightness of the thumbnail
}

const cache = new Map<string, Promise<Palette>>()

export function extractPalette(src: string): Promise<Palette> {
  let p = cache.get(src)
  if (!p) {
    p = load(src)
      .then(analyze)
      .catch(() => ({ colors: [], hsl: [], luminance: 0.3 }))
    cache.set(src, p)
  }
  return p
}

/** Everything the ambient background needs from one thumbnail, in one theme style. */
export interface AmbientArt {
  palette: Palette
  /** The artwork already blurred and toned into a small image (no live CSS blur needed). */
  blurred: string
}

/**
 * How a theme renders artwork:
 * - default: the original Graphite treatment (dimmed, slightly desaturated);
 * - night: richer and brighter light, meant to pool into near-black surroundings;
 * - light: a soft pastel wash (washed toward white, never muddied toward grey).
 */
export type AmbientVariant = 'default' | 'night' | 'light'

const imgCache = new Map<string, Promise<HTMLImageElement>>()
const paletteCache = new Map<string, Palette>()
const artCache = new Map<string, Promise<AmbientArt>>()

function loadCached(src: string): Promise<HTMLImageElement> {
  let p = imgCache.get(src)
  if (!p) {
    p = load(src)
    p.catch(() => imgCache.delete(src))
    imgCache.set(src, p)
  }
  return p
}

/**
 * Loads a thumbnail once and pre-renders the blurred background for a theme style.
 * The blur is baked into a 320×180 bitmap here, one time per image and style, so
 * the background only ever moves/fades a plain image on the GPU instead of
 * re-blurring the window every frame. Scaled up, a blurred bitmap stays smooth.
 * Rejects if the image can't be loaded (the caller falls back to the plain theme).
 */
export function prepareAmbientArt(src: string, variant: AmbientVariant = 'default'): Promise<AmbientArt> {
  const key = `${variant}|${src}`
  let p = artCache.get(key)
  if (!p) {
    p = loadCached(src).then((img) => {
      let palette = paletteCache.get(src)
      if (!palette) {
        palette = analyze(img)
        paletteCache.set(src, palette)
      }
      const W = 320
      const H = 180
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      const lum = palette.luminance
      if (variant === 'light') ctx.filter = 'blur(18px) saturate(0.62) brightness(1.04)'
      else if (variant === 'night') ctx.filter = `blur(18px) saturate(1) brightness(${lum > 0.6 ? 0.38 : lum > 0.45 ? 0.45 : 0.52})`
      // Default: bright thumbnails are dimmed more so text on top stays readable.
      else ctx.filter = `blur(16px) saturate(0.8) brightness(${lum > 0.6 ? 0.3 : lum > 0.45 ? 0.36 : 0.42})`
      // Cover-fit, slightly oversized so the blurred edges fall off-canvas.
      const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight) * 1.2
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
      if (variant === 'light') {
        // Pastel: lift every colour toward white (only where there is artwork), keeping its hue.
        ctx.filter = 'none'
        ctx.globalCompositeOperation = 'source-atop'
        ctx.fillStyle = `rgb(255 255 255 / ${lum > 0.6 ? 0.36 : 0.5})`
        ctx.fillRect(0, 0, W, H)
      }
      return { palette, blurred: canvas.toDataURL('image/png') }
    })
    p.catch(() => artCache.delete(key))
    artCache.set(key, p)
  }
  return p
}

/** The palette's colours toned for a theme style (the artwork's hues are always kept). */
export function ambientColors(p: Palette | undefined, variant: AmbientVariant): string[] {
  if (!p) return []
  if (variant === 'default') return p.colors
  return p.hsl.map(([h, s, l]) =>
    variant === 'night'
      ? `hsl(${Math.round(h)} ${Math.round(Math.min(s, 0.55) * 100)}% ${Math.round(clamp(l, 0.22, 0.4) * 100)}%)`
      : `hsl(${Math.round(h)} ${Math.round(Math.min(s, 0.55) * 85)}% ${Math.round(clamp(0.8 + (l - 0.5) * 0.1, 0.76, 0.86) * 100)}%)`
  )
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Saved thumbnails come from the app's own scheme; CORS keeps the canvas readable.
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function analyze(img: HTMLImageElement): Palette {
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { colors: [], hsl: [], luminance: 0.3 }
  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data

  // Bucket pixels by 4 bits per channel and count them.
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  let lumSum = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!,
      g = data[i + 1]!,
      b = data[i + 2]!
    lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const e = buckets.get(key)
    if (e) {
      e.r += r
      e.g += g
      e.b += b
      e.n++
    } else buckets.set(key, { r, g, b, n: 1 })
  }

  const sorted = [...buckets.values()]
    .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n }))
    .map((c) => ({ ...c, hsl: rgbToHsl(c.r, c.g, c.b) }))
    // Prefer colorful buckets over grey ones, then by size.
    .sort((a, b) => b.n * (0.35 + b.hsl[1]) - a.n * (0.35 + a.hsl[1]))

  const picked: [number, number, number][] = []
  for (const c of sorted) {
    if (picked.length >= 4) break
    if (picked.every((p) => hueDistance(p[0], c.hsl[0]) > 24 || Math.abs(p[2] - c.hsl[2]) > 0.25)) {
      picked.push(c.hsl)
    }
  }

  return {
    hsl: picked,
    luminance: lumSum / (data.length / 4),
    // Clamp to the plan's range: 15–35% lightness, at most 45% saturation.
    colors: picked.map(([h, s, l]) => `hsl(${Math.round(h)} ${Math.round(Math.min(s, 0.45) * 100)}% ${Math.round(clamp(l, 0.15, 0.35) * 100)}%)`)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}
