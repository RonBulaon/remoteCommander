import { ipcMain } from 'electron'
import { Ch } from './channels'
import { VpnService } from '../services/VpnService'
import type { StoredVpnProfile } from '../services/StoreService'

export function registerVpnHandlers(): void {
  ipcMain.handle(Ch.VPN_CONNECT, async (_e, vpnProfileId: string) => {
    try {
      await VpnService.connect(vpnProfileId)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.VPN_DISCONNECT, async (_e, vpnProfileId: string) => {
    await VpnService.disconnect(vpnProfileId)
    return { ok: true }
  })

  ipcMain.handle(Ch.VPN_GET_STATUS, (_e, vpnProfileId: string) => {
    return VpnService.getStatus(vpnProfileId)
  })

  ipcMain.handle(Ch.VPN_LIST_PROFILES, () => {
    return { profiles: VpnService.listProfiles() }
  })

  ipcMain.handle(Ch.VPN_SAVE_PROFILE, (_e, profile: StoredVpnProfile, password?: string | null) => {
    VpnService.saveProfile(profile, password)
    return { ok: true }
  })

  ipcMain.handle(Ch.VPN_DELETE_PROFILE, async (_e, vpnProfileId: string) => {
    await VpnService.deleteProfile(vpnProfileId)
    return { ok: true }
  })
}
