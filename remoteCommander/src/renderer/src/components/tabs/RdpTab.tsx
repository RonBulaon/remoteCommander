import { useEffect, useRef, useState, useCallback } from 'react'
import Guacamole, { GuacClient, GuacKeyboard } from 'guacamole-common-js'
import { useTabStore, Tab } from '../../store/tabStore'
import { useProfileStore } from '../../store/profileStore'
import { ipc } from '../../lib/ipc'

// ── Types ─────────────────────────────────────────────────────────────────

type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'external'

// Guacamole.Client state codes
const GUAC_STATE = { IDLE: 0, CONNECTING: 1, WAITING: 2, CONNECTED: 3, DISCONNECTING: 4, DISCONNECTED: 5 }

// X11 keysyms for Ctrl+Alt+Del
const KEY = { CTRL: 0xffe3, ALT: 0xffe9, DEL: 0xffff }

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
        disabled ? 'cursor-not-allowed text-[#454545]' : 'text-[#858585] hover:bg-white/[0.07] hover:text-[#cccccc]',
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
    status === 'external'   ? 'bg-[#569cd6]' :
    'bg-[#6d6d6d]'
  return <div className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
}

function PasswordDialog({
  host, onSubmit, onCancel,
}: { host: string; onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState('')
  return (
    <div className="flex flex-1 items-center justify-center bg-[#1e1e1e]">
      <div className="w-[320px] rounded border border-[#454545] bg-[#252526] shadow-2xl">
        <div className="border-b border-[#3e3e42] px-4 py-3">
          <p className="text-[13px] font-semibold text-[#cccccc]">Password Required</p>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-[12px] text-[#858585]">
            Enter the RDP password for <span className="text-[#cccccc]">{host}</span>.
          </p>
          <input
            className="w-full rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1.5 text-[13px] text-[#cccccc] outline-none focus:border-[#007acc]"
            type="password"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && pw) onSubmit(pw) }}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-[#3e3e42] px-4 py-3">
          <button className="rounded-sm border border-[#3e3e42] px-3 py-1.5 text-[12px] text-[#858585] hover:text-[#cccccc]" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded-sm bg-[#007acc] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#0069ac] disabled:opacity-50"
            disabled={!pw}
            onClick={() => onSubmit(pw)}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}

// ── RdpTab ────────────────────────────────────────────────────────────────

export function RdpTab({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const displayRef    = useRef<HTMLDivElement>(null)
  const clientRef     = useRef<GuacClient | null>(null)
  const keyboardRef   = useRef<GuacKeyboard | null>(null)
  const sessionIdRef  = useRef<string | null>(null)
  const cleanupRef    = useRef<(() => void) | null>(null)
  const resizeTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 'guac' = retry the in-tab path after a password; 'external' = retry the window
  const resumeModeRef = useRef<'guac' | 'external'>('guac')

  const [status, setStatus]                 = useState<SessionStatus>('idle')
  const [statusMsg, setStatusMsg]           = useState('')
  const [needsPassword, setNeedsPassword]   = useState(false)
  const [passwordOverride, setPasswordOverride] = useState<string | undefined>(undefined)
  const [reconnectTick, setReconnectTick]   = useState(0)

  const { setTabStatus } = useTabStore()
  const { profiles }     = useProfileStore()
  const profile = tab.profileId ? profiles.find((p) => p.id === tab.profileId) : undefined

  // Fit the remote display into the available area.
  const scaleToFit = useCallback(() => {
    const client = clientRef.current
    const area = displayRef.current
    if (!client || !area) return
    const display = client.getDisplay()
    const dw = display.getWidth()
    const dh = display.getHeight()
    if (!dw || !dh) return
    display.scale(Math.min(area.clientWidth / dw, area.clientHeight / dh))
  }, [])

  // ── Connect (in-tab via guacd) ─────────────────────────────────────────────
  useEffect(() => {
    if (!tab.profileId || needsPassword) return

    cleanupRef.current?.()
    cleanupRef.current = null

    setStatus('connecting')
    setStatusMsg('Connecting…')
    setTabStatus(tab.id, 'connecting')

    let cancelled = false
    let client: GuacClient | null = null
    let keyboard: GuacKeyboard | null = null

    ;(async () => {
      const area = displayRef.current
      const width = Math.max(640, area?.clientWidth ?? 1024)
      const height = Math.max(480, area?.clientHeight ?? 768)

      const result = await ipc.rdp.guacConnect({ profileId: tab.profileId!, password: passwordOverride, width, height })
      if (cancelled) return

      if ('needsPassword' in result) {
        resumeModeRef.current = 'guac'
        setNeedsPassword(true)
        setStatus('idle'); setStatusMsg('')
        setTabStatus(tab.id, 'disconnected')
        return
      }
      if ('error' in result) {
        setStatus('error'); setStatusMsg(result.error)
        setTabStatus(tab.id, 'disconnected')
        return
      }

      sessionIdRef.current = result.sessionId
      try {
        const tunnel = new Guacamole.WebSocketTunnel(`ws://127.0.0.1:${result.wsPort}`)
        client = new Guacamole.Client(tunnel)
        clientRef.current = client

        const displayEl = client.getDisplay().getElement()
        if (area) { area.innerHTML = ''; area.appendChild(displayEl) }

        client.onstatechange = (state) => {
          if (cancelled) return
          if (state === GUAC_STATE.CONNECTED) {
            setStatus('connected')
            setStatusMsg(`Connected — ${profile?.host ?? ''}:${profile?.port ?? 3389}`)
            setTabStatus(tab.id, 'connected')
            scaleToFit()
          } else if (state === GUAC_STATE.DISCONNECTED) {
            setStatus('disconnected'); setStatusMsg('Disconnected')
            setTabStatus(tab.id, 'disconnected')
          }
        }
        client.onerror = (err) => {
          if (cancelled) return
          setStatus('error')
          setStatusMsg(err.message || 'RDP connection error')
          setTabStatus(tab.id, 'disconnected')
        }

        // Input: mouse on the display element, keyboard on the focusable area.
        const mouse = new Guacamole.Mouse(displayEl)
        mouse.onEach(['mousedown', 'mousemove', 'mouseup'], (e) => client!.sendMouseState(e.state, true))

        keyboard = new Guacamole.Keyboard(area ?? document)
        keyboard.onkeydown = (sym) => client!.sendKeyEvent(1, sym)
        keyboard.onkeyup = (sym) => client!.sendKeyEvent(0, sym)
        keyboardRef.current = keyboard

        client.connect(`token=${encodeURIComponent(result.token)}`)
        area?.focus()
      } catch (err) {
        if (!cancelled) { setStatus('error'); setStatusMsg(String(err)); setTabStatus(tab.id, 'disconnected') }
      }
    })()

    cleanupRef.current = () => {
      cancelled = true
      if (keyboard) { keyboard.onkeydown = null; keyboard.onkeyup = null; try { keyboard.reset() } catch { /* */ } }
      if (client) { try { client.disconnect() } catch { /* */ } }
      clientRef.current = null
      keyboardRef.current = null
      if (sessionIdRef.current) { ipc.rdp.guacDisconnect(sessionIdRef.current).catch(() => {}); sessionIdRef.current = null }
    }

    return () => { cancelled = true }
  }, [tab.profileId, reconnectTick, passwordOverride]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { cleanupRef.current?.() }, [])

  // ── Resize: match remote display + rescale ─────────────────────────────────
  useEffect(() => {
    const area = displayRef.current
    if (!area) return
    const obs = new ResizeObserver(() => {
      scaleToFit()
      if (resizeTimer.current) clearTimeout(resizeTimer.current)
      resizeTimer.current = setTimeout(() => {
        if (clientRef.current && status === 'connected') {
          clientRef.current.sendSize(Math.max(640, area.clientWidth), Math.max(480, area.clientHeight))
        }
      }, 400)
    })
    obs.observe(area)
    return () => { obs.disconnect(); if (resizeTimer.current) clearTimeout(resizeTimer.current) }
  }, [scaleToFit, status])

  // Refocus the display when the tab becomes active so keystrokes are captured.
  useEffect(() => { if (isActive && status === 'connected') displayRef.current?.focus() }, [isActive, status])

  // ── External FreeRDP window (fallback) ─────────────────────────────────────
  const launchExternal = useCallback(async (pw?: string) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setStatus('connecting'); setStatusMsg('Launching external FreeRDP window…')
    const detect = await ipc.rdp.detectBinary()
    if (!detect.path) {
      setStatus('error')
      setStatusMsg('FreeRDP not found. Install xfreerdp (e.g. "sudo apt install freerdp2-x11").')
      return
    }
    const r = await ipc.rdp.connect({ profileId: tab.profileId!, password: pw ?? passwordOverride })
    if ('needsPassword' in r) { resumeModeRef.current = 'external'; setNeedsPassword(true); setStatus('idle'); return }
    if ('error' in r) { setStatus('error'); setStatusMsg(r.error); return }
    sessionIdRef.current = r.sessionId
    setStatus('external'); setStatusMsg('Running in an external FreeRDP window.')
    setTabStatus(tab.id, 'connected')
  }, [tab.profileId, tab.id, passwordOverride, setTabStatus])

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleDisconnect = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (sessionIdRef.current && status === 'external') {
      ipc.rdp.disconnect(sessionIdRef.current).catch(() => {})
      sessionIdRef.current = null
    }
    setStatus('disconnected'); setStatusMsg('Disconnected')
    setTabStatus(tab.id, 'disconnected')
  }, [tab.id, status, setTabStatus])

  const handleReconnect = useCallback(() => {
    setNeedsPassword(false)
    cleanupRef.current?.()
    cleanupRef.current = null
    setReconnectTick((t) => t + 1)
  }, [])

  const handlePasswordSubmit = useCallback((pw: string) => {
    setNeedsPassword(false)
    setPasswordOverride(pw)
    if (resumeModeRef.current === 'external') launchExternal(pw)
    else setReconnectTick((t) => t + 1)
  }, [launchExternal])

  const sendCtrlAltDel = useCallback(() => {
    const c = clientRef.current
    if (!c) return
    for (const k of [KEY.CTRL, KEY.ALT, KEY.DEL]) c.sendKeyEvent(1, k)
    for (const k of [KEY.DEL, KEY.ALT, KEY.CTRL]) c.sendKeyEvent(0, k)
  }, [])

  const isConnected = status === 'connected'

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
        <TBtn title="Send Ctrl+Alt+Del" onClick={sendCtrlAltDel} disabled={!isConnected}>
          <span className="text-[11px]">Ctrl+Alt+Del</span>
        </TBtn>
        <Sep />
        <TBtn title="Fit to window" onClick={scaleToFit} disabled={!isConnected}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M1 4.5V1H4.5M8.5 1H12V4.5M12 8.5V12H8.5M4.5 12H1V8.5"/>
          </svg>
        </TBtn>
        <div className="flex-1" />
        <TBtn title="Reconnect" onClick={handleReconnect} disabled={status === 'connecting'}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 2A5 5 0 1 0 11 6.5"/><path d="M11 0v3H8"/>
          </svg>
        </TBtn>
        <TBtn title="Disconnect" onClick={handleDisconnect} disabled={!isConnected && status !== 'external'}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8"/>
          </svg>
        </TBtn>
      </div>

      {/* Display area (guacamole canvas is appended here) */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden bg-black">
        <div
          ref={displayRef}
          tabIndex={0}
          className="absolute inset-0 flex items-center justify-center overflow-hidden outline-none"
        />

        {/* Overlays for non-connected states */}
        {status !== 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/95">
            {status === 'error' ? (
              <div className="max-w-md text-center">
                <div className="mb-3 text-[32px] opacity-60">✕</div>
                <p className="mb-2 text-[13px] font-semibold text-[#f48771]">Connection Error</p>
                <p className="mb-4 text-[12px] text-[#858585]">{statusMsg}</p>
                <div className="flex justify-center gap-2">
                  <button className="rounded-sm bg-[#007acc] px-4 py-1.5 text-[12px] text-white hover:bg-[#0069ac]" onClick={handleReconnect}>
                    Try Again
                  </button>
                  <button className="rounded-sm border border-[#3e3e42] px-4 py-1.5 text-[12px] text-[#cccccc] hover:border-[#6d6d6d]" onClick={() => launchExternal()}>
                    Open in external window
                  </button>
                </div>
              </div>
            ) : status === 'connecting' ? (
              <div className="text-center">
                <p className="text-[13px] text-[#858585] animate-pulse">
                  Connecting to <span className="text-[#cccccc]">{profile?.host ?? '…'}</span>
                </p>
                <p className="mt-1 text-[11px] text-[#6d6d6d]">{statusMsg}</p>
              </div>
            ) : status === 'external' ? (
              <div className="text-center">
                <div className="mb-4 text-[40px] opacity-20">🖥</div>
                <p className="text-[13px] text-[#cccccc]">RDP session is running in an external FreeRDP window.</p>
                <p className="mt-1 text-[12px] text-[#858585]">guacd wasn’t available, so the session opened outside the app.</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-[13px] text-[#858585]">Session ended.</p>
                <button className="mt-3 rounded-sm border border-[#3e3e42] px-4 py-1.5 text-[12px] text-[#858585] hover:border-[#6d6d6d] hover:text-[#cccccc]" onClick={handleReconnect}>
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
        <span className="ml-2 truncate text-[11px] text-[#858585]">{statusMsg || 'Idle'}</span>
      </div>
    </div>
  )
}
