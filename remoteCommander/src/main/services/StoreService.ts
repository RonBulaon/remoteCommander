import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

interface StoredGroup { id: string; name: string }
// Profiles are opaque objects; the renderer owns the type.
type StoredProfile = Record<string, unknown>

export interface StoreData {
  version: number
  groups: StoredGroup[]
  profiles: StoredProfile[]
}

export interface StoredVpnProfile {
  id: string
  name: string
  type: 'openvpn' | 'wireguard'
  configPath: string
  username?: string
  // Password encrypted at rest (Electron safeStorage, or a flagged fallback).
  // Never sent to the renderer.
  passwordEnc?: string
  autoConnect: boolean
}

function storePath(): string {
  return join(app.getPath('userData'), 'profiles.json')
}

// VPN profiles live in their own file so saving server profiles never clobbers them.
function vpnStorePath(): string {
  return join(app.getPath('userData'), 'vpn-profiles.json')
}

function workspaceStorePath(): string {
  return join(app.getPath('userData'), 'workspaces.json')
}

// Workspaces are opaque objects; the renderer owns the type.
type StoredWorkspace = Record<string, unknown>

export const StoreService = {
  load(): StoreData {
    const path = storePath()
    if (!existsSync(path)) return { version: 1, groups: [], profiles: [] }
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as StoreData
    } catch {
      return { version: 1, groups: [], profiles: [] }
    }
  },

  save(groups: StoredGroup[], profiles: StoredProfile[]): void {
    writeFileSync(storePath(), JSON.stringify({ version: 1, groups, profiles }, null, 2), 'utf8')
  },

  loadVpnProfiles(): StoredVpnProfile[] {
    const path = vpnStorePath()
    if (!existsSync(path)) return []
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as StoredVpnProfile[]
    } catch {
      return []
    }
  },

  saveVpnProfiles(profiles: StoredVpnProfile[]): void {
    writeFileSync(vpnStorePath(), JSON.stringify(profiles, null, 2), 'utf8')
  },

  loadWorkspaces(): StoredWorkspace[] {
    const path = workspaceStorePath()
    if (!existsSync(path)) return []
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as StoredWorkspace[]
    } catch {
      return []
    }
  },

  saveWorkspaces(workspaces: StoredWorkspace[]): void {
    writeFileSync(workspaceStorePath(), JSON.stringify(workspaces, null, 2), 'utf8')
  },
}
