import { BrowserWindow } from 'electron'
import { spawn, ChildProcess, execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { CredentialService } from './CredentialService'
import { StoreService } from './StoreService'

// ── Types ─────────────────────────────────────────────────────────────────

interface RdpProfileData {
  id: string
  host: string
  port: number
  username: string
  rdpResolution?: string
  rdpWidth?: number
  rdpHeight?: number
  rdpColorDepth?: number
  rdpDomain?: string
  rdpCertMode?: 'warn' | 'accept' | 'reject'
}

interface RdpSession {
  process: ChildProcess
  profileId: string
}

// ── Module-level state ────────────────────────────────────────────────────

const sessions = new Map<string, RdpSession>()

function emitToRenderer(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, ...args)
}

function resolveProfile(profileId: string): RdpProfileData {
  const storeData = StoreService.load()
  const profile = storeData.profiles.find(
    (p) => (p as unknown as { id: string }).id === profileId,
  ) as unknown as RdpProfileData | undefined
  if (!profile) throw new Error(`Profile not found: ${profileId}`)
  return profile
}

// ── RdpService ────────────────────────────────────────────────────────────

export const RdpService = {
  sessions,

  detectBinary(): string | null {
    const isWin = process.platform === 'win32'
    const candidates = isWin ? ['wfreerdp.exe', 'wfreerdp'] : ['xfreerdp', 'xfreerdp3']

    for (const bin of candidates) {
      try {
        const cmd = isWin ? `where "${bin}"` : `which "${bin}"`
        const result = execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim()
        const first = result.split(/\r?\n/)[0].trim()
        if (first) return first
      } catch {
        // not found, try next candidate
      }
    }
    return null
  },

  async connect(
    profileId: string,
    opts: { password?: string; width?: number; height?: number } = {},
  ): Promise<string | 'NEEDS_PASSWORD'> {
    const sessionId = randomUUID()
    const profile = resolveProfile(profileId)
    const binary = this.detectBinary()

    if (!binary) {
      throw new Error('FreeRDP binary not found. Please install xfreerdp.')
    }

    // Prefer caller-supplied password, fall back to keytar
    const password = opts.password ?? (await CredentialService.get(profileId))
    if (!password) {
      return 'NEEDS_PASSWORD'
    }

    // Prefer caller-supplied dimensions (auto/custom), fall back to profile settings
    let width = opts.width ?? 1920
    let height = opts.height ?? 1080
    if (!opts.width) {
      if (profile.rdpResolution === '1024x768') { width = 1024; height = 768 }
      else if (profile.rdpResolution === '1280x720') { width = 1280; height = 720 }
      else if (profile.rdpResolution === '1920x1080') { width = 1920; height = 1080 }
      else if (profile.rdpResolution === 'custom' && profile.rdpWidth && profile.rdpHeight) {
        width = profile.rdpWidth
        height = profile.rdpHeight
      }
    }

    const colorDepth = profile.rdpColorDepth ?? 32

    // Certificate trust argument
    let certArg = '/cert:ignore'
    if (profile.rdpCertMode === 'warn') certArg = '/cert:warn'
    else if (profile.rdpCertMode === 'reject') certArg = '/cert:deny'

    const args: string[] = [
      `/v:${profile.host}:${profile.port || 3389}`,
      `/u:${profile.username}`,
      `/w:${width}`,
      `/h:${height}`,
      `/bpp:${colorDepth}`,
      certArg,
    ]
    args.push(`/p:${password}`)
    if (profile.rdpDomain) args.push(`/d:${profile.rdpDomain}`)

    emitToRenderer(`rdp:status:${sessionId}`, 'connecting')

    const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    sessions.set(sessionId, { process: proc, profileId })

    // Give FreeRDP 3 seconds to start; if still alive, assume connected
    const connectTimer = setTimeout(() => {
      if (sessions.has(sessionId)) {
        emitToRenderer(`rdp:status:${sessionId}`, 'connected')
      }
    }, 3000)

    const parseOutput = (text: string) => {
      if (/authentication failure|logon failure|wrong password|incorrect password/i.test(text)) {
        clearTimeout(connectTimer)
        emitToRenderer(`rdp:status:${sessionId}`, 'error:Authentication failed')
      } else if (/connection refused|unable to connect|name or service not known|no route to host/i.test(text)) {
        clearTimeout(connectTimer)
        emitToRenderer(`rdp:status:${sessionId}`, 'error:Connection refused')
      } else if (/connected|rdp.*session established/i.test(text)) {
        clearTimeout(connectTimer)
        emitToRenderer(`rdp:status:${sessionId}`, 'connected')
      }
    }

    proc.stdout?.on('data', (chunk: Buffer) => parseOutput(chunk.toString()))
    proc.stderr?.on('data', (chunk: Buffer) => parseOutput(chunk.toString()))

    proc.on('error', (err) => {
      clearTimeout(connectTimer)
      sessions.delete(sessionId)
      emitToRenderer(`rdp:status:${sessionId}`, `error:${err.message}`)
    })

    proc.on('close', (code) => {
      clearTimeout(connectTimer)
      const wasActive = sessions.has(sessionId)
      sessions.delete(sessionId)
      if (wasActive) {
        if (code === 0 || code === null) {
          emitToRenderer(`rdp:status:${sessionId}`, 'disconnected')
        } else {
          emitToRenderer(`rdp:status:${sessionId}`, `error:Process exited with code ${code}`)
        }
      }
    })

    return sessionId
  },

  disconnect(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId)
    try {
      session.process.kill('SIGTERM')
      setTimeout(() => {
        try { session.process.kill('SIGKILL') } catch { /* already dead */ }
      }, 2000)
    } catch { /* already dead */ }
    emitToRenderer(`rdp:status:${sessionId}`, 'disconnected')
  },

  disconnectAll(): void {
    for (const [sessionId] of [...sessions]) {
      this.disconnect(sessionId)
    }
  },
}
