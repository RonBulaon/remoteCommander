import { BrowserWindow } from 'electron'
import * as os from 'os'
import { randomUUID } from 'crypto'
import type { IPty } from 'node-pty'

// node-pty is an optional native module — it needs a C/C++ toolchain to build.
// Load it lazily and guarded so the rest of the app works (and the build stays
// green) even when it isn't installed; the local-terminal tab just reports it.
let ptyMod: typeof import('node-pty') | null | undefined
function loadPty(): typeof import('node-pty') | null {
  if (ptyMod !== undefined) return ptyMod
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyMod = require('node-pty') as typeof import('node-pty')
  } catch (err) {
    console.error('[LocalTerminalService] node-pty unavailable:', (err as Error).message)
    ptyMod = null
  }
  return ptyMod
}

interface LocalSession {
  pty: IPty
}

const sessions = new Map<string, LocalSession>()

function emit(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, ...args)
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

export const LocalTerminalService = {
  sessions,

  connect(cols: number, rows: number): string {
    const pty = loadPty()
    if (!pty) {
      throw new Error(
        'Local terminal needs node-pty, which is not installed/built. Install a build toolchain then node-pty — e.g. "sudo apt install build-essential" then "npm install node-pty".',
      )
    }
    const sessionId = randomUUID()
    const term = pty.spawn(defaultShell(), [], {
      name: 'xterm-color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: os.homedir(),
      env: process.env as { [key: string]: string },
    })
    sessions.set(sessionId, { pty: term })

    term.onData((data) => emit(`local:data:${sessionId}`, data))
    term.onExit(() => {
      sessions.delete(sessionId)
      emit(`local:status:${sessionId}`, 'disconnected')
    })

    console.log(`[LocalTerminalService] spawned ${defaultShell()} (session ${sessionId})`)
    return sessionId
  },

  send(sessionId: string, data: string): void {
    sessions.get(sessionId)?.pty.write(data)
  },

  resize(sessionId: string, cols: number, rows: number): void {
    try { sessions.get(sessionId)?.pty.resize(cols, rows) } catch { /* terminal gone */ }
  },

  disconnect(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId)
    try { session.pty.kill() } catch { /* already dead */ }
  },

  disconnectAll(): void {
    for (const [sessionId] of [...sessions]) this.disconnect(sessionId)
  },
}
