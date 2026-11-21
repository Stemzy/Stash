import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import { registerSystemIpc } from './ipc/system.ipc'
import { registerUpdatesIpc } from './ipc/updates.ipc'
import { registerMediaIpc } from './ipc/media.ipc'
import { registerJobsIpc } from './ipc/jobs.ipc'
import { protocol } from 'electron'
import { handleThumbScheme, thumbSchemePrivileges } from './services/jobs/thumbs'
import { handleMediaScheme, mediaSchemePrivileges } from './services/library/library'
import { registerLibraryIpc } from './ipc/library.ipc'
import { registerLabIpc } from './ipc/lab.ipc'
import { savedAppearance } from './lib/appearance'
import { carryOverOldName } from './lib/rename'

function createWindow(): void {
  // Last theme's colours, so a light theme doesn't flash dark (or vice versa) at startup.
  const look = savedAppearance()
  nativeTheme.themeSource = look.mode
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: look.background,
    titleBarStyle: 'hidden',
    // Native Windows caption buttons drawn over our own title bar.
    titleBarOverlay: { color: '#00000000', symbolColor: look.symbolColor, height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // The window only ever shows the app. A file dropped outside a drop zone must not replace it.
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (!(dev && url.startsWith(dev))) e.preventDefault()
  })

  // Never open new windows inside the app; hand http(s) links to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Private schemes for saved thumbnails and in-app playback. Must be registered before ready.
protocol.registerSchemesAsPrivileged([thumbSchemePrivileges, mediaSchemePrivileges])

// Before the single-instance lock: it lives in the data folder this may move.
carryOverOldName()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    handleThumbScheme()
    handleMediaScheme()
    registerSystemIpc()
    // Updates are extras: a failure here must never stop the window from opening.
    await registerUpdatesIpc().catch((e) => console.warn('updates unavailable', e))
    registerMediaIpc()
    await registerJobsIpc() // loads saved jobs before the window asks for them
    registerLibraryIpc()
    allowOnlyWhatTheAppUses()
    registerLabIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/**
 * Permissions, only for the app's own window: full screen for the video player and
 * writing to the clipboard for Copy buttons (never reading it). Everything else
 * (camera, microphone, screen capture, location, notifications…) is refused.
 */
function allowOnlyWhatTheAppUses(): void {
  const ours = (wc: Electron.WebContents | null) => !!wc && BrowserWindow.getAllWindows().some((w) => w.webContents === wc)
  const allowed = (p: string) => p === 'fullscreen' || p === 'clipboard-sanitized-write'
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed(permission) && ours(wc)))
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed(permission) && ours(wc))
}
