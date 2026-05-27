import { ipcMain } from 'electron'
import { Ch } from './channels'
import { SshService } from '../services/SshService'
import { AuditService } from '../services/AuditService'

export function registerSshHandlers(): void {
  ipcMain.handle(Ch.SSH_CONNECT, async (_event, profileId: string) => {
    try {
      const sessionId = await SshService.connect(profileId)
      AuditService.logConnect(sessionId, profileId, 'ssh')
      return { sessionId, status: 'connecting' }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SSH_RESIZE, async (_event, sessionId: string, cols: number, rows: number) => {
    SshService.resize(sessionId, cols, rows)
    return { ok: true }
  })

  ipcMain.handle(Ch.SSH_DISCONNECT, async (_event, sessionId: string) => {
    SshService.disconnect(sessionId)
    AuditService.logDisconnect(sessionId)
    return { ok: true }
  })

  // Fire-and-forget: user keystrokes forwarded to the shell
  ipcMain.on(Ch.SSH_DATA_IN, (_event, sessionId: string, data: string) => {
    SshService.send(sessionId, data)
  })
}
