// MOCK ONLY — stands in for `yt-dlp --dump-single-json` until the backend exists.
// Nothing here touches the network. Titles, creators and streams are invented.

import type { MediaErrorCode, MediaInfo } from '@shared/types/media'
import { mockArtwork } from '../lib/mockArtwork'

type Seed = Omit<MediaInfo, 'thumbnailUrl' | 'url'> & {
  art: [string, string, string]
}

const MB = 1_000_000

const VIDEOS: Seed[] = [
  {
    id: 'v-coast',
    extractor: 'YouTube',
    title: 'Golden Hour Over the Coast — 4K Drone Film',
    creator: 'Northbound Aerials',
    durationSec: 766,
    art: ['#c9773e', '#2b3d63', '#f2c46d'],
    videoStreams: [
      { formatId: '401', height: 2160, fps: 60, vcodec: 'av1', sizeBytes: 1890 * MB },
      { formatId: '400', height: 1440, fps: 60, vcodec: 'vp9', sizeBytes: 920 * MB },
      { formatId: '299', height: 1080, fps: 60, vcodec: 'h264', sizeBytes: 410 * MB },
      { formatId: '298', height: 720, fps: 60, vcodec: 'h264', sizeBytes: 205 * MB }
    ],
    audioStreams: [
      { formatId: '251', acodec: 'opus', bitrateKbps: 160, sampleRateHz: 48000, channels: 2 },
      { formatId: '140', acodec: 'aac', bitrateKbps: 128, sampleRateHz: 44100, channels: 2 }
    ]
  },
  {
    id: 'v-keyboard',
    extractor: 'YouTube',
    title: 'Building a Mechanical Keyboard from Scratch',
    creator: 'Desk Lab',
    durationSec: 1082,
    art: ['#3a4a3f', '#1b2026', '#9fb38a'],
    videoStreams: [
      { formatId: '308', height: 1440, fps: 30, vcodec: 'vp9', sizeBytes: 780 * MB },
      { formatId: '137', height: 1080, fps: 30, vcodec: 'h264', sizeBytes: 340 * MB },
      { formatId: '136', height: 720, fps: 30, vcodec: 'h264', sizeBytes: 160 * MB }
    ],
    audioStreams: [{ formatId: '140', acodec: 'aac', bitrateKbps: 128, sampleRateHz: 44100, channels: 2 }]
  },
  {
    id: 'v-train',
    extractor: 'Vimeo',
    title: 'Night Train — a short film',
    creator: 'Ola Lindqvist',
    durationSec: 571,
    art: ['#5b2f4f', '#121826', '#d36b6b'],
    videoStreams: [
      { formatId: 'hls-1080', height: 1080, fps: 24, vcodec: 'h264', sizeBytes: 260 * MB },
      { formatId: 'hls-720', height: 720, fps: 24, vcodec: 'h264', sizeBytes: 130 * MB }
    ],
    audioStreams: [{ formatId: 'hls-audio', acodec: 'aac', bitrateKbps: 128, sampleRateHz: 48000, channels: 2 }]
  }
]

const TRACKS: Seed[] = [
  {
    id: 'm-midnight',
    extractor: 'SoundCloud',
    title: 'Midnight Drive (Lo-fi Mix)',
    creator: 'Kaito Rain',
    durationSec: 225,
    art: ['#4b3b8f', '#14162b', '#e08fb4'],
    videoStreams: [],
    audioStreams: [{ formatId: 'http_mp3_128', acodec: 'mp3', bitrateKbps: 128, sampleRateHz: 44100, channels: 2 }]
  },
  {
    id: 'm-bloom',
    extractor: 'YouTube',
    title: 'Slow Bloom',
    creator: 'Marigold Avenue',
    durationSec: 252,
    art: ['#d9a441', '#3d2a22', '#f0d9a8'],
    videoStreams: [],
    audioStreams: [
      { formatId: '251', acodec: 'opus', bitrateKbps: 160, sampleRateHz: 48000, channels: 2 },
      { formatId: '140', acodec: 'aac', bitrateKbps: 128, sampleRateHz: 44100, channels: 2 }
    ]
  },
  {
    id: 'm-harbor',
    extractor: 'Bandcamp',
    title: 'Glass Harbor',
    creator: 'Wren & the Tides',
    durationSec: 303,
    art: ['#2f6f78', '#0f1d24', '#a6d3c9'],
    videoStreams: [],
    // Bitrate deliberately unknown to show the "Source bitrate unknown" state.
    audioStreams: [{ formatId: 'mp3-128', acodec: 'mp3', sampleRateHz: 44100, channels: 2 }]
  }
]

export type AnalyzeErrorCode = MediaErrorCode

export class AnalyzeError extends Error {
  constructor(public code: AnalyzeErrorCode) {
    super(code)
  }
}

function hash(s: string): number {
  return [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0)
}

function pick(list: Seed[], url: string): Seed {
  return list[hash(url) % list.length]!
}

/**
 * Pretends to analyze a link. Special words in the URL trigger error states
 * so every state can be reviewed: "drm"/"netflix", "private", "removed",
 * "offline", "unsupported". "slow" takes 5 s so the Cancel option shows.
 */
export function mockAnalyze(rawUrl: string, kind: 'video' | 'audio', signal: AbortSignal): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    const url = rawUrl.trim()
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      /* handled below */
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.')) {
      reject(new AnalyzeError('INVALID_URL'))
      return
    }

    const delay = url.toLowerCase().includes('slow') ? 5000 : 900 + (hash(url) % 700)
    const timer = window.setTimeout(() => {
      const u = url.toLowerCase()
      if (/netflix|disneyplus|drm/.test(u)) return reject(new AnalyzeError('DRM_PROTECTED'))
      if (u.includes('private')) return reject(new AnalyzeError('AUTH_REQUIRED'))
      if (u.includes('removed')) return reject(new AnalyzeError('UNAVAILABLE'))
      if (u.includes('offline')) return reject(new AnalyzeError('NETWORK'))
      if (u.includes('unsupported')) return reject(new AnalyzeError('UNSUPPORTED_SITE'))

      const host = parsed!.hostname
      let seed: Seed
      if (kind === 'video') {
        seed = host.includes('vimeo') ? VIDEOS[2]! : pick(host.includes('youtu') ? VIDEOS.slice(0, 2) : VIDEOS, url)
      } else if (host.includes('soundcloud')) seed = TRACKS[0]!
      else if (host.includes('bandcamp')) seed = TRACKS[2]!
      else if (host.includes('youtu')) seed = TRACKS[1]!
      else seed = pick(TRACKS, url)

      const { art, ...info } = seed
      resolve({ ...info, url, thumbnailUrl: mockArtwork(seed.id, art, kind === 'video' ? 'wide' : 'square') })
    }, delay)

    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Canceled', 'AbortError'))
    })
  })
}

/** Artwork for the sample history rows. */
export function sampleArtwork(id: string, shape: 'wide' | 'square'): string {
  const seed = [...VIDEOS, ...TRACKS].find((s) => s.id === id)
  return seed ? mockArtwork(seed.id, seed.art, shape) : ''
}
