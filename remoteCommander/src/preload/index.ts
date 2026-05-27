import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// ── Allowlists (renderer is untrusted — validate every channel) ───────────

const INVOKE_CHANNELS = new Set([
  // SSH
  'ssh:connect', 'ssh:resize', 'ssh:disconnect',
  // SFTP
  'sftp:connect', 'sftp:disconnect', 'sftp:list', 'sftp:listLocal', 'sftp:upload', 'sftp:download',
  'sftp:delete', 'sftp:mkdir', 'sftp:rename', 'sftp:chmod', 'sftp:cancelTransfer',
  'sftp:readFile', 'sftp:writeFile', 'sftp:readLocalFile', 'sftp:writeLocalFile',
  // RDP
  'rdp:connect', 'rdp:disconnect', 'rdp:detectBinary', 'rdp:guacConnect', 'rdp:guacDisconnect',
  // VNC
  'vnc:connect', 'vnc:disconnect',
  // Web console
  'web:allowInsecureCerts', 'web:revokeInsecureCerts', 'web:getCertError', 'web:setProxy',
  // VPN
  'vpn:connect', 'vpn:disconnect', 'vpn:getStatus',
  'vpn:listProfiles', 'vpn:saveProfile', 'vpn:deleteProfile',
  // Credentials
  'credentials:set', 'credentials:get', 'credentials:delete',
  // Profile store
  'store:loadProfiles', 'store:saveProfiles',
  // Workspaces
  'workspaces:load', 'workspaces:save',
  // Audit
  'audit:query', 'audit:export',
  // Import / export
  'profiles:export', 'profiles:import',
  // Native dialog
  'dialog:openFile',
  // Window controls (custom title bar)
  'window:control',
  // Local terminal
  'local:connect', 'local:resize', 'local:disconnect',
])

const SEND_CHANNELS = new Set(['ssh:data', 'local:data'])

// Prefixes for main→renderer events the renderer may subscribe to
const EVENT_PREFIXES = ['ssh:', 'sftp:', 'rdp:', 'vnc:', 'vpn:', 'menu:', 'window:', 'local:']

// ── Typed API exposed to renderer ─────────────────────────────────────────

export type ElectronCustomAPI = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
}

const electronCustomAPI: ElectronCustomAPI = {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC invoke channel not allowlisted: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  send(channel, ...args) {
    if (SEND_CHANNELS.has(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  },

  on(channel, callback) {
    const allowed = EVENT_PREFIXES.some((p) => channel.startsWith(p))
    if (!allowed) throw new Error(`IPC event channel not allowlisted: ${channel}`)
    const listener = (_e: IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

// ── Expose to renderer ────────────────────────────────────────────────────

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('electronAPI', electronCustomAPI)
  } catch (e) {
    console.error('[preload]', e)
  }
} else {
  // @ts-ignore (non-isolated context, dev only)
  window.electron = electronAPI
  // @ts-ignore
  window.electronAPI = electronCustomAPI
}
