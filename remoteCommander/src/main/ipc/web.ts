import { ipcMain, session } from 'electron'
import { Ch } from './channels'
import { WebSecurityService } from '../services/WebSecurityService'

// Web-console partitions are always named `persist:web-<profileId>`. Reject
// anything else so the untrusted renderer can't reconfigure other sessions.
function isWebPartition(name: unknown): name is string {
  return typeof name === 'string' && /^persist:web-[\w-]+$/.test(name)
}

export function registerWebHandlers(): void {
  ipcMain.handle(Ch.WEB_ALLOW_INSECURE_CERTS, (_, urlOrOrigin: string) => {
    const origin = WebSecurityService.allowOrigin(urlOrOrigin)
    return { origin }
  })

  ipcMain.handle(Ch.WEB_REVOKE_INSECURE_CERTS, (_, urlOrOrigin: string) => {
    WebSecurityService.revokeOrigin(urlOrOrigin)
    return { ok: true }
  })

  // Renderer pulls the details of the cert that was just rejected for its guest
  // webContents, to populate the "Proceed anyway" interstitial. Reading clears it.
  ipcMain.handle(Ch.WEB_GET_CERT_ERROR, (_, webContentsId: number) => {
    return typeof webContentsId === 'number'
      ? WebSecurityService.takeCertError(webContentsId)
      : null
  })

  ipcMain.handle(Ch.WEB_SET_PROXY, async (_, partition: string, proxyRules: string) => {
    if (!isWebPartition(partition)) return { ok: false, error: 'invalid partition' }
    try {
      const ses = session.fromPartition(partition)
      const rules = (proxyRules || '').trim()
      await ses.setProxy(rules ? { proxyRules: rules } : { mode: 'direct' })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}
