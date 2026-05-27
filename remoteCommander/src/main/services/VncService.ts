import { BrowserWindow } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import * as net from 'net'
import { randomUUID } from 'crypto'
import { CredentialService } from './CredentialService'
import { StoreService } from './StoreService'

// ── Types ─────────────────────────────────────────────────────────────────

interface VncProfileData {
  id: string
  host: string
  port?: number
  vncPort?: number
  vncDisplay?: number
}

interface VncSession {
  wss: WebSocketServer
  port: number
  profileId: string
}

// ── Module-level state ────────────────────────────────────────────────────

const sessions = new Map<string, VncSession>()

function emitToRenderer(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, ...args)
}

function resolveProfile(profileId: string): VncProfileData {
  const storeData = StoreService.load()
  const profile = storeData.profiles.find(
    (p) => (p as unknown as { id: string }).id === profileId,
  ) as unknown as VncProfileData | undefined
  if (!profile) throw new Error(`Profile not found: ${profileId}`)
  return profile
}

function resolveVncPort(profile: VncProfileData): number {
  if (profile.vncPort && profile.vncPort > 0) return profile.vncPort
  if (profile.vncDisplay != null && profile.vncDisplay >= 0) return 5900 + profile.vncDisplay
  if (profile.port && profile.port > 0) return profile.port
  return 5900
}

// ── VncService ────────────────────────────────────────────────────────────

export const VncService = {
  sessions,

  async connect(profileId: string): Promise<{
    sessionId: string
    localWsPort: number
    password: string | null
  }> {
    const sessionId = randomUUID()
    const profile = resolveProfile(profileId)
    const vncPort = resolveVncPort(profile)
    const password = await CredentialService.get(profileId)

    // Create a WebSocket server on a random local port.
    // Each WS client connection is proxied to the VNC TCP server — this is
    // the equivalent of websockify but implemented in Node.js directly.
    // handleProtocols accepts the 'binary' subprotocol that noVNC requests.
    const wss = await new Promise<WebSocketServer>((resolve, reject) => {
      const server = new WebSocketServer({
        host: '127.0.0.1',
        port: 0,
        handleProtocols: (protocols: Set<string>) =>
          protocols.has('binary') ? 'binary' : (protocols.values().next().value ?? false),
        perMessageDeflate: false,
      })
      server.once('listening', () => resolve(server))
      server.once('error', reject)
    })

    const addr = wss.address() as net.AddressInfo
    sessions.set(sessionId, { wss, port: addr.port, profileId })

    console.log(`[VncService] Proxy listening on 127.0.0.1:${addr.port} → ${profile.host}:${vncPort}`)

    wss.on('connection', (ws) => {
      console.log(`[VncService] noVNC connected to proxy (session ${sessionId})`)
      const tcp = net.createConnection(vncPort, profile.host)

      tcp.once('connect', () => {
        console.log(`[VncService] TCP connected to VNC server ${profile.host}:${vncPort}`)
        tcp.setTimeout(0) // clear connection-phase timeout; VNC keepalive handled by noVNC
        emitToRenderer(`vnc:status:${sessionId}`, 'connected')
      })

      // WebSocket → TCP (data from noVNC to VNC server)
      ws.on('message', (data) => {
        if (!tcp.writable) return
        // data can be Buffer | ArrayBuffer | Buffer[] depending on ws version
        if (Buffer.isBuffer(data)) {
          tcp.write(data)
        } else if (Array.isArray(data)) {
          tcp.write(Buffer.concat(data))
        } else {
          tcp.write(Buffer.from(data as ArrayBuffer))
        }
      })

      // TCP → WebSocket (data from VNC server to noVNC)
      tcp.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data, { binary: true })
        }
      })

      // 15-second TCP connection timeout
      tcp.setTimeout(15000)
      tcp.on('timeout', () => {
        console.error(`[VncService] TCP connection timed out to ${profile.host}:${vncPort}`)
        emitToRenderer(`vnc:status:${sessionId}`, `error:Connection timed out (${profile.host}:${vncPort})`)
        tcp.destroy()
        if (ws.readyState !== WebSocket.CLOSED) ws.close()
      })

      const cleanup = () => {
        try { tcp.destroy() } catch { /* already gone */ }
        try { if (ws.readyState !== WebSocket.CLOSED) ws.close() } catch { /* already gone */ }
      }

      ws.on('close', () => tcp.destroy())
      ws.on('error', (err) => {
        console.error('[VncService] WS error:', err.message)
        cleanup()
      })

      tcp.on('close', () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
        if (sessions.has(sessionId)) {
          emitToRenderer(`vnc:status:${sessionId}`, 'disconnected')
        }
      })

      tcp.on('error', (err) => {
        console.error(`[VncService] TCP error: ${err.message}`)
        emitToRenderer(`vnc:status:${sessionId}`, `error:${err.message}`)
        cleanup()
      })
    })

    emitToRenderer(`vnc:status:${sessionId}`, 'connecting')
    return { sessionId, localWsPort: addr.port, password }
  },

  disconnect(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId)
    try { session.wss.close() } catch { /* already closed */ }
    emitToRenderer(`vnc:status:${sessionId}`, 'disconnected')
  },

  disconnectAll(): void {
    for (const [sessionId] of [...sessions]) {
      this.disconnect(sessionId)
    }
  },
}
