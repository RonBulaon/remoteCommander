import { useCallback, useRef, useState } from 'react'
import { useTabStore, PaneId, LayoutNode, SplitDirection } from '../../store/tabStore'
import { useProfileStore } from '../../store/profileStore'
import { useVpnStore } from '../../store/vpnStore'
import { TabBar } from './TabBar'
import { SshTab } from '../tabs/SshTab'
import { SftpTab } from '../tabs/SftpTab'
import { RdpTab } from '../tabs/RdpTab'
import { VncTab } from '../tabs/VncTab'
import { WebTab } from '../tabs/WebTab'
import { EditorTab } from '../tabs/EditorTab'
import { VpnTab } from '../tabs/VpnTab'
import { AuditTab } from '../tabs/AuditTab'
import { LocalTerminalTab } from '../tabs/LocalTerminalTab'

// ── VPN disconnect warning banner ──────────────────────────────────────────
// Shown above a session tab when the profile requires a VPN that is not connected.

function VpnWarningBanner({ profileId }: { profileId?: string }) {
  const profile = useProfileStore((s) => s.profiles.find((p) => p.id === profileId))
  const vpnProfileId = profile?.vpnProfileId
  const vpn = useVpnStore((s) => s.profiles.find((p) => p.id === vpnProfileId))
  const status = useVpnStore((s) => (vpnProfileId ? s.statuses[vpnProfileId] : undefined))

  if (!vpnProfileId || !vpn) return null
  if (status?.state === 'connected') return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[#5a4a1a] bg-[#3a2f12] px-3 py-1.5 text-[12px] text-[#dcdcaa]">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      VPN “{vpn.name}” is disconnected. This session may be affected.
    </div>
  )
}

// ── Pane content ──────────────────────────────────────────────────────────

// Shown when a pane has no tabs (startup, or after closing them all). The
// welcome/getting-started message is a placeholder, not a tab of its own.
function WelcomeContent() {
  return (
    <div>
      <div className="mb-4 text-[32px] text-[#3e3e42]">⚡</div>
      <p className="text-[14px] font-semibold text-[#cccccc]">Welcome to Remote Commander</p>
      <p className="mt-2 text-[13px] text-[#858585]">Connect to a server to get started.</p>
      <p className="mt-1 text-[12px] text-[#6d6d6d]">
        Double-click a profile in the sidebar, or click the terminal button for a local shell.
      </p>
    </div>
  )
}

