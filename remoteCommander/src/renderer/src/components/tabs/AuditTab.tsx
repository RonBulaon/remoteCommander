import { useCallback, useEffect, useState } from 'react'
import { ipc, ConnectionEvent, AuditFilters } from '../../lib/ipc'

function formatTime(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function formatDuration(s: number | null): string {
  if (s == null) return '—'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

const PROTO_COLORS: Record<string, string> = {
  ssh: '#4ec9b0', sftp: '#569cd6', rdp: '#c586c0', vnc: '#ce9178',
}

const inputCls =
  'rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1 text-[12px] text-[#cccccc] outline-none placeholder:text-[#6d6d6d] focus:border-[#007acc]'

export function AuditTab() {
  const [events, setEvents] = useState<ConnectionEvent[]>([])
  const [protocol, setProtocol] = useState('')
  const [host, setHost] = useState('')
  const [profileName, setProfileName] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')

  const buildFilters = useCallback((): AuditFilters => ({
    protocol: protocol || undefined,
    host: host.trim() || undefined,
    profileName: profileName.trim() || undefined,
    since: since ? new Date(since).toISOString() : undefined,
    until: until ? new Date(`${until}T23:59:59`).toISOString() : undefined,
  }), [protocol, host, profileName, since, until])

  const refresh = useCallback(async () => {
    const res = await ipc.audit.query(buildFilters())
    setEvents(res.events)
  }, [buildFilters])

  useEffect(() => { refresh() }, [refresh])

  const exportCsv = async () => {
    const { csv } = await ipc.audit.export(buildFilters())
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `connection-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#3e3e42] bg-[#2d2d2d] px-4 py-2">
        <span className="text-[13px] font-semibold text-[#cccccc]">Connection History</span>
        <button
          className="rounded-sm border border-[#3e3e42] px-3 py-1 text-[12px] text-[#cccccc] hover:border-[#007acc] hover:text-[#007acc]"
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#3e3e42] px-4 py-2">
        <select className={inputCls} value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          <option value="">All protocols</option>
          <option value="ssh">SSH</option>
          <option value="sftp">SFTP</option>
          <option value="rdp">RDP</option>
          <option value="vnc">VNC</option>
        </select>
        <input className={inputCls} placeholder="Server name" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
        <input className={inputCls} placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} />
        <input className={inputCls} type="date" value={since} onChange={(e) => setSince(e.target.value)} title="From" />
        <input className={inputCls} type="date" value={until} onChange={(e) => setUntil(e.target.value)} title="To" />
        <button
          className="rounded-sm border border-[#3e3e42] px-2.5 py-1 text-[12px] text-[#858585] hover:text-[#cccccc]"
          onClick={() => { setProtocol(''); setHost(''); setProfileName(''); setSince(''); setUntil('') }}
        >
          Clear
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-[#6d6d6d]">No connection events recorded yet.</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[#252526] text-[#858585]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Server</th>
                <th className="px-4 py-2 text-left font-medium">Protocol</th>
                <th className="px-4 py-2 text-left font-medium">Host</th>
                <th className="px-4 py-2 text-left font-medium">User</th>
                <th className="px-4 py-2 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-[#2d2d2d] text-[#cccccc] hover:bg-[#2a2d2e]">
                  <td className="whitespace-nowrap px-4 py-1.5 text-[#bbbbbb]">{formatTime(e.timestamp)}</td>
                  <td className="px-4 py-1.5">{e.profileName}</td>
                  <td className="px-4 py-1.5">
                    <span style={{ color: PROTO_COLORS[e.protocol] ?? '#cccccc' }}>{e.protocol.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-1.5 text-[#bbbbbb]">{e.host}</td>
                  <td className="px-4 py-1.5 text-[#bbbbbb]">{e.username}</td>
                  <td className="px-4 py-1.5 text-right text-[#bbbbbb]">{formatDuration(e.durationSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="flex h-[22px] shrink-0 items-center border-t border-[#3e3e42] bg-[#252526] px-3">
        <span className="text-[11px] text-[#858585]">{events.length} event{events.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  )
}
