import { ipcMain } from 'electron'
import { Ch } from './channels'
import { LocalTerminalService } from '../services/LocalTerminalService'

export function registerLocalHandlers(): void {
  ipcMain.handle(Ch.LOCAL_CONNECT, (_e, cols: number, rows: number) => {
    try {
      return { sessionId: LocalTerminalService.connect(cols, rows) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.LOCAL_RESIZE, (_e, sessionId: string, cols: number, rows: number) => {
    LocalTerminalService.resize(sessionId, cols, rows)
    return { ok: true }
  })

  ipcMain.handle(Ch.LOCAL_DISCONNECT, (_e, sessionId: string) => {
    LocalTerminalService.disconnect(sessionId)
    return { ok: true }
  })

  // Fire-and-forget: user keystrokes forwarded to the PTY
  ipcMain.on(Ch.LOCAL_DATA_IN, (_e, sessionId: string, data: string) => {
    LocalTerminalService.send(sessionId, data)
  })
}
