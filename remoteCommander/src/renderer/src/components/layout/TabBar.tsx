import { useCallback, useEffect, useRef, useState, DragEvent } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { useTabStore, Protocol, Tab, PaneId, SplitDirection, ConnectionStatus, listLeafIds } from '../../store/tabStore'

// ── Protocol badge ────────────────────────────────────────────────────────

const PROTOCOL_META: Record<Protocol, { label: string; fg: string; bg: string }> = {
  ssh:     { label: 'SSH',  fg: '#4ec9b0', bg: '#4ec9b018' },
  sftp:    { label: 'SFTP', fg: '#569cd6', bg: '#569cd618' },
  rdp:     { label: 'RDP',  fg: '#c586c0', bg: '#c586c018' },
  vnc:     { label: 'VNC',  fg: '#ce9178', bg: '#ce917818' },
  web:     { label: 'WEB',  fg: '#d7ba7d', bg: '#d7ba7d18' },
  editor:  { label: 'EDIT', fg: '#569cd6', bg: '#569cd618' },
  vpn:     { label: 'VPN',  fg: '#dcdcaa', bg: '#dcdcaa18' },
  audit:   { label: 'LOG',  fg: '#9cdcfe', bg: '#9cdcfe18' },
  local:   { label: 'SH',   fg: '#6a9955', bg: '#6a995518' },
}

function ProtocolBadge({ protocol }: { protocol: Protocol }) {
  const { label, fg, bg } = PROTOCOL_META[protocol]
  if (!label) return null
  return (
    <span
      className="shrink-0 rounded border px-1 text-[9px] font-semibold leading-4 mr-1.5"
      style={{ color: fg, backgroundColor: bg, borderColor: fg + '40' }}
    >
      {label}
    </span>
  )
}

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connecting:    '#dcdcaa',
  connected:     '#4ec9b0',
  disconnected:  '#f44747',
}

function ConnectionDot({ status }: { status: ConnectionStatus }) {
  const color = STATUS_COLOR[status]
  return (
    <span
      className="ml-0.5 mr-2 inline-block h-[7px] w-[7px] shrink-0 rounded-full"
      // Soft ring so the dot reads as an intentional status indicator, not a stray pixel.
      style={{ backgroundColor: color, boxShadow: `0 0 0 2px ${color}33` }}
      title={`Status: ${status}`}
    />
  )
}

function PinIcon() {
  return (
    <svg className="shrink-0 mr-1 text-[#dcdcaa]" width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 3a1 1 0 0 1 .7 1.7L14 7.4l1.3 5.1-3.3 3.3V20l-2-2v-4.2l-3.3-3.3L8 5.4 5.3 4.7A1 1 0 0 1 6 3h10z" />
    </svg>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      className="ml-1.5 shrink-0 rounded p-0.5 text-[#858585] opacity-0 transition-all group-hover:opacity-100 hover:!opacity-100 hover:bg-white/10 hover:text-[#cccccc]"
      onClick={(e) => { e.stopPropagation(); onClose() }}
      title="Close tab"
    >
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M1 1l6 6M7 1L1 7" />
      </svg>
    </button>
  )
}

// ── Context menu ──────────────────────────────────────────────────────────

