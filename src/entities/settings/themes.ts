// Adaptive Atmosphere: the five appearance themes, in one place.
//
// Every value here is a CSS custom property. Components never hard-code
// colours: Tailwind utilities (bg-raised, text-fg-2, border-ink/[0.09] …) read
// these variables, so switching a theme is just rewriting them on <html>.
// The Default values are exactly the original Graphite tokens.

export type ThemeId = 'default' | 'night' | 'light' | 'pink' | 'ocean'

/** How the ambient artwork is rendered in this theme (the theme is the room; the artwork is the light). */
export interface AmbientTreatment {
  /** Which baked artwork bitmap + palette treatment to use. */
  variant: 'default' | 'night' | 'light'
  /** Slider value (0–100) that gives the designed look. */
  defaultIntensity: number
  /** Readability layer over the artwork: dark (or light) edges, an open pool behind the content. */
  scrim: string
  /** Optional theme-coloured light mixed in (blush, aqua). Never replaces the artwork's colours. */
  tint?: string
  noise: number
  /** Opacity of the moving colour pools (Library, while playing). */
  pools: number
}

export interface ThemeDef {
  id: ThemeId
  name: string
  mode: 'dark' | 'light'
  /** Swatches for the Settings preview tile. */
  preview: { base: string; sidebar: string; panel: string; accent: string; text: string; muted: string }
  vars: Record<string, string>
  ambient: AmbientTreatment
}

// The content column's centre sits right of the window's centre (176px sidebar).
const pool = (rgb: string, inner: number, mid: number, outer: number, bottom: number) =>
  [
    `radial-gradient(ellipse 60% 55% at 56% 22%, rgb(${rgb} / ${inner}) 0%, rgb(${rgb} / ${mid}) 55%, rgb(${rgb} / ${outer}) 100%)`,
    `linear-gradient(180deg, rgb(${rgb} / 0) 50%, rgb(${rgb} / ${bottom}) 100%)`
  ].join(', ')

