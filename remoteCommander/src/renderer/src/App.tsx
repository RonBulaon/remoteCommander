import { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Sidebar } from './components/layout/Sidebar'
import { SplitPane } from './components/layout/SplitPane'
import { TitleBar } from './components/layout/TitleBar'
import { AboutDialog } from './components/AboutDialog'
import { useProfileStore } from './store/profileStore'
import { useVpnStore } from './store/vpnStore'
import { useTabStore } from './store/tabStore'
import { useWorkspaceStore } from './store/workspaceStore'
import { ipc } from './lib/ipc'

// ── Global VPN status indicator (bottom status bar) ───────────────────────

function VpnStatusIndicator() {
  const profiles = useVpnStore((s) => s.profiles)
  const statuses = useVpnStore((s) => s.statuses)
  const connected = profiles.find((p) => statuses[p.id]?.state === 'connected')

  const openVpnTab = () => {
    const { tabs, addTab, setActiveTab } = useTabStore.getState()
    const existing = tabs.find((t) => t.protocol === 'vpn')
    if (existing) setActiveTab(existing.id, existing.paneId)
    else addTab({ label: 'VPN', protocol: 'vpn', pinned: false })
  }

  return (
    <button
      onClick={openVpnTab}
      title="Manage VPN connections"
      className="flex items-center gap-1.5 rounded-sm px-1.5 text-[11px] text-white/80 hover:bg-white/15"
    >
      <span className={`h-2 w-2 rounded-full ${connected ? 'bg-[#89d185]' : 'bg-white/40'}`} />
      {connected ? `VPN: ${connected.name}` : 'VPN: off'}
    </button>
  )
}

// ── Password prompt dialog (shared by export and import) ──────────────────

