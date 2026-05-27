import { BrowserWindow } from 'electron'
import { spawn, ChildProcess, execFileSync } from 'child_process'
import { basename, extname, join } from 'path'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { StoreService, StoredVpnProfile } from './StoreService'
import { encryptSecret, decryptSecret } from './secretCrypto'

// ── Types ─────────────────────────────────────────────────────────────────

export type VpnState = 'connecting' | 'connected' | 'disconnected'

export interface VpnStatus {
  state: VpnState
  assignedIp?: string
}

interface VpnSession {
  type: 'openvpn' | 'wireguard'
  configPath: string
  process: ChildProcess | null
  status: VpnStatus
  pollTimer: NodeJS.Timeout | null
  elevated: boolean
  authFile: string | null
}

// ── Module-level state ──────────────────────────────────────────────────────

const sessions = new Map<string, VpnSession>() // keyed by vpnProfileId

function emitToRenderer(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, ...args)
}

function emitStatus(vpnProfileId: string, status: VpnStatus): void {
  emitToRenderer(`vpn:status:${vpnProfileId}`, status)
}

function resolveProfile(vpnProfileId: string): StoredVpnProfile {
  const profile = StoreService.loadVpnProfiles().find((p) => p.id === vpnProfileId)
  if (!profile) throw new Error(`VPN profile not found: ${vpnProfileId}`)
  return profile
}

function which(bin: string): string | null {
  try {
    // execFileSync (no shell) — never interpolate into a shell command line.
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim()
    const first = out.split(/\r?\n/)[0].trim()
    return first || null
  } catch {
    return null
  }
}

// wg-quick derives the interface name from the config file's basename (e.g. wg0.conf → wg0).
function wgInterfaceName(configPath: string): string {
  return basename(configPath, extname(configPath))
}

// Pull the most useful line out of a log tail for the UI error.
function extractError(output: string): string | null {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const errorLine = [...lines].reverse().find((l) =>
    /ERROR|Cannot open|fatal|not permitted|permission denied|password is required|^sudo:/i.test(l),
  )
  return errorLine ?? lines[lines.length - 1] ?? null
}

function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0
}

// openvpn/wg-quick need root. On POSIX (when not already root) prefix `sudo -n`
// — non-interactive, so it fails fast with a clear message if NOPASSWD isn't
// configured instead of hanging on a password prompt with no TTY.
function elevate(binary: string, args: string[]): { cmd: string; cmdArgs: string[]; elevated: boolean } {
  if (process.platform === 'win32' || isRoot()) return { cmd: binary, cmdArgs: args, elevated: false }
  return { cmd: 'sudo', cmdArgs: ['-n', binary, ...args], elevated: true }
}

function runToClose(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: 'ignore' })
      p.on('close', () => resolve())
      p.on('error', () => resolve())
    } catch {
      resolve()
    }
  })
}

function safeUnlink(path: string | null): void {
  if (!path) return
  try { unlinkSync(path) } catch { /* gone or not ours */ }
}

function setSessionStatus(vpnProfileId: string, status: VpnStatus): void {
  const session = sessions.get(vpnProfileId)
  if (session) session.status = status
  emitStatus(vpnProfileId, status)
}

// ── VpnService ────────────────────────────────────────────────────────────

