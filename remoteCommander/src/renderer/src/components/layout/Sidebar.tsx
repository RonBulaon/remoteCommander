import { useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Dialog from '@radix-ui/react-dialog'
import { useProfileStore } from '../../store/profileStore'
import { useTabStore } from '../../store/tabStore'
import { useVpnStore } from '../../store/vpnStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { ipc } from '../../lib/ipc'
import { Profile, ProfileGroup, ConnectionHistoryEntry, Protocol, VpnProfile } from '../../types/profile'
import { ProfileEditor } from '../profiles/ProfileEditor'

// ── Helpers ───────────────────────────────────────────────────────────────

const PROTOCOL_META: Record<Protocol, { label: string; fg: string; bg: string }> = {
  ssh:  { label: 'SSH',  fg: '#4ec9b0', bg: '#4ec9b018' },
  sftp: { label: 'SFTP', fg: '#569cd6', bg: '#569cd618' },
  rdp:  { label: 'RDP',  fg: '#c586c0', bg: '#c586c018' },
  vnc:  { label: 'VNC',  fg: '#ce9178', bg: '#ce917818' },
  web:  { label: 'WEB',  fg: '#d7ba7d', bg: '#d7ba7d18' },
}

function ProtocolBadge({ protocol }: { protocol: Protocol }) {
  const { label, fg, bg } = PROTOCOL_META[protocol]
  return (
    <span
      className="shrink-0 rounded-sm border px-1 text-[9px] font-semibold leading-4"
      style={{ color: fg, backgroundColor: bg, borderColor: fg + '40' }}
    >
      {label}
    </span>
  )
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`shrink-0 h-[6px] w-[6px] rounded-full ${connected ? 'bg-[#4ec9b0]' : 'bg-[#3e3e42]'}`}
      title={connected ? 'Connected' : 'Offline'}
    />
  )
}