export const THEMES: Record<ThemeId, ThemeDef> = {
  default: {
    id: 'default',
    name: 'Default',
    mode: 'dark',
    preview: { base: '#0e0f11', sidebar: '#16181b', panel: '#1b1d21', accent: '#8fa8c8', text: '#ecedee', muted: '#5f636a' },
    vars: {
      '--color-base': '#0e0f11',
      '--color-sidebar': '#16181b',
      '--color-raised': '#16181b',
      '--color-surface': 'rgb(20 22 25 / 0.92)',
      '--color-elevated': '#1c1e22',
      '--color-hover': 'rgb(255 255 255 / 0.05)',
      '--color-selected': 'rgb(143 168 200 / 0.11)',
      '--color-overlay': 'rgb(28 30 34 / 0.72)',
      '--color-line': 'rgb(255 255 255 / 0.06)',
      '--color-line-strong': 'rgb(255 255 255 / 0.12)',
      '--color-fg': '#ecedee',
      '--color-fg-2': '#9a9da3',
      '--color-fg-3': '#5f636a',
      '--color-accent': '#8fa8c8',
      '--color-accent-hover': '#9db4d1',
      '--color-accent-press': '#86a0c0',
      '--color-on-accent': '#0d1014',
      '--color-success': '#7fb89a',
      '--color-warning': '#d4b072',
      '--color-danger': '#d9817a',
      '--color-ink': '#ffffff',
      '--color-shade': '#000000',
      '--focus-halo': 'rgb(143 168 200 / 0.12)',
      '--card-bg': 'rgb(255 255 255 / 0.03)',
      '--shadow-card': 'inset 0 1px 0 rgb(255 255 255 / 0.035), 0 1px 2px rgb(0 0 0 / 0.25)',
      '--glass-panel-bg': 'rgb(22 24 27 / 0.82)',
      '--glass-popover-bg': 'rgb(27 29 33 / 0.97)',
      '--glass-toast-bg': 'rgb(26 28 32 / 0.9)',
      '--glass-bar-bg': 'rgb(17 18 21 / 0.84)',
      '--glass-bar-hover': 'rgb(24 26 29 / 0.88)',
      '--glass-sheet-bg': 'rgb(20 21 24 / 0.9)',
      '--glass-border': 'rgb(255 255 255 / 0.08)',
      '--glass-highlight': 'rgb(255 255 255 / 0.05)',
      '--scrim-bg': 'rgb(8 9 10 / 0.5)',
      '--shadow-panel': '0 0 0 1px rgb(0 0 0 / 0.3), 0 24px 64px rgb(0 0 0 / 0.5)',
      '--shadow-popover': '0 12px 32px rgb(0 0 0 / 0.45)',
      '--shadow-sheet': '0 -16px 40px rgb(0 0 0 / 0.35)',
      '--shadow-bar': '0 -8px 24px rgb(0 0 0 / 0.25)',
      '--scrollbar': 'rgb(255 255 255 / 0.08)',
      '--scrollbar-hover': 'rgb(255 255 255 / 0.14)',
      '--selection': 'rgb(143 168 200 / 0.35)',
      '--sheen': 'rgb(255 255 255 / 0.05)'
    },
    ambient: {
      variant: 'default',
      defaultIntensity: 60,
      scrim: pool('14 15 17', 0.34, 0.66, 0.88, 0.65),
      noise: 0.04,
      pools: 0.3
    }
  },

  night: {
    id: 'night',
    name: 'Night',
    mode: 'dark',
    preview: { base: '#07080a', sidebar: '#0b0c0e', panel: '#101114', accent: '#9eaabe', text: '#f0f1f3', muted: '#62666e' },
    vars: {
      '--color-base': '#07080a',
      '--color-sidebar': '#0b0c0e',
      '--color-raised': '#101114',
      '--color-surface': 'rgb(14 15 18 / 0.9)',
      '--color-elevated': '#202227',
      '--color-hover': '#1a1c20',
      '--color-selected': 'rgb(158 170 190 / 0.1)',
      '--color-overlay': 'rgb(16 17 20 / 0.78)',
      '--color-line': 'rgb(255 255 255 / 0.045)',
      '--color-line-strong': 'rgb(255 255 255 / 0.09)',
      '--color-fg': '#f0f1f3',
      '--color-fg-2': '#969aa3',
      '--color-fg-3': '#62666e',
      '--color-accent': '#9eaabe',
      '--color-accent-hover': '#b0bacb',
      '--color-accent-press': '#8f9bb0',
      '--color-on-accent': '#0a0b0d',
      '--color-success': '#7fb89a',
      '--color-warning': '#d4b072',
      '--color-danger': '#d9817a',
      // Slightly dimmed overlay ink: Night's borders and hovers sit a step quieter.
      '--color-ink': '#d4d7dc',
      '--color-shade': '#000000',
      '--focus-halo': 'rgb(158 170 190 / 0.12)',
      '--card-bg': 'rgb(255 255 255 / 0.022)',
      '--shadow-card': 'inset 0 1px 0 rgb(255 255 255 / 0.025), 0 1px 2px rgb(0 0 0 / 0.4)',
      '--glass-panel-bg': 'rgb(13 14 17 / 0.8)',
      '--glass-popover-bg': 'rgb(22 23 27 / 0.97)',
      '--glass-toast-bg': 'rgb(19 20 24 / 0.9)',
      '--glass-bar-bg': 'rgb(9 10 12 / 0.8)',
      '--glass-bar-hover': 'rgb(15 16 19 / 0.86)',
      '--glass-sheet-bg': 'rgb(12 13 16 / 0.9)',
      '--glass-border': 'rgb(255 255 255 / 0.06)',
      '--glass-highlight': 'rgb(255 255 255 / 0.04)',
      '--scrim-bg': 'rgb(2 3 4 / 0.55)',
      '--shadow-panel': '0 0 0 1px rgb(0 0 0 / 0.5), 0 24px 64px rgb(0 0 0 / 0.65)',
      '--shadow-popover': '0 12px 32px rgb(0 0 0 / 0.6)',
      '--shadow-sheet': '0 -16px 40px rgb(0 0 0 / 0.5)',
      '--shadow-bar': '0 -8px 24px rgb(0 0 0 / 0.4)',
      '--scrollbar': 'rgb(255 255 255 / 0.07)',
      '--scrollbar-hover': 'rgb(255 255 255 / 0.12)',
      '--selection': 'rgb(158 170 190 / 0.3)',
      '--sheen': 'rgb(255 255 255 / 0.04)'
    },
    ambient: {
      variant: 'night',
      defaultIntensity: 70,
      // A wider, more open pool of light, falling off to near-black at the edges.
      scrim: [
        'radial-gradient(ellipse 68% 62% at 56% 26%, rgb(7 8 10 / 0.12) 0%, rgb(7 8 10 / 0.5) 52%, rgb(7 8 10 / 0.9) 100%)',
        'linear-gradient(180deg, rgb(7 8 10 / 0) 55%, rgb(7 8 10 / 0.72) 100%)'
      ].join(', '),
      noise: 0.05,
      pools: 0.38
    }
  },

  light: {
    id: 'light',
    name: 'Light',
    mode: 'light',
    preview: { base: '#f5f4f1', sidebar: '#efeeeb', panel: '#ffffff', accent: '#637f9d', text: '#24272d', muted: '#a3a6ac' },
    vars: {
      '--color-base': '#f5f4f1',
      '--color-sidebar': '#efeeeb',
      '--color-raised': '#ffffff',
      '--color-surface': 'rgb(255 255 255 / 0.9)',
      '--color-elevated': '#ffffff',
      '--color-hover': '#e8e9e8',
      '--color-selected': 'rgb(99 127 157 / 0.12)',
      '--color-overlay': 'rgb(255 255 255 / 0.8)',
      '--color-line': '#e7e7e4',
      '--color-line-strong': '#dddedc',
      '--color-fg': '#24272d',
      '--color-fg-2': '#636770',
      '--color-fg-3': '#8b8f96',
      '--color-accent': '#637f9d',
      '--color-accent-hover': '#56718e',
      '--color-accent-press': '#4c6580',
      '--color-on-accent': '#ffffff',
      '--color-success': '#3e8a62',
      '--color-warning': '#a8792a',
      '--color-danger': '#c25a50',
      '--color-ink': '#2a2d33',
      '--color-shade': '#d6d4cf',
      '--focus-halo': 'rgb(99 127 157 / 0.2)',
      '--card-bg': 'rgb(255 255 255 / 0.62)',
      '--shadow-card': '0 1px 2px rgb(36 39 45 / 0.05)',
      '--glass-panel-bg': 'rgb(250 249 247 / 0.84)',
      '--glass-popover-bg': 'rgb(255 255 255 / 0.97)',
      '--glass-toast-bg': 'rgb(255 255 255 / 0.92)',
      '--glass-bar-bg': 'rgb(246 245 242 / 0.86)',
      '--glass-bar-hover': 'rgb(239 238 235 / 0.92)',
      '--glass-sheet-bg': 'rgb(250 249 247 / 0.93)',
      '--glass-border': 'rgb(36 39 45 / 0.1)',
      '--glass-highlight': 'rgb(255 255 255 / 0.7)',
      '--scrim-bg': 'rgb(70 66 60 / 0.2)',
      '--shadow-panel': '0 0 0 1px rgb(36 39 45 / 0.04), 0 24px 56px rgb(36 39 45 / 0.16)',
      '--shadow-popover': '0 10px 28px rgb(36 39 45 / 0.14)',
      '--shadow-sheet': '0 -12px 32px rgb(36 39 45 / 0.08)',
      '--shadow-bar': '0 -6px 20px rgb(36 39 45 / 0.05)',
      '--scrollbar': 'rgb(36 39 45 / 0.16)',
      '--scrollbar-hover': 'rgb(36 39 45 / 0.26)',
      '--selection': 'rgb(99 127 157 / 0.25)',
      '--sheen': 'rgb(255 255 255 / 0.6)'
    },
    ambient: {
      variant: 'light',
      defaultIntensity: 60,
      scrim: pool('245 244 241', 0.22, 0.56, 0.86, 0.62),
      noise: 0.025,
      pools: 0.4
    }
  },

  pink: {
    id: 'pink',
    name: 'Pink',
    mode: 'light',
    preview: { base: '#fff1f6', sidebar: '#f9e4ed', panel: '#ffffff', accent: '#c6779f', text: '#493641', muted: '#c9adbb' },
    vars: {
      '--color-base': '#fff1f6',
      '--color-sidebar': '#f9e4ed',
      '--color-raised': '#ffffff',
      '--color-surface': 'rgb(255 255 255 / 0.88)',
      '--color-elevated': '#ffffff',
      '--color-hover': '#f2d8e4',
      '--color-selected': 'rgb(198 119 159 / 0.12)',
      '--color-overlay': 'rgb(255 250 252 / 0.8)',
      '--color-line': '#f2dce6',
      '--color-line-strong': '#eacbd9',
      '--color-fg': '#493641',
      '--color-fg-2': '#856e7b',
      '--color-fg-3': '#a8909d',
      '--color-accent': '#c6779f',
      '--color-accent-hover': '#b9698f',
      '--color-accent-press': '#a95d83',
      '--color-on-accent': '#ffffff',
      '--color-success': '#4a8c69',
      '--color-warning': '#ad7a30',
      '--color-danger': '#c4566a',
      '--color-ink': '#5e3c4e',
      '--color-shade': '#f0cfdd',
      '--focus-halo': 'rgb(198 119 159 / 0.2)',
      '--card-bg': 'rgb(255 255 255 / 0.6)',
      '--shadow-card': '0 1px 2px rgb(120 60 90 / 0.06)',
      '--glass-panel-bg': 'rgb(255 247 250 / 0.84)',
      '--glass-popover-bg': 'rgb(255 252 253 / 0.97)',
      '--glass-toast-bg': 'rgb(255 250 252 / 0.92)',
      '--glass-bar-bg': 'rgb(253 240 246 / 0.86)',
      '--glass-bar-hover': 'rgb(249 231 240 / 0.92)',
      '--glass-sheet-bg': 'rgb(255 246 250 / 0.93)',
      '--glass-border': 'rgb(120 70 95 / 0.12)',
      '--glass-highlight': 'rgb(255 255 255 / 0.7)',
      '--scrim-bg': 'rgb(95 55 75 / 0.16)',
      '--shadow-panel': '0 0 0 1px rgb(120 60 90 / 0.04), 0 24px 56px rgb(120 60 90 / 0.16)',
      '--shadow-popover': '0 10px 28px rgb(120 60 90 / 0.14)',
      '--shadow-sheet': '0 -12px 32px rgb(120 60 90 / 0.08)',
      '--shadow-bar': '0 -6px 20px rgb(120 60 90 / 0.05)',
      '--scrollbar': 'rgb(73 54 65 / 0.16)',
      '--scrollbar-hover': 'rgb(73 54 65 / 0.26)',
      '--selection': 'rgb(198 119 159 / 0.25)',
      '--sheen': 'rgb(255 255 255 / 0.6)'
    },
    ambient: {
      variant: 'light',
      defaultIntensity: 60,
      scrim: pool('255 241 246', 0.2, 0.54, 0.86, 0.6),
      // Soft blush light from the top, mixed in with the artwork's own colours.
      tint: [
        'radial-gradient(55% 50% at 18% 0%, rgb(240 170 200 / 0.28) 0%, transparent 72%)',
        'radial-gradient(45% 45% at 92% 18%, rgb(248 196 214 / 0.22) 0%, transparent 70%)'
      ].join(', '),
      noise: 0.025,
      pools: 0.4
    }
  },

  ocean: {
    id: 'ocean',
    name: 'Ocean Blue',
    mode: 'light',
    preview: { base: '#dfeffa', sidebar: '#c9e3f4', panel: '#f4faff', accent: '#438cb8', text: '#244a63', muted: '#9bbad0' },
    vars: {
      '--color-base': '#dfeffa',
      '--color-sidebar': '#c9e3f4',
      '--color-raised': '#f4faff',
      '--color-surface': 'rgb(244 250 255 / 0.9)',
      '--color-elevated': '#fbfdff',
      '--color-hover': '#b8dbf0',
      '--color-selected': 'rgb(67 140 184 / 0.14)',
      '--color-overlay': 'rgb(240 248 255 / 0.8)',
      '--color-line': '#c9e1f0',
      '--color-line-strong': '#b6d6e9',
      '--color-fg': '#244a63',
      '--color-fg-2': '#55778c',
      '--color-fg-3': '#7895a8',
      '--color-accent': '#438cb8',
      '--color-accent-hover': '#3a7fa9',
      '--color-accent-press': '#336f95',
      '--color-on-accent': '#ffffff',
      '--color-success': '#3a8664',
      '--color-warning': '#a3772c',
      '--color-danger': '#bf5753',
      '--color-ink': '#1f4560',
      '--color-shade': '#a9d0ea',
      '--focus-halo': 'rgb(67 140 184 / 0.22)',
      '--card-bg': 'rgb(255 255 255 / 0.5)',
      '--shadow-card': '0 1px 2px rgb(30 70 100 / 0.07)',
      '--glass-panel-bg': 'rgb(236 246 253 / 0.84)',
      '--glass-popover-bg': 'rgb(246 251 255 / 0.97)',
      '--glass-toast-bg': 'rgb(244 250 255 / 0.92)',
      '--glass-bar-bg': 'rgb(212 233 247 / 0.86)',
      '--glass-bar-hover': 'rgb(202 227 244 / 0.92)',
      '--glass-sheet-bg': 'rgb(232 244 252 / 0.93)',
      '--glass-border': 'rgb(36 74 99 / 0.13)',
      '--glass-highlight': 'rgb(255 255 255 / 0.6)',
      '--scrim-bg': 'rgb(30 62 88 / 0.18)',
      '--shadow-panel': '0 0 0 1px rgb(30 70 100 / 0.05), 0 24px 56px rgb(30 70 100 / 0.18)',
      '--shadow-popover': '0 10px 28px rgb(30 70 100 / 0.16)',
      '--shadow-sheet': '0 -12px 32px rgb(30 70 100 / 0.1)',
      '--shadow-bar': '0 -6px 20px rgb(30 70 100 / 0.06)',
      '--scrollbar': 'rgb(36 74 99 / 0.2)',
      '--scrollbar-hover': 'rgb(36 74 99 / 0.3)',
      '--selection': 'rgb(67 140 184 / 0.25)',
      '--sheen': 'rgb(255 255 255 / 0.55)'
    },
    ambient: {
      variant: 'light',
      defaultIntensity: 60,
      scrim: pool('223 239 250', 0.2, 0.52, 0.85, 0.6),
      // Pale aqua and coastal-blue light; the artwork keeps its own colours underneath.
      tint: [
        'radial-gradient(55% 50% at 20% 0%, rgb(150 215 230 / 0.26) 0%, transparent 72%)',
        'radial-gradient(48% 48% at 90% 22%, rgb(120 180 230 / 0.2) 0%, transparent 70%)'
      ].join(', '),
      noise: 0.025,
      pools: 0.42
    }
  }
}

export const THEME_ORDER: ThemeId[] = ['default', 'night', 'light', 'pink', 'ocean']

export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && v in THEMES
