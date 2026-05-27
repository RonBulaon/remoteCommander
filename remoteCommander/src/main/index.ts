import { app, shell, BrowserWindow, Menu, ipcMain, screen } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// WSL2 / headless Linux: GPU process fails without a real display adapter.
// Disabling hardware acceleration lets the renderer fall back to software
// rasterization so the window is not blank.
if (process.platform === 'linux') {
  // GPU strategy. Default = software rendering, because headless/WSL hosts with
  // no real display adapter blank-screen with hardware acceleration on. BUT on a
  // machine with a real GPU, software compositing stalls badly on large surfaces
  // (maximized window → "GPU stall due to ReadPixels", UI appears frozen).
  // Set RC_ENABLE_GPU=1 to use the real GPU and fix that.
  if (process.env.RC_ENABLE_GPU === '1') {
    // Hardware acceleration stays on; no SwiftShader needed.
  } else {
    app.disableHardwareAcceleration()
    // With HW accel off, WebGL falls back to SwiftShader (software); opt in
    // explicitly so Chromium doesn't log a deprecation error per GL context.
    app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  }
  // Raise Chromium's stderr log threshold to FATAL so the benign, unfixable
  // WSL/headless ERROR noise stops flooding the console (NetworkManager D-Bus
  // probes, software-compositor mojo messages).
  app.commandLine.appendSwitch('log-level', '3')
}
import icon from '../../resources/icon.png?asset'
import { registerSshHandlers } from './ipc/ssh'
import { SshService } from './services/SshService'
import { SftpService } from './services/SftpService'
import { registerSftpHandlers } from './ipc/sftp'
import { registerRdpHandlers } from './ipc/rdp'
import { RdpService } from './services/RdpService'
import { GuacamoleService } from './services/GuacamoleService'
import { registerVncHandlers } from './ipc/vnc'
import { VncService } from './services/VncService'
import { registerVpnHandlers } from './ipc/vpn'
import { VpnService } from './services/VpnService'
import { registerAuditHandlers } from './ipc/audit'
import { registerCredentialHandlers } from './ipc/credentials'
import { registerProfileHandlers } from './ipc/profiles'
import { registerLocalHandlers } from './ipc/local'
import { LocalTerminalService } from './services/LocalTerminalService'
import { registerWebHandlers } from './ipc/web'
import { WebSecurityService } from './services/WebSecurityService'

// ── Application menu ──────────────────────────────────────────────────────

function buildMenu(): void {
  const send = (channel: string) => {
    BrowserWindow.getFocusedWindow()?.webContents.send(channel)
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Export Profiles…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send('menu:export-profiles'),
        },
        {
          label: 'Import Profiles…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => send('menu:import-profiles'),
        },
        { type: 'separator' },
        {
          label: 'New Local Terminal',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send('menu:new-local-terminal'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Connection History',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => send('menu:connection-history'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Remote Commander',
          click: () => send('menu:about'),
        },
      ],
    },
  ]

  // macOS: prepend the app menu
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Custom title-bar window controls ──────────────────────────────────────

// Some Linux WMs freeze frameless windows when *truly* maximized (the maximize
// button), while resizing to fill the screen works fine. So we emulate maximize:
// resize to the display work area and keep the window in normal state; restore
// puts the saved bounds back. Keyed by window id; cleared on close.
const fakeMaxBounds = new Map<number, Electron.Rectangle>()

function toggleFakeMaximize(win: BrowserWindow): boolean {
  const saved = fakeMaxBounds.get(win.id)
  if (saved) {
    fakeMaxBounds.delete(win.id)
    win.setBounds(saved)
    return false
  }
  fakeMaxBounds.set(win.id, win.getBounds())
  win.setBounds(screen.getDisplayMatching(win.getBounds()).workArea)
  return true
}

function registerWindowHandlers(): void {
  ipcMain.handle('window:control', (event, action: string, arg?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false }
    switch (action) {
      case 'minimize': win.minimize(); break
      case 'maximize': {
        const isMax = toggleFakeMaximize(win)
        win.webContents.send('window:state', isMax)
        break
      }
      case 'close': win.close(); break
      case 'isMaximized': return { value: fakeMaxBounds.has(win.id) }
      case 'toggleFullScreen': win.setFullScreen(!win.isFullScreen()); break
      case 'toggleDevTools': win.webContents.toggleDevTools(); break
      case 'reload': win.webContents.reload(); break
      case 'openExternal': if (arg) shell.openExternal(arg); break
    }
    return { ok: true }
  })
}