function PaneContent({ paneId }: { paneId: PaneId }) {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabByPane[paneId] ?? null)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const paneTabs = tabs.filter((t) => t.paneId === paneId)

  if (paneTabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#1e1e1e] text-center">
        <WelcomeContent />
      </div>
    )
  }

  // SSH, SFTP, RDP, and VNC tabs stay mounted for the lifetime of the pane (keep-alive).
  // Other tabs are rendered only when active.
  const sshTabs  = paneTabs.filter((t) => t.protocol === 'ssh'  && t.profileId)
  const sftpTabs = paneTabs.filter((t) => t.protocol === 'sftp' && t.profileId)
  const rdpTabs  = paneTabs.filter((t) => t.protocol === 'rdp'  && t.profileId)
  const vncTabs  = paneTabs.filter((t) => t.protocol === 'vnc'  && t.profileId)
  // Editor tabs stay mounted (keep-alive) so unsaved edits survive tab switches.
  const editorTabs = paneTabs.filter((t) => t.protocol === 'editor' && t.editor)
  const localTabs = paneTabs.filter((t) => t.protocol === 'local')
  const isVpnActive = activeTab?.protocol === 'vpn'
  const isAuditActive = activeTab?.protocol === 'audit'
  // Web tabs are NOT kept alive: each <webview> is a live Chromium guest with its
  // own compositor surface, and several at once stall the whole window (especially
  // under software rendering). Render only the active one; WebTab restores its last
  // URL on remount, so switching tabs discards-and-reloads like a browser tab.
  const isWebActive = activeTab?.protocol === 'web' && !!activeTab.profileId
  // Every protocol now has a renderer, so the only placeholder case is a stale
  // active-tab id that points outside this pane (rare). The empty-pane welcome
  // is handled by the early return above.
  const showPlaceholder = !activeTab

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden bg-[#1e1e1e]">
      {/* SSH tabs — always mounted, CSS-hidden when inactive */}
      {sshTabs.map((tab) => (
        <div
          key={tab.id}
          className="absolute inset-0 flex flex-col"
          style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
        >
          <VpnWarningBanner profileId={tab.profileId} />
          <SshTab tab={tab} isActive={tab.id === activeTabId} />
        </div>
      ))}

      {/* SFTP tabs — always mounted, CSS-hidden when inactive */}
      {sftpTabs.map((tab) => (
        <div
          key={tab.id}
          className="absolute inset-0 flex flex-col"
          style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
        >
          <VpnWarningBanner profileId={tab.profileId} />
          <SftpTab tab={tab} isActive={tab.id === activeTabId} />
        </div>
      ))}

      {/* RDP tabs — always mounted, CSS-hidden when inactive */}
      {rdpTabs.map((tab) => (
        <div
          key={tab.id}
          className="absolute inset-0 flex flex-col"
          style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
        >
          <VpnWarningBanner profileId={tab.profileId} />
          <RdpTab tab={tab} isActive={tab.id === activeTabId} />
        </div>
      ))}

      {/* VNC tabs — always mounted, CSS-hidden when inactive */}
      {vncTabs.map((tab) => (
        <div
          key={tab.id}
          className="absolute inset-0 flex flex-col"
          style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
        >
          <VpnWarningBanner profileId={tab.profileId} />
          <VncTab tab={tab} isActive={tab.id === activeTabId} />
        </div>
      ))}

      {/* Web-console tab — rendered only when active (not kept alive; see above) */}
      {isWebActive && activeTab && (
        <div key={activeTab.id} className="absolute inset-0 flex flex-col">
          <VpnWarningBanner profileId={activeTab.profileId} />
          <WebTab tab={activeTab} isActive />
        </div>
      )}

      {/* Editor tabs — always mounted (keep-alive), CSS-hidden when inactive */}
      {editorTabs.map((tab) => (
        <div
          key={tab.id}
          className="absolute inset-0 flex flex-col"
          style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
        >
          <EditorTab tab={tab} isActive={tab.id === activeTabId} />
        </div>
      ))}

      {/* Local terminal tabs — always mounted, CSS-hidden when inactive */}
      {localTabs.map((tab) => (
        <div
          key={tab.id}
          className="absolute inset-0 flex flex-col"
          style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
        >
          <LocalTerminalTab tab={tab} isActive={tab.id === activeTabId} />
        </div>
      ))}

      {/* VPN management tab — rendered only when active (state lives in vpnStore) */}
      {isVpnActive && (
        <div className="absolute inset-0 flex flex-col">
          <VpnTab />
        </div>
      )}

      {/* Audit log tab — rendered only when active */}
      {isAuditActive && (
        <div className="absolute inset-0 flex flex-col">
          <AuditTab />
        </div>
      )}

      {/* Fallback placeholder when no tab is active (e.g. a stale active id). */}
      {showPlaceholder && (
        <div className="absolute inset-0 flex items-center justify-center text-center">
          <WelcomeContent />
        </div>
      )}
    </div>
  )
}

// ── Draggable divider ─────────────────────────────────────────────────────
// Resizes one split node. Its immediate parent is the split's flex container,
// so the drag ratio is computed against that container's rect.

