import { ipcMain } from 'electron'
import { Ch } from './channels'
import { VncService } from '../services/VncService'
import { AuditService } from '../services/AuditService'

export function registerVncHandlers(): void {
  ipcMain.handle(Ch.VNC_CONNECT, async (_, profileId: string) => {
    try {
      const { sessionId, localWsPort, password } = await VncService.connect(profileId)
      AuditService.logConnect(sessionId, profileId, 'vnc')
      return { sessionId, localWsPort, password }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.VNC_DISCONNECT, (_, sessionId: string) => {
    VncService.disconnect(sessionId)
    AuditService.logDisconnect(sessionId)
    return { ok: true }
  })
}