// ── Window factory ────────────────────────────────────────────────────────

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    // Frameless: the renderer draws its own dark title bar (matches the theme).
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#1e1e1e',
    title: 'Remote Commander',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // Enables the <webview> tag used by web-console tabs. Guest webviews are
      // independently hardened below (will-attach-webview + web-contents-created).
      webviewTag: true,
    },
  })

  // ── Web-console <webview> hardening ──────────────────────────────────────
  // Force-strip any privileges off every guest webview, regardless of what the
  // renderer requested on the tag. The renderer is treated as untrusted.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    // Enables Chromium's built-in PDFium viewer so PDF links render inline
    // instead of downloading. PDFium is the only "plugin" in modern Electron.
    webPreferences.plugins = true
    // Never honor a renderer attempt to disable web security on a guest.
    params.allowpopups = 'false'
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Tell the custom title bar when to swap the maximize/restore icon (covers a
  // real WM-driven maximize; the button uses fake-maximize and reports its own).
  const sendMaxState = () => mainWindow.webContents.send('window:state', mainWindow.isMaximized())
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)
  const winId = mainWindow.id
  mainWindow.on('closed', () => fakeMaxBounds.delete(winId))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

// ── Guest <webview> navigation / popup lockdown ───────────────────────────
// Applies only to web-console guest contents; the main window keeps its own
// existing setWindowOpenHandler.
function hardenGuestContents(contents: WebContents): void {
  if (contents.getType() !== 'webview') return

  // Deny all popups (window.open / target=_blank). Ad-heavy pages spam these
  // for cookie-sync; auto-forwarding each to the system browser would hijack it.
  // Opening externally is a deliberate toolbar action ("Open in system browser").
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Allow http(s) and local file: navigation; block everything else
  // (javascript:, data:, etc.).
  contents.on('will-navigate', (event, url) => {
    if (!/^(https?|file):/i.test(url)) event.preventDefault()
  })
}

// ── TLS certificate gate ───────────────────────────────────────────────────
// Default behavior (reject invalid certs) is preserved for everything except
// origins the user explicitly opted into — either persistently via a web
// profile's "Ignore certificate errors" setting, or for the session via the
// in-page "Proceed anyway" interstitial. When a guest's cert is rejected we
// stash its details so the renderer can render that interstitial.
function handleCertificateError(
  event: Electron.Event,
  webContents: WebContents | null,
  url: string,
  error: string,
  certificate: Electron.Certificate,
  callback: (isTrusted: boolean) => void,
): void {
  if (webContents?.getType() === 'webview' && WebSecurityService.isAllowed(url)) {
    event.preventDefault()
    callback(true)
    return
  }
  if (webContents?.getType() === 'webview') {
    WebSecurityService.recordCertError(webContents.id, {
      url,
      error,
      certificate: {
        subjectName: certificate.subjectName,
        issuerName: certificate.issuerName,
        validStart: certificate.validStart,
        validExpiry: certificate.validExpiry,
        fingerprint: certificate.fingerprint,
        serialNumber: certificate.serialNumber,
      },
    })
  }
  callback(false)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.remotecommander')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('web-contents-created', (_event, contents) => {
    hardenGuestContents(contents)
  })

  app.on('certificate-error', handleCertificateError)

  // Register all IPC handlers before creating window
  registerSshHandlers()
  registerSftpHandlers()
  registerRdpHandlers()
  registerVncHandlers()
  registerVpnHandlers()
  registerCredentialHandlers()
  registerProfileHandlers()
  registerAuditHandlers()
  registerLocalHandlers()
  registerWebHandlers()
  registerWindowHandlers()

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  SshService.disconnectAll()
  SftpService.disconnectAll()
  RdpService.disconnectAll()
  GuacamoleService.shutdown()
  VncService.disconnectAll()
  VpnService.disconnectAll()
  LocalTerminalService.disconnectAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
