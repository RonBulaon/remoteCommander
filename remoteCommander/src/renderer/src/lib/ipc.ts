// Typed wrapper around window.electronAPI.
// All components import from here — never call window.electronAPI directly.

import type { Profile, ProfileGroup, VpnProfile, Workspace } from '../types/profile'

export type VpnState = 'connecting' | 'connected' | 'disconnected'

export interface VpnStatus {
  state: VpnState
  assignedIp?: string
  error?: string
}

export interface ConnectionEvent {
  id: number
  timestamp: string
  profileId: string
  profileName: string
  protocol: string
  host: string
  username: string
  durationSeconds: number | null
}

// Mirror of the main-process WebSecurityService.CertErrorInfo (renderer can't
// import from main). Returned by web.getCertError for the cert interstitial.
export interface CertErrorInfo {
  url: string
  error: string
  certificate: {
    subjectName: string
    issuerName: string
    validStart: number
    validExpiry: number
    fingerprint: string
    serialNumber: string
  }
}

export interface AuditFilters {
  protocol?: string
  host?: string
  profileName?: string
  since?: string
  until?: string
}

export interface SftpFileEntry {
  name: string
  size: number
  mtime: number
  permissions: number
  isDir: boolean
  isSymlink: boolean
}

export interface SftpTransferProgress {
  transferId: string
  transferred: number
  total: number
  speed: number
  eta: number
  status: 'progress' | 'done' | 'error' | 'cancelled'
  error?: string
}

const raw = () => window.electronAPI

