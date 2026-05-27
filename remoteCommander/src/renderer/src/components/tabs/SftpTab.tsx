import { useEffect, useRef, useCallback } from 'react'
import { useTabStore, Tab } from '../../store/tabStore'
import { useProfileStore } from '../../store/profileStore'
import { ipc } from '../../lib/ipc'
import type { SftpFileEntry } from '../../lib/ipc'
import { FilePane } from '../sftp/FilePane'
import { TransferQueue, useTransferQueue } from '../sftp/TransferQueue'
import type { TransferItem } from '../sftp/TransferQueue'
import { PermissionEditor } from '../sftp/PermissionEditor'
import { useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

type SftpStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'

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
        'flex h-6 min-w-[24px] items-center justify-center rounded-sm px-1.5 transition-colors',
        disabled
          ? 'cursor-not-allowed text-[#454545]'
          : 'text-[#858585] hover:bg-white/[0.07] hover:text-[#cccccc]',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="mx-1 h-4 w-px shrink-0 bg-[#3e3e42]" />
}

// ── SftpTab ────────────────────────────────────────────────────────────────

export function SftpTab({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const [status, setStatus]               = useState<SftpStatus>('idle')
  const [sessionId, setSessionId]         = useState<string | null>(null)
  const [localPath, setLocalPath]         = useState('/')
  const [remotePath, setRemotePath]       = useState('/')
  const [errorMsg, setErrorMsg]           = useState<string | null>(null)
  const [localRefreshKey, setLocalRefreshKey]   = useState(0)
  const [remoteRefreshKey, setRemoteRefreshKey] = useState(0)

  // Selected files (for toolbar upload/download buttons)
  const [localSelected, setLocalSelected]   = useState<{ entry: SftpFileEntry; path: string } | null>(null)
  const [remoteSelected, setRemoteSelected] = useState<{ entry: SftpFileEntry; path: string } | null>(null)

  // Drag state — shared between panes
  const dragRef = useRef<{ entry: SftpFileEntry; path: string; side: 'local' | 'remote' } | null>(null)

  // Permission editor
  const [permTarget, setPermTarget] = useState<{ entry: SftpFileEntry; path: string } | null>(null)

  const { setTabStatus } = useTabStore()
  const profile = useProfileStore((s) => s.profiles.find((p) => p.id === tab.profileId))

  const { transfers, add: addTransfer, update: updateTransfer, remove: removeTransfer, subscribe } = useTransferQueue()

  // ── Connect ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tab.profileId) return
    let cancelled = false

    setStatus('connecting')
    setTabStatus(tab.id, 'connecting')
    setErrorMsg(null)

    ipc.sftp.connect(tab.profileId).then((res) => {
      if (cancelled) return
      if ('error' in res) {
        setStatus('error')
        setErrorMsg(res.error)
        setTabStatus(tab.id, 'disconnected')
        return
      }
      setSessionId(res.sessionId)
      setLocalPath(res.localHome)
      setRemotePath(res.remoteHome)
      setStatus('connected')
      setTabStatus(tab.id, 'connected')

      const unsub = ipc.sftp.onStatus(res.sessionId, (st) => {
        if (st === 'disconnected') {
          setStatus('disconnected')
          setTabStatus(tab.id, 'disconnected')
        }
      })
      return unsub
    }).catch((err) => {
      if (cancelled) return
      setStatus('error')
      setErrorMsg(String(err))
      setTabStatus(tab.id, 'disconnected')
    })

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.profileId])

  // Disconnect on unmount
  useEffect(() => {
    return () => {
      if (sessionId) ipc.sftp.disconnect(sessionId)
    }
  }, [sessionId])

  // ── Transfer helpers ──────────────────────────────────────────────────────

  const startUpload = useCallback(
    async (localFilePath: string, remoteDir: string) => {
      if (!sessionId) return
      const filename = localFilePath.split('/').pop() ?? localFilePath
      const remoteDest = remoteDir.replace(/\/$/, '') + '/' + filename

      const item: TransferItem = {
        transferId: '',
        filename,
        direction: 'upload',
        transferred: 0,
        total: 0,
        speed: 0,
        eta: 0,
        status: 'progress',
      }

      const res = await ipc.sftp.upload(sessionId, localFilePath, remoteDest)
      if ('error' in res) {
        setErrorMsg(res.error)
        return
      }
      item.transferId = res.transferId
      addTransfer(item)
      const unsub = subscribe(res.transferId)

      // Refresh remote pane when done
      const origUnsub = unsub
      const wrappedUnsub = ipc.sftp.onProgress(res.transferId, (p) => {
        if (p.status === 'done') {
          setRemoteRefreshKey((k) => k + 1)
          wrappedUnsub()
          origUnsub()
        }
      })
    },
    [sessionId, addTransfer, subscribe],
  )

  const startDownload = useCallback(
    async (remoteFilePath: string, localDir: string) => {
      if (!sessionId) return
      const filename = remoteFilePath.split('/').pop() ?? remoteFilePath
      const localDest = localDir.replace(/\/$/, '') + '/' + filename

      const item: TransferItem = {
        transferId: '',
        filename,
        direction: 'download',
        transferred: 0,
        total: 0,
        speed: 0,
        eta: 0,
        status: 'progress',
      }

      const res = await ipc.sftp.download(sessionId, remoteFilePath, localDest)
      if ('error' in res) {
        setErrorMsg(res.error)
        return
      }
      item.transferId = res.transferId
      addTransfer(item)
      const unsub = subscribe(res.transferId)

      const wrappedUnsub = ipc.sftp.onProgress(res.transferId, (p) => {
        if (p.status === 'done') {
          setLocalRefreshKey((k) => k + 1)
          wrappedUnsub()
          unsub()
        }
      })
    },
    [sessionId, addTransfer, subscribe],
  )

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleUpload = () => {
    if (!localSelected || !localSelected.entry.isDir === false) return
    if (localSelected.entry.isDir) return
    startUpload(localSelected.path, remotePath)
  }

  const handleDownload = () => {
    if (!remoteSelected || remoteSelected.entry.isDir) return
    startDownload(remoteSelected.path, localPath)
  }

  const handleDrop = useCallback(
    (targetSide: 'local' | 'remote', _: SftpFileEntry, __: string) => {
      const drag = dragRef.current
      if (!drag || drag.side === targetSide) return
      if (targetSide === 'remote') {
        startUpload(drag.path, remotePath)
      } else {
        startDownload(drag.path, localPath)
      }
    },
    [startUpload, startDownload, localPath, remotePath],
  )

  const handleTransferAction = useCallback(
    (action: 'upload' | 'download', _entry: SftpFileEntry, fullPath: string) => {
      if (action === 'upload') {
        startUpload(fullPath, remotePath)
      } else {
        startDownload(fullPath, localPath)
      }
    },
    [startUpload, startDownload, localPath, remotePath],
  )

  const handlePermSave = useCallback(
    async (mode: number) => {
      if (!sessionId || !permTarget) return
      const res = await ipc.sftp.chmod(sessionId, permTarget.path, mode)
      if ('error' in res) throw new Error(res.error)
      setRemoteRefreshKey((k) => k + 1)
    },
    [sessionId, permTarget],
  )

  const openEditor = useCallback(
    (fileSide: 'local' | 'remote', fullPath: string) => {
      if (!sessionId) return
      const filename = fullPath.split('/').pop() || fullPath
      useTabStore.getState().addTab({
        label: filename,
        protocol: 'editor',
        pinned: false,
        editor: { path: fullPath, isLocal: fileSide === 'local', sessionId },
      })
    },
    [sessionId],
  )

  const handleDisconnect = useCallback(() => {
    if (!sessionId) return
    ipc.sftp.disconnect(sessionId)
    setSessionId(null)
    setStatus('disconnected')
    setTabStatus(tab.id, 'disconnected')
  }, [sessionId, tab.id, setTabStatus])

  // ── Status bar content ─────────────────────────────────────────────────────

  const statusText =
    status === 'connecting'   ? 'Connecting…'
    : status === 'connected'  ? (profile ? `${profile.host} — ${profile.username}` : 'Connected')
    : status === 'error'      ? `Error: ${errorMsg}`
    : status === 'disconnected' ? 'Disconnected'
    : ''

  const statusColor =
    status === 'connected'    ? '#4ec9b0'
    : status === 'connecting' ? '#dcdcaa'
    : '#f44747'

  // ── Render ─────────────────────────────────────────────────────────────────

  if (status === 'connecting') {
    return (
      <div className="flex h-full items-center justify-center bg-[#1e1e1e]">
        <p className="text-[13px] text-[#858585]">Connecting to SFTP…</p>
      </div>
    )
  }

  if (status === 'error' || status === 'disconnected') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#1e1e1e]">
        <p className="text-[13px] text-[#f48771]">{errorMsg ?? 'Disconnected'}</p>
        <button
          onClick={() => {
            setStatus('connecting')
            setSessionId(null)
            setErrorMsg(null)
            // Trigger reconnect by resetting tab — re-fire the connect effect
            if (tab.profileId) {
              setTabStatus(tab.id, 'connecting')
              ipc.sftp.connect(tab.profileId).then((res) => {
                if ('error' in res) { setStatus('error'); setErrorMsg(res.error); return }
                setSessionId(res.sessionId)
                setLocalPath(res.localHome)
                setRemotePath(res.remoteHome)
                setStatus('connected')
                setTabStatus(tab.id, 'connected')
              }).catch((e) => { setStatus('error'); setErrorMsg(String(e)) })
            }
          }}
          className="rounded-sm bg-[#007acc] px-3 py-1.5 text-[12px] text-white hover:bg-[#0069ac]"
        >
          Reconnect
        </button>
      </div>
    )
  }

  if (!sessionId) return null

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ display: isActive ? 'flex' : 'none' }}>
      {/* ── Toolbar ── */}
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-[#3e3e42] bg-[#252526] px-2">
        <TBtn
          title="Upload selected local file to remote"
          onClick={handleUpload}
          disabled={!localSelected || localSelected.entry.isDir}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </TBtn>
        <TBtn
          title="Download selected remote file to local"
          onClick={handleDownload}
          disabled={!remoteSelected || remoteSelected.entry.isDir}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </TBtn>
        <Sep />
        <TBtn title="Refresh both panes" onClick={() => { setLocalRefreshKey((k) => k + 1); setRemoteRefreshKey((k) => k + 1) }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.36" />
          </svg>
        </TBtn>
        <Sep />
        <TBtn title="Disconnect" onClick={handleDisconnect}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        </TBtn>
      </div>

      {/* ── Dual panes ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <FilePane
          key={`local-${localRefreshKey}`}
          sessionId={sessionId}
          side="local"
          initialPath={localPath}
          onSelectionChange={(entry, path) => setLocalSelected(entry ? { entry, path } : null)}
          onDragStart={(entry, path) => { dragRef.current = { entry, path, side: 'local' } }}
          onDrop={(_sourceSide, entry, path) => handleDrop('local', entry, path)}
          onRequestPermissions={() => {}}
          onTransferAction={handleTransferAction}
          onEdit={(_entry, fullPath) => openEditor('local', fullPath)}
        />
        <FilePane
          key={`remote-${remoteRefreshKey}`}
          sessionId={sessionId}
          side="remote"
          initialPath={remotePath}
          onSelectionChange={(entry, path) => setRemoteSelected(entry ? { entry, path } : null)}
          onDragStart={(entry, path) => { dragRef.current = { entry, path, side: 'remote' } }}
          onDrop={(_sourceSide, entry, path) => handleDrop('remote', entry, path)}
          onRequestPermissions={(entry, path) => setPermTarget({ entry, path })}
          onTransferAction={handleTransferAction}
          onEdit={(_entry, fullPath) => openEditor('remote', fullPath)}
        />
      </div>

      {/* ── Transfer queue ── */}
      <TransferQueue
        transfers={transfers}
        onUpdate={updateTransfer}
        onRemove={removeTransfer}
      />

      {/* ── Status bar ── */}
      <div className="flex h-[22px] shrink-0 items-center gap-2 border-t border-[#3e3e42] bg-[#1a1a1a] px-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statusColor }} />
        <span className="text-[11px]" style={{ color: statusColor }}>{statusText}</span>
      </div>

      {/* ── Permission editor ── */}
      {permTarget && (
        <PermissionEditor
          open={permTarget !== null}
          path={permTarget.path}
          currentMode={permTarget.entry.permissions}
          onSave={handlePermSave}
          onClose={() => setPermTarget(null)}
        />
      )}
    </div>
  )
}
