import { BrowserWindow } from 'electron'
import { Client } from 'ssh2'
import type { ConnectConfig, ClientChannel } from 'ssh2'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { CredentialService } from './CredentialService'
import { StoreService } from './StoreService'

// ── Types ─────────────────────────────────────────────────────────────────

interface ProfileRecord {
  id: string
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key' | 'agent'
  privateKeyPath?: string
  jumpHost?: { host: string; port: number; username: string }
}

interface Session {
  client: Client
  shell: ClientChannel | null
  jumpClient?: Client
  profileId: string    // kept for auto-reconnect
  retries: number      // reconnect attempts used so far
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000

// ── Helpers ───────────────────────────────────────────────────────────────

const sessions = new Map<string, Session>()

function emitToRenderer(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, ...args)
}

// Build ConnectConfig auth options from a stored profile + keytar
async function buildAuthOpts(profile: ProfileRecord): Promise<Partial<ConnectConfig>> {
  if (profile.authMethod === 'password') {
    return { password: (await CredentialService.get(profile.id)) ?? '' }
  }
  if (profile.authMethod === 'key' && profile.privateKeyPath) {
    const privateKey = readFileSync(profile.privateKeyPath)
    const passphrase = (await CredentialService.get(`${profile.id}:passphrase`)) ?? undefined
    return { privateKey, passphrase }
  }
  if (profile.authMethod === 'agent') {
    return { agent: process.env.SSH_AUTH_SOCK }
  }
  return {}
}

function resolveProfile(profileId: string): ProfileRecord {
  const storeData = StoreService.load()
  const profile = storeData.profiles.find(
    (p) => (p as unknown as ProfileRecord).id === profileId,
  ) as unknown as ProfileRecord | undefined
  if (!profile) throw new Error(`Profile not found: ${profileId}`)
  return profile
}

// ── openShell ─────────────────────────────────────────────────────────────
// Opens a PTY shell on `client` and wires data / close events.
// On drop, auto-reconnect up to MAX_RETRIES with exponential backoff.

function openShell(
  sessionId: string,
  client: Client,
  profileId: string,
  resolve: ((id: string) => void) | null,
  reject:  ((err: Error) => void) | null,
  jumpClient?: Client,
): void {
  client.shell({ term: 'xterm-256color' }, (err, stream) => {
    if (err) {
      client.end()
      jumpClient?.end()
      if (reject) reject(err)
      return
    }

    // Upsert session (may already exist if this is a reconnect)
    const existing = sessions.get(sessionId)
    if (existing) {
      existing.client    = client
      existing.shell     = stream
      existing.jumpClient = jumpClient
    } else {
      sessions.set(sessionId, { client, shell: stream, profileId, retries: 0, jumpClient })
    }

    stream.on('data', (chunk: Buffer) => {
      emitToRenderer(`ssh:data:${sessionId}`, chunk.toString('binary'))
    })

    stream.on('close', () => {
      const session = sessions.get(sessionId)
      if (!session) return
      session.shell = null
      jumpClient?.end()
      scheduleReconnect(sessionId)
    })

    emitToRenderer(`ssh:status:${sessionId}`, 'connected')
    if (resolve) resolve(sessionId)
  })
}

// ── scheduleReconnect ─────────────────────────────────────────────────────

function scheduleReconnect(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return // was manually disconnected

  if (session.retries >= MAX_RETRIES) {
    sessions.delete(sessionId)
    emitToRenderer(`ssh:status:${sessionId}`, 'disconnected')
    return
  }

  session.retries++
  emitToRenderer(`ssh:status:${sessionId}`, 'reconnecting')

  const delay = RETRY_DELAY_MS * session.retries
  setTimeout(() => attemptReconnect(sessionId), delay)
}

