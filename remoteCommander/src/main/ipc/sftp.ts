import { ipcMain } from 'electron'
import { Ch } from './channels'
import { SftpService } from '../services/SftpService'
import { AuditService } from '../services/AuditService'

export function registerSftpHandlers(): void {
  ipcMain.handle(Ch.SFTP_CONNECT, async (_event, profileId: string) => {
    try {
      const result = await SftpService.connect(profileId)
      const sessionId = (result as { sessionId?: string }).sessionId
      if (sessionId) AuditService.logConnect(sessionId, profileId, 'sftp')
      return result
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_DISCONNECT, (_event, sessionId: string) => {
    SftpService.disconnect(sessionId)
    AuditService.logDisconnect(sessionId)
    return { ok: true }
  })

  ipcMain.handle(Ch.SFTP_LIST, async (_event, sessionId: string, remotePath: string) => {
    try {
      const entries = await SftpService.list(sessionId, remotePath)
      return { entries }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_LIST_LOCAL, async (_event, sessionId: string, localPath: string) => {
    try {
      const entries = await SftpService.listLocal(sessionId, localPath)
      return { entries }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_UPLOAD, async (_event, sessionId: string, localPath: string, remotePath: string) => {
    try {
      return await SftpService.upload(sessionId, localPath, remotePath)
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_DOWNLOAD, async (_event, sessionId: string, remotePath: string, localPath: string) => {
    try {
      return await SftpService.download(sessionId, remotePath, localPath)
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_DELETE, async (_event, sessionId: string, remotePath: string) => {
    try {
      await SftpService.delete(sessionId, remotePath)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_MKDIR, async (_event, sessionId: string, remotePath: string) => {
    try {
      await SftpService.mkdir(sessionId, remotePath)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_RENAME, async (_event, sessionId: string, oldPath: string, newPath: string) => {
    try {
      await SftpService.rename(sessionId, oldPath, newPath)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_CHMOD, async (_event, sessionId: string, remotePath: string, mode: number) => {
    try {
      await SftpService.chmod(sessionId, remotePath, mode)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_READ_FILE, async (_event, sessionId: string, remotePath: string) => {
    try {
      return await SftpService.readFile(sessionId, remotePath)
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_WRITE_FILE, async (_event, sessionId: string, remotePath: string, content: string) => {
    try {
      await SftpService.writeFile(sessionId, remotePath, content)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_READ_LOCAL_FILE, async (_event, localPath: string) => {
    try {
      return await SftpService.readLocalFile(localPath)
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_WRITE_LOCAL_FILE, async (_event, localPath: string, content: string) => {
    try {
      await SftpService.writeLocalFile(localPath, content)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(Ch.SFTP_CANCEL_TRANSFER, (_event, transferId: string) => {
    SftpService.cancelTransfer(transferId)
    return { ok: true }
  })
}
