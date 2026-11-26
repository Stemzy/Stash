import swooshUrl from '@/assets/sounds/intro-swoosh.mp3?url'
import hitUrl from '@/assets/sounds/intro-hit.mp3?url'
import { settingsStore } from '@/entities/settings/model'

// Startup intro, played over the app once it's on screen:
//   1. pop: a light frosted layer slides in and the icon spins in fast, landing
//      exactly on the peak of the first sound (the rising swoosh)
//   2. hold: it settles with a bounce, the star glints, then it winds up (leans back)
//   3. punch: on the second sound's hit: white flash, squash, comic burst,
//      shockwave ring, and the whole app jolts
//   4. knock-back: it spins off into the distance with a motion trail, for as long
//      as the whoosh lasts, and twinkles where it vanishes; the frost clears
// Sound and picture run off the same clock (the audio clock), so they stay in sync.
// Timings below were measured from the sound files themselves.

/** "swoosh 015": builds from 0.28 s, peaks at 0.46 s, gone by 0.64 s. */
const SWOOSH = { onset: 0.28, peak: 0.46, end: 0.64 }
/** "simple whoosh": hits at 0.10 s, peaks at 0.16 s, tail fades by ~0.45 s. */
const HIT = { onset: 0.1, peak: 0.16, tail: 0.45 }
const HOLD = 0.55 // how long the icon sits there before it gets hit
const FLIGHT = HIT.tail - HIT.onset + 0.08 // the knock-back lasts as long as the whoosh
const LEAD = 0.08 // tiny head start so audio and animation begin together

async function loadSounds(ctx: AudioContext): Promise<[AudioBuffer, AudioBuffer] | null> {
  try {
    const get = async (u: string) => ctx.decodeAudioData(await (await fetch(u)).arrayBuffer())
    // Local files decode in a few ms; never hold the intro back for long.
    return await Promise.race([Promise.all([get(swooshUrl), get(hitUrl)]), new Promise<null>((r) => setTimeout(() => r(null), 600))])
  } catch {
    return null
  }
}

function play(ctx: AudioContext, buf: AudioBuffer, at: number, volume: number): void {
  const src = ctx.createBufferSource()
  const g = ctx.createGain()
  src.buffer = buf
  g.gain.value = volume
  src.connect(g).connect(ctx.destination)
  src.start(at)
  src.onended = () => g.disconnect()
}

let running = false

/**
 * Runs the intro once the app has drawn its first frame, then hides it.
 * `preview` (the play button in Settings) plays it even if it's switched off.
 */