export const ipc = {
  // ── Window controls (custom title bar) ────────────────────────────────────
  window: {
    minimize:         () => raw().invoke('window:control', 'minimize'),
    toggleMaximize:   () => raw().invoke('window:control', 'maximize'),
    close:            () => raw().invoke('window:control', 'close'),
    isMaximized:      () => raw().invoke('window:control', 'isMaximized') as Promise<{ value: boolean }>,
    toggleFullScreen: () => raw().invoke('window:control', 'toggleFullScreen'),
    toggleDevTools:   () => raw().invoke('window:control', 'toggleDevTools'),
    reload:           () => raw().invoke('window:control', 'reload'),
    openExternal:     (url: string) => raw().invoke('window:control', 'openExternal', url),
    onMaximizeState:  (cb: (maximized: boolean) => void) =>
      raw().on('window:state', cb as (...a: unknown[]) => void),
  },

  // ── Local terminal ────────────────────────────────────────────────────────
  local: {
    connect: (cols: number, rows: number) =>
      raw().invoke('local:connect', cols, rows) as Promise<{ sessionId: string } | { error: string }>,
    send: (sessionId: string, data: string) => raw().send('local:data', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      raw().invoke('local:resize', sessionId, cols, rows) as Promise<{ ok: boolean }>,
    disconnect: (sessionId: string) =>
      raw().invoke('local:disconnect', sessionId) as Promise<{ ok: boolean }>,
    onData: (sessionId: string, cb: (data: string) => void) =>
      raw().on(`local:data:${sessionId}`, cb as (...a: unknown[]) => void),
    onStatus: (sessionId: string, cb: (status: string) => void) =>
      raw().on(`local:status:${sessionId}`, cb as (...a: unknown[]) => void),
  },

  // ── SSH ───────────────────────────────────────────────────────────────────
  ssh: {
    connect: (profileId: string) =>
      raw().invoke('ssh:connect', profileId) as Promise<{ sessionId: string; status: string }>,

    send: (sessionId: string, data: string) =>
      raw().send('ssh:data', sessionId, data),

    resize: (sessionId: string, cols: number, rows: number) =>
      raw().invoke('ssh:resize', sessionId, cols, rows) as Promise<{ ok: boolean }>,

    disconnect: (sessionId: string) =>
      raw().invoke('ssh:disconnect', sessionId) as Promise<{ ok: boolean }>,

    onData: (sessionId: string, cb: (data: string) => void) =>
      raw().on(`ssh:data:${sessionId}`, cb as (...a: unknown[]) => void),

    onStatus: (sessionId: string, cb: (status: string) => void) =>
      raw().on(`ssh:status:${sessionId}`, cb as (...a: unknown[]) => void),
  },

  // ── SFTP ──────────────────────────────────────────────────────────────────
  sftp: {
    connect: (profileId: string) =>
      raw().invoke('sftp:connect', profileId) as Promise<
        { sessionId: string; localHome: string; remoteHome: string } | { error: string }
      >,
    disconnect: (sessionId: string) =>
      raw().invoke('sftp:disconnect', sessionId) as Promise<{ ok: boolean }>,
    list: (sessionId: string, path: string) =>
      raw().invoke('sftp:list', sessionId, path) as Promise<
        { entries: SftpFileEntry[] } | { error: string }
      >,
    listLocal: (sessionId: string, path: string) =>
      raw().invoke('sftp:listLocal', sessionId, path) as Promise<
        { entries: SftpFileEntry[] } | { error: string }
      >,
    upload: (sessionId: string, local: string, remote: string) =>
      raw().invoke('sftp:upload', sessionId, local, remote) as Promise<
        { transferId: string } | { error: string }
      >,
    download: (sessionId: string, remote: string, local: string) =>
      raw().invoke('sftp:download', sessionId, remote, local) as Promise<
        { transferId: string } | { error: string }
      >,
    delete: (sessionId: string, path: string) =>
      raw().invoke('sftp:delete', sessionId, path) as Promise<{ ok: boolean } | { error: string }>,
    mkdir: (sessionId: string, path: string) =>
      raw().invoke('sftp:mkdir', sessionId, path) as Promise<{ ok: boolean } | { error: string }>,
    rename: (sessionId: string, oldPath: string, newPath: string) =>
      raw().invoke('sftp:rename', sessionId, oldPath, newPath) as Promise<
        { ok: boolean } | { error: string }
      >,
    chmod: (sessionId: string, path: string, mode: number) =>
      raw().invoke('sftp:chmod', sessionId, path, mode) as Promise<
        { ok: boolean } | { error: string }
      >,
    cancelTransfer: (transferId: string) =>
      raw().invoke('sftp:cancelTransfer', transferId) as Promise<{ ok: boolean }>,
    // ── Text editing (whole-file read/write) ──
    readFile: (sessionId: string, path: string) =>
      raw().invoke('sftp:readFile', sessionId, path) as Promise<{ content: string } | { error: string }>,
    writeFile: (sessionId: string, path: string, content: string) =>
      raw().invoke('sftp:writeFile', sessionId, path, content) as Promise<{ ok: boolean } | { error: string }>,
    readLocalFile: (path: string) =>
      raw().invoke('sftp:readLocalFile', path) as Promise<{ content: string } | { error: string }>,
    writeLocalFile: (path: string, content: string) =>
      raw().invoke('sftp:writeLocalFile', path, content) as Promise<{ ok: boolean } | { error: string }>,
    onProgress: (transferId: string, cb: (progress: SftpTransferProgress) => void) =>
      raw().on(`sftp:progress:${transferId}`, cb as (...a: unknown[]) => void),
    onStatus: (sessionId: string, cb: (status: string) => void) =>
      raw().on(`sftp:status:${sessionId}`, cb as (...a: unknown[]) => void),
  },

  // ── RDP ───────────────────────────────────────────────────────────────────
  rdp: {
    detectBinary: () =>
      raw().invoke('rdp:detectBinary') as Promise<{ path: string | null }>,
    // External FreeRDP window (fallback when guacd is unavailable)
    connect: (opts: { profileId: string; password?: string; width?: number; height?: number }) =>
      raw().invoke('rdp:connect', opts) as Promise<
        { sessionId: string } | { error: string } | { needsPassword: true }
      >,
    disconnect: (sessionId: string) =>
      raw().invoke('rdp:disconnect', sessionId) as Promise<{ ok: boolean }>,
    onStatus: (sessionId: string, cb: (status: string) => void) =>
      raw().on(`rdp:status:${sessionId}`, cb as (...a: unknown[]) => void),
    // In-tab RDP via guacd
    guacConnect: (opts: { profileId: string; password?: string; width?: number; height?: number }) =>
      raw().invoke('rdp:guacConnect', opts) as Promise<
        { sessionId: string; wsPort: number; token: string } | { needsPassword: true } | { error: string }
      >,
    guacDisconnect: (sessionId: string) =>
      raw().invoke('rdp:guacDisconnect', sessionId) as Promise<{ ok: boolean }>,
  },

  // ── VNC ───────────────────────────────────────────────────────────────────
  vnc: {
    connect: (profileId: string) =>
      raw().invoke('vnc:connect', profileId) as Promise<
        { sessionId: string; localWsPort: number; password: string | null } | { error: string }
      >,
    disconnect: (sessionId: string) =>
      raw().invoke('vnc:disconnect', sessionId) as Promise<{ ok: boolean }>,
    onStatus: (sessionId: string, cb: (status: string) => void) =>
      raw().on(`vnc:status:${sessionId}`, cb as (...a: unknown[]) => void),
  },

  // ── Web console ─────────────────────────────────────────────────────────
  web: {
    // Opt an origin into ignoring TLS cert errors (per-profile setting).
    allowInsecureCerts: (urlOrOrigin: string) =>
      raw().invoke('web:allowInsecureCerts', urlOrOrigin) as Promise<{ origin: string | null }>,
    revokeInsecureCerts: (urlOrOrigin: string) =>
      raw().invoke('web:revokeInsecureCerts', urlOrOrigin) as Promise<{ ok: true }>,
    // Pull the details of the cert just rejected for a guest webContents (for the
    // "Proceed anyway" interstitial). Reading clears it on the main side.
    getCertError: (webContentsId: number) =>
      raw().invoke('web:getCertError', webContentsId) as Promise<CertErrorInfo | null>,
    // Set (or clear, when proxyRules is empty) the proxy for a web partition.
    setProxy: (partition: string, proxyRules: string) =>
      raw().invoke('web:setProxy', partition, proxyRules) as Promise<{ ok: boolean; error?: string }>,
  },

  // ── VPN ───────────────────────────────────────────────────────────────────
  vpn: {
    connect:       (vpnProfileId: string) =>
      raw().invoke('vpn:connect', vpnProfileId) as Promise<{ ok: true } | { error: string }>,
    disconnect:    (vpnProfileId: string) =>
      raw().invoke('vpn:disconnect', vpnProfileId) as Promise<{ ok: boolean }>,
    getStatus:     (vpnProfileId: string) =>
      raw().invoke('vpn:getStatus', vpnProfileId) as Promise<VpnStatus>,
    listProfiles:  () =>
      raw().invoke('vpn:listProfiles') as Promise<{ profiles: VpnProfile[] }>,
    saveProfile:   (profile: VpnProfile, password?: string | null) =>
      raw().invoke('vpn:saveProfile', profile, password) as Promise<{ ok: boolean }>,
    deleteProfile: (id: string) =>
      raw().invoke('vpn:deleteProfile', id) as Promise<{ ok: boolean }>,
    onStatus:      (vpnProfileId: string, cb: (status: VpnStatus) => void) =>
      raw().on(`vpn:status:${vpnProfileId}`, cb as (...a: unknown[]) => void),
  },

  // ── Credentials ───────────────────────────────────────────────────────────
  credentials: {
    set:    (account: string, secret: string) =>
      raw().invoke('credentials:set', account, secret) as Promise<{ ok: boolean }>,
    get:    (account: string) =>
      raw().invoke('credentials:get', account) as Promise<{ secret: string | null }>,
    delete: (account: string) =>
      raw().invoke('credentials:delete', account) as Promise<{ ok: boolean }>,
  },

  // ── Profile store (persistence) ───────────────────────────────────────────
  store: {
    load: () =>
      raw().invoke('store:loadProfiles') as Promise<{ groups: ProfileGroup[]; profiles: Profile[] }>,
    save: (groups: ProfileGroup[], profiles: Profile[]) =>
      raw().invoke('store:saveProfiles', groups, profiles) as Promise<{ ok: boolean }>,
  },

  // ── Workspaces ──────────────────────────────────────────────────────────────
  workspaces: {
    load: () => raw().invoke('workspaces:load') as Promise<Workspace[]>,
    save: (workspaces: Workspace[]) =>
      raw().invoke('workspaces:save', workspaces) as Promise<{ ok: boolean }>,
  },

  // ── Audit log ─────────────────────────────────────────────────────────────
  audit: {
    query: (filters: AuditFilters = {}) =>
      raw().invoke('audit:query', filters) as Promise<{ events: ConnectionEvent[] }>,
    export: (filters: AuditFilters = {}) =>
      raw().invoke('audit:export', filters) as Promise<{ csv: string }>,
  },

  // ── Import / export ───────────────────────────────────────────────────────
  profiles: {
    export: (payload: { profiles: Profile[]; groups: ProfileGroup[]; password: string }) =>
      raw().invoke('profiles:export', payload) as Promise<{ ok?: boolean; cancelled?: boolean; error?: string }>,
    import: (payload: { password: string }) =>
      raw().invoke('profiles:import', payload) as Promise<
        | { profiles: Profile[]; groups: ProfileGroup[] }
        | { cancelled: true }
        | { error: string }
      >,
  },

  // ── Native dialog ─────────────────────────────────────────────────────────
  dialog: {
    openFile: (options: { title?: string; filters?: { name: string; extensions: string[] }[] }) =>
      raw().invoke('dialog:openFile', { ...options, properties: ['openFile'] }) as Promise<{
        filePath: string | null
      }>,
  },

  // ── Menu events (main → renderer subscriptions) ───────────────────────────
  menu: {
    onExportProfiles: (cb: () => void) =>
      raw().on('menu:export-profiles', cb as (...a: unknown[]) => void),
    onImportProfiles: (cb: () => void) =>
      raw().on('menu:import-profiles', cb as (...a: unknown[]) => void),
    onConnectionHistory: (cb: () => void) =>
      raw().on('menu:connection-history', cb as (...a: unknown[]) => void),
    onNewLocalTerminal: (cb: () => void) =>
      raw().on('menu:new-local-terminal', cb as (...a: unknown[]) => void),
    onAbout: (cb: () => void) =>
      raw().on('menu:about', cb as (...a: unknown[]) => void),
  },
}
