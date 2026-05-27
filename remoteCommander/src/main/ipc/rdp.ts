import { ipcMain } from 'electron'
import { Ch } from './channels'
import { RdpService } from '../services/RdpService'
import { GuacamoleService } from '../services/GuacamoleService'
import { AuditService } from '../services/AuditService'

interface ConnectPayload {
  profileId: string
  password?: string
  width?: number
  height?: number
}

export function registerRdpHandlers(): void {
  ipcMain.handle(Ch.RDP_DETECT_BINARY, () => {
    const path = RdpService.detectBinary()
    return { path }
  })

  ipcMain.handle(Ch.RDP_CONNECT, async (_, payload: ConnectPayload) => {
    const { profileId, password, width, height } = payload
    try {
      const result = await RdpService.connect(profileId, { password, width, height })
      if (result === 'NEEDS_PASSWORD') return { needsPassword: true }
      AuditService.logConnect(result, profileId, 'rdp')
      return { sessionId: result }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.RDP_DISCONNECT, (_, sessionId: string) => {
    RdpService.disconnect(sessionId)
    AuditService.logDisconnect(sessionId)
    return { ok: true }
  })

  // In-tab RDP via guacd (guacamole-lite proxy + guacamole-common-js canvas)
  ipcMain.handle(Ch.RDP_GUAC_CONNECT, async (_, payload: ConnectPayload) => {
    const { profileId, password, width, height } = payload
    try {
      const result = await GuacamoleService.connect(profileId, { password, width, height })
      if ('sessionId' in result) AuditService.logConnect(result.sessionId, profileId, 'rdp')
      return result
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.RDP_GUAC_DISCONNECT, (_, sessionId: string) => {
    // The shared guacd proxy stays up; the renderer closing its tunnel ends the
    // guacd session. We only record the audit disconnect here.
    AuditService.logDisconnect(sessionId)
    return { ok: true }
  })
}
