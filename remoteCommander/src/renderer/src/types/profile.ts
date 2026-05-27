export type Protocol = 'ssh' | 'rdp' | 'vnc' | 'sftp' | 'web'
export type AuthMethod = 'password' | 'key' | 'agent'

export interface JumpHostConfig {
  host: string
  port: number
  username: string
}

export interface Profile {
  id: string
  name: string
  host: string
  port: number
  protocol: Protocol
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  tags: string[]
  notes: string
  groupId: string
  vpnProfileId?: string
  jumpHost?: JumpHostConfig
  // RDP-specific fields (present only when protocol = 'rdp')
  rdpResolution?: '1024x768' | '1280x720' | '1920x1080' | 'custom' | 'auto'
  rdpWidth?: number
  rdpHeight?: number
  rdpColorDepth?: 16 | 24 | 32
  rdpDomain?: string
  rdpCertMode?: 'warn' | 'accept' | 'reject'
  // VNC-specific fields (present only when protocol = 'vnc')
  vncDisplay?: number
  vncPort?: number
  vncEncoding?: 'tight' | 'zrle' | 'hextile' | 'raw'
  // Web-console fields (present only when protocol = 'web')
  webUrl?: string
  // Opt-in: trust this origin's TLS certificate even if invalid/self-signed
  // (common for device BMCs/iDRAC/iLO/ESXi). Scoped to the profile's origin.
  webIgnoreCertErrors?: boolean
  // Proxy for this console's browser session, e.g. "socks5://127.0.0.1:1080"
  // or "http://proxy:8080". Empty/undefined = direct connection.
  webProxy?: string
  // Saved pages for this console's browser (the bookmark dropdown).
  webBookmarks?: WebBookmark[]
}

export interface WebBookmark {
  title: string
  url: string
}

export interface ProfileGroup {
  id: string
  name: string
}

export interface VpnProfile {
  id: string
  name: string
  type: 'openvpn' | 'wireguard'
  configPath: string
  username?: string
  autoConnect: boolean
}

export interface WorkspaceTab {
  profileId?: string
  protocol: string
  label: string
  paneId: string
}

/** Serialized pane layout tree (mirrors tabStore's LayoutNode). */
export type PersistedLayout =
  | { type: 'leaf'; paneId: string }
  | {
      type: 'split'
      id: string
      direction: 'horizontal' | 'vertical'
      ratio: number
      a: PersistedLayout
      b: PersistedLayout
    }

/** Pre-tree layout shape; still read from older saved workspaces and migrated on load. */
export interface LegacyLayout {
  splitMode: 'single' | 'horizontal' | 'vertical'
  splitRatio: number
}

export interface Workspace {
  id: string
  name: string
  isDefault: boolean
  tabs: WorkspaceTab[]
  layout: PersistedLayout | LegacyLayout
}

export interface ConnectionHistoryEntry {
  id: string
  profileId: string
  profileName: string
  protocol: string
  host: string
  connectedAt: string   // ISO string
  disconnectedAt?: string
  durationSeconds?: number
}
