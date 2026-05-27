import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import { Workspace, PersistedLayout, LegacyLayout } from '../types/profile'
import { useTabStore, Tab, Protocol, LayoutNode, listLeafIds } from './tabStore'

interface WorkspaceStoreState {
  workspaces: Workspace[]
  load: () => Promise<void>
  saveCurrent: (name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setDefault: (id: string) => Promise<void>
  restore: (id: string) => void
}

// Old workspaces stored a single split direction + ratio with tabs pinned to
// pane 'A' or 'B'. Convert that to a one-node (or single-leaf) layout tree.
function migrateLegacyLayout(
  legacy: LegacyLayout,
  tabs: Workspace['tabs'],
): { layout: PersistedLayout; tabs: Workspace['tabs'] } {
  if (legacy.splitMode === 'single') {
    const paneId = crypto.randomUUID()
    return { layout: { type: 'leaf', paneId }, tabs: tabs.map((t) => ({ ...t, paneId })) }
  }
  const paneA = crypto.randomUUID()
  const paneB = crypto.randomUUID()
  return {
    layout: {
      type: 'split',
      id: crypto.randomUUID(),
      direction: legacy.splitMode,
      ratio: legacy.splitRatio,
      a: { type: 'leaf', paneId: paneA },
      b: { type: 'leaf', paneId: paneB },
    },
    tabs: tabs.map((t) => ({ ...t, paneId: t.paneId === 'B' ? paneB : paneA })),
  }
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  workspaces: [],

  load: async () => {
    const workspaces = await ipc.workspaces.load()
    set({ workspaces })
  },

  saveCurrent: async (name) => {
    const { tabs, layout } = useTabStore.getState()
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      isDefault: false,
      tabs: tabs.map((t) => ({ profileId: t.profileId, protocol: t.protocol, label: t.label, paneId: t.paneId })),
      layout,
    }
    const workspaces = [...get().workspaces, workspace]
    set({ workspaces })
    await ipc.workspaces.save(workspaces)
  },

  remove: async (id) => {
    const workspaces = get().workspaces.filter((w) => w.id !== id)
    set({ workspaces })
    await ipc.workspaces.save(workspaces)
  },

  setDefault: async (id) => {
    // Toggle: clicking the current default clears it.
    const current = get().workspaces.find((w) => w.id === id)
    const makeDefault = !current?.isDefault
    const workspaces = get().workspaces.map((w) => ({ ...w, isDefault: w.id === id ? makeDefault : false }))
    set({ workspaces })
    await ipc.workspaces.save(workspaces)
  },

  restore: (id) => {
    const workspace = get().workspaces.find((w) => w.id === id)
    if (!workspace) return

    // Accept both the current tree layout and the legacy { splitMode, splitRatio }.
    let layout: PersistedLayout
    let wsTabs = workspace.tabs
    if ('splitMode' in workspace.layout) {
      const migrated = migrateLegacyLayout(workspace.layout, workspace.tabs)
      layout = migrated.layout
      wsTabs = migrated.tabs
    } else {
      layout = workspace.layout
    }

    // Drop any tab whose pane no longer exists in the tree into the first leaf.
    const leaves = new Set(listLeafIds(layout as LayoutNode))
    const fallback = listLeafIds(layout as LayoutNode)[0]
    const descriptors: Omit<Tab, 'id'>[] = wsTabs.map((t) => ({
      label: t.label,
      protocol: t.protocol as Protocol,
      pinned: false,
      paneId: leaves.has(t.paneId) ? t.paneId : fallback,
      profileId: t.profileId,
    }))
    useTabStore.getState().restoreSession(descriptors, layout as LayoutNode)
  },
}))
