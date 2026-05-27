import { BrowserWindow } from 'electron'
import { Client } from 'ssh2'
import type { ConnectConfig, SFTPWrapper } from 'ssh2'
import { readFileSync, createReadStream, createWriteStream } from 'fs'
import { readdir, stat, readFile as fsReadFile, writeFile as fsWriteFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { SshService } from './SshService'
import { CredentialService } from './CredentialService'
import { StoreService } from './StoreService'

// ── Types ──────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string
  size: number
  mtime: number       // unix ms
  permissions: number // raw mode bits
  isDir: boolean
  isSymlink: boolean
}

export interface TransferProgress {
  transferId: string
  transferred: number
  total: number
  speed: number       // bytes/sec
  eta: number         // seconds remaining
  status: 'progress' | 'done' | 'error' | 'cancelled'
  error?: string
}

interface ProfileRecord {
  id: string
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key' | 'agent'
  privateKeyPath?: string
}

interface TransferHandle {
  cancel: () => void
}

interface SftpSessionRecord {
  sftp: SFTPWrapper
  client: Client
  ownedClient: boolean
  profileId: string
  transfers: Map<string, TransferHandle>
}

// ── Module state ───────────────────────────────────────────────────────────

const sessions = new Map<string, SftpSessionRecord>()

// ── Helpers ────────────────────────────────────────────────────────────────

function emit(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, ...args)
}

function resolveProfile(profileId: string): ProfileRecord {
  const data = StoreService.load()
  const p = data.profiles.find(
    (x) => (x as unknown as ProfileRecord).id === profileId,
  ) as unknown as ProfileRecord | undefined
  if (!p) throw new Error(`Profile not found: ${profileId}`)
  return p
}

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

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(err)
      else resolve(sftp)
    })
  })
}

// Text-editor file guards: cap size and refuse binary content.
const MAX_EDIT_BYTES = 5 * 1024 * 1024

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

function tooLargeError(size: number): Error {
  return new Error(
    `File is too large to edit (${(size / 1024 / 1024).toFixed(1)} MB; limit ${MAX_EDIT_BYTES / 1024 / 1024} MB).`,
  )
}

// ── SftpService ────────────────────────────────────────────────────────────

