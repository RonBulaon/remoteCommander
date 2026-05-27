// Account key conventions:
//   password auth  → profileId
//   key passphrase → `${profileId}:passphrase`

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { encryptSecret, decryptSecret } from './secretCrypto'

const SERVICE = 'RemoteCommander'

// keytar requires libsecret on Linux. When it's missing or throws at runtime
// (e.g. WSL2 without a keyring), we fall back to a persistent file store with
// each secret encrypted at rest via safeStorage — so credentials survive a
// restart instead of living only in memory. On a real OS, keytar (the OS
// keychain) is used and is preferred.

type Keytar = {
  setPassword: (s: string, a: string, p: string) => Promise<void>
  getPassword: (s: string, a: string) => Promise<string | null>
  deletePassword: (s: string, a: string) => Promise<boolean>
}

let kt: Keytar | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  kt = require('keytar') as Keytar
} catch (e) {
  console.warn('[CredentialService] keytar unavailable — using encrypted file store:', (e as Error).message)
}

function disableKeytar(err: unknown): void {
  console.warn('[CredentialService] keytar runtime error — switching to encrypted file store:', (err as Error).message)
  kt = null
}

// ── Encrypted file fallback ──────────────────────────────────────────────────

let cache: Record<string, string> | null = null

function storePath(): string {
  return join(app.getPath('userData'), 'credentials.json')
}

function getCache(): Record<string, string> {
  if (cache) return cache
  try {
    cache = existsSync(storePath()) ? (JSON.parse(readFileSync(storePath(), 'utf8')) as Record<string, string>) : {}
  } catch {
    cache = {}
  }
  return cache
}

function persist(): void {
  try {
    writeFileSync(storePath(), JSON.stringify(getCache(), null, 2), 'utf8')
  } catch (e) {
    console.error('[CredentialService] failed to persist credentials:', (e as Error).message)
  }
}

function fileSet(account: string, secret: string): void {
  getCache()[account] = encryptSecret(secret)
  persist()
}

function fileGet(account: string): string | null {
  const enc = getCache()[account]
  return enc ? decryptSecret(enc) : null
}

function fileDelete(account: string): boolean {
  const c = getCache()
  if (!(account in c)) return false
  delete c[account]
  persist()
  return true
}

// ── Public API ───────────────────────────────────────────────────────────────

export const CredentialService = {
  async set(account: string, secret: string): Promise<void> {
    if (kt) {
      try {
        await kt.setPassword(SERVICE, account, secret)
        return
      } catch (e) {
        disableKeytar(e)
      }
    }
    fileSet(account, secret)
  },

  async get(account: string): Promise<string | null> {
    if (kt) {
      try {
        return await kt.getPassword(SERVICE, account)
      } catch (e) {
        disableKeytar(e)
      }
    }
    return fileGet(account)
  },

  async delete(account: string): Promise<boolean> {
    if (kt) {
      try {
        return await kt.deletePassword(SERVICE, account)
      } catch (e) {
        disableKeytar(e)
      }
    }
    return fileDelete(account)
  },
}
