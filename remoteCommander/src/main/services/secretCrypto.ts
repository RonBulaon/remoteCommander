import { safeStorage } from 'electron'

// Encrypt a secret for at-rest storage. Uses the OS-backed safeStorage when
// available (real keychain/credential store); otherwise falls back to base64 so
// the value still persists (e.g. WSL2 without a keyring). The 'b64:' tag marks
// the insecure path.
export function encryptSecret(plain: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `v1:${safeStorage.encryptString(plain).toString('base64')}`
    }
  } catch (err) {
    console.error('[secretCrypto] encrypt failed:', err)
  }
  return `b64:${Buffer.from(plain, 'utf8').toString('base64')}`
}

export function decryptSecret(stored: string): string | null {
  try {
    if (stored.startsWith('v1:')) return safeStorage.decryptString(Buffer.from(stored.slice(3), 'base64'))
    if (stored.startsWith('b64:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8')
  } catch (err) {
    console.error('[secretCrypto] decrypt failed:', err)
  }
  return null
}