export const SftpService = {
  sessions,

  async connect(
    profileId: string,
  ): Promise<{ sessionId: string; localHome: string; remoteHome: string }> {
    const sessionId = randomUUID()
    const profile = resolveProfile(profileId)

    // Reuse an existing live SSH client for this profile if one exists
    let client: Client | null = null
    let ownedClient = false

    for (const session of SshService.sessions.values()) {
      const s = session as unknown as { profileId: string; client: Client }
      if (s.profileId === profileId) {
        client = s.client
        break
      }
    }

    if (!client) {
      const authOpts = await buildAuthOpts(profile)
      const cfg: ConnectConfig = {
        host: profile.host,
        port: profile.port || 22,
        username: profile.username,
        readyTimeout: 20000,
        ...authOpts,
      }
      client = await new Promise<Client>((resolve, reject) => {
        const c = new Client()
        c.on('ready', () => resolve(c))
        c.on('error', reject)
        c.connect(cfg)
      })
      ownedClient = true
    }

    const sftp = await openSftp(client)

    const record: SftpSessionRecord = {
      sftp,
      client,
      ownedClient,
      profileId,
      transfers: new Map(),
    }
    sessions.set(sessionId, record)

    if (ownedClient) {
      const handleClose = () => {
        sessions.delete(sessionId)
        emit(`sftp:status:${sessionId}`, 'disconnected')
      }
      client.on('end', handleClose)
      client.on('error', handleClose)
    }

    return {
      sessionId,
      localHome: homedir(),
      remoteHome: `/home/${profile.username}`,
    }
  },

  async list(sessionId: string, remotePath: string): Promise<FileEntry[]> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)

    return new Promise((resolve, reject) => {
      session.sftp.readdir(remotePath, (err, list) => {
        if (err) { reject(err); return }
        const entries: FileEntry[] = list.map((entry) => {
          const mode = entry.attrs.mode ?? 0
          return {
            name: entry.filename,
            size: entry.attrs.size ?? 0,
            mtime: (entry.attrs.mtime ?? 0) * 1000,
            permissions: mode,
            isDir: (mode & 0o170000) === 0o040000,
            isSymlink: (mode & 0o170000) === 0o120000,
          }
        })
        // Sort: dirs first, then alphabetically
        entries.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        resolve(entries)
      })
    })
  },

  async listLocal(_sessionId: string, localPath: string): Promise<FileEntry[]> {
    const dirEntries = await readdir(localPath, { withFileTypes: true })
    const results = await Promise.all(
      dirEntries.map(async (entry): Promise<FileEntry | null> => {
        try {
          const fullPath = join(localPath, entry.name)
          const s = await stat(fullPath)
          return {
            name: entry.name,
            size: s.size,
            mtime: s.mtimeMs,
            permissions: s.mode,
            isDir: s.isDirectory(),
            isSymlink: s.isSymbolicLink(),
          }
        } catch {
          return null
        }
      }),
    )
    const entries = results.filter((e): e is FileEntry => e !== null)
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return entries
  },

  async upload(
    sessionId: string,
    localPath: string,
    remotePath: string,
  ): Promise<{ transferId: string }> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)

    const transferId = randomUUID()
    let totalSize = 0
    try {
      totalSize = (await stat(localPath)).size
    } catch { /* not critical */ }

    const readStream = createReadStream(localPath)
    const writeStream = session.sftp.createWriteStream(remotePath)
    let transferred = 0
    const startTime = Date.now()

    readStream.on('data', (chunk: Buffer | string) => {
      if (typeof chunk === 'string') return
      transferred += chunk.length
      const elapsed = (Date.now() - startTime) / 1000
      const speed = elapsed > 0 ? transferred / elapsed : 0
      const eta = speed > 0 ? (totalSize - transferred) / speed : 0
      emit(`sftp:progress:${transferId}`, {
        transferId, transferred, total: totalSize, speed, eta, status: 'progress',
      } satisfies TransferProgress)
    })

    session.transfers.set(transferId, {
      cancel: () => { readStream.destroy(new Error('cancelled')); writeStream.destroy() },
    })

    const done = new Promise<void>((resolve, reject) => {
      writeStream.on('close', () => {
        session.transfers.delete(transferId)
        emit(`sftp:progress:${transferId}`, {
          transferId, transferred: totalSize, total: totalSize, speed: 0, eta: 0, status: 'done',
        } satisfies TransferProgress)
        resolve()
      })
      const onErr = (err: Error) => {
        session.transfers.delete(transferId)
        const cancelled = err.message === 'cancelled'
        emit(`sftp:progress:${transferId}`, {
          transferId, transferred, total: totalSize, speed: 0, eta: 0,
          status: cancelled ? 'cancelled' : 'error',
          error: cancelled ? undefined : err.message,
        } satisfies TransferProgress)
        reject(err)
      }
      writeStream.on('error', onErr)
      readStream.on('error', onErr)
    })

    readStream.pipe(writeStream)
    done.catch(() => { /* handled via progress events */ })

    return { transferId }
  },

  async download(
    sessionId: string,
    remotePath: string,
    localPath: string,
  ): Promise<{ transferId: string }> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)

    const transferId = randomUUID()
    let totalSize = 0
    try {
      totalSize = await new Promise<number>((resolve, reject) => {
        session.sftp.stat(remotePath, (err, attrs) => {
          if (err) reject(err)
          else resolve(attrs.size ?? 0)
        })
      })
    } catch { /* not critical */ }

    const readStream = session.sftp.createReadStream(remotePath)
    const writeStream = createWriteStream(localPath)
    let transferred = 0
    const startTime = Date.now()

    readStream.on('data', (chunk: Buffer) => {
      transferred += chunk.length
      const elapsed = (Date.now() - startTime) / 1000
      const speed = elapsed > 0 ? transferred / elapsed : 0
      const eta = speed > 0 ? (totalSize - transferred) / speed : 0
      emit(`sftp:progress:${transferId}`, {
        transferId, transferred, total: totalSize, speed, eta, status: 'progress',
      } satisfies TransferProgress)
    })

    session.transfers.set(transferId, {
      cancel: () => { readStream.destroy(new Error('cancelled')); writeStream.destroy() },
    })

    const done = new Promise<void>((resolve, reject) => {
      writeStream.on('close', () => {
        session.transfers.delete(transferId)
        emit(`sftp:progress:${transferId}`, {
          transferId, transferred: totalSize, total: totalSize, speed: 0, eta: 0, status: 'done',
        } satisfies TransferProgress)
        resolve()
      })
      const onErr = (err: Error) => {
        session.transfers.delete(transferId)
        const cancelled = err.message === 'cancelled'
        emit(`sftp:progress:${transferId}`, {
          transferId, transferred, total: totalSize, speed: 0, eta: 0,
          status: cancelled ? 'cancelled' : 'error',
          error: cancelled ? undefined : err.message,
        } satisfies TransferProgress)
        reject(err)
      }
      writeStream.on('error', onErr)
      readStream.on('error', onErr)
    })

    readStream.pipe(writeStream)
    done.catch(() => { /* handled via progress events */ })

    return { transferId }
  },

  async uploadFolder(sessionId: string, localPath: string, remotePath: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)

    await new Promise<void>((resolve) => {
      session.sftp.mkdir(remotePath, () => resolve())
    })

    const entries = await readdir(localPath, { withFileTypes: true })
    for (const entry of entries) {
      const localChild = join(localPath, entry.name)
      const remoteChild = remotePath.replace(/\/$/, '') + '/' + entry.name
      if (entry.isDirectory()) {
        await SftpService.uploadFolder(sessionId, localChild, remoteChild)
      } else {
        await SftpService.upload(sessionId, localChild, remoteChild)
      }
    }
  },

  async delete(sessionId: string, remotePath: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)

    return new Promise((resolve, reject) => {
      session.sftp.unlink(remotePath, (err) => {
        if (!err) { resolve(); return }
        session.sftp.rmdir(remotePath, (err2) => {
          if (err2) reject(err2)
          else resolve()
        })
      })
    })
  },

  async mkdir(sessionId: string, remotePath: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)

    return new Promise((resolve, reject) => {
      session.sftp.mkdir(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },

  async rename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)

    return new Promise((resolve, reject) => {
      session.sftp.rename(oldPath, newPath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },

  async chmod(sessionId: string, remotePath: string, mode: number): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)

    return new Promise((resolve, reject) => {
      session.sftp.chmod(remotePath, mode, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },

  // ── Text editing (read/write whole file) ───────────────────────────────────

  async readFile(sessionId: string, remotePath: string): Promise<{ content: string }> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)

    const size = await new Promise<number>((resolve, reject) => {
      session.sftp.stat(remotePath, (err, attrs) => (err ? reject(err) : resolve(attrs.size ?? 0)))
    })
    if (size > MAX_EDIT_BYTES) throw tooLargeError(size)

    const buf = await new Promise<Buffer>((resolve, reject) => {
      session.sftp.readFile(remotePath, (err, data) => (err ? reject(err) : resolve(data as Buffer)))
    })
    if (isBinary(buf)) throw new Error('File appears to be binary and cannot be edited as text.')
    return { content: buf.toString('utf8') }
  },

  async writeFile(sessionId: string, remotePath: string, content: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`SFTP session not found: ${sessionId}`)
    await new Promise<void>((resolve, reject) => {
      session.sftp.writeFile(remotePath, Buffer.from(content, 'utf8'), (err) => (err ? reject(err) : resolve()))
    })
  },

  async readLocalFile(localPath: string): Promise<{ content: string }> {
    const s = await stat(localPath)
    if (s.size > MAX_EDIT_BYTES) throw tooLargeError(s.size)
    const buf = await fsReadFile(localPath)
    if (isBinary(buf)) throw new Error('File appears to be binary and cannot be edited as text.')
    return { content: buf.toString('utf8') }
  },

  async writeLocalFile(localPath: string, content: string): Promise<void> {
    await fsWriteFile(localPath, content, 'utf8')
  },

  cancelTransfer(transferId: string): void {
    for (const session of sessions.values()) {
      const handle = session.transfers.get(transferId)
      if (handle) {
        handle.cancel()
        session.transfers.delete(transferId)
        return
      }
    }
  },

  disconnect(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId)
    for (const handle of session.transfers.values()) {
      handle.cancel()
    }
    if (session.ownedClient) {
      session.client.end()
    }
  },

  disconnectAll(): void {
    for (const [id] of [...sessions]) {
      SftpService.disconnect(id)
    }
  },
}
