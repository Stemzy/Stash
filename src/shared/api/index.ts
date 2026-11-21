import type { StashApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    api?: StashApi
  }
}

// Typed access to the preload bridge. When the renderer is opened in a plain
// browser (no Electron), a harmless fallback keeps the UI usable for review.
const fallback: StashApi = {
  platform: 'browser',
  system: {
    pickFolder: async () => null,
    defaultFolders: async () => ({ videos: 'C:\\Users\\you\\Videos', music: 'C:\\Users\\you\\Music'}),
    toolsStatus: async () => [],
    setAppearance: async () => undefined
  },
  appUpdate: {
    status: async () => ({ phase: 'unsupported', current: __APP_VERSION__ }),
    check: async () => ({ phase: 'unsupported', current: __APP_VERSION__ }),
    download: async () => undefined,
    install: async () => undefined,
    later: async () => undefined,
    skip: async () => undefined,
    onChange: () => () => undefined
  },
  updates: {
    state: async () => ({ auto: false, progress: { phase: 'idle' } }),
    setAuto: async () => ({ auto: false, progress: { phase: 'idle' } }),
    checkNow: async () => ({ auto: false, progress: { phase: 'idle' } }),
    onProgress: () => () => undefined
  },
  media: {
    analyze: async () => ({ ok: false, error: { code: 'TOOLS_MISSING' } }),
    cancelAnalyze: async () => undefined
  },
  jobs: {
    enqueueAudio: async () => ({ ok: false, message: 'Only available in the desktop app.' }),
    enqueueVideo: async () => ({ ok: false, message: 'Only available in the desktop app.' }),
    list: async () => [],
    cancel: async () => undefined,
    pause: async () => undefined,
    resume: async () => undefined,
    retry: async () => false,
    again: async () => ({ ok: false, message: 'Only available in the desktop app.' }),
    remove: async () => undefined,
    clearHistory: async () => undefined,
    reveal: async () => 'missing',
    deleteDownload: async () => 'failed',
    reorder: async () => undefined,
    setConcurrency: async () => undefined,
    onUpdate: () => () => undefined
  },
  library: {
    list: async () => [],
    openExternal: async () => false
  },

  lab: {
    pickFile: async () => ({ ok: false, code: 'TOOLS_MISSING', message: 'Desktop app only.' }),
    openDropped: async () => ({ ok: false, code: 'TOOLS_MISSING', message: 'Desktop app only.' }),
    openLibrary: async () => ({ ok: false, code: 'TOOLS_MISSING', message: 'Desktop app only.' }),
    waveform: async () => ({ ok: false, code: 'TOOLS_MISSING' }),
    analyzeKey: async () => ({ ok: false, code: 'TOOLS_MISSING' }),
    analyzeTempo: async () => ({ ok: false, code: 'TOOLS_MISSING' }),
    pcm: async () => ({ ok: false, code: 'TOOLS_MISSING' }),
    cancel: async () => undefined,
    saveUser: async () => false,
    close: async () => undefined,
    onProgress: () => () => undefined,
    peaks: async () => ({ ok: false, code: 'TOOLS_MISSING' }),
    measure: async () => ({ ok: false, code: 'TOOLS_MISSING' }),
    preview: async () => ({ ok: false, code: 'TOOLS_MISSING' }),
    exportAudio: async () => ({ ok: false, code: 'TOOLS_MISSING' }),
    revealExport: async () => false
  }
}

export const api: StashApi = window.api ?? fallback
export const isElectron = !!window.api