function Divider({ splitId, direction }: { splitId: string; direction: SplitDirection }) {
  const setSplitRatio = useTabStore((s) => s.setSplitRatio)
  const dragging = useRef(false)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      const container = (e.currentTarget as HTMLElement).parentElement
      if (!container) return

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return
        const rect = container.getBoundingClientRect()
        const ratio =
          direction === 'horizontal'
            ? (ev.clientX - rect.left) / rect.width
            : (ev.clientY - rect.top) / rect.height
        setSplitRatio(splitId, ratio)
      }
      const onUp = () => {
        dragging.current = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [splitId, direction, setSplitRatio],
  )

  if (direction === 'horizontal') {
    return (
      <div
        className="relative w-[1px] shrink-0 cursor-col-resize bg-[#3e3e42] transition-colors hover:bg-[#007acc]"
        onMouseDown={onMouseDown}
      >
        {/* Wider invisible hit target */}
        <div className="absolute inset-y-0 -left-1 -right-1 z-10" />
      </div>
    )
  }
  return (
    <div
      className="relative h-[1px] shrink-0 cursor-row-resize bg-[#3e3e42] transition-colors hover:bg-[#007acc]"
      onMouseDown={onMouseDown}
    >
      <div className="absolute inset-x-0 -top-1 -bottom-1 z-10" />
    </div>
  )
}

// ── Recursive layout renderer ──────────────────────────────────────────────

function PaneLeaf({ paneId }: { paneId: PaneId }) {
  const isActive = useTabStore((s) => s.activePaneId === paneId)
  // Only highlight the focused pane when more than one pane exists.
  const multiPane = useTabStore((s) => s.layout.type === 'split')
  const moveTabToPane = useTabStore((s) => s.moveTabToPane)
  const setDraggingTab = useTabStore((s) => s.setDraggingTab)
  // A tab dragged from a *different* pane → offer this pane as a drop target.
  const canDrop = useTabStore((s) => {
    if (!s.draggingTabId) return false
    const dragged = s.tabs.find((t) => t.id === s.draggingTabId)
    return dragged != null && dragged.paneId !== paneId
  })
  const [dropHover, setDropHover] = useState(false)

  return (
    <div
      className={[
        'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        multiPane && isActive ? 'outline outline-1 -outline-offset-1 outline-[#007acc]/30' : '',
      ].join(' ')}
    >
      <TabBar paneId={paneId} />
      <PaneContent paneId={paneId} />

      {/* Cross-pane drop zone. Covers the whole pane while a tab from another
          pane is being dragged, so it lands here regardless of nesting depth.
          The source pane shows no overlay, so within-pane reorder still works. */}
      {canDrop && (
        <div
          className={[
            'absolute inset-0 z-30 flex items-center justify-center transition-colors',
            dropHover ? 'bg-[#007acc]/15 outline outline-2 -outline-offset-2 outline-[#007acc]' : 'bg-transparent',
          ].join(' ')}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!dropHover) setDropHover(true) }}
          onDragLeave={() => setDropHover(false)}
          onDrop={(e) => {
            e.preventDefault()
            const id = useTabStore.getState().draggingTabId
            if (id) moveTabToPane(id, paneId)
            setDropHover(false)
            setDraggingTab(null)
          }}
        >
          {dropHover && (
            <span className="pointer-events-none rounded bg-[#007acc] px-2.5 py-1 text-[11px] font-medium text-white shadow-lg">
              Move tab here
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function LayoutTree({ node }: { node: LayoutNode }) {
  if (node.type === 'leaf') return <PaneLeaf paneId={node.paneId} />

  const isHorizontal = node.direction === 'horizontal'
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${isHorizontal ? 'flex-row' : 'flex-col'}`}>
      <div
        className="flex min-h-0 min-w-0 overflow-hidden"
        style={isHorizontal ? { width: `${node.ratio * 100}%` } : { height: `${node.ratio * 100}%` }}
      >
        <LayoutTree node={node.a} />
      </div>
      <Divider splitId={node.id} direction={node.direction} />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <LayoutTree node={node.b} />
      </div>
    </div>
  )
}

// ── SplitPane root ────────────────────────────────────────────────────────

export function SplitPane() {
  const layout = useTabStore((s) => s.layout)
  return (
    <div className="relative flex flex-1 overflow-hidden">
      <LayoutTree node={layout} />
    </div>
  )
}
