import { create } from 'zustand'

export type Protocol = 'ssh' | 'sftp' | 'rdp' | 'vnc' | 'web' | 'vpn' | 'audit' | 'local' | 'editor'

/** File context for an `editor` tab. sessionId is the SFTP session for remote files. */
export interface EditorFile {
  path: string
  isLocal: boolean
  sessionId: string
}

/** A pane is identified by a uuid; panes are the leaves of the layout tree. */
export type PaneId = string
export type SplitDirection = 'horizontal' | 'vertical'

/**
 * The pane layout is a binary tree (tmux-style): a `leaf` holds tabs, a `split`
 * divides its area between two child nodes at `ratio`, each of which may itself
 * be split. Splitting a pane replaces its leaf with a split node; closing the
 * last pane in a split collapses it (the sibling takes the split's place).
 */
export type LayoutNode =
  | { type: 'leaf'; paneId: PaneId }
  | { type: 'split'; id: string; direction: SplitDirection; ratio: number; a: LayoutNode; b: LayoutNode }

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface Tab {
  id: string
  label: string
  protocol: Protocol
  pinned: boolean
  paneId: PaneId
  profileId?: string
  connectionStatus?: ConnectionStatus
  editor?: EditorFile          // present only when protocol === 'editor'
  editorDirty?: boolean        // unsaved changes in an editor tab
}

interface TabState {
  tabs: Tab[]
  layout: LayoutNode
  activePaneId: PaneId
  activeTabByPane: Record<PaneId, string | null>
  /** Id of the tab currently being dragged (drives the per-pane drop overlay). */
  draggingTabId: string | null

  // ── Tab actions ────────────────────────────────────────────────────────
  addTab: (tab: Omit<Tab, 'id' | 'paneId'>, paneId?: PaneId) => string
  setDraggingTab: (id: string | null) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string, paneId: PaneId) => void
  renameTab: (id: string, label: string) => void
  setTabStatus: (id: string, status: ConnectionStatus) => void
  setEditorDirty: (id: string, dirty: boolean) => void
  pinTab: (id: string) => void
  reorderTabs: (fromIndex: number, toIndex: number, paneId: PaneId) => void
  moveTabToPane: (tabId: string, targetPane: PaneId) => void

  // ── Pane / split actions ───────────────────────────────────────────────
  setActivePane: (paneId: PaneId) => void
  /** Split `paneId` into two, returning the new (empty) pane's id. */
  splitPane: (paneId: PaneId, direction: SplitDirection) => PaneId
  /** Close a pane: drop its non-pinned tabs and collapse it (no-op on the only pane). */
  closePane: (paneId: PaneId) => void
  setSplitRatio: (splitId: string, ratio: number) => void

  // ── Workspace restore ──────────────────────────────────────────────────
  restoreSession: (tabs: Omit<Tab, 'id'>[], layout: LayoutNode) => void
}

// ── Pure layout-tree helpers ───────────────────────────────────────────────

/** All leaf pane ids, left-to-right / top-to-bottom. */
export function listLeafIds(node: LayoutNode): PaneId[] {
  return node.type === 'leaf' ? [node.paneId] : [...listLeafIds(node.a), ...listLeafIds(node.b)]
}

/** The first (top-left-most) leaf — used to pick a focus target after collapses. */
function firstLeafId(node: LayoutNode): PaneId {
  return node.type === 'leaf' ? node.paneId : firstLeafId(node.a)
}

/** Return a new tree with the `paneId` leaf swapped for `replacement`. */
function replaceLeaf(node: LayoutNode, paneId: PaneId, replacement: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return node.paneId === paneId ? replacement : node
  return { ...node, a: replaceLeaf(node.a, paneId, replacement), b: replaceLeaf(node.b, paneId, replacement) }
}

/** Remove the `paneId` leaf, collapsing its parent (sibling promoted). Null if it was the root leaf. */
function removeLeaf(node: LayoutNode, paneId: PaneId): LayoutNode | null {
  if (node.type === 'leaf') return node.paneId === paneId ? null : node
  const a = removeLeaf(node.a, paneId)
  const b = removeLeaf(node.b, paneId)
  if (a === null) return b
  if (b === null) return a
  return { ...node, a, b }
}

