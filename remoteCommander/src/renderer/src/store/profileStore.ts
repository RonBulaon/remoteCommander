import { create } from 'zustand'
import { Profile, ProfileGroup, ConnectionHistoryEntry } from '../types/profile'

interface ProfileState {
  groups: ProfileGroup[]
  profiles: Profile[]
  history: ConnectionHistoryEntry[]
  collapsedGroups: Set<string>

  addGroup: (name: string) => string
  renameGroup: (id: string, name: string) => void
  deleteGroup: (id: string) => void
  toggleGroup: (id: string) => void

  addProfile: (profile: Omit<Profile, 'id'>) => string
  updateProfile: (id: string, changes: Partial<Profile>) => void
  deleteProfile: (id: string) => void
  duplicateProfile: (id: string) => string

  addHistoryEntry: (entry: Omit<ConnectionHistoryEntry, 'id'>) => void
  clearHistory: () => void

  /** Replace groups + profiles wholesale (used on import and initial hydration). */
  setFromStore: (groups: ProfileGroup[], profiles: Profile[]) => void
}

// ── Seed data — only used when electron-store has no persisted profiles ───

const SEED_GROUPS: ProfileGroup[] = [
  { id: 'g-prod', name: 'Production' },
  { id: 'g-dev',  name: 'Development' },
  { id: 'g-lab',  name: 'Homelab' },
]

const SEED_PROFILES: Profile[] = [
  {
    id: 'p1', name: 'prod-web-01', host: '10.0.1.10', port: 22,
    protocol: 'ssh', username: 'ubuntu', authMethod: 'key',
    tags: ['web', 'nginx'], notes: '', groupId: 'g-prod',
  },
  {
    id: 'p2', name: 'prod-db-01', host: '10.0.1.20', port: 22,
    protocol: 'ssh', username: 'postgres', authMethod: 'key',
    tags: ['db', 'postgres'], notes: '', groupId: 'g-prod',
  },
  {
    id: 'p3', name: 'dev-server', host: '192.168.1.50', port: 22,
    protocol: 'ssh', username: 'ron', authMethod: 'password',
    tags: ['dev'], notes: '', groupId: 'g-dev',
  },
  {
    id: 'p4', name: 'nas', host: '192.168.1.100', port: 22,
    protocol: 'sftp', username: 'ron', authMethod: 'password',
    tags: [], notes: '', groupId: 'g-lab',
  },
  {
    id: 'p5', name: 'pi-hole', host: '192.168.1.53', port: 22,
    protocol: 'ssh', username: 'pi', authMethod: 'password',
    tags: ['dns'], notes: '', groupId: 'g-lab',
  },
]

const SEED_HISTORY: ConnectionHistoryEntry[] = [
  {
    id: 'h1', profileId: 'p1', profileName: 'prod-web-01',
    protocol: 'ssh', host: '10.0.1.10',
    connectedAt: new Date(Date.now() - 3_600_000).toISOString(),
    disconnectedAt: new Date(Date.now() - 1_800_000).toISOString(),
    durationSeconds: 1800,
  },
  {
    id: 'h2', profileId: 'p2', profileName: 'prod-db-01',
    protocol: 'ssh', host: '10.0.1.20',
    connectedAt: new Date(Date.now() - 7_200_000).toISOString(),
    disconnectedAt: new Date(Date.now() - 6_900_000).toISOString(),
    durationSeconds: 300,
  },
  {
    id: 'h3', profileId: 'p4', profileName: 'nas',
    protocol: 'sftp', host: '192.168.1.100',
    connectedAt: new Date(Date.now() - 86_400_000).toISOString(),
    disconnectedAt: new Date(Date.now() - 86_200_000).toISOString(),
    durationSeconds: 200,
  },
]

// ── Store ─────────────────────────────────────────────────────────────────

export const useProfileStore = create<ProfileState>((set, get) => ({
  groups: SEED_GROUPS,
  profiles: SEED_PROFILES,
  history: SEED_HISTORY,
  collapsedGroups: new Set<string>(),

  // ── Groups ────────────────────────────────────────────────────────────────

  addGroup: (name) => {
    const id = crypto.randomUUID()
    set((s) => ({ groups: [...s.groups, { id, name }] }))
    return id
  },

  renameGroup: (id, name) =>
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, name } : g)) })),

  // Delete the group but keep its profiles — they fall back to "Ungrouped".
  deleteGroup: (id) =>
    set((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),

  toggleGroup: (id) =>
    set((s) => {
      const next = new Set(s.collapsedGroups)
      next.has(id) ? next.delete(id) : next.add(id)
      return { collapsedGroups: next }
    }),

  // ── Profiles ──────────────────────────────────────────────────────────────

  addProfile: (profile) => {
    const id = crypto.randomUUID()
    set((s) => ({ profiles: [...s.profiles, { ...profile, id }] }))
    return id
  },

  updateProfile: (id, changes) =>
    set((s) => ({
      profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...changes } : p)),
    })),

  deleteProfile: (id) =>
    set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) })),

  duplicateProfile: (id) => {
    const src = get().profiles.find((p) => p.id === id)
    if (!src) return ''
    const newId = crypto.randomUUID()
    set((s) => ({
      profiles: [...s.profiles, { ...src, id: newId, name: `${src.name} (copy)` }],
    }))
    return newId
  },

  // ── History ───────────────────────────────────────────────────────────────

  addHistoryEntry: (entry) => {
    const id = crypto.randomUUID()
    set((s) => ({ history: [{ ...entry, id }, ...s.history].slice(0, 100) }))
  },

  clearHistory: () => set({ history: [] }),

  // ── Hydration / import ────────────────────────────────────────────────────

  setFromStore: (groups, profiles) => set({ groups, profiles }),
}))
