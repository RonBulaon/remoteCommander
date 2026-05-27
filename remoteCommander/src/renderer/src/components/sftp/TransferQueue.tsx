import { useState } from 'react'
import { ipc } from '../../lib/ipc'
import type { SftpTransferProgress } from '../../lib/ipc'

export interface TransferItem {
  transferId: string
  filename: string
  direction: 'upload' | 'download'
  transferred: number
  total: number
  speed: number
  eta: number
  status: 'progress' | 'done' | 'error' | 'cancelled'
  error?: string
}

interface Props {
  transfers: Map<string, TransferItem>
  onUpdate: (transferId: string, patch: Partial<TransferItem>) => void
  onRemove: (transferId: string) => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.ceil(seconds % 60)
  return `${m}m ${s}s`
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`
}

export function useTransferQueue() {
  const [transfers, setTransfers] = useState<Map<string, TransferItem>>(new Map())

  function add(item: TransferItem) {
    setTransfers((prev) => new Map(prev).set(item.transferId, item))
  }

  function update(transferId: string, patch: Partial<TransferItem>) {
    setTransfers((prev) => {
      const map = new Map(prev)
      const existing = map.get(transferId)
      if (existing) map.set(transferId, { ...existing, ...patch })
      return map
    })
  }

  function remove(transferId: string) {
    setTransfers((prev) => {
      const map = new Map(prev)
      map.delete(transferId)
      return map
    })
  }

  function subscribe(transferId: string) {
    return ipc.sftp.onProgress(transferId, (progress: SftpTransferProgress) => {
      update(transferId, {
        transferred: progress.transferred,
        total: progress.total,
        speed: progress.speed,
        eta: progress.eta,
        status: progress.status,
        error: progress.error,
      })
    })
  }

  return { transfers, add, update, remove, subscribe }
}

export function TransferQueue({ transfers, onUpdate, onRemove }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const items = [...transfers.values()]
  const active = items.filter((t) => t.status === 'progress').length
  const completed = items.filter((t) => t.status === 'done' || t.status === 'cancelled').length

  if (items.length === 0) return null

  return (
    <div className="shrink-0 border-t border-[#3e3e42] bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex h-8 items-center justify-between border-b border-[#3e3e42] px-3">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1.5 text-[12px] text-[#cccccc] hover:text-white"
        >
          <svg
            width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round"
            className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
          >
            <path d="M1 3l3.5 3.5L8 3" />
          </svg>
          Transfers
          {active > 0 && (
            <span className="rounded-full bg-[#007acc] px-1.5 py-px text-[10px] text-white">
              {active}
            </span>
          )}
        </button>
        {completed > 0 && !collapsed && (
          <button
            onClick={() => items.filter((t) => t.status === 'done' || t.status === 'cancelled' || t.status === 'error').forEach((t) => onRemove(t.transferId))}
            className="text-[11px] text-[#858585] hover:text-[#cccccc]"
          >
            Clear completed
          </button>
        )}
      </div>

      {/* List */}
      {!collapsed && (
        <div className="max-h-[160px] overflow-y-auto">
          {items.map((t) => {
            const pct = t.total > 0 ? Math.round((t.transferred / t.total) * 100) : 0
            return (
              <div key={t.transferId} className="flex items-center gap-2 border-b border-[#3e3e42]/50 px-3 py-1.5 last:border-0">
                {/* Direction */}
                <span className={`text-[11px] font-medium ${t.direction === 'upload' ? 'text-[#569cd6]' : 'text-[#4ec9b0]'}`}>
                  {t.direction === 'upload' ? '↑' : '↓'}
                </span>

                {/* Filename */}
                <span className="w-32 shrink-0 truncate text-[11px] text-[#cccccc]">{t.filename}</span>

                {/* Progress bar */}
                <div className="flex-1">
                  {t.status === 'progress' ? (
                    <div className="h-1.5 w-full rounded-full bg-[#3e3e42]">
                      <div
                        className="h-full rounded-full bg-[#007acc] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : t.status === 'done' ? (
                    <div className="h-1.5 w-full rounded-full bg-[#4ec9b0]/30">
                      <div className="h-full w-full rounded-full bg-[#4ec9b0]" />
                    </div>
                  ) : (
                    <div className="h-1.5 w-full rounded-full bg-[#f44747]/30">
                      <div className="h-full rounded-full bg-[#f44747]" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="w-28 shrink-0 text-right text-[10px] text-[#858585]">
                  {t.status === 'progress' && (
                    <>{pct}%&nbsp; {formatSpeed(t.speed)}&nbsp; {t.eta > 0 ? formatEta(t.eta) : ''}</>
                  )}
                  {t.status === 'done' && (
                    <span className="text-[#4ec9b0]">✓ {formatBytes(t.total)}</span>
                  )}
                  {t.status === 'error' && (
                    <span className="text-[#f44747]" title={t.error}>Error</span>
                  )}
                  {t.status === 'cancelled' && (
                    <span className="text-[#858585]">Cancelled</span>
                  )}
                </div>

                {/* Cancel / remove */}
                <button
                  onClick={() => {
                    if (t.status === 'progress') {
                      ipc.sftp.cancelTransfer(t.transferId)
                      onUpdate(t.transferId, { status: 'cancelled' })
                    } else {
                      onRemove(t.transferId)
                    }
                  }}
                  className="text-[#858585] hover:text-[#cccccc]"
                  title={t.status === 'progress' ? 'Cancel' : 'Dismiss'}
                >
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1 1l7 7M8 1L1 8" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