function PasswordDialog({
  open, title, description, confirmLabel, onConfirm, onClose,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onConfirm: (password: string) => Promise<void>
  onClose: () => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state each time the dialog opens
  useEffect(() => {
    if (open) { setPassword(''); setError(null) }
  }, [open])

  const handleConfirm = async () => {
    if (!password.trim()) { setError('Password is required.'); return }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(password)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[360px] -translate-x-1/2 -translate-y-1/2 rounded border border-[#454545] bg-[#252526] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#3e3e42] px-4 py-3">
            <Dialog.Title className="text-[13px] font-semibold text-[#cccccc]">{title}</Dialog.Title>
            <Dialog.Close className="rounded-sm p-0.5 text-[#858585] hover:bg-white/10 hover:text-[#cccccc]">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l10 10M12 2L2 12"/>
              </svg>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3 px-4 py-4">
            <p className="text-[12px] text-[#858585]">{description}</p>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-[#bbbbbb]">Password</label>
              <input
                className="w-full rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1.5 text-[13px] text-[#cccccc] outline-none placeholder:text-[#6d6d6d] focus:border-[#007acc]"
                type="password"
                placeholder="Encryption password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
                autoFocus
              />
            </div>
            {error && <p className="text-[12px] text-[#f48771]">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-[#3e3e42] px-4 py-3">
            <Dialog.Close asChild>
              <button className="rounded-sm border border-[#3e3e42] px-3 py-1.5 text-[12px] text-[#858585] hover:border-[#6d6d6d] hover:text-[#cccccc]">
                Cancel
              </button>
            </Dialog.Close>
            <button
              className="rounded-sm bg-[#007acc] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#0069ac] disabled:opacity-50"
              onClick={handleConfirm}
              disabled={busy}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── App root ──────────────────────────────────────────────────────────────

function App(): React.JSX.Element {
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const { groups, profiles, setFromStore } = useProfileStore()
  const vpnProfiles = useVpnStore((s) => s.profiles)
  const loadVpn = useVpnStore((s) => s.load)
  const setVpnStatus = useVpnStore((s) => s.setStatus)

  // Load persisted profiles from main process on first render
  useEffect(() => {
    ipc.store.load().then((data) => {
      if (data.profiles.length > 0 || data.groups.length > 0) {
        setFromStore(data.groups, data.profiles)
      }
    }).catch(console.error)
    loadVpn().catch(console.error)
    // Load workspaces; if one is marked default, restore it on startup.
    useWorkspaceStore.getState().load().then(() => {
      const def = useWorkspaceStore.getState().workspaces.find((w) => w.isDefault)
      if (def) useWorkspaceStore.getState().restore(def.id)
    }).catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to live VPN status events for each known VPN profile
  useEffect(() => {
    const unsubs = vpnProfiles.map((p) => ipc.vpn.onStatus(p.id, (st) => setVpnStatus(p.id, st)))
    return () => unsubs.forEach((u) => u())
  }, [vpnProfiles, setVpnStatus])

  // Title-bar / menu actions (shared by the native menu accelerators and the
  // custom title-bar menu)
  const openConnectionHistory = useCallback(() => {
    const { tabs, addTab, setActiveTab } = useTabStore.getState()
    const existing = tabs.find((t) => t.protocol === 'audit')
    if (existing) setActiveTab(existing.id, existing.paneId)
    else addTab({ label: 'Connection History', protocol: 'audit', pinned: false })
  }, [])

  const openLocalTerminal = useCallback(() => {
    useTabStore.getState().addTab({ label: 'Local Terminal', protocol: 'local', pinned: false })
  }, [])

  // Subscribe to menu events (native menu accelerators) from main process
  useEffect(() => {
    const unsubExport = ipc.menu.onExportProfiles(() => setExportOpen(true))
    const unsubImport = ipc.menu.onImportProfiles(() => setImportOpen(true))
    const unsubHistory = ipc.menu.onConnectionHistory(openConnectionHistory)
    const unsubLocal = ipc.menu.onNewLocalTerminal(openLocalTerminal)
    const unsubAbout = ipc.menu.onAbout(() => setAboutOpen(true))
    return () => { unsubExport(); unsubImport(); unsubHistory(); unsubLocal(); unsubAbout() }
  }, [openConnectionHistory, openLocalTerminal])

  // ── Export handler ────────────────────────────────────────────────────
  const handleExport = useCallback(async (password: string) => {
    const res = await ipc.profiles.export({ profiles, groups, password })
    if ('error' in res) throw new Error(res.error)
    // cancelled is not an error — just close silently
  }, [profiles, groups])

  // ── Import handler ────────────────────────────────────────────────────
  const handleImport = useCallback(async (password: string) => {
    const res = await ipc.profiles.import({ password })
    if ('error' in res) throw new Error(res.error)
    if ('cancelled' in res) return  // user cancelled file picker — close silently
    setFromStore(res.groups, res.profiles)
    // Persist imported profiles to disk
    await ipc.store.save(res.groups, res.profiles)
  }, [setFromStore])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#1e1e1e] text-[#cccccc]">
      <TitleBar
        onNewLocalTerminal={openLocalTerminal}
        onExport={() => setExportOpen(true)}
        onImport={() => setImportOpen(true)}
        onConnectionHistory={openConnectionHistory}
        onAbout={() => setAboutOpen(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <SplitPane />
      </div>

      {/* VS Code–style status bar */}
      <div className="flex h-[22px] shrink-0 items-center gap-3 bg-[#007acc] px-3">
        <span className="text-[11px] font-medium text-white/90">Remote Commander</span>
        <VpnStatusIndicator />
        <span className="ml-auto text-[11px] text-white/70">v0.1.0-dev</span>
      </div>

      {/* Import / export dialogs */}
      <PasswordDialog
        open={exportOpen}
        title="Export Profiles"
        description="Profiles will be encrypted with AES-256-GCM using this password. Store it safely — you need it to import."
        confirmLabel="Export"
        onConfirm={handleExport}
        onClose={() => setExportOpen(false)}
      />
      <PasswordDialog
        open={importOpen}
        title="Import Profiles"
        description="Select a .rcprofiles file and enter the password used when it was exported."
        confirmLabel="Import"
        onConfirm={handleImport}
        onClose={() => setImportOpen(false)}
      />

      {/* About dialog */}
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}

export default App