function TabContextMenu({
  tab, onRename, children,
}: {
  tab: Tab; onRename: () => void; children: React.ReactNode
}) {
  const { pinTab, closeTab, splitPane, moveTabToPane } = useTabStore()

  // Peel this tab into a new split of its current pane (tmux "break pane").
  const splitWithTab = (direction: SplitDirection) => {
    const newPane = splitPane(tab.paneId, direction)
    moveTabToPane(tab.id, newPane)
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-[180px] overflow-hidden rounded-sm border border-[#454545] bg-[#252526] py-1 shadow-2xl">
          <CMenuItem onSelect={onRename}>Rename</CMenuItem>
          <CMenuItem onSelect={() => pinTab(tab.id)}>{tab.pinned ? 'Unpin' : 'Pin Tab'}</CMenuItem>
          <ContextMenu.Separator className="my-1 h-px bg-[#454545]" />
          <CMenuItem onSelect={() => splitWithTab('horizontal')}>Move to Split Right</CMenuItem>
          <CMenuItem onSelect={() => splitWithTab('vertical')}>Move to Split Down</CMenuItem>
          <ContextMenu.Separator className="my-1 h-px bg-[#454545]" />
          <ContextMenu.Item
            className={`flex items-center px-3 py-[3px] text-[13px] outline-none ${
              tab.pinned
                ? 'cursor-not-allowed text-[#858585]'
                : 'cursor-pointer text-[#f48771] hover:bg-[#094771] focus:bg-[#094771]'
            }`}
            onSelect={() => {
              if (tab.pinned) return
              if (tab.editorDirty && !confirm(`“${tab.label.replace(/^● /, '')}” has unsaved changes. Close anyway?`)) return
              closeTab(tab.id)
            }}
            disabled={tab.pinned}
          >
            Close
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function CMenuItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <ContextMenu.Item
      className="flex cursor-pointer items-center px-3 py-[3px] text-[13px] text-[#cccccc] outline-none hover:bg-[#094771] focus:bg-[#094771]"
      onSelect={onSelect}
    >
      {children}
    </ContextMenu.Item>
  )
}

// ── Single tab item ───────────────────────────────────────────────────────

function TabItem({
  tab, paneId, isActive, isDragging, dropSide, index,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  tab: Tab; paneId: PaneId; isActive: boolean; isDragging: boolean
  dropSide: 'left' | 'right' | null; index: number
  onDragStart: (e: DragEvent, i: number) => void
  onDragOver: (e: DragEvent, i: number) => void
  onDrop: (e: DragEvent, i: number) => void
  onDragEnd: () => void
}) {
  const { setActiveTab, closeTab, renameTab } = useTabStore()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(tab.label)
  const inputRef = useRef<HTMLInputElement>(null)

  const confirmClose = useCallback(() => {
    if (tab.editorDirty && !confirm(`“${tab.label.replace(/^● /, '')}” has unsaved changes. Close anyway?`)) return
    closeTab(tab.id)
  }, [tab.editorDirty, tab.label, tab.id, closeTab])

  const startEdit = useCallback(() => { setEditValue(tab.label); setIsEditing(true) }, [tab.label])
  const commitEdit = useCallback(() => {
    const v = editValue.trim()
    if (v) renameTab(tab.id, v)
    setIsEditing(false)
  }, [editValue, renameTab, tab.id])

  useEffect(() => {
    if (isEditing) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [isEditing])

  return (
    <TabContextMenu tab={tab} onRename={startEdit}>
      <div
        draggable={!isEditing}
        onDragStart={(e) => onDragStart(e, index)}
        onDragOver={(e) => onDragOver(e, index)}
        onDrop={(e) => onDrop(e, index)}
        onDragEnd={onDragEnd}
        onClick={() => setActiveTab(tab.id, paneId)}
        className={[
          'group relative flex min-w-[120px] max-w-[200px] shrink-0 cursor-pointer items-center border-r border-[#252526] px-3 py-1.5 transition-colors select-none',
          isActive
            ? 'bg-[#1e1e1e] text-[#ffffff]'
            : 'bg-[#2d2d2d] text-[#8c8c8c] hover:bg-[#2a2d2e] hover:text-[#cccccc]',
          isDragging ? 'opacity-30' : '',
          dropSide === 'left'  ? 'border-l-2 border-l-[#007acc]' : '',
          dropSide === 'right' ? 'border-r-[2px] border-r-[#007acc]' : '',
        ].filter(Boolean).join(' ')}
      >
        {/* Active tab top border — VS Code signature */}
        {isActive && <div className="absolute inset-x-0 top-0 h-[1px] bg-[#007acc]" />}

        <ProtocolBadge protocol={tab.protocol} />
        {tab.pinned && <PinIcon />}
        {tab.connectionStatus && <ConnectionDot status={tab.connectionStatus} />}

        {isEditing ? (
          <input
            ref={inputRef}
            className="w-full rounded-sm border border-[#007acc] bg-[#3c3c3c] px-1 text-[13px] text-[#cccccc] outline-none"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setIsEditing(false) }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 truncate text-[13px]"
            onDoubleClick={(e) => { e.stopPropagation(); startEdit() }}
          >
            {tab.label}
          </span>
        )}

        {!tab.pinned && <CloseButton onClose={confirmClose} />}
      </div>
    </TabContextMenu>
  )
}

// ── TabBar ────────────────────────────────────────────────────────────────

export function TabBar({ paneId }: { paneId: PaneId }) {
  const { tabs, activeTabByPane, layout, addTab, reorderTabs, setActivePane, splitPane, closePane, setDraggingTab } = useTabStore()
  const paneTabs = tabs.filter((t) => t.paneId === paneId)
  const activeTabId = activeTabByPane[paneId] ?? null
  const paneCount = listLeafIds(layout).length

  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const handleDragStart = useCallback((e: DragEvent, i: number) => {
    setDragSourceIdx(i)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
    // Publish the dragged tab so any pane can accept a drop (cross-pane move).
    setDraggingTab(paneTabs[i]?.id ?? null)
  }, [paneTabs, setDraggingTab])

  const handleDragOver = useCallback((e: DragEvent, i: number) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(i)
  }, [])

  const handleDrop = useCallback((e: DragEvent, i: number) => {
    e.preventDefault()
    if (dragSourceIdx !== null && dragSourceIdx !== i) reorderTabs(dragSourceIdx, i, paneId)
    setDragSourceIdx(null); setDragOverIdx(null)
  }, [dragSourceIdx, reorderTabs, paneId])

  const handleDragEnd = useCallback(() => {
    setDragSourceIdx(null); setDragOverIdx(null); setDraggingTab(null)
  }, [setDraggingTab])

  return (
    <div
      className="flex h-[35px] shrink-0 items-stretch border-b border-[#252526] bg-[#2d2d2d]"
      onClick={() => setActivePane(paneId)}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="scrollbar-none flex flex-1 items-stretch overflow-x-auto">
        {paneTabs.map((tab, idx) => (
          <TabItem
            key={tab.id}
            tab={tab}
            paneId={paneId}
            isActive={tab.id === activeTabId}
            isDragging={dragSourceIdx === idx}
            dropSide={
              dragOverIdx === idx && dragSourceIdx !== null && dragSourceIdx !== idx
                ? idx < (dragSourceIdx ?? 0) ? 'left' : 'right'
                : null
            }
            index={idx}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>

      {/* New local-terminal button — each click opens a fresh local shell tab */}
      <button
        className="flex shrink-0 items-center px-3 text-[#858585] transition-colors hover:bg-[#2a2d2e] hover:text-[#cccccc]"
        onClick={(e) => { e.stopPropagation(); addTab({ label: 'Local Terminal', protocol: 'local', pinned: false }, paneId) }}
        title="New local terminal"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </button>

      <div className="my-1.5 w-px shrink-0 bg-[#3e3e42]" />

      {/* Pane controls: split this pane right / down, and close it (tmux-style). */}
      <button
        className="flex shrink-0 items-center px-2 text-[#858585] transition-colors hover:bg-[#2a2d2e] hover:text-[#cccccc]"
        onClick={(e) => { e.stopPropagation(); splitPane(paneId, 'horizontal') }}
        title="Split pane right"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="0.6" y="0.6" width="4.8" height="11.8" rx="0.8" stroke="currentColor" strokeWidth="1.1" />
          <rect x="7.6" y="0.6" width="4.8" height="11.8" rx="0.8" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
      <button
        className="flex shrink-0 items-center px-2 text-[#858585] transition-colors hover:bg-[#2a2d2e] hover:text-[#cccccc]"
        onClick={(e) => { e.stopPropagation(); splitPane(paneId, 'vertical') }}
        title="Split pane down"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="0.6" y="0.6" width="11.8" height="4.8" rx="0.8" stroke="currentColor" strokeWidth="1.1" />
          <rect x="0.6" y="7.6" width="11.8" height="4.8" rx="0.8" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
      {paneCount > 1 && (
        <button
          className="flex shrink-0 items-center px-2 text-[#858585] transition-colors hover:bg-[#2a2d2e] hover:text-[#f48771]"
          onClick={(e) => { e.stopPropagation(); closePane(paneId) }}
          title="Close pane"
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l7 7M8 1L1 8" />
          </svg>
        </button>
      )}
    </div>
  )
}