async function attemptReconnect(sessionId: string): Promise<void> {
  if (!sessions.has(sessionId)) return // manually disconnected while waiting

  try {
    const profile = resolveProfile(sessions.get(sessionId)!.profileId)
    const authOpts = await buildAuthOpts(profile)
    const targetCfg: ConnectConfig = {
      host: profile.host,
      port: profile.port || 22,
      username: profile.username,
      readyTimeout: 20000,
      ...authOpts,
    }

    await new Promise<void>((resolve, reject) => {
      if (profile.jumpHost) {
        const jumpClient = new Client()
        jumpClient.on('ready', () => {
          jumpClient.forwardOut('127.0.0.1', 0, profile.host, profile.port || 22, (err, stream) => {
            if (err) { jumpClient.end(); reject(err); return }
            const targetClient = new Client()
            targetClient.on('ready', () => {
              const session = sessions.get(sessionId)
              if (session) session.retries = 0
              openShell(sessionId, targetClient, profile.id, () => resolve(), reject, jumpClient)
            })
            targetClient.on('error', (e) => { jumpClient.end(); reject(e) })
            targetClient.connect({ ...targetCfg, sock: stream })
          })
        })
        jumpClient.on('error', reject)
        jumpClient.connect({
          host: profile.jumpHost.host, port: profile.jumpHost.port || 22,
          username: profile.jumpHost.username, agent: process.env.SSH_AUTH_SOCK,
          readyTimeout: 20000,
        })
      } else {
        const client = new Client()
        client.on('ready', () => {
          const session = sessions.get(sessionId)
          if (session) session.retries = 0
          openShell(sessionId, client, profile.id, () => resolve(), reject)
        })
        client.on('error', reject)
        client.connect(targetCfg)
      }
    })
  } catch (err) {
    console.error(`[SSH] Reconnect attempt ${sessions.get(sessionId)?.retries} failed:`, err)
    scheduleReconnect(sessionId) // try next attempt (retries already incremented)
  }
}

// ── SshService ────────────────────────────────────────────────────────────

export const SshService = {
  sessions,

  async connect(profileId: string): Promise<string> {
    const sessionId = randomUUID()
    const profile   = resolveProfile(profileId)

    emitToRenderer(`ssh:status:${sessionId}`, 'connecting')

    const authOpts   = await buildAuthOpts(profile)
    const targetCfg: ConnectConfig = {
      host: profile.host,
      port: profile.port || 22,
      username: profile.username,
      readyTimeout: 20000,
      ...authOpts,
    }

    return new Promise<string>((resolve, reject) => {
      if (profile.jumpHost) {
        const jumpCfg: ConnectConfig = {
          host: profile.jumpHost.host,
          port: profile.jumpHost.port || 22,
          username: profile.jumpHost.username,
          agent: process.env.SSH_AUTH_SOCK,
          readyTimeout: 20000,
        }
        const jumpClient = new Client()
        jumpClient.on('ready', () => {
          jumpClient.forwardOut('127.0.0.1', 0, profile.host, profile.port || 22, (err, stream) => {
            if (err) { jumpClient.end(); reject(err); return }
            const targetClient = new Client()
            targetClient.on('ready', () =>
              openShell(sessionId, targetClient, profileId, resolve, reject, jumpClient),
            )
            targetClient.on('error', (e) => { jumpClient.end(); reject(e) })
            targetClient.connect({ ...targetCfg, sock: stream })
          })
        })
        jumpClient.on('error', reject)
        jumpClient.connect(jumpCfg)
      } else {
        const client = new Client()
        client.on('ready', () => openShell(sessionId, client, profileId, resolve, reject))
        client.on('error', reject)
        client.connect(targetCfg)
      }
    })
  },

  send(sessionId: string, data: string): void {
    sessions.get(sessionId)?.shell?.write(data, 'binary')
  },

  resize(sessionId: string, cols: number, rows: number): void {
    sessions.get(sessionId)?.shell?.setWindow(rows, cols, 0, 0)
  },

  disconnect(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId) // delete first so scheduleReconnect bails early
    session.shell?.end()
    session.client.end()
    session.jumpClient?.end()
    emitToRenderer(`ssh:status:${sessionId}`, 'disconnected')
  },

  disconnectAll(): void {
    for (const [sessionId] of [...sessions]) {
      this.disconnect(sessionId)
    }
  },
}
