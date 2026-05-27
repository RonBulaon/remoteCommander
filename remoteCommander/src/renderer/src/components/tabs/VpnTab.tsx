import { useState } from 'react'
import { useVpnStore } from '../../store/vpnStore'
import { ipc } from '../../lib/ipc'
import { VpnProfile } from '../../types/profile'

// ── Badges ──────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: VpnProfile['type'] }) {
  const meta = type === 'openvpn'
    ? { label: 'OpenVPN', fg: '#dcdcaa' }
    : { label: 'WireGuard', fg: '#88c0d0' }
  return (
    <span
      className="shrink-0 rounded-sm border px-1.5 text-[10px] font-semibold leading-5"
      style={{ color: meta.fg, backgroundColor: meta.fg + '18', borderColor: meta.fg + '40' }}
    >
      {meta.label}
    </span>
  )
}

function StatusBadge({ state }: { state: 'connecting' | 'connected' | 'disconnected' }) {
  const meta =
    state === 'connected'  ? { label: 'Connected',  fg: '#4ec9b0' } :
    state === 'connecting' ? { label: 'Connecting…', fg: '#dcdcaa' } :
    { label: 'Disconnected', fg: '#858585' }
  return (
    <span className="flex items-center gap-1.5 text-[11px]" style={{ color: meta.fg }}>
      <span className={`h-2 w-2 rounded-full ${state === 'connecting' ? 'animate-pulse' : ''}`} style={{ backgroundColor: meta.fg }} />
      {meta.label}
    </span>
  )
}

// ── Add / edit form ───────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1.5 text-[13px] text-[#cccccc] outline-none placeholder:text-[#6d6d6d] focus:border-[#007acc]'

