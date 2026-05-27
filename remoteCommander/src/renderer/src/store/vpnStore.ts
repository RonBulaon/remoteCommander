import { create } from 'zustand'
import { ipc, VpnStatus } from '../lib/ipc'
import { VpnProfile } from '../types/profile'

interface VpnStoreState {
  profiles: VpnProfile[]
  statuses: Record<string, VpnStatus> // keyed by vpnProfileId
  loaded: boolean

  load: () => Promise<void>
  saveProfile: (profile: VpnProfile, password?: string | null) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  setStatus: (id: string, status: VpnStatus) => void
  statusOf: (id: string) => VpnStatus
}

export const useVpnStore = create<VpnStoreState>((set, get) => ({
  profiles: [],
  statuses: {},
  loaded: false,

  load: async () => {
    const { profiles } = await ipc.vpn.listProfiles()
    // Hydrate current statuses for each profile from the main process.
    const statuses: Record<string, VpnStatus> = {}
    await Promise.all(
      profiles.map(async (p) => {
        statuses[p.id] = await ipc.vpn.getStatus(p.id)
      }),
    )
    set({ profiles, statuses, loaded: true })
  },

  saveProfile: async (profile, password) => {
    await ipc.vpn.saveProfile(profile, password)
    set((s) => {
      const idx = s.profiles.findIndex((p) => p.id === profile.id)
      const profiles = idx >= 0
        ? s.profiles.map((p) => (p.id === profile.id ? profile : p))
        : [...s.profiles, profile]
      return { profiles }
    })
  },

  deleteProfile: async (id) => {
    await ipc.vpn.deleteProfile(id)
    set((s) => {
      const { [id]: _removed, ...statuses } = s.statuses
      return { profiles: s.profiles.filter((p) => p.id !== id), statuses }
    })
  },

  setStatus: (id, status) =>
    set((s) => ({ statuses: { ...s.statuses, [id]: status } })),

  statusOf: (id) => get().statuses[id] ?? { state: 'disconnected' },
}))