// Small lock glyph next to profiles that require a VPN; green when its VPN is up.
function VpnDot({ vpnProfileId }: { vpnProfileId?: string }) {
  const vpn = useVpnStore((s) => s.profiles.find((p) => p.id === vpnProfileId))
  const status = useVpnStore((s) => (vpnProfileId ? s.statuses[vpnProfileId] : undefined))
  if (!vpnProfileId || !vpn) return null
  const connected = status?.state === 'connected'
  return (
    <span className="shrink-0" title={`VPN ${vpn.name}: ${connected ? 'connected' : 'disconnected'}`}>
      <svg
        width="10" height="10" viewBox="0 0 24 24" fill="none"
        stroke={connected ? '#4ec9b0' : '#f44747'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </span>
  )
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Context menu helpers ──────────────────────────────────────────────────

function CMenuItem({ children, onSelect, danger }: { children: React.ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <ContextMenu.Item
      className={`flex cursor-pointer items-center px-3 py-[3px] text-[13px] outline-none hover:bg-[#094771] focus:bg-[#094771] ${
        danger ? 'text-[#f48771]' : 'text-[#cccccc]'
      }`}
      onSelect={onSelect}
    >
      {children}
    </ContextMenu.Item>
  )
}

// ── Profile row ───────────────────────────────────────────────────────────

function ProfileRow({
  profile, connected, onConnect, onSftpTab, onEdit,
}: {
  profile: Profile; connected: boolean
  onConnect: () => void; onSftpTab: () => void; onEdit: () => void
}) {
  const { deleteProfile, duplicateProfile } = useProfileStore()

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className="group flex cursor-pointer items-center gap-2 rounded-sm px-2 py-[3px] text-[13px] text-[#cccccc] hover:bg-[#2a2d2e]"
          onDoubleClick={onConnect}
        >
          <ProtocolBadge protocol={profile.protocol} />
          <span className="flex-1 truncate">{profile.name}</span>
          <VpnDot vpnProfileId={profile.vpnProfileId} />
          <StatusDot connected={connected} />
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-[170px] overflow-hidden rounded-sm border border-[#454545] bg-[#252526] py-1 shadow-2xl">
          <CMenuItem onSelect={onConnect}>Connect</CMenuItem>
          {profile.protocol === 'ssh' && <CMenuItem onSelect={onSftpTab}>Open SFTP Tab</CMenuItem>}
          <ContextMenu.Separator className="my-1 h-px bg-[#454545]" />
          <CMenuItem onSelect={onEdit}>Edit</CMenuItem>
          <CMenuItem onSelect={() => duplicateProfile(profile.id)}>Duplicate</CMenuItem>
          <ContextMenu.Separator className="my-1 h-px bg-[#454545]" />
          <CMenuItem danger onSelect={() => deleteProfile(profile.id)}>Delete</CMenuItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

// ── Persistence + search helpers ────────────────────────────────────────────

function persistProfiles(): void {
  const { groups, profiles } = useProfileStore.getState()
  ipc.store.save(groups, profiles).catch(() => {})
}

function profileMatches(p: Profile, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (
    p.name.toLowerCase().includes(needle) ||
    p.host.toLowerCase().includes(needle) ||
    p.protocol.toLowerCase().includes(needle) ||
    p.tags.some((t) => t.toLowerCase().includes(needle))
  )
}

// ── Group header (collapsible; right-click to rename / delete) ───────────────

function GroupHeader({
  group, count, collapsed, onToggle,
}: {
  group: ProfileGroup; count: number; collapsed: boolean; onToggle: () => void
}) {
  const { renameGroup, deleteGroup } = useProfileStore()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(group.name)

  const commit = () => {
    const v = value.trim()
    if (v && v !== group.name) { renameGroup(group.id, v); persistProfiles() }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        className="w-full rounded-sm border border-[#007acc] bg-[#3c3c3c] px-2 py-[3px] text-[11px] font-semibold uppercase tracking-wider text-[#cccccc] outline-none"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      />
    )
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-[3px] text-left text-[11px] font-semibold uppercase tracking-wider text-[#bbbbbb] hover:bg-[#2a2d2e]"
          onClick={onToggle}
        >
          <svg
            className={`shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
          >
            <path d="M0 2l4 4 4-4H0z" />
          </svg>
          {group.name}
          <span className="ml-auto font-normal text-[#6d6d6d]">{count}</span>
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-[150px] overflow-hidden rounded-sm border border-[#454545] bg-[#252526] py-1 shadow-2xl">
          <CMenuItem onSelect={() => { setValue(group.name); setEditing(true) }}>Rename</CMenuItem>
          <ContextMenu.Separator className="my-1 h-px bg-[#454545]" />
          <CMenuItem danger onSelect={() => { deleteGroup(group.id); persistProfiles() }}>Delete Group</CMenuItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

// ── Servers section ───────────────────────────────────────────────────────

function ServersSection({
  query, onEdit, onLaunch,
}: {
  query: string
  onEdit: (id: string | 'new') => void
  onLaunch: (profile: Profile, protocol: Protocol) => void
}) {
  const { groups, profiles, collapsedGroups, toggleGroup } = useProfileStore()

  const visible = profiles.filter((p) => profileMatches(p, query))
  const knownGroupIds = new Set(groups.map((g) => g.id))
  const ungrouped = visible.filter((p) => !knownGroupIds.has(p.groupId))
  const searching = query.trim().length > 0

  return (
    <div className="flex flex-col gap-px px-1 py-1">
      {groups.map((group) => {
        const groupProfiles = visible.filter((p) => p.groupId === group.id)
        if (searching && groupProfiles.length === 0) return null
        const isCollapsed = collapsedGroups.has(group.id) && !searching

        return (
          <div key={group.id}>
            <GroupHeader
              group={group}
              count={groupProfiles.length}
              collapsed={isCollapsed}
              onToggle={() => toggleGroup(group.id)}
            />

            {!isCollapsed && (
              <div className="ml-3 flex flex-col gap-px py-px">
                {groupProfiles.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-[#6d6d6d]">No profiles</p>
                ) : (
                  groupProfiles.map((profile) => (
                    <ProfileRow
                      key={profile.id}
                      profile={profile}
                      connected={false}
                      onConnect={() => onLaunch(profile, profile.protocol)}
                      onSftpTab={() => onLaunch(profile, 'sftp')}
                      onEdit={() => onEdit(profile.id)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}

      {ungrouped.length > 0 && (
        <div>
          <p className="px-2 py-[3px] text-[11px] font-semibold uppercase tracking-wider text-[#bbbbbb]">
            Ungrouped
          </p>
          {ungrouped.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              connected={false}
              onConnect={() => onLaunch(profile, profile.protocol)}
              onSftpTab={() => onLaunch(profile, 'sftp')}
              onEdit={() => onEdit(profile.id)}
            />
          ))}
        </div>
      )}

      {searching && visible.length === 0 && (
        <p className="px-3 py-2 text-[12px] text-[#6d6d6d]">No matches for “{query}”.</p>
      )}
    </div>
  )
}

// ── History section ───────────────────────────────────────────────────────

function HistorySection() {
  const { history, clearHistory } = useProfileStore()
  const { addTab, activePaneId } = useTabStore()

  if (history.length === 0) {
    return <p className="px-4 py-3 text-[13px] text-[#6d6d6d]">No recent connections.</p>
  }

  return (
    <div className="flex flex-col py-1">
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-[11px] text-[#6d6d6d]">Recent connections</span>
        <button className="text-[11px] text-[#6d6d6d] hover:text-[#cccccc]" onClick={clearHistory}>
          Clear
        </button>
      </div>

      {history.map((entry: ConnectionHistoryEntry) => (
        <button
          key={entry.id}
          className="flex cursor-pointer flex-col gap-0.5 rounded-sm px-3 py-1.5 text-left hover:bg-[#2a2d2e]"
          onClick={() =>
            addTab({ label: entry.profileName, protocol: entry.protocol as Protocol, pinned: false, profileId: entry.profileId }, activePaneId)
          }
        >
          <div className="flex items-center gap-2">
            <ProtocolBadge protocol={entry.protocol as Protocol} />
            <span className="truncate text-[13px] text-[#cccccc]">{entry.profileName}</span>
            <span className="ml-auto shrink-0 text-[11px] text-[#6d6d6d]">
              {formatRelativeTime(entry.connectedAt)}
            </span>
          </div>
          <span className="pl-0.5 text-[11px] text-[#858585]">{entry.host}</span>
        </button>
      ))}
    </div>
  )
}

// ── Workspaces section ──────────────────────────────────────────────────────

function WorkspacesSection() {
  const { workspaces, saveCurrent, remove, setDefault, restore } = useWorkspaceStore()
  const [name, setName] = useState('')

  const save = () => {
    const n = name.trim()
    if (!n) return
    saveCurrent(n)
    setName('')
  }

  return (
    <div className="flex flex-col gap-1 px-2 py-1">
      <div className="flex gap-1.5 pb-1">
        <input
          className="min-w-0 flex-1 rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1 text-[12px] text-[#cccccc] outline-none placeholder:text-[#6d6d6d] focus:border-[#007acc]"
          placeholder="Save current layout as…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        />
        <button
          className="shrink-0 rounded-sm bg-[#007acc] px-2.5 text-[12px] font-medium text-white hover:bg-[#0069ac]"
          onClick={save}
        >
          Save
        </button>
      </div>

      {workspaces.length === 0 ? (
        <p className="px-2 py-2 text-[12px] text-[#6d6d6d]">No saved workspaces.</p>
      ) : (
        workspaces.map((w) => (
          <div key={w.id} className="group flex items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-[#2a2d2e]">
            <button
              title={w.isDefault ? 'Default — opens on startup' : 'Set as default'}
              onClick={() => setDefault(w.id)}
              className={`shrink-0 ${w.isDefault ? 'text-[#dcdcaa]' : 'text-[#5a5a5a] hover:text-[#858585]'}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill={w.isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M12 2l3 7h7l-5.5 4.5 2 7L12 17l-6.5 3.5 2-7L2 9h7z" />
              </svg>
            </button>
            <button className="flex min-w-0 flex-1 flex-col text-left" onClick={() => restore(w.id)}>
              <span className="truncate text-[13px] text-[#cccccc]">{w.name}</span>
              <span className="text-[11px] text-[#6d6d6d]">{w.tabs.length} tab{w.tabs.length === 1 ? '' : 's'}</span>
            </button>
            <button
              title="Delete workspace"
              onClick={() => remove(w.id)}
              className="shrink-0 text-[#5a5a5a] opacity-0 transition-opacity hover:text-[#f48771] group-hover:opacity-100"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </button>
          </div>
        ))
      )}
    </div>
  )
}

// ── Sidebar icon button ───────────────────────────────────────────────────

type SidebarView = 'servers' | 'history' | 'workspaces'

function IconBtn({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-sm transition-colors ${
        active
          ? 'bg-[#094771] text-[#cccccc]'
          : 'text-[#858585] hover:bg-[#2a2d2e] hover:text-[#cccccc]'
      }`}
    >
      {children}
    </button>
  )
}

// ── VPN pre-connect dialog ──────────────────────────────────────────────────

function VpnPreconnectDialog({
  pending, onConnect, onOpenAnyway, onCancel,
}: {
  pending: { vpn: VpnProfile } | null
  onConnect: () => void
  onOpenAnyway: () => void
  onCancel: () => void
}) {
  return (
    <Dialog.Root open={!!pending} onOpenChange={(o) => { if (!o) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2 rounded border border-[#454545] bg-[#252526] shadow-2xl">
          <div className="border-b border-[#3e3e42] px-4 py-3">
            <Dialog.Title className="text-[13px] font-semibold text-[#cccccc]">VPN Required</Dialog.Title>
          </div>
          <div className="px-4 py-4">
            <p className="text-[12px] text-[#bbbbbb]">
              This server requires VPN{' '}
              <span className="text-[#cccccc]">“{pending?.vpn.name}”</span>, which is not connected.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-[#3e3e42] px-4 py-3">
            <button
              className="rounded-sm border border-[#3e3e42] px-3 py-1.5 text-[12px] text-[#858585] hover:text-[#cccccc]"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="rounded-sm border border-[#3e3e42] px-3 py-1.5 text-[12px] text-[#cccccc] hover:border-[#6d6d6d]"
              onClick={onOpenAnyway}
            >
              Open Anyway
            </button>
            <button
              className="rounded-sm bg-[#007acc] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#0069ac]"
              onClick={onConnect}
            >
              Connect VPN &amp; Open
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Sidebar root ──────────────────────────────────────────────────────────

export function Sidebar() {
  const [view, setView] = useState<SidebarView>('servers')
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [query, setQuery] = useState('')

  const { addTab, activePaneId } = useTabStore()
  const addGroup = useProfileStore((s) => s.addGroup)
  const vpnProfiles = useVpnStore((s) => s.profiles)
  const vpnStatuses = useVpnStore((s) => s.statuses)
  const [pendingLaunch, setPendingLaunch] =
    useState<{ profile: Profile; protocol: Protocol; vpn: VpnProfile } | null>(null)

  const openTab = (profile: Profile, protocol: Protocol) => {
    addTab({ label: profile.name, protocol, pinned: false, profileId: profile.id }, activePaneId)
  }

  // VPN-aware launch: prompt (or auto-connect) when a profile's VPN is down.
  const launch = (profile: Profile, protocol: Protocol) => {
    const vpnId = profile.vpnProfileId
    if (vpnId) {
      const vpn = vpnProfiles.find((p) => p.id === vpnId)
      const state = vpnStatuses[vpnId]?.state ?? 'disconnected'
      if (vpn && state !== 'connected') {
        if (vpn.autoConnect) {
          ipc.vpn.connect(vpnId).catch(() => {})
          openTab(profile, protocol)
          return
        }
        setPendingLaunch({ profile, protocol, vpn })
        return
      }
    }
    openTab(profile, protocol)
  }

  const confirmConnect = async () => {
    if (!pendingLaunch) return
    const { profile, protocol, vpn } = pendingLaunch
    setPendingLaunch(null)
    await ipc.vpn.connect(vpn.id).catch(() => {})
    openTab(profile, protocol)
  }

  const confirmOpenAnyway = () => {
    if (!pendingLaunch) return
    openTab(pendingLaunch.profile, pendingLaunch.protocol)
    setPendingLaunch(null)
  }

  return (
    <div className="flex h-full w-[220px] shrink-0 flex-col border-r border-[#3e3e42] bg-[#252526]">
      {/* Section toggle strip */}
      <div className="flex items-center gap-1 border-b border-[#3e3e42] px-2 py-1.5">
        <IconBtn active={view === 'servers'} onClick={() => setView('servers')} title="Servers">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="5" rx="1"/>
            <rect x="2" y="10" width="20" height="5" rx="1"/>
            <rect x="2" y="17" width="20" height="5" rx="1"/>
            <circle cx="18" cy="5.5" r="0.8" fill="currentColor"/>
            <circle cx="18" cy="12.5" r="0.8" fill="currentColor"/>
            <circle cx="18" cy="19.5" r="0.8" fill="currentColor"/>
          </svg>
        </IconBtn>

        <IconBtn active={view === 'history'} onClick={() => setView('history')} title="History">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </IconBtn>

        <IconBtn active={view === 'workspaces'} onClick={() => setView('workspaces')} title="Workspaces">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
          </svg>
        </IconBtn>
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[#bbbbbb]">
          {view === 'servers' ? 'Servers' : view === 'history' ? 'History' : 'Workspaces'}
        </span>
        {view === 'servers' && (
          <button
            className="text-[11px] text-[#6d6d6d] hover:text-[#cccccc]"
            title="New group"
            onClick={() => { addGroup('New Group'); persistProfiles() }}
          >
            + Group
          </button>
        )}
      </div>

      {view === 'servers' && (
        <div className="px-2 pb-1">
          <input
            className="w-full rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1 text-[12px] text-[#cccccc] outline-none placeholder:text-[#6d6d6d] focus:border-[#007acc]"
            placeholder="Search profiles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {/* Scrollable content */}
      <div className="scrollbar-none flex-1 overflow-y-auto">
        {view === 'servers'
          ? <ServersSection query={query} onEdit={setEditingId} onLaunch={launch} />
          : view === 'history'
            ? <HistorySection />
            : <WorkspacesSection />
        }
      </div>

      {/* Add Profile button */}
      {view === 'servers' && (
        <div className="border-t border-[#3e3e42] p-2">
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-[#454545] py-1.5 text-[12px] text-[#858585] transition-colors hover:border-[#007acc] hover:text-[#007acc]"
            onClick={() => setEditingId('new')}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M5 1v8M1 5h8"/>
            </svg>
            Add Profile
          </button>
        </div>
      )}

      {/* Profile editor modal — portal renders it above everything */}
      <ProfileEditor editingId={editingId} onClose={() => setEditingId(null)} />

      {/* VPN pre-connect prompt */}
      <VpnPreconnectDialog
        pending={pendingLaunch}
        onConnect={confirmConnect}
        onOpenAnyway={confirmOpenAnyway}
        onCancel={() => setPendingLaunch(null)}
      />
    </div>
  )
}