export const VpnService = {
  sessions,

  // Never expose the encrypted password to the renderer.
  listProfiles(): StoredVpnProfile[] {
    return StoreService.loadVpnProfiles().map(({ passwordEnc: _enc, ...rest }) => rest)
  },

  // password: a new plaintext password, or null/undefined to keep the saved one.
  saveProfile(profile: StoredVpnProfile, password?: string | null): void {
    const profiles = StoreService.loadVpnProfiles()
    const existing = profiles.find((p) => p.id === profile.id)
    const stored: StoredVpnProfile = { ...profile }
    if (password) stored.passwordEnc = encryptSecret(password)
    else if (existing?.passwordEnc) stored.passwordEnc = existing.passwordEnc

    const idx = profiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) profiles[idx] = stored
    else profiles.push(stored)
    StoreService.saveVpnProfiles(profiles)
  },

  async deleteProfile(vpnProfileId: string): Promise<void> {
    if (sessions.has(vpnProfileId)) await this.disconnect(vpnProfileId)
    const profiles = StoreService.loadVpnProfiles().filter((p) => p.id !== vpnProfileId)
    StoreService.saveVpnProfiles(profiles)
  },

  getStatus(vpnProfileId: string): VpnStatus {
    return sessions.get(vpnProfileId)?.status ?? { state: 'disconnected' }
  },

  async connect(vpnProfileId: string): Promise<void> {
    if (sessions.get(vpnProfileId)?.status.state === 'connected') return

    const profile = resolveProfile(vpnProfileId)
    const binary = profile.type === 'openvpn' ? which('openvpn') : which('wg-quick')
    if (!binary) {
      const name = profile.type === 'openvpn' ? 'openvpn' : 'wg-quick (wireguard-tools)'
      throw new Error(`${name} not found on PATH. Please install it.`)
    }

    const session: VpnSession = {
      type: profile.type,
      configPath: profile.configPath,
      process: null,
      status: { state: 'connecting' },
      pollTimer: null,
      elevated: false,
      authFile: null,
    }
    sessions.set(vpnProfileId, session)
    setSessionStatus(vpnProfileId, { state: 'connecting' })

    if (profile.type === 'openvpn') {
      const password = profile.passwordEnc ? decryptSecret(profile.passwordEnc) : null
      this.startOpenVpn(vpnProfileId, binary, profile, password)
    } else {
      this.startWireGuard(vpnProfileId, binary, profile.configPath)
    }
  },

  // OpenVPN runs in the foreground so we can parse its log for connection state.
  // If the profile has a username, credentials are injected via a temp 0600
  // file (--auth-user-pass) so the interactive prompt is never hit.
  startOpenVpn(vpnProfileId: string, binary: string, profile: StoredVpnProfile, password: string | null): void {
    const session = sessions.get(vpnProfileId)
    if (!session) return
    const { configPath } = profile

    const ovpnArgs = ['--config', configPath]
    if (profile.username) {
      const authFile = join(tmpdir(), `rc-vpn-${vpnProfileId}.auth`)
      writeFileSync(authFile, `${profile.username}\n${password ?? ''}\n`, { mode: 0o600 })
      session.authFile = authFile
      ovpnArgs.push('--auth-user-pass', authFile, '--auth-nocache')
    }

    const { cmd, cmdArgs, elevated } = elevate(binary, ovpnArgs)
    session.elevated = elevated
    console.log(`[VpnService] spawning ${elevated ? 'sudo ' : ''}openvpn --config ${configPath}`)
    const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    session.process = proc

    // Keep a rolling tail of the log so we can report why openvpn exited.
    let recentOutput = ''
    const record = (text: string): void => {
      recentOutput = (recentOutput + text).slice(-4000)
    }

    const parse = (text: string): void => {
      if (/Initialization Sequence Completed/i.test(text)) {
        console.log(`[VpnService] openvpn connected (${vpnProfileId})`)
        setSessionStatus(vpnProfileId, { state: 'connected', assignedIp: session.status.assignedIp })
      }
      const ipMatch = text.match(/ifconfig\s+(\d{1,3}(?:\.\d{1,3}){3})/i) ??
        text.match(/PUSH:.*?ifconfig\s+(\d{1,3}(?:\.\d{1,3}){3})/i)
      if (ipMatch) {
        session.status.assignedIp = ipMatch[1]
        if (session.status.state === 'connected') setSessionStatus(vpnProfileId, session.status)
      }
      if (/AUTH_FAILED|auth-failure|authentication failed/i.test(text)) {
        setSessionStatus(vpnProfileId, { state: 'disconnected' })
        emitToRenderer(`vpn:status:${vpnProfileId}`, { state: 'disconnected', error: 'Authentication failed' })
      }
    }

    proc.stdout?.on('data', (c: Buffer) => { const t = c.toString(); record(t); parse(t) })
    proc.stderr?.on('data', (c: Buffer) => { const t = c.toString(); record(t); parse(t) })

    proc.on('error', (err) => {
      console.error(`[VpnService] openvpn spawn error: ${err.message}`)
      setSessionStatus(vpnProfileId, { state: 'disconnected' })
      emitToRenderer(`vpn:status:${vpnProfileId}`, { state: 'disconnected', error: err.message })
      this.clearSession(vpnProfileId)
    })

    // 'close' fires after we stop it (session already removed → ignore) or when
    // openvpn exits on its own. The latter while still 'connecting' is a failure
    // we surface (commonly: sudo needs NOPASSWD, bad credentials, or no TUN).
    proc.on('close', (code) => {
      if (!sessions.has(vpnProfileId)) return
      const wasConnected = session.status.state === 'connected'
      console.log(`[VpnService] openvpn exited (code ${code})`)
      this.clearSession(vpnProfileId)
      if (wasConnected) {
        setSessionStatus(vpnProfileId, { state: 'disconnected' })
      } else {
        emitToRenderer(`vpn:status:${vpnProfileId}`, {
          state: 'disconnected',
          error: extractError(recentOutput) || `openvpn exited (code ${code}) before connecting`,
        })
      }
    })

    this.startPolling(vpnProfileId)
  },

  // wg-quick configures the interface and exits; success is exit code 0.
  startWireGuard(vpnProfileId: string, binary: string, configPath: string): void {
    const { cmd, cmdArgs, elevated } = elevate(binary, ['up', configPath])
    const session = sessions.get(vpnProfileId)
    if (session) session.elevated = elevated
    console.log(`[VpnService] spawning ${elevated ? 'sudo ' : ''}wg-quick up ${configPath}`)
    const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString() })

    proc.on('error', (err) => {
      setSessionStatus(vpnProfileId, { state: 'disconnected' })
      emitToRenderer(`vpn:status:${vpnProfileId}`, { state: 'disconnected', error: err.message })
      this.clearSession(vpnProfileId)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        const ip = this.readWireGuardIp(configPath)
        setSessionStatus(vpnProfileId, { state: 'connected', assignedIp: ip })
        this.startPolling(vpnProfileId)
      } else {
        setSessionStatus(vpnProfileId, { state: 'disconnected' })
        emitToRenderer(`vpn:status:${vpnProfileId}`, {
          state: 'disconnected',
          error: extractError(stderr) || `wg-quick exited with code ${code}`,
        })
        this.clearSession(vpnProfileId)
      }
    })
  },

  readWireGuardIp(configPath: string): string | undefined {
    try {
      const iface = wgInterfaceName(configPath)
      const out = execFileSync('ip', ['-4', 'addr', 'show', iface], { stdio: 'pipe', encoding: 'utf8' })
      return out.match(/inet\s+(\d{1,3}(?:\.\d{1,3}){3})/)?.[1]
    } catch {
      return undefined
    }
  },

  // Re-verify liveness every 3s and emit disconnects that happen out of band.
  startPolling(vpnProfileId: string): void {
    const session = sessions.get(vpnProfileId)
    if (!session || session.pollTimer) return

    session.pollTimer = setInterval(() => {
      const s = sessions.get(vpnProfileId)
      if (!s) return

      if (s.type === 'openvpn') {
        if (s.process && s.process.exitCode !== null) {
          setSessionStatus(vpnProfileId, { state: 'disconnected' })
          this.clearSession(vpnProfileId)
        }
      } else {
        // `ip link show` works without root, unlike `wg show`.
        try {
          execFileSync('ip', ['link', 'show', wgInterfaceName(s.configPath)], { stdio: 'pipe' })
        } catch {
          setSessionStatus(vpnProfileId, { state: 'disconnected' })
          this.clearSession(vpnProfileId)
        }
      }
    }, 3000)
  },

  clearSession(vpnProfileId: string): void {
    const session = sessions.get(vpnProfileId)
    if (!session) return
    if (session.pollTimer) clearInterval(session.pollTimer)
    safeUnlink(session.authFile)
    sessions.delete(vpnProfileId)
  },

  async disconnect(vpnProfileId: string): Promise<void> {
    const session = sessions.get(vpnProfileId)
    if (!session) {
      emitStatus(vpnProfileId, { state: 'disconnected' })
      return
    }

    if (session.pollTimer) clearInterval(session.pollTimer)

    if (session.type === 'openvpn') {
      if (session.elevated) {
        // A non-root process can't signal the root openvpn it spawned via sudo,
        // so stop it with sudo by matching the config path on its command line.
        await runToClose('sudo', ['-n', 'pkill', '-f', session.configPath])
      } else {
        try { session.process?.kill('SIGTERM') } catch { /* already dead */ }
      }
    } else {
      const binary = which('wg-quick') ?? 'wg-quick'
      const { cmd, cmdArgs } = elevate(binary, ['down', session.configPath])
      await runToClose(cmd, cmdArgs)
    }

    safeUnlink(session.authFile)
    sessions.delete(vpnProfileId)
    emitStatus(vpnProfileId, { state: 'disconnected' })
  },

  disconnectAll(): void {
    for (const [vpnProfileId] of [...sessions]) {
      void this.disconnect(vpnProfileId)
    }
  },
}
