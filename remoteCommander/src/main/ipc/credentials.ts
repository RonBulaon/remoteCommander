import { ipcMain } from 'electron'
import { Ch } from './channels'
import { CredentialService } from '../services/CredentialService'

export function registerCredentialHandlers(): void {
  ipcMain.handle(Ch.CREDS_SET, async (_event, account: string, secret: string) => {
    await CredentialService.set(account, secret)
    return { ok: true }
  })

  ipcMain.handle(Ch.CREDS_GET, async (_event, account: string) => {
    const secret = await CredentialService.get(account)
    return { secret }
  })

  ipcMain.handle(Ch.CREDS_DELETE, async (_event, account: string) => {
    const ok = await CredentialService.delete(account)
    return { ok }
  })
}
