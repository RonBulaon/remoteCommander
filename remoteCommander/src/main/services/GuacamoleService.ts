import * as http from 'http'
import * as net from 'net'
import { randomBytes, randomUUID, createCipheriv } from 'crypto'
import GuacamoleLite from 'guacamole-lite'
import { CredentialService } from './CredentialService'
import { StoreService } from './StoreService'

// ── Types ─────────────────────────────────────────────────────────────────

interface RdpProfileData {
  id: string
  host: string
  port?: number
  username?: string
  rdpDomain?: string
  rdpColorDepth?: number
  rdpCertMode?: 'warn' | 'accept' | 'reject'
}

export type GuacConnectResult =
  | { sessionId: string; wsPort: number; token: string }
  | { needsPassword: true }
  | { error: string }

// ── Config / module state ───────────────────────────────────────────────────

const GUACD_HOST = '127.0.0.1'
const GUACD_PORT = 4822
const CIPHER = 'AES-256-CBC'

// One key + WS↔guacd proxy server for the app lifetime (guacamole-lite handles
// many connections; each carries its own encrypted RDP settings token).
const cryptKey = randomBytes(32)
let httpServer: http.Server | null = null
let guacServer: GuacamoleLite | null = null
let wsPort = 0

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveProfile(profileId: string): RdpProfileData {
  const profile = StoreService.load().profiles.find(
    (p) => (p as unknown as { id: string }).id === profileId,
  ) as unknown as RdpProfileData | undefined
  if (!profile) throw new Error(`Profile not found: ${profileId}`)
  return profile
}

// Produce a token guacamole-lite can decrypt: base64(JSON{ iv, value }), where
// value is AES-256-CBC(JSON(payload)). Mirrors the library's decryptToken.
function encryptToken(payload: unknown): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(CIPHER, cryptKey, iv)
  let value = cipher.update(JSON.stringify(payload), 'utf8', 'base64')
  value += cipher.final('base64')
  return Buffer.from(JSON.stringify({ iv: iv.toString('base64'), value })).toString('base64')
}

// Quick reachability check so we can fail fast (and offer the fallback) when
// guacd isn't running, instead of waiting for the WebSocket to error.
function probeGuacd(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection(GUACD_PORT, GUACD_HOST)
    const finish = (ok: boolean): void => {
      try { sock.destroy() } catch { /* ignore */ }
      resolve(ok)
    }
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
    sock.setTimeout(2000, () => finish(false))
  })
}

async function ensureServer(): Promise<number> {
  if (guacServer && wsPort) return wsPort

  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve())
    server.once('error', reject)
    server.listen(0, '127.0.0.1')
  })
  httpServer = server
  wsPort = (server.address() as net.AddressInfo).port

  guacServer = new GuacamoleLite(
    { server },
    { host: GUACD_HOST, port: GUACD_PORT },
    { crypt: { cypher: CIPHER, key: cryptKey }, log: { level: 'ERRORS' } },
  )
  console.log(`[GuacamoleService] WS proxy listening on 127.0.0.1:${wsPort} → guacd ${GUACD_HOST}:${GUACD_PORT}`)
  return wsPort
}

// ── GuacamoleService ────────────────────────────────────────────────────────

export const GuacamoleService = {
  async connect(
    profileId: string,
    opts: { password?: string; width?: number; height?: number } = {},
  ): Promise<GuacConnectResult> {
    const profile = resolveProfile(profileId)

    const password = opts.password ?? (await CredentialService.get(profileId))
    if (!password) return { needsPassword: true }

    if (!(await probeGuacd())) {
      return {
        error: `guacd is not reachable on ${GUACD_HOST}:${GUACD_PORT}. Install and start it (e.g. "sudo apt install guacd"), or use the external window.`,
      }
    }

    const port = await ensureServer()

    const settings: Record<string, string> = {
      hostname: profile.host,
      port: String(profile.port || 3389),
      username: profile.username ?? '',
      password,
      'ignore-cert': profile.rdpCertMode === 'reject' ? 'false' : 'true',
      'resize-method': 'display-update',
      width: String(opts.width ?? 1024),
      height: String(opts.height ?? 768),
      dpi: '96',
    }
    if (profile.rdpDomain) settings.domain = profile.rdpDomain
    if (profile.rdpColorDepth) settings['color-depth'] = String(profile.rdpColorDepth)

    const token = encryptToken({ connection: { type: 'rdp', settings } })
    return { sessionId: randomUUID(), wsPort: port, token }
  },

  shutdown(): void {
    try { guacServer?.close() } catch { /* ignore */ }
    try { httpServer?.close() } catch { /* ignore */ }
    guacServer = null
    httpServer = null
    wsPort = 0
  },
}
