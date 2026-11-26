import { useEffect, useRef, useState } from 'react'
import type { Palette, AmbientVariant } from '@/shared/lib/palette'

// The animated background: one continuous atmosphere of soft coloured light
// over near-black. Several layers of slow "domain-warped" noise fold into each
// other, so lit and dark regions keep stretching, bending, merging and
// splitting as they drift: the shapes morph, they don't just move. Colours
// come from the artwork; the noise never repeats, so it never snaps back.
// Drawn small on the GPU and scaled up (it's all soft, so that's invisible).

export type RGB = [number, number, number]

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface AtmosphereColors {
  /** Four light colours, from the artwork's dominant colours. */
  light: RGB[]
  /** The darkness they emerge from: near-black, faintly tinted by the artwork. */
  dark: RGB
}

/**
 * Artwork colours as diffused light. Kept muted like the reference (soft mid-tones,
 * never neon). `stage` (Now Playing) is a little richer than the dimmed app pages.
 * Light themes invert it: pastel light in a pale room.
 */
export function atmosphereColors(p: Palette | undefined, variant: AmbientVariant, stage: boolean): AtmosphereColors {
  const src = p?.hsl.length ? p.hsl : [[230, 0.25, 0.45] as [number, number, number]]
  const pick = (i: number) => src[i % src.length]!
  const [h0, s0] = pick(0)
  if (variant === 'light') {
    return {
      light: [0, 1, 2, 3].map((i) => {
        const [h, s] = pick(i)
        return hslToRgb(h, clamp(s, 0.2, 0.5), 0.74 + (i % 2) * 0.05)
      }),
      dark: hslToRgb(h0, clamp(s0, 0.1, 0.3), 0.93)
    }
  }
  const rich = stage || variant === 'night'
  return {
    light: [0, 1, 2, 3].map((i) => {
      const [h, s, l] = pick(i)
      return hslToRgb(h, clamp(s * (rich ? 1.0 : 0.8), 0.18, rich ? 0.6 : 0.45), clamp(l, rich ? 0.38 : 0.3, rich ? 0.52 : 0.42) + (i % 2 ? 0.03 : -0.02))
    }),
    dark: hslToRgb(h0, clamp(s0, 0.15, 0.4), 0.018)
  }
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`

// Simplex noise: Ian McEwan / Ashima Arts (MIT licence).
const FRAG = `
precision highp float;
uniform vec3 uCol[4];
uniform vec3 uDark;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
// Broad, low-detail noise: big shapes only (two gentle octaves).
float fbm(vec2 p) { return 0.78 * snoise(p) + 0.22 * snoise(p * 1.7 + 3.1); }

void main() {
  // Stretched sideways: the light forms wide bands rather than round clouds.
  vec2 p = vec2((vUv.x - 0.5) * uAspect * 0.6, vUv.y - 0.5);
  float t = uTime;

  // The current: a slow drift whose direction itself wanders (diagonal, then sideways,
  // then back), so the light sweeps across the space instead of panning like wallpaper.
  vec2 flow = vec2(t * 0.05, t * 0.02) + 1.3 * vec2(snoise(vec2(t * 0.031, 1.7)), snoise(vec2(t * 0.027, 8.3)));

  // Two rounds of warping, carried by the current: the shapes stretch, narrow, bend,
  // merge and split as they travel.
  vec2 q = vec2(fbm(p * 0.9 + flow * 0.5 + vec2(0.0, t * 0.05)),
                fbm(p * 0.9 + vec2(5.2, 1.3) - flow * 0.4 + vec2(t * 0.045, 0.0)));
  vec2 r = vec2(fbm(p * 0.7 + q * 0.45 + vec2(1.7, 9.2) + t * 0.04),
                fbm(p * 0.7 + q * 0.45 + vec2(8.3, 2.8) - t * 0.035));
  float f = fbm(p * 0.75 + r * 0.42 + flow * 0.8);

  // Wide regions that slowly sink into near-black and open up again: darkness moves too.
  float g = snoise(p * 0.35 + flow * 0.35 + vec2(t * 0.02, -t * 0.015));
  float light = smoothstep(-0.85, 0.5, f) * smoothstep(-1.15, 0.0, g);

  // The artwork's colours ride the same current, so hues travel with the light.
  float h1 = smoothstep(0.15, 0.85, fbm(p * 0.45 + r * 0.5 + flow * 0.7 + vec2(11.0, 0.0)) * 0.5 + 0.5);
  float h2 = smoothstep(0.2, 0.8, fbm(p * 0.4 - r * 0.4 + flow * 0.55 + vec2(-7.0, 3.0)) * 0.5 + 0.5);
  vec3 col = mix(mix(uCol[0], uCol[1], h1), mix(uCol[2], uCol[3], h1), h2);

  // Where light gathers it glows a touch richer; edges stay soft.
  vec3 c = mix(uDark, col, light) + col * pow(light, 2.5) * 0.22;
  gl_FragColor = vec4(c, 1.0);
}`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
}

/** Seconds of "atmosphere time" per real second: slow and calm, calibrated against the reference. */
const SPEED = 4.5

const css = ([r, g, b]: RGB) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`

/**
 * The atmosphere. `moving`: animate (Settings → Moving background, or Now Playing);
 * `paused`: window hidden. Without WebGL, a CSS version of the same idea (slow,
 * huge, blurred light) takes over so it still moves.
 */
export function AtmosphereLight({ colors, opacity = 1, moving, paused }: { colors: AtmosphereColors; opacity?: number; moving: boolean; paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [noGl, setNoGl] = useState(false)
  const live = useRef({ colors, moving, paused })
  live.current = { colors, moving, paused }

  useEffect(() => {
    const el = ref.current
    const gl = el?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!el || !gl) return setNoGl(true)
    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG.replace('precision highp float;', gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'precision highp float;' : 'precision mediump float;'))
    const prog = gl.createProgram()
    if (!vs || !fs || !prog) return setNoGl(true)
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return setNoGl(true)
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    const uCol = gl.getUniformLocation(prog, 'uCol')
    const uDark = gl.getUniformLocation(prog, 'uDark')
    const uTime = gl.getUniformLocation(prog, 'uTime')
    const uAspect = gl.getUniformLocation(prog, 'uAspect')

    let alive = true
    // A random starting point far into the noise: every song opens on a different sky.
    let time = 200 + Math.random() * 2000
    let last = performance.now()
    let raf = 0
    let timer = 0
    const draw = (now: number) => {
      const s = live.current
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const w = Math.max(48, Math.round(el.clientWidth / 8))
      const h = Math.max(27, Math.round(el.clientHeight / 8))
      if (el.width !== w || el.height !== h) {
        el.width = w
        el.height = h
        gl.viewport(0, 0, w, h)
      }
      if (s.moving) time += dt * SPEED
      gl.uniform3fv(uCol, s.colors.light.flat())
      gl.uniform3fv(uDark, s.colors.dark)
      gl.uniform1f(uTime, time)
      el.dataset.t = time.toFixed(3)
      gl.uniform1f(uAspect, w / h)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    // ~30 fps is plenty for something this slow; when still or hidden, check back twice a second.
    const loop = (now: number) => {
      if (!alive) return
      const s = live.current
      if (s.paused || !s.moving) {
        draw(now)
        timer = window.setTimeout(() => (raf = requestAnimationFrame(loop)), 500)
        return
      }
      if (now - last >= 30) draw(now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  if (noGl) {
    const [a, b, c] = colors.light
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: css(colors.dark), opacity }} data-atmosphere-css>
        <div className="absolute inset-[-20%]" style={{ filter: 'blur(80px)' }}>
          {[a!, b!, c!].map((col, i) => (
            <div
              key={i}
              className="atmo-band absolute"
              style={{
                left: `${[-10, 30, 5][i]}%`,
                top: `${[5, 35, 55][i]}%`,
                width: `${[80, 70, 90][i]}%`,
                height: `${[45, 40, 35][i]}%`,
                borderRadius: '50%',
                background: `radial-gradient(closest-side, ${css(col)}, transparent)`,
                animationName: `atmo-${i}`,
                animationDuration: `${47 + i * 13}s`,
                animationDelay: `${-i * 17}s`,
                animationPlayState: moving && !paused ? 'running' : 'paused'
              }}
            />
          ))}
        </div>
      </div>
    )
  }
  // Slightly oversized + blurred: soft as fog, with no edge showing at the window border.
  return <canvas ref={ref} className="absolute inset-[-4%] size-[108%]" style={{ opacity, filter: 'blur(min(44px, 3.2vmin))' }} />
}