function VpnForm({ initial, onSave, onCancel }: {
  initial?: VpnProfile
  onSave: (p: VpnProfile, password: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<VpnProfile['type']>(initial?.type ?? 'openvpn')
  const [configPath, setConfigPath] = useState(initial?.configPath ?? '')
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState('')
  const [autoConnect, setAutoConnect] = useState(initial?.autoConnect ?? false)
  const [error, setError] = useState<string | null>(null)

  const browse = async () => {
    const res = await ipc.dialog.openFile({
      title: 'Select VPN Config File',
      filters: [
        { name: 'VPN Config', extensions: ['ovpn', 'conf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (res.filePath) setConfigPath(res.filePath)
  }

  const submit = () => {
    if (!name.trim()) { setError('Name is required.'); return }
    if (!configPath.trim()) { setError('Config file is required.'); return }
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      type,
      configPath: configPath.trim(),
      username: type === 'openvpn' && username.trim() ? username.trim() : undefined,
      autoConnect,
    }, password)
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-[#3e3e42] bg-[#252526] p-4">
      <p className="text-[12px] font-semibold text-[#cccccc]">
        {initial ? 'Edit VPN Profile' : 'New VPN Profile'}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[#bbbbbb]">Name</label>
          <input className={inputCls} placeholder="Office VPN" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[#bbbbbb]">Type</label>
          <select
            className={inputCls}
            value={type}
            onChange={(e) => setType(e.target.value as VpnProfile['type'])}
          >
            <option value="openvpn">OpenVPN</option>
            <option value="wireguard">WireGuard</option>
          </select>
        </div>

        <div className="flex items-end pb-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[#cccccc]">
            <input type="checkbox" checked={autoConnect} onChange={(e) => setAutoConnect(e.target.checked)} />
            Auto-connect before sessions
          </label>
        </div>

        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[#bbbbbb]">Config File</label>
          <div className="flex gap-1.5">
            <input className={inputCls} placeholder="/etc/wireguard/wg0.conf" value={configPath} onChange={(e) => setConfigPath(e.target.value)} />
            <button
              type="button"
              className="shrink-0 rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2.5 text-[12px] text-[#cccccc] hover:border-[#007acc] hover:text-[#007acc]"
              onClick={browse}
            >
              Browse
            </button>
          </div>
        </div>

        {type === 'openvpn' && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-[#bbbbbb]">Username</label>
              <input className={inputCls} placeholder="VPN username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-[#bbbbbb]">Password</label>
              <input
                className={inputCls}
                type="password"
                placeholder={initial ? '(saved — leave blank to keep)' : 'VPN password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <p className="col-span-2 text-[11px] text-[#6d6d6d]">
              Only needed if your config uses <code>auth-user-pass</code>. Leave blank for certificate-only configs.
            </p>
          </>
        )}
      </div>

      {error && <p className="text-[12px] text-[#f48771]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          className="rounded-sm border border-[#3e3e42] px-3 py-1.5 text-[12px] text-[#858585] hover:border-[#6d6d6d] hover:text-[#cccccc]"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="rounded-sm bg-[#007acc] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#0069ac]"
          onClick={submit}
        >
          {initial ? 'Save' : 'Add Profile'}
        </button>
      </div>
    </div>
  )
}

// ── VpnTab ──────────────────────────────────────────────────────────────────

export function VpnTab() {
  const { profiles, statuses, saveProfile, deleteProfile, statusOf } = useVpnStore()
  const [editing, setEditing] = useState<VpnProfile | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errorById, setErrorById] = useState<Record<string, string>>({})

  const handleSave = async (p: VpnProfile, password: string) => {
    // Blank password on edit → keep the saved one; the password is persisted
    // encrypted-at-rest in the profile by the main process.
    await saveProfile(p, password || null)
    setEditing(null)
  }

  const handleConnect = async (id: string) => {
    setBusyId(id)
    setErrorById((e) => ({ ...e, [id]: '' }))
    const res = await ipc.vpn.connect(id)
    if ('error' in res) setErrorById((e) => ({ ...e, [id]: res.error }))
    setBusyId(null)
  }

  const handleDisconnect = async (id: string) => {
    setBusyId(id)
    await ipc.vpn.disconnect(id)
    setBusyId(null)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#3e3e42] bg-[#2d2d2d] px-4 py-2">
        <span className="text-[13px] font-semibold text-[#cccccc]">VPN Connections</span>
        {!editing && (
          <button
            className="flex items-center gap-1.5 rounded-sm bg-[#007acc] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#0069ac]"
            onClick={() => setEditing('new')}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M5 1v8M1 5h8" />
            </svg>
            Add VPN Profile
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {editing && (
          <div className="mb-4">
            <VpnForm
              initial={editing === 'new' ? undefined : editing}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}

        {profiles.length === 0 && !editing ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 text-[32px] opacity-40">🔒</div>
            <p className="text-[13px] text-[#858585]">No VPN profiles yet.</p>
            <p className="mt-1 text-[12px] text-[#6d6d6d]">
              Add an OpenVPN or WireGuard config to manage connections here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {profiles.map((p) => {
              const status = statuses[p.id] ?? statusOf(p.id)
              const isBusy = busyId === p.id
              const isConnected = status.state === 'connected'
              return (
                <div key={p.id} className="flex flex-col rounded border border-[#3e3e42] bg-[#252526] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="truncate text-[13px] font-medium text-[#cccccc]">{p.name}</span>
                    <TypeBadge type={p.type} />
                    {p.autoConnect && (
                      <span className="rounded-sm border border-[#3e3e42] px-1.5 text-[10px] text-[#858585]">auto</span>
                    )}
                    <div className="ml-auto flex items-center gap-3">
                      <StatusBadge state={status.state} />
                      {isConnected ? (
                        <button
                          className="rounded-sm border border-[#3e3e42] px-3 py-1 text-[12px] text-[#cccccc] hover:border-[#f48771] hover:text-[#f48771] disabled:opacity-50"
                          onClick={() => handleDisconnect(p.id)}
                          disabled={isBusy}
                        >
                          Disconnect
                        </button>
                      ) : status.state === 'connecting' ? (
                        <button
                          className="rounded-sm border border-[#d7ba7d] px-3 py-1 text-[12px] text-[#d7ba7d] hover:bg-[#d7ba7d1a]"
                          onClick={() => handleDisconnect(p.id)}
                          title="Stop the connection attempt"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          className="rounded-sm bg-[#007acc] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#0069ac] disabled:opacity-50"
                          onClick={() => handleConnect(p.id)}
                          disabled={isBusy}
                        >
                          Connect
                        </button>
                      )}
                      <button
                        className="rounded-sm p-1 text-[#858585] hover:text-[#cccccc]"
                        title="Edit"
                        onClick={() => setEditing(p)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <button
                        className="rounded-sm p-1 text-[#858585] hover:text-[#f48771]"
                        title="Delete"
                        onClick={() => deleteProfile(p.id)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="mt-1 flex items-center gap-3 text-[11px] text-[#6d6d6d]">
                    <span className="truncate">{p.configPath}</span>
                    {isConnected && status.assignedIp && (
                      <span className="ml-auto shrink-0 text-[#4ec9b0]">IP: {status.assignedIp}</span>
                    )}
                  </div>

                  {errorById[p.id] && (
                    <p className="mt-2 text-[11px] text-[#f48771]">{errorById[p.id]}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
