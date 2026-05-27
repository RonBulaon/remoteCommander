import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto'
import { Ch } from './channels'
import { StoreService } from '../services/StoreService'
import { CredentialService } from '../services/CredentialService'

// ── AES-256-GCM helpers ───────────────────────────────────────────────────

const ALGO     = 'aes-256-gcm'
const KEY_LEN  = 32
const IV_LEN   = 16
const SALT_LEN = 32

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN, { N: 32768, r: 8, p: 1 }) as Buffer
}

interface EncryptedFile {
  v: number
  salt: string
  iv: string
  tag: string
  data: string
}

function encryptJson(obj: unknown, password: string): string {
  const salt = randomBytes(SALT_LEN)
  const iv   = randomBytes(IV_LEN)
  const key  = deriveKey(password, salt)

  const cipher     = createCipheriv(ALGO, key, iv)
  const plaintext  = JSON.stringify(obj)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag        = cipher.getAuthTag()

  const file: EncryptedFile = {
    v:    1,
    salt: salt.toString('hex'),
    iv:   iv.toString('hex'),
    tag:  tag.toString('hex'),
    data: ciphertext.toString('hex'),
  }
  return JSON.stringify(file)
}

function decryptJson(raw: string, password: string): unknown {
  const file: EncryptedFile = JSON.parse(raw)
  const salt       = Buffer.from(file.salt, 'hex')
  const iv         = Buffer.from(file.iv, 'hex')
  const tag        = Buffer.from(file.tag, 'hex')
  const ciphertext = Buffer.from(file.data, 'hex')
  const key        = deriveKey(password, salt)

  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}

// ── IPC registration ──────────────────────────────────────────────────────

export function registerProfileHandlers(): void {

  // ── Persistence ───────────────────────────────────────────────────────────

  ipcMain.handle(Ch.STORE_LOAD, () => {
    return StoreService.load()
  })

  ipcMain.handle(Ch.STORE_SAVE, (_event, groups: unknown[], profiles: unknown[]) => {
    StoreService.save(
      groups   as Parameters<typeof StoreService.save>[0],
      profiles as Parameters<typeof StoreService.save>[1],
    )
    return { ok: true }
  })

  // ── Workspaces ──────────────────────────────────────────────────────────────

  ipcMain.handle(Ch.WORKSPACES_LOAD, () => {
    return StoreService.loadWorkspaces()
  })

  ipcMain.handle(Ch.WORKSPACES_SAVE, (_event, workspaces: unknown[]) => {
    StoreService.saveWorkspaces(workspaces as Parameters<typeof StoreService.saveWorkspaces>[0])
    return { ok: true }
  })

  // ── Export ────────────────────────────────────────────────────────────────

  ipcMain.handle(
    Ch.PROFILES_EXPORT,
    async (
      _event,
      payload: { profiles: { id: string }[]; groups: unknown[]; password: string },
    ) => {
      const { profiles, groups, password } = payload

      // Collect credentials from keytar for each profile
      const credentials: Record<string, { password?: string; passphrase?: string }> = {}
      for (const p of profiles) {
        const pw  = await CredentialService.get(p.id)
        const pp  = await CredentialService.get(`${p.id}:passphrase`)
        if (pw || pp) {
          credentials[p.id] = {}
          if (pw) credentials[p.id].password   = pw
          if (pp) credentials[p.id].passphrase = pp
        }
      }

      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { error: 'No window' }

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title:       'Export Profiles',
        defaultPath: 'remote-commander-profiles.rcprofiles',
        filters:     [{ name: 'RC Profiles', extensions: ['rcprofiles'] }],
      })
      if (canceled || !filePath) return { cancelled: true }

      const encrypted = encryptJson({ profiles, groups, credentials }, password)
      writeFileSync(filePath, encrypted, 'utf8')
      return { ok: true }
    },
  )

  // ── Import ────────────────────────────────────────────────────────────────

  ipcMain.handle(Ch.PROFILES_IMPORT, async (_event, payload: { password: string }) => {
    const { password } = payload

    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { error: 'No window' }

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title:      'Import Profiles',
      filters:    [{ name: 'RC Profiles', extensions: ['rcprofiles'] }],
      properties: ['openFile'],
    })
    if (canceled || filePaths.length === 0) return { cancelled: true }

    let decrypted: {
      profiles: { id: string }[]
      groups: unknown[]
      credentials: Record<string, { password?: string; passphrase?: string }>
    }
    try {
      const raw = readFileSync(filePaths[0], 'utf8')
      decrypted = decryptJson(raw, password) as typeof decrypted
    } catch {
      return { error: 'Wrong password or corrupted file.' }
    }

    // Re-store credentials in keytar
    for (const [profileId, creds] of Object.entries(decrypted.credentials ?? {})) {
      if (creds.password)   await CredentialService.set(profileId, creds.password)
      if (creds.passphrase) await CredentialService.set(`${profileId}:passphrase`, creds.passphrase)
    }

    return { profiles: decrypted.profiles, groups: decrypted.groups }
  })

  // ── Native file picker ────────────────────────────────────────────────────

  ipcMain.handle(Ch.DIALOG_OPEN_FILE, async (_event, options: Electron.OpenDialogOptions) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { filePath: null }
    const { canceled, filePaths } = await dialog.showOpenDialog(win, options)
    return { filePath: canceled ? null : (filePaths[0] ?? null) }
  })
}
