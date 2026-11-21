// MOCK ONLY. Paints placeholder thumbnails locally so the UI (and the ambient
// background) can be reviewed without loading anything from the internet.
// Replaced by real cached thumbnails when the backend is connected.

const cache = new Map<string, string>()

export function mockArtwork(seed: string, colors: [string, string, string], shape: 'wide' | 'square'): string {
  const key = `${seed}:${shape}`
  const hit = cache.get(key)
  if (hit) return hit
  const w = shape === 'wide' ? 640 : 480
  const h = shape === 'wide' ? 360 : 480
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return ''

  const [a, b, d] = colors
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, a)
  g.addColorStop(1, b)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // A few soft shapes so the blur has something to work with.
  let s = [...seed].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let i = 0; i < 5; i++) {
    const x = rnd() * w, y = rnd() * h, r = (0.2 + rnd() * 0.35) * Math.max(w, h)
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r)
    rg.addColorStop(0, i % 2 ? d : a)
    rg.addColorStop(1, 'transparent')
    ctx.globalAlpha = 0.55
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, w, h)
  }
  ctx.globalAlpha = 1
  // Subject silhouette: a simple horizon / disc.
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.beginPath()
  ctx.ellipse(w * 0.5, h * 1.05, w * 0.7, h * 0.35, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.beginPath()
  ctx.arc(w * (0.3 + rnd() * 0.4), h * (0.3 + rnd() * 0.2), Math.min(w, h) * 0.12, 0, Math.PI * 2)
  ctx.fill()

  const url = c.toDataURL('image/png')
  cache.set(key, url)
  return url
}