/** Return a new tree with the given split node's ratio updated. */
function updateRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'leaf') return node
  if (node.id === splitId) return { ...node, ratio }
  return { ...node, a: updateRatio(node.a, splitId, ratio), b: updateRatio(node.b, splitId, ratio) }
}

function activeForPane(state: TabState, paneId: PaneId): string | null {
  return state.activeTabByPane[paneId] ?? null
}

/** A copy of `map` without `key` (used to drop a collapsed pane's active-tab entry). */
function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...map }
  delete copy[key]
  return copy
}

// ── Store ───────────────────────────────────────────────────────────────────

const ROOT_PANE = crypto.randomUUID()

export const useTabStore = create<TabState>((set, get) => ({
  // No tabs at startup — an empty pane renders the welcome placeholder (SplitPane).
  tabs: [],
  layout: { type: 'leaf', paneId: ROOT_PANE },
  activePaneId: ROOT_PANE,
  activeTabByPane: { [ROOT_PANE]: null },
  draggingTabId: null,

  setDraggingTab: (id) => set({ draggingTabId: id }),

  // ── addTab ─────────────────────────────────────────────────────────────
  addTab: (tabData, paneId) => {
    const id = crypto.randomUUID()
    const targetPane = paneId ?? get().activePaneId
    set((s) => ({
      tabs: [...s.tabs, { ...tabData, id, paneId: targetPane }],
      activeTabByPane: { ...s.activeTabByPane, [targetPane]: id },
      activePaneId: targetPane,
    }))
    return id
  },

  // ── closeTab ───────────────────────────────────────────────────────────
  closeTab: (id) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab || tab.pinned) return s

      const { paneId } = tab
      const remaining = s.tabs.filter((t) => t.id !== id)
      const paneRemaining = remaining.filter((t) => t.paneId === paneId)
      const wasActive = activeForPane(s, paneId) === id

      let activeTabByPane = s.activeTabByPane
      if (wasActive) {
        const paneOrder = s.tabs.filter((t) => t.paneId === paneId)
        const oldIdx = paneOrder.findIndex((t) => t.id === id)
        const newActive = paneRemaining[Math.min(oldIdx, paneRemaining.length - 1)]?.id ?? null
        activeTabByPane = { ...activeTabByPane, [paneId]: newActive }
      }

      // Auto-collapse a pane once its last tab closes — unless it's the only pane,
      // which stays as the welcome placeholder.
      if (paneRemaining.length === 0 && listLeafIds(s.layout).length > 1) {
        const layout = removeLeaf(s.layout, paneId) ?? s.layout
        return {
          tabs: remaining,
          layout,
          activeTabByPane: omit(activeTabByPane, paneId),
          activePaneId: s.activePaneId === paneId ? firstLeafId(layout) : s.activePaneId,
        }
      }

      return { tabs: remaining, activeTabByPane }
    })
  },

  // ── setActiveTab ───────────────────────────────────────────────────────
  setActiveTab: (id, paneId) =>
    set((s) => ({
      activeTabByPane: { ...s.activeTabByPane, [paneId]: id },
      activePaneId: paneId,
    })),

  renameTab: (id, label) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, label } : t)) })),

  setTabStatus: (id, status) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, connectionStatus: status } : t)) })),

  setEditorDirty: (id, dirty) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, editorDirty: dirty } : t)) })),

  pinTab: (id) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)) })),

  // ── reorderTabs ────────────────────────────────────────────────────────
  // Indices are within the pane's own tab list; reorder those tabs in place
  // without disturbing the global positions of other panes' tabs.
  reorderTabs: (fromIndex, toIndex, paneId) =>
    set((s) => {
      const slots = s.tabs.reduce<number[]>((acc, t, i) => (t.paneId === paneId ? [...acc, i] : acc), [])
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= slots.length || toIndex >= slots.length) return s
      const paneTabs = slots.map((i) => s.tabs[i])
      const [moved] = paneTabs.splice(fromIndex, 1)
      paneTabs.splice(toIndex, 0, moved)
      const next = [...s.tabs]
      slots.forEach((gi, k) => { next[gi] = paneTabs[k] })
      return { tabs: next }
    }),

  // ── moveTabToPane ──────────────────────────────────────────────────────
  moveTabToPane: (tabId, targetPane) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId)
      if (!tab || tab.paneId === targetPane) return s

      const srcPane = tab.paneId
      const tabs = s.tabs.map((t) => (t.id === tabId ? { ...t, paneId: targetPane } : t))
      const srcRemaining = tabs.filter((t) => t.paneId === srcPane)
      const wasActive = activeForPane(s, srcPane) === tabId
      const newSrcActive = wasActive ? srcRemaining[0]?.id ?? null : activeForPane(s, srcPane)

      const next = {
        tabs,
        activeTabByPane: { ...s.activeTabByPane, [srcPane]: newSrcActive, [targetPane]: tabId },
        activePaneId: targetPane,
      }

      // If the source pane is now empty and isn't the only pane, collapse it.
      if (srcRemaining.length === 0 && listLeafIds(s.layout).length > 1) {
        const layout = removeLeaf(s.layout, srcPane) ?? s.layout
        return { ...next, layout, activeTabByPane: omit(next.activeTabByPane, srcPane) }
      }
      return next
    }),

  // ── Pane / split ───────────────────────────────────────────────────────
  setActivePane: (paneId) => set({ activePaneId: paneId }),

  splitPane: (paneId, direction) => {
    const newPaneId = crypto.randomUUID()
    set((s) => ({
      layout: replaceLeaf(s.layout, paneId, {
        type: 'split',
        id: crypto.randomUUID(),
        direction,
        ratio: 0.5,
        a: { type: 'leaf', paneId },
        b: { type: 'leaf', paneId: newPaneId },
      }),
      activeTabByPane: { ...s.activeTabByPane, [newPaneId]: null },
      activePaneId: newPaneId,
    }))
    return newPaneId
  },

  closePane: (paneId) =>
    set((s) => {
      if (listLeafIds(s.layout).length <= 1) return s // never close the only pane

      const pinned = s.tabs.filter((t) => t.paneId === paneId && t.pinned)
      if (pinned.length > 0) {
        // Keep pinned tabs (and the pane); just close the rest.
        const tabs = s.tabs.filter((t) => t.paneId !== paneId || t.pinned)
        const active = activeForPane(s, paneId)
        const keep = pinned.some((t) => t.id === active) ? active : pinned[0].id
        return { tabs, activeTabByPane: { ...s.activeTabByPane, [paneId]: keep } }
      }

      const layout = removeLeaf(s.layout, paneId) ?? s.layout
      return {
        tabs: s.tabs.filter((t) => t.paneId !== paneId),
        layout,
        activeTabByPane: omit(s.activeTabByPane, paneId),
        activePaneId: s.activePaneId === paneId ? firstLeafId(layout) : s.activePaneId,
      }
    }),

  setSplitRatio: (splitId, ratio) =>
    set((s) => ({ layout: updateRatio(s.layout, splitId, Math.min(0.9, Math.max(0.1, ratio))) })),

  // ── restoreSession ─────────────────────────────────────────────────────
  restoreSession: (descriptors, layout) =>
    set(() => {
      const tabs: Tab[] = descriptors.map((d) => ({ ...d, id: crypto.randomUUID() }))
      const leaves = listLeafIds(layout)
      const activeTabByPane: Record<PaneId, string | null> = {}
      for (const paneId of leaves) {
        activeTabByPane[paneId] = tabs.find((t) => t.paneId === paneId)?.id ?? null
      }
      return {
        tabs,
        layout,
        activePaneId: firstLeafId(layout),
        activeTabByPane,
      }
    }),
}))