export async function runSplash(preview = false): Promise<void> {
  if (running) return
  const splash = document.getElementById('splash')
  const $ = <T extends HTMLElement>(sel: string) => splash?.querySelector<T>(sel) ?? null
  const mark = $('.mark')
  const glass = $('.glass')
  const burst = $('.burst')
  const ring = $('.ring')
  const twinkle = $('.twinkle')
  const glint = $('.glint')
  const ghosts = [...(splash?.querySelectorAll<HTMLElement>('.ghost') ?? [])]
  if (!splash || !mark || !glass || !burst || !ring || !twinkle || !glint) return
  running = true
  // Hidden rather than removed, so Settings can play it again.
  const finish = () => {
    splash.getAnimations({ subtree: true }).forEach((a) => a.cancel())
    splash.style.display = 'none'
    running = false
  }
  splash.style.display = ''

  // Off in Settings, launched in the background, or Windows "reduce animations": just the app.
  const settings = settingsStore.get()
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // Why it did or didn't play, readable in DevTools: document.getElementById('splash').dataset.intro
  const skip = (why: string) => {
    splash.dataset.intro = `skipped: ${why}`
    finish()
  }
  if (!preview && !settings.startupAnimation) return skip('turned off in Settings')
  if (!preview && reduce) return skip('Windows "reduce animations" is on')
  // The window opens hidden while the app loads and is shown a moment later: wait for that,
  // and only skip if it stays hidden (Stash started minimised or in the background).
  if (!preview && document.hidden) {
    const shown = await new Promise<boolean>((resolve) => {
      const done = (v: boolean) => {
        document.removeEventListener('visibilitychange', onVis)
        clearTimeout(timer)
        resolve(v)
      }
      const onVis = () => !document.hidden && done(true)
      document.addEventListener('visibilitychange', onVis)
      const timer = setTimeout(() => done(!document.hidden), 4000)
    })
    if (!shown) return skip('window not visible')
  }
  splash.dataset.intro = 'played'

  // The app first: wait until it has rendered and its fonts are in.
  await Promise.all([(document.fonts?.ready ?? Promise.resolve()).catch(() => undefined), new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))])

  const { sounds } = settings
  // A bit quieter than the other sounds: it's a flourish, not an alert.
  const volume = sounds.startup ? Math.pow(Math.max(0, Math.min(100, sounds.volume)) / 100, 2) * 0.6 : 0
  let ctx: AudioContext | null = null
  let bufs: [AudioBuffer, AudioBuffer] | null = null
  if (volume > 0) {
    try {
      ctx = new AudioContext()
      if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
      bufs = await loadSounds(ctx)
    } catch {
      ctx = null
    }
  }

  // The shared timeline, in seconds from "now".
  const swooshStart = LEAD
  const popFrom = swooshStart + SWOOSH.onset - 0.04 // appears as the swoosh rises...
  const landAt = swooshStart + SWOOSH.peak // ...full size exactly on its peak
  const impact = landAt + HOLD // the punch lands...
  const hitStart = impact - HIT.onset // ...so the whoosh starts early enough to hit right then
  const goneAt = impact + FLIGHT // gone into the distance as the whoosh fades
  const total = goneAt + 0.45

  // Audio is scheduled on the audio clock; the animations start at the same moment
  // (plus the sound card's own delay, so what you hear and see line up).
  let shift = 0
  if (ctx && bufs) {
    const t0 = ctx.currentTime
    play(ctx, bufs[0], t0 + swooshStart, volume)
    play(ctx, bufs[1], t0 + hitStart, volume * 0.95)
    shift = (ctx.outputLatency || ctx.baseLatency || 0) as number
    setTimeout(() => void ctx?.close().catch(() => undefined), (total + 1.5) * 1000)
  }

  const ms = (s: number) => Math.round((s + shift) * 1000)
  const dur = (s: number) => Math.round(s * 1000)
  // fill 'both' holds the first frame while waiting; a later move on the same element
  // must only hold forwards, or its first frame would cover the earlier one.
  const anim = (el: Element, frames: Keyframe[], start: number, length: number, easing = 'linear', fill: FillMode = 'both') =>
    el.animate(frames, { delay: ms(start), duration: dur(length), fill, easing })
  const at = (t: number, from: number, to: number) => Math.min(1, Math.max(0, (t - from) / (to - from)))

  // 1. Pop: the frost slides in, the icon spins in fast, overshoots on the peak, settles.
  anim(glass, [{ opacity: 0 }, { opacity: 1 }], popFrom - 0.06, landAt - popFrom + 0.06, 'ease-out')
  anim(
    mark,
    [
      { transform: 'scale(0.05) rotate(-200deg)', opacity: 0, filter: 'blur(6px) brightness(1.6)' },
      { transform: 'scale(1.25) rotate(8deg)', opacity: 1, filter: 'blur(0px) brightness(1.15)', offset: at(landAt, popFrom, impact) },
      { transform: 'scale(0.9, 1.08) rotate(-3deg)', filter: 'blur(0px) brightness(1)', offset: at(landAt + 0.09, popFrom, impact) },
      { transform: 'scale(1.05, 0.97) rotate(1.5deg)', offset: at(landAt + 0.18, popFrom, impact) },
      { transform: 'scale(1) rotate(0deg)', offset: at(landAt + 0.28, popFrom, impact) },
      { transform: 'scale(1) rotate(0deg)', offset: at(impact - 0.16, popFrom, impact) },
      // 2. Wind-up: it leans back just before the hit.
      { transform: 'scale(0.96, 1.04) rotate(-7deg) translate(-8px, 3px)', opacity: 1, filter: 'blur(0px) brightness(1)' }
    ],
    popFrom,
    impact - popFrom,
    'cubic-bezier(0.2, 0.8, 0.3, 1)'
  )
  // The star glints while it sits there.
  anim(glint, [{ opacity: 0, transform: 'scale(0.4) rotate(-20deg)' }, { opacity: 1, transform: 'scale(1.05) rotate(0deg)', offset: 0.35 }, { opacity: 0, transform: 'scale(0.8) rotate(10deg)' }], landAt + 0.12, 0.45, 'ease-out')

  // 3. Punch: white flash and squash, a comic burst, a shockwave, and the app jolts.
  const flight: Keyframe[] = [
    { transform: 'translate(0, 0) scale(1.22, 0.8) rotate(-6deg)', filter: 'brightness(3.2) saturate(0.4) blur(0px)', offset: 0 },
    { transform: 'translate(3vw, -2.5vh) scale(0.95, 1.05) rotate(55deg)', filter: 'brightness(1.6) blur(0px)', offset: 0.14 },
    { transform: 'translate(22vw, -20vh) scale(0.34) rotate(380deg)', filter: 'brightness(1) blur(1.5px)', offset: 0.6 },
    { transform: 'translate(36vw, -33vh) scale(0.03) rotate(760deg)', filter: 'brightness(1) blur(3px)' }
  ]
  const flightEase = 'cubic-bezier(0.12, 0.6, 0.3, 1)'
  anim(mark, flight.map((f, i) => ({ ...f, opacity: i === flight.length - 1 ? 0.9 : 1 })), impact, FLIGHT, flightEase, 'forwards')
  // 4. Motion trail: fading copies a few frames behind.
  ghosts.forEach((g, i) => {
    const o = [0.38, 0.22, 0.12][i] ?? 0.1
    anim(g, flight.map((f, k) => ({ ...f, opacity: k === 0 ? 0 : k === flight.length - 1 ? 0 : o })), impact + 0.025 * (i + 1), FLIGHT, flightEase)
  })
  anim(burst, [{ opacity: 0, transform: 'scale(0.3) rotate(0deg)' }, { opacity: 1, transform: 'scale(1) rotate(8deg)', offset: 0.25 }, { opacity: 0, transform: 'scale(1.4) rotate(14deg)' }], impact - 0.01, 0.22, 'ease-out')
  anim(ring, [{ opacity: 0, transform: 'scale(0.55)' }, { opacity: 0.95, transform: 'scale(0.6)', offset: 0.03 }, { opacity: 0, transform: 'scale(2.8)' }], impact, 0.42, 'cubic-bezier(0.1, 0.7, 0.3, 1)')
  const shake: Keyframe[] = [
    { transform: 'translate(0, 0)' },
    { transform: 'translate(-8px, 5px)' },
    { transform: 'translate(7px, -4px)' },
    { transform: 'translate(-4px, -2px)' },
    { transform: 'translate(2px, 2px)' },
    { transform: 'translate(0, 0)' }
  ]
  const root = document.getElementById('root')
  if (root) anim(root, shake, impact, 0.24, 'linear', 'none')
  anim(glass, shake, impact, 0.24, 'linear', 'none')

  // 5. Ding: a twinkle where it vanishes, while the frost clears and the app is back.
  anim(twinkle, [{ opacity: 0, transform: 'scale(0) rotate(0deg)' }, { opacity: 1, transform: 'scale(1.15) rotate(45deg)', offset: 0.35 }, { opacity: 0, transform: 'scale(0.2) rotate(90deg)' }], goneAt - 0.05, 0.4, 'ease-out')
  const clear = anim(glass, [{ opacity: 1 }, { opacity: 0 }], impact + 0.08, goneAt - impact + 0.25, 'ease-in-out', 'forwards')
  void clear.finished.then(() => setTimeout(finish, dur(Math.max(0, total - (goneAt + 0.33)))), finish)
}
