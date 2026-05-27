import { useState, useEffect, useCallback, useRef } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { ipc } from '../../lib/ipc'
import type { SftpFileEntry } from '../../lib/ipc'

// ── Helpers ────────────────────────────────────────────────────────────────

function formatSize(size: number, isDir: boolean): string {
  if (isDir) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(mtime: number): string {
  if (!mtime) return '—'
  const d = new Date(mtime)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMode(permissions: number, isDir: boolean, isSymlink: boolean): string {
  const type = isSymlink ? 'l' : isDir ? 'd' : '-'
  let result = type
  for (let shift = 6; shift >= 0; shift -= 3) {
    const bits = (permissions >> shift) & 7
    result += bits & 4 ? 'r' : '-'
    result += bits & 2 ? 'w' : '-'
    result += bits & 1 ? 'x' : '-'
  }
  return result
}

function joinPath(base: string, name: string): string {
  if (base === '/') return '/' + name
  return base.replace(/\/$/, '') + '/' + name
}

function parentPath(p: string): string {
  if (p === '/') return '/'
  const parts = p.replace(/\/$/, '').split('/')
  parts.pop()
  return parts.join('/') || '/'
}

function pathSegments(p: string): { label: string; path: string }[] {
  if (p === '/') return [{ label: '/', path: '/' }]
  const parts = p.replace(/^\//, '').split('/')
  const segs: { label: string; path: string }[] = [{ label: '/', path: '/' }]
  let acc = ''
  for (const part of parts) {
    acc += '/' + part
    segs.push({ label: part, path: acc })
  }
  return segs
}

// ── Icons ──────────────────────────────────────────────────────────────────

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#dcdcaa]">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#9cdcfe]">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  )
}

// ── Toolbar button ─────────────────────────────────────────────────────────

function TBtn({
  title, onClick, disabled, children,
}: {
  title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex h-6 min-w-[24px] items-center justify-center rounded-sm px-1 transition-colors',
        disabled
          ? 'cursor-not-allowed text-[#454545]'
          : 'text-[#858585] hover:bg-white/[0.07] hover:text-[#cccccc]',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface FilePaneProps {
  sessionId: string
  side: 'local' | 'remote'
  initialPath: string
  onSelectionChange: (entry: SftpFileEntry | null, fullPath: string) => void
  onDragStart: (entry: SftpFileEntry, fullPath: string) => void
  onDrop: (sourceSide: 'local' | 'remote', sourceFile: SftpFileEntry, sourcePath: string) => void
  onRequestPermissions: (entry: SftpFileEntry, fullPath: string) => void
  onTransferAction: (action: 'upload' | 'download', entry: SftpFileEntry, fullPath: string) => void
  onEdit: (entry: SftpFileEntry, fullPath: string) => void
}

// ── FilePane ───────────────────────────────────────────────────────────────

export function FilePane({
  sessionId, side, initialPath,
  onSelectionChange, onDragStart, onDrop,
  onRequestPermissions, onTransferAction, onEdit,
}: FilePaneProps) {
  const [path, setPath] = useState(initialPath)
  const [entries, setEntries] = useState<SftpFileEntry[]>([])
  const [selected, setSelected] = useState<SftpFileEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renamingName, setRenamingName] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newFolderActive, setNewFolderActive] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  // ── Load entries ─────────────────────────────────────────────────────────

  const load = useCallback(
    async (p: string) => {
      setLoading(true)
      setError(null)
      setSelected(null)
      onSelectionChange(null, p)
      try {
        const res = side === 'local'
          ? await ipc.sftp.listLocal(sessionId, p)
          : await ipc.sftp.list(sessionId, p)
        if ('error' in res) { setError(res.error); return }
        setEntries(res.entries)
        setPath(p)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    },
    [sessionId, side, onSelectionChange],
  )

  useEffect(() => { load(initialPath) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigation ────────────────────────────────────────────────────────────

  // Double-click / "Open": directories navigate; files open in the editor.
  const openEntry = (entry: SftpFileEntry) => {
    if (entry.isDir || entry.isSymlink) load(joinPath(path, entry.name))
    else onEdit(entry, joinPath(path, entry.name))
  }

  const selectEntry = (entry: SftpFileEntry) => {
    setSelected(entry)
    onSelectionChange(entry, joinPath(path, entry.name))
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  const startRename = (entry: SftpFileEntry) => {
    setRenamingName(entry.name)
    setRenameValue(entry.name)
    setTimeout(() => renameInputRef.current?.select(), 0)
  }

  const commitRename = async () => {
    if (!renamingName || !renameValue.trim() || renameValue === renamingName) {
      setRenamingName(null); return
    }
    const oldPath = joinPath(path, renamingName)
    const newPath = joinPath(path, renameValue.trim())
    setRenamingName(null)
    if (side === 'remote') {
      const res = await ipc.sftp.rename(sessionId, oldPath, newPath)
      if ('error' in res) { setError(res.error); return }
    }
    await load(path)
  }

  // ── New folder ────────────────────────────────────────────────────────────

  const commitNewFolder = async () => {
    setNewFolderActive(false)
    if (!newFolderName.trim()) { setNewFolderName(''); return }
    const newPath = joinPath(path, newFolderName.trim())
    setNewFolderName('')
    if (side === 'remote') {
      const res = await ipc.sftp.mkdir(sessionId, newPath)
      if ('error' in res) { setError(res.error); return }
    }
    await load(path)
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteEntry = async (entry: SftpFileEntry) => {
    if (!confirm(`Delete "${entry.name}"?`)) return
    if (side === 'remote') {
      const res = await ipc.sftp.delete(sessionId, joinPath(path, entry.name))
      if ('error' in res) { setError(res.error); return }
    }
    if (selected?.name === entry.name) { setSelected(null); onSelectionChange(null, path) }
    await load(path)
  }

  // ── Copy path ─────────────────────────────────────────────────────────────

  const copyPath = (entry: SftpFileEntry) => {
    navigator.clipboard.writeText(joinPath(path, entry.name)).catch(() => {})
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, entry: SftpFileEntry) => {
    if (entry.isDir) return
    e.dataTransfer.setData('application/x-filepane', JSON.stringify({ side, name: entry.name }))
    onDragStart(entry, joinPath(path, entry.name))
  }

  const handleDragOver = (e: React.DragEvent) => {
    const data = e.dataTransfer.types.includes('application/x-filepane')
    if (data) { e.preventDefault(); setIsDragOver(true) }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    try {
      const raw = e.dataTransfer.getData('application/x-filepane')
      const { side: sourceSide, name } = JSON.parse(raw) as { side: 'local' | 'remote'; name: string }
      if (sourceSide === side) return // same pane, ignore
      const sourceEntries = entries // wrong — need to look up from source side
      void sourceEntries // unused
      // The actual lookup is done at SftpTab level via the drag state
      const fakeEntry: SftpFileEntry = { name, size: 0, mtime: 0, permissions: 0, isDir: false, isSymlink: false }
      onDrop(sourceSide, fakeEntry, name)
    } catch { /* malformed data */ }
  }

  // ── New folder active focus ────────────────────────────────────────────────

  useEffect(() => {
    if (newFolderActive) setTimeout(() => newFolderInputRef.current?.focus(), 0)
  }, [newFolderActive])

  // ── Render ─────────────────────────────────────────────────────────────────

  const segs = pathSegments(path)

  return (
    <div
      className={[
        'flex flex-1 min-w-0 flex-col overflow-hidden border-[#3e3e42]',
        side === 'local' ? 'border-r' : '',
        isDragOver ? 'outline outline-2 outline-[#007acc]/50' : '',
      ].join(' ')}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* ── Pane toolbar ── */}
      <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-[#3e3e42] bg-[#252526] px-1.5">
        {/* Up */}
        <TBtn title="Go up" onClick={() => load(parentPath(path))} disabled={path === '/'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </TBtn>
        {/* Refresh */}
        <TBtn title="Refresh" onClick={() => load(path)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.36" />
          </svg>
        </TBtn>
        {/* New folder (remote only) */}
        {side === 'remote' && (
          <TBtn title="New folder" onClick={() => { setNewFolderActive(true); setNewFolderName('') }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </TBtn>
        )}
        {/* Rename */}
        {side === 'remote' && (
          <TBtn title="Rename" onClick={() => selected && startRename(selected)} disabled={!selected}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </TBtn>
        )}
        {/* Delete */}
        {side === 'remote' && (
          <TBtn title="Delete" onClick={() => selected && deleteEntry(selected)} disabled={!selected}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </TBtn>
        )}
        {/* Permissions */}
        {side === 'remote' && (
          <TBtn title="Permissions" onClick={() => selected && onRequestPermissions(selected, joinPath(path, selected.name))} disabled={!selected}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </TBtn>
        )}

        <span className="ml-1 text-[10px] font-medium uppercase tracking-wider text-[#858585]">
          {side === 'local' ? 'LOCAL' : 'REMOTE'}
        </span>
      </div>

      {/* ── Breadcrumb ── */}
      <div className="flex h-6 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[#3e3e42] bg-[#1e1e1e] px-2 scrollbar-none">
        {segs.map((seg, i) => (
          <span key={seg.path} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <span className="text-[10px] text-[#555555]">/</span>}
            <button
              onClick={() => load(seg.path)}
              className={[
                'text-[11px] transition-colors',
                seg.path === path ? 'text-[#cccccc]' : 'text-[#858585] hover:text-[#cccccc]',
              ].join(' ')}
            >
              {seg.label}
            </button>
          </span>
        ))}
      </div>

      {/* ── Column headers ── */}
      <div className="flex shrink-0 border-b border-[#3e3e42] bg-[#252526] text-[10px] font-medium uppercase tracking-wider text-[#858585]">
        <div className="flex-1 px-2 py-1">Name</div>
        <div className="w-20 px-2 py-1 text-right">Size</div>
        <div className="w-28 px-2 py-1">Modified</div>
        <div className="w-24 px-2 py-1 font-mono">Mode</div>
      </div>

      {/* ── File list ── */}
      <div className="flex-1 overflow-y-auto bg-[#1e1e1e] text-[12px]">
        {loading && (
          <div className="flex h-12 items-center justify-center text-[#858585]">
            Loading…
          </div>
        )}
        {error && !loading && (
          <div className="px-3 py-2 text-[12px] text-[#f48771]">{error}</div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="flex h-12 items-center justify-center text-[#555555]">
            Empty directory
          </div>
        )}

        {/* New folder row */}
        {newFolderActive && (
          <div className="flex items-center gap-1.5 border-b border-[#3e3e42]/50 bg-[#094771]/20 px-2 py-1">
            <FolderIcon />
            <input
              ref={newFolderInputRef}
              className="flex-1 bg-[#3c3c3c] px-1 text-[12px] text-[#cccccc] outline outline-1 outline-[#007acc]"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewFolder()
                if (e.key === 'Escape') { setNewFolderActive(false); setNewFolderName('') }
              }}
              onBlur={commitNewFolder}
            />
          </div>
        )}

        {!loading && !error && entries.map((entry) => {
          const isSelected = selected?.name === entry.name
          const isRenaming = renamingName === entry.name

          const row = (
            <div
              key={entry.name}
              draggable={!entry.isDir}
              onDragStart={(e) => handleDragStart(e, entry)}
              onClick={() => selectEntry(entry)}
              onDoubleClick={() => openEntry(entry)}
              className={[
                'flex cursor-default items-center border-b border-[#3e3e42]/30 transition-colors',
                isSelected ? 'bg-[#094771]' : 'hover:bg-white/[0.04]',
              ].join(' ')}
            >
              <div className="flex flex-1 items-center gap-1.5 overflow-hidden px-2 py-1">
                {entry.isDir ? <FolderIcon /> : <FileIcon />}
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    className="flex-1 bg-[#3c3c3c] px-1 text-[12px] text-[#cccccc] outline outline-1 outline-[#007acc]"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingName(null)
                    }}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={`truncate ${entry.isDir ? 'text-[#dcdcaa]' : 'text-[#cccccc]'}`}>
                    {entry.name}
                  </span>
                )}
              </div>
              <div className="w-20 shrink-0 px-2 py-1 text-right text-[#858585]">
                {formatSize(entry.size, entry.isDir)}
              </div>
              <div className="w-28 shrink-0 px-2 py-1 text-[#858585]">
                {formatDate(entry.mtime)}
              </div>
              <div className="w-24 shrink-0 px-2 py-1 font-mono text-[10px] text-[#858585]">
                {formatMode(entry.permissions, entry.isDir, entry.isSymlink)}
              </div>
            </div>
          )

          return (
            <ContextMenu.Root key={entry.name}>
              <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content
                  className="z-50 min-w-[160px] rounded border border-[#454545] bg-[#252526] py-1 shadow-xl"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  {!entry.isDir && (
                    <ContextMenu.Item
                      className="cursor-default px-3 py-1 text-[12px] text-[#cccccc] hover:bg-[#094771] hover:outline-none"
                      onSelect={() => onEdit(entry, joinPath(path, entry.name))}
                    >
                      Edit
                    </ContextMenu.Item>
                  )}
                  {!entry.isDir && (
                    <ContextMenu.Item
                      className="cursor-default px-3 py-1 text-[12px] text-[#cccccc] hover:bg-[#094771] hover:outline-none"
                      onSelect={() => onTransferAction(side === 'local' ? 'upload' : 'download', entry, joinPath(path, entry.name))}
                    >
                      {side === 'local' ? '↑ Upload' : '↓ Download'}
                    </ContextMenu.Item>
                  )}
                  {side === 'remote' && (
                    <>
                      <ContextMenu.Item
                        className="cursor-default px-3 py-1 text-[12px] text-[#cccccc] hover:bg-[#094771] hover:outline-none"
                        onSelect={() => startRename(entry)}
                      >
                        Rename
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        className="cursor-default px-3 py-1 text-[12px] text-[#cccccc] hover:bg-[#094771] hover:outline-none"
                        onSelect={() => deleteEntry(entry)}
                      >
                        Delete
                      </ContextMenu.Item>
                      {!entry.isDir && (
                        <ContextMenu.Item
                          className="cursor-default px-3 py-1 text-[12px] text-[#cccccc] hover:bg-[#094771] hover:outline-none"
                          onSelect={() => onRequestPermissions(entry, joinPath(path, entry.name))}
                        >
                          Permissions
                        </ContextMenu.Item>
                      )}
                    </>
                  )}
                  <ContextMenu.Separator className="my-1 h-px bg-[#3e3e42]" />
                  <ContextMenu.Item
                    className="cursor-default px-3 py-1 text-[12px] text-[#cccccc] hover:bg-[#094771] hover:outline-none"
                    onSelect={() => copyPath(entry)}
                  >
                    Copy Path
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          )
        })}
      </div>
    </div>
  )
}
