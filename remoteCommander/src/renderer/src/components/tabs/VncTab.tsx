import { useEffect, useRef, useState, useCallback } from 'react'
import RFB from '@novnc/novnc'
import { useTabStore, Tab } from '../../store/tabStore'
import { useProfileStore } from '../../store/profileStore'
import { ipc } from '../../lib/ipc'

// ── Types ─────────────────────────────────────────────────────────────────

type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'needsPassword'

// ── Small UI helpers ──────────────────────────────────────────────────────

function TBtn({
  title, onClick, disabled, children,
}: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
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

function StatusDot({ status }: { status: SessionStatus }) {
  const color =
    status === 'connected'  ? 'bg-[#89d185]' :
    status === 'connecting' ? 'bg-[#d7ba7d] animate-pulse' :
    status === 'error'      ? 'bg-[#f48771]' :
    'bg-[#6d6d6d]'
  return <div className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
}

// ── In-app password dialog ────────────────────────────────────────────────

function PasswordDialog({
  host, onSubmit, onCancel,
}: { host: string; onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState('')
  return (
    <div className="flex flex-1 items-center justify-center bg-[#1e1e1e]">
      <div className="w-[340px] rounded border border-[#454545] bg-[#252526] shadow-2xl">
        <div className="border-b border-[#3e3e42] px-4 py-3">
          <p className="text-[13px] font-semibold text-[#cccccc]">VNC Password</p>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-[12px] text-[#858585]">
            Enter the VNC password for{' '}
            <span className="text-[#cccccc]">{host}</span>, or connect without one.
          </p>
          <input
            className="w-full rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1.5 text-[13px] text-[#cccccc] outline-none focus:border-[#007acc]"
            type="password"
            placeholder="VNC password (leave blank if none)"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(pw) }}
            autoFocus
          />
          <p className="text-[11px] text-[#6d6d6d]">
            Leave blank and click Connect for no-auth VNC servers.
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
            className="rounded-sm bg-[#007acc] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#0069ac]"
            onClick={() => onSubmit(pw)}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}

// ── VncTab ────────────────────────────────────────────────────────────────

export function VncTab({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const canvasRef      = useRef<HTMLDivElement>(null)
  const rfbRef         = useRef<InstanceType<typeof RFB> | null>(null)
  const sessionIdRef   = useRef<string | null>(null)
  const cleanupRef     = useRef<(() => void) | null>(null)

  const [status,           setStatus]           = useState<SessionStatus>('idle')
  const [statusMsg,        setStatusMsg]        = useState('')
  const [desktopName,      setDesktopName]      = useState('')
  const [needsPassword,    setNeedsPassword]    = useState(false)
  // undefined = not yet determined; string (even '') = user-supplied override
  const [passwordOverride, setPasswordOverride] = useState<string | undefined>(undefined)
  const [reconnectTick,    setReconnectTick]    = useState(0)

  const { setTabStatus } = useTabStore()
  const { profiles }     = useProfileStore()
  const profile = tab.profileId ? profiles.find((p) => p.id === tab.profileId) : undefined

  // ── Connect ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tab.profileId) return
    if (needsPassword) return

    // Tear down any previous session
    cleanupRef.current?.()
    cleanupRef.current = null

    if (rfbRef.current) {
      try { rfbRef.current.disconnect() } catch { /* */ }
      rfbRef.current = null
    }

    setStatus('connecting')
    setStatusMsg('Connecting…')
    setDesktopName('')
    setTabStatus(tab.id, 'connecting')

    let cancelled = false
    let unsubStatus: (() => void) | null = null
    let rfb: InstanceType<typeof RFB> | null = null
    let sessionId: string | null = null

    ;(async () => {
      try {
        const result = await ipc.vnc.connect(tab.profileId!)

        if (cancelled) return

        if ('error' in result) {
          setStatus('error')
          setStatusMsg(result.error)
          setTabStatus(tab.id, 'disconnected')
          return
        }

        sessionId = result.sessionId
        sessionIdRef.current = sessionId

        // Subscribe to main-process TCP-level status events
        unsubStatus = ipc.vnc.onStatus(sessionId, (raw) => {
          const s = raw as string
          if (s === 'connected' && !cancelled) {
            setStatusMsg('TCP connected — negotiating VNC protocol…')
          } else if (s === 'disconnected' && !cancelled) {
            setStatus('disconnected')
            setStatusMsg('Disconnected')
            setTabStatus(tab.id, 'disconnected')
          } else if (s.startsWith('error:') && !cancelled) {
            setStatus('error')
            setStatusMsg(s.slice(6))
            setTabStatus(tab.id, 'disconnected')
          }
        })

        // Effective password: explicit override > keytar result.
        // null means "no password saved and no override" → ask user.
        // '' (empty string) means "connect without password".
        const effectivePassword: string | null =
          passwordOverride !== undefined ? passwordOverride : result.password

        if (effectivePassword === null) {
          setNeedsPassword(true)
          setStatus('needsPassword')
          setTabStatus(tab.id, 'disconnected')
          await ipc.vnc.disconnect(sessionId)
          sessionIdRef.current = null
          return
        }

        if (!canvasRef.current || cancelled) return

        // Create the WebSocket ourselves so any connection failure is caught
        // immediately as a thrown error rather than silently hanging.
        setStatusMsg('Connecting to VNC proxy…')
        const proxyWs = await new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${result.localWsPort}`, ['binary'])
          const timer = setTimeout(() => {
            ws.close()
            reject(new Error(`Timed out connecting to local VNC proxy (port ${result.localWsPort})`))
          }, 8000)
          ws.onopen  = () => { clearTimeout(timer); resolve(ws) }
          ws.onerror = () => { clearTimeout(timer); reject(new Error(`Cannot reach VNC proxy on 127.0.0.1:${result.localWsPort}`)) }
        })

        if (cancelled) { proxyWs.close(); return }

        rfb = new RFB(
          canvasRef.current,
          proxyWs,
          { credentials: { password: effectivePassword ?? '' } },
        )
        rfbRef.current = rfb
        rfb.scaleViewport = true
        rfb.resizeSession = false

        rfb.addEventListener('connect', () => {
          if (cancelled) return
          const host   = profile?.host ?? ''
          const display = profile?.vncDisplay != null ? `:${profile.vncDisplay}` : ''
          setStatus('connected')
          setStatusMsg(`Connected — ${host}${display}`)
          setTabStatus(tab.id, 'connected')
        })

        rfb.addEventListener('disconnect', (e: CustomEvent<{ clean: boolean }>) => {
          if (cancelled) return
          if (e.detail.clean) {
            setStatus('disconnected')
            setStatusMsg('Disconnected')
          } else {
            setStatus('error')
            setStatusMsg('Connection lost unexpectedly')
          }
          setTabStatus(tab.id, 'disconnected')
        })

        rfb.addEventListener('credentialsrequired', () => {
          if (cancelled) return
          // This fires when the server needs credentials not covered by the
          // constructor options. If we have a password, send it; otherwise ask.
          if (effectivePassword !== null && effectivePassword !== '') {
            rfb!.sendCredentials({ password: effectivePassword })
          } else {
            setPasswordOverride(undefined)
            setNeedsPassword(true)
            setStatus('needsPassword')
            setTabStatus(tab.id, 'disconnected')
          }
        })

        rfb.addEventListener('securityfailure', (e: CustomEvent<{ status: number; reason?: string }>) => {
          if (cancelled) return
          setStatus('error')
          setStatusMsg(`Authentication failed${e.detail.reason ? `: ${e.detail.reason}` : ''}`)
          setTabStatus(tab.id, 'disconnected')
        })

        rfb.addEventListener('desktopname', (e: CustomEvent<{ name: string }>) => {
          setDesktopName(e.detail.name)
        })
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setStatusMsg(String(err))
          setTabStatus(tab.id, 'disconnected')
        }
      }
    })()

    cleanupRef.current = () => {
      cancelled = true
      unsubStatus?.()
      if (rfb) {
        try { rfb.disconnect() } catch { /* */ }
      }
      if (sessionId) {
        ipc.vnc.disconnect(sessionId).catch(() => {})
      }
    }

    return () => {
      unsubStatus?.()
      cancelled = true
    }
  }, [tab.profileId, reconnectTick, passwordOverride]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { cleanupRef.current?.() }
  }, [])

  // Focus/blur when tab becomes active/inactive
  useEffect(() => {
    if (!rfbRef.current) return
    try {
      if (isActive) rfbRef.current.focus()
      else rfbRef.current.blur()
    } catch { /* rfb may be disconnected */ }
  }, [isActive])

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleDisconnect = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    rfbRef.current = null
    sessionIdRef.current = null
    setStatus('disconnected')
    setStatusMsg('Disconnected')
    setTabStatus(tab.id, 'disconnected')
  }, [tab.id, setTabStatus])

  const handleReconnect = useCallback(() => {
    setNeedsPassword(false)
    setPasswordOverride(undefined)
    cleanupRef.current?.()
    cleanupRef.current = null
    rfbRef.current = null
    sessionIdRef.current = null
    setReconnectTick((t) => t + 1)
  }, [])

  // Called from PasswordDialog — pw may be '' for no-auth servers
  const handlePasswordSubmit = useCallback((pw: string) => {
    setNeedsPassword(false)
    setPasswordOverride(pw)
    setReconnectTick((t) => t + 1)
  }, [])

  const isConnected = status === 'connected'

  // ── Status bar text ───────────────────────────────────────────────────────

  const statusText =
    status === 'idle'          ? 'Idle' :
    status === 'connecting'    ? statusMsg :
    status === 'connected'     ? `${statusMsg}${desktopName ? ` — ${desktopName}` : ''}` :
    status === 'disconnected'  ? 'Disconnected' :
    status === 'needsPassword' ? 'Password required' :
    `Error: ${statusMsg}`

  // ── Render ────────────────────────────────────────────────────────────────

  if (needsPassword) {
    return (
      <PasswordDialog
        host={profile?.host ?? tab.label}
        onSubmit={handlePasswordSubmit}
        onCancel={() => { setNeedsPassword(false); setStatus('idle'); setStatusMsg('') }}
      />
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#1e1e1e]">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[#3e3e42] bg-[#2d2d2d] px-2 py-1">

        <TBtn
          title="Send Ctrl+Alt+Del"
          onClick={() => rfbRef.current?.sendCtrlAltDel()}
          disabled={!isConnected}
        >
          <span className="text-[11px]">Ctrl+Alt+Del</span>
        </TBtn>

        <Sep />

        <TBtn
          title="Scale viewport to fit tab"
          onClick={() => {
            if (rfbRef.current) rfbRef.current.scaleViewport = !rfbRef.current.scaleViewport
          }}
          disabled={!isConnected}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M1 4.5V1H4.5M8.5 1H12V4.5M12 8.5V12H8.5M4.5 12H1V8.5"/>
          </svg>
        </TBtn>

        <div className="flex-1" />

        <TBtn
          title="Reconnect"
          onClick={handleReconnect}
          disabled={status === 'connecting'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 2A5 5 0 1 0 11 6.5"/>
            <path d="M11 0v3H8"/>
          </svg>
        </TBtn>

        <TBtn
          title="Disconnect"
          onClick={handleDisconnect}
          disabled={!isConnected && status !== 'connecting'}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8"/>
          </svg>
        </TBtn>
      </div>

      {/* VNC canvas area */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden bg-black">
        {/* noVNC appends its canvas element into this div.
            Always in the DOM so noVNC can measure dimensions during the
            handshake — hiding it prevents scaleViewport from working. */}
        <div ref={canvasRef} className="absolute inset-0 overflow-hidden" />

        {/* Overlay for non-connected states — sits above the (empty) canvas */}
        {!isConnected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            {status === 'error' ? (
              <div className="max-w-sm text-center">
                <div className="mb-3 text-[32px] opacity-60">✕</div>
                <p className="mb-2 text-[13px] font-semibold text-[#f48771]">Connection Error</p>
                <p className="mb-4 text-[12px] text-[#858585]">{statusMsg}</p>
                <button
                  className="rounded-sm bg-[#007acc] px-4 py-1.5 text-[12px] text-white hover:bg-[#0069ac]"
                  onClick={handleReconnect}
                >
                  Try Again
                </button>
              </div>
            ) : status === 'connecting' ? (
              <div className="text-center">
                <p className="text-[13px] text-[#858585] animate-pulse">
                  Connecting to{' '}
                  <span className="text-[#cccccc]">{profile?.host ?? '…'}</span>
                </p>
                <p className="mt-1 text-[11px] text-[#6d6d6d]">Establishing VNC session…</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-[13px] text-[#858585]">Session ended.</p>
                <button
                  className="mt-3 rounded-sm border border-[#3e3e42] px-4 py-1.5 text-[12px] text-[#858585] hover:border-[#6d6d6d] hover:text-[#cccccc]"
                  onClick={handleReconnect}
                >
                  Reconnect
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex h-[22px] shrink-0 items-center border-t border-[#3e3e42] bg-[#252526] px-3">
        <StatusDot status={status} />
        <span className="ml-2 truncate text-[11px] text-[#858585]">{statusText || 'Idle'}</span>
      </div>
    </div>
  )
}
