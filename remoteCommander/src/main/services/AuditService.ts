import type DatabaseType from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { StoreService } from './StoreService'

// ── Types ─────────────────────────────────────────────────────────────────

export interface ConnectionEvent {
  id: number
  timestamp: string
  profileId: string
  profileName: string
  protocol: string
  host: string
  username: string
  durationSeconds: number | null
}

export interface AuditFilters {
  protocol?: string
  host?: string
  profileName?: string
  since?: string // ISO date
  until?: string // ISO date
}

// ── Module state ────────────────────────────────────────────────────────────

let db: DatabaseType.Database | null = null
const openRows = new Map<string, { id: number; start: number }>() // sessionId → row

// Lazy, guarded native-module load: a broken better-sqlite3 build degrades
// audit to a no-op instead of crashing the whole app at startup.
let driver: typeof DatabaseType | null | undefined
function loadDriver(): typeof DatabaseType | null {
  if (driver !== undefined) return driver
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    driver = require('better-sqlite3') as typeof DatabaseType
  } catch (err) {
    console.error('[AuditService] better-sqlite3 unavailable:', err)
    driver = null
  }
  return driver
}

// Lazily open the DB. Wrapped so a native-module failure can never break an
// actual connection — audit just degrades to a no-op.
function getDb(): DatabaseType.Database | null {
  if (db) return db
  const Driver = loadDriver()
  if (!Driver) return null
  try {
    db = new Driver(join(app.getPath('userData'), 'audit.db'))
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS connection_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        profileId TEXT,
        profileName TEXT,
        protocol TEXT,
        host TEXT,
        username TEXT,
        durationSeconds INTEGER
      )
    `)
    return db
  } catch (err) {
    console.error('[AuditService] failed to open audit DB:', err)
    return null
  }
}

function resolveProfileMeta(profileId: string): { name: string; host: string; username: string } {
  const p = StoreService.load().profiles.find(
    (x) => (x as { id?: string }).id === profileId,
  ) as { name?: string; host?: string; username?: string } | undefined
  return { name: p?.name ?? profileId, host: p?.host ?? '', username: p?.username ?? '' }
}

// ── AuditService ────────────────────────────────────────────────────────────

export const AuditService = {
  logConnect(sessionId: string, profileId: string, protocol: string): void {
    const d = getDb()
    if (!d) return
    try {
      const meta = resolveProfileMeta(profileId)
      const info = d
        .prepare(
          `INSERT INTO connection_events (timestamp, profileId, profileName, protocol, host, username, durationSeconds)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(new Date().toISOString(), profileId, meta.name, protocol, meta.host, meta.username, null)
      openRows.set(sessionId, { id: Number(info.lastInsertRowid), start: Date.now() })
    } catch (err) {
      console.error('[AuditService] logConnect failed:', err)
    }
  },

  logDisconnect(sessionId: string): void {
    const row = openRows.get(sessionId)
    if (!row) return
    openRows.delete(sessionId)
    const d = getDb()
    if (!d) return
    try {
      const duration = Math.max(0, Math.round((Date.now() - row.start) / 1000))
      d.prepare(`UPDATE connection_events SET durationSeconds = ? WHERE id = ?`).run(duration, row.id)
    } catch (err) {
      console.error('[AuditService] logDisconnect failed:', err)
    }
  },

  query(filters: AuditFilters = {}): ConnectionEvent[] {
    const d = getDb()
    if (!d) return []
    try {
      const where: string[] = []
      const params: unknown[] = []
      if (filters.protocol) { where.push('protocol = ?'); params.push(filters.protocol) }
      if (filters.host) { where.push('host LIKE ?'); params.push(`%${filters.host}%`) }
      if (filters.profileName) { where.push('profileName LIKE ?'); params.push(`%${filters.profileName}%`) }
      if (filters.since) { where.push('timestamp >= ?'); params.push(filters.since) }
      if (filters.until) { where.push('timestamp <= ?'); params.push(filters.until) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      return d
        .prepare(`SELECT * FROM connection_events ${clause} ORDER BY timestamp DESC LIMIT 1000`)
        .all(...params) as ConnectionEvent[]
    } catch (err) {
      console.error('[AuditService] query failed:', err)
      return []
    }
  },

  exportCsv(filters: AuditFilters = {}): string {
    const rows = this.query(filters)
    const header = ['timestamp', 'profileName', 'protocol', 'host', 'username', 'durationSeconds']
    const escape = (v: unknown): string => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push([r.timestamp, r.profileName, r.protocol, r.host, r.username, r.durationSeconds].map(escape).join(','))
    }
    return lines.join('\n')
  },
}
