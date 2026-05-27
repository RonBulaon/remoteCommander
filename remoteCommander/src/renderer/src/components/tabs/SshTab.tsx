import 'xterm/css/xterm.css'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useTabStore, Tab } from '../../store/tabStore'
import { useProfileStore } from '../../store/profileStore'
import { ipc } from '../../lib/ipc'

// ── Types ─────────────────────────────────────────────────────────────────

type SessionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

// ── xterm theme (VS Code dark) ────────────────────────────────────────────

const DARK_THEME = {
  background:        '#1e1e1e',
  foreground:        '#d4d4d4',
  cursor:            '#aeafad',
  cursorAccent:      '#1e1e1e',
  selectionBackground: '#264f78',
  black:             '#1e1e1e', brightBlack:   '#808080',
  red:               '#f44747', brightRed:     '#f44747',
  green:             '#6a9955', brightGreen:   '#b5cea8',
  yellow:            '#d7ba7d', brightYellow:  '#dcdcaa',
  blue:              '#569cd6', brightBlue:    '#9cdcfe',
  magenta:           '#c586c0', brightMagenta: '#c586c0',
  cyan:              '#4ec9b0', brightCyan:    '#4fc1ff',
  white:             '#d4d4d4', brightWhite:   '#ffffff',
}

// ── Toolbar helpers ───────────────────────────────────────────────────────

function TBtn({
  title, onClick, disabled, active, children,
}: {
  title: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode
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
          : active
            ? 'bg-[#007acc]/20 text-[#cccccc]'
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

// ── SshTab ────────────────────────────────────────────────────────────────

export function SshTab({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<Terminal | null>(null)
  const fitRef       = useRef<FitAddon | null>(null)
  const searchRef    = useRef<SearchAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  // cleanup function for the current IPC subscriptions + disconnect
  const sessionCleanupRef = useRef<(() => void) | null>(null)
  // incrementing this triggers a reconnect via useEffect deps
  const [reconnectTick, setReconnectTick] = useState(0)

  const [status, setStatus]               = useState<SessionStatus>('idle')
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchQuery, setSearchQuery]     = useState('')

  const { setTabStatus } = useTabStore()
  const profile = useProfileStore((s) => s.profiles.find((p) => p.id === tab.profileId))

  // ── Terminal lifecycle (once per tab) ──────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme:           DARK_THEME,
      fontFamily:      '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      fontSize:        13,
      lineHeight:      1.2,
      cursorBlink:     true,
      allowTransparency: false,
      scrollback:      3000,
    })

    const fit    = new FitAddon()
    const search = new SearchAddon()
    const links  = new WebLinksAddon()

    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(links)
    term.open(containerRef.current)
    try { fit.fit() } catch { /* 0×0 on first render with display:none — ok */ }

    termRef.current   = term
    fitRef.current    = fit
    searchRef.current = search

    // Forward user keystrokes to SSH shell
    const inputDispose = term.onData((data) => {
      if (sessionIdRef.current) ipc.ssh.send(sessionIdRef.current, data)
    })

    // Ctrl+Shift+C — copy; Ctrl+Shift+V — paste
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        const sel = term.getSelection()
        if (sel) navigator.clipboard.writeText(sel).catch(() => {})
        return false
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        navigator.clipboard.readText()
          .then((text) => { if (sessionIdRef.current) ipc.ssh.send(sessionIdRef.current, text) })
          .catch(() => {})
        return false
      }
      return true
    })

    return () => {
      inputDispose.dispose()
      sessionCleanupRef.current?.()
      sessionCleanupRef.current = null
      term.dispose()
      termRef.current   = null
      fitRef.current    = null
      searchRef.current = null
      sessionIdRef.current = null
    }
  }, [tab.id]) // re-mount only if the tab identity changes

  // ── Connect / reconnect ────────────────────────────────────────────────

  useEffect(() => {
    const term = termRef.current
    if (!term || !tab.profileId) return

    // Tear down the previous session before starting a new one
    sessionCleanupRef.current?.()
    sessionCleanupRef.current = null
    sessionIdRef.current = null

    let cancelled = false
    setStatus('connecting')
    setTabStatus(tab.id, 'connecting')

    ipc.ssh.connect(tab.profileId)
      .then((res) => {
        if (cancelled) return
        if ('error' in res) {
          setStatus('error')
          setTabStatus(tab.id, 'disconnected')
          term.writeln(`\r\n\x1b[31mConnection failed: ${res.error}\x1b[0m`)
          return
        }

        const { sessionId } = res
        sessionIdRef.current = sessionId

        // connect() resolves only after the shell is open, so we're already connected
        setStatus('connected')
        setTabStatus(tab.id, 'connected')

        const unsubData = ipc.ssh.onData(sessionId, (raw) => {
          termRef.current?.write(raw as string)
        })

        const unsubStatus = ipc.ssh.onStatus(sessionId, (st) => {
          const s = st as string
          if (s === 'connected') {
            setStatus('connected')
            setTabStatus(tab.id, 'connected')
          } else if (s === 'reconnecting') {
            setStatus('reconnecting')
            setTabStatus(tab.id, 'connecting')
            termRef.current?.writeln('\r\n\x1b[33mConnection lost — reconnecting...\x1b[0m')
          } else {
            setStatus('disconnected')
            setTabStatus(tab.id, 'disconnected')
          }
        })

        sessionCleanupRef.current = () => {
          unsubData()
          unsubStatus()
          const sid = sessionIdRef.current
          if (sid) ipc.ssh.disconnect(sid)
          sessionIdRef.current = null
        }
      })
      .catch((err) => {
        if (cancelled) return
        setStatus('error')
        setTabStatus(tab.id, 'disconnected')
        term.writeln(`\r\n\x1b[31mError: ${String(err)}\x1b[0m`)
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.profileId, reconnectTick])

  // ── Fit terminal when tab becomes visible ──────────────────────────────

  useEffect(() => {
    if (!isActive) return
    // After display:none → flex transition, wait one frame for layout to settle
    requestAnimationFrame(() => {
      const fit  = fitRef.current
      const term = termRef.current
      if (!fit || !term) return
      try {
        fit.fit()
        if (sessionIdRef.current) {
          ipc.ssh.resize(sessionIdRef.current, term.cols, term.rows)
        }
      } catch { /* terminal may be disposed */ }
    })
  }, [isActive])

  // ── ResizeObserver — pane / window resize ──────────────────────────────

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      const fit  = fitRef.current
      const term = termRef.current
      if (!fit || !term) return
      try {
        fit.fit()
        if (sessionIdRef.current) {
          ipc.ssh.resize(sessionIdRef.current, term.cols, term.rows)
        }
      } catch { /* terminal disposed */ }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [tab.id])

  // ── Toolbar handlers ───────────────────────────────────────────────────

  const handleReconnect = useCallback(() => {
    termRef.current?.clear()
    setReconnectTick((n) => n + 1)
  }, [])

  const handleDisconnect = useCallback(() => {
    sessionCleanupRef.current?.()
    sessionCleanupRef.current = null
    setStatus('disconnected')
    setTabStatus(tab.id, 'disconnected')
  }, [tab.id, setTabStatus])

  const handleClear = useCallback(() => { termRef.current?.clear() }, [])

  const handleCopy = useCallback(() => {
    const sel = termRef.current?.getSelection()
    if (sel) navigator.clipboard.writeText(sel).catch(() => {})
  }, [])

  const handlePaste = useCallback(() => {
    navigator.clipboard.readText()
      .then((text) => { if (sessionIdRef.current) ipc.ssh.send(sessionIdRef.current, text) })
      .catch(() => {})
  }, [])

  const handleSearchNext = useCallback(() => {
    if (searchQuery) searchRef.current?.findNext(searchQuery, { incremental: false })
  }, [searchQuery])

  const handleSearchPrev = useCallback(() => {
    if (searchQuery) searchRef.current?.findPrevious(searchQuery, { incremental: false })
  }, [searchQuery])

  // ── Status bar ─────────────────────────────────────────────────────────

  const statusText =
    status === 'connecting'   ? 'Connecting...'
    : status === 'reconnecting' ? 'Reconnecting...'
    : status === 'connected'    ? (profile ? `Connected — ${profile.host}:${profile.port} — ${profile.username}` : 'Connected')
    : status === 'disconnected' ? 'Disconnected'
    : status === 'error'        ? 'Connection failed'
    : ''

  const statusColor =
    status === 'connected'                         ? '#4ec9b0'
    : status === 'connecting' || status === 'reconnecting' ? '#dcdcaa'
    : status === 'disconnected' || status === 'error'      ? '#f44747'
    : '#858585'

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-[#3e3e42] bg-[#252526] px-2">
        <TBtn
          title="Reconnect"
          onClick={handleReconnect}
          disabled={status === 'connecting' || status === 'reconnecting'}
        >
          {/* circular arrow */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-3.36"/>
          </svg>
        </TBtn>

        <TBtn
          title="Disconnect"
          onClick={handleDisconnect}
          disabled={status !== 'connected' && status !== 'reconnecting'}
        >
          {/* power-off */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
            <line x1="12" y1="2" x2="12" y2="12"/>
          </svg>
        </TBtn>

        <Sep />

        <TBtn title="Clear terminal" onClick={handleClear}>
          {/* eraser */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 20 9 20 4.586 15.586 12.172 8 20 15.828"/>
            <line x1="4" y1="20" x2="20" y2="20"/>
          </svg>
        </TBtn>

        <TBtn
          title="Toggle search (Ctrl+Shift+F)"
          onClick={() => setSearchVisible((v) => !v)}
          active={searchVisible}
        >
          {/* magnifying glass */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </TBtn>

        <Sep />

        <TBtn title="Copy selection (Ctrl+Shift+C)" onClick={handleCopy}>
          {/* copy */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </TBtn>

        <TBtn title="Paste from clipboard (Ctrl+Shift+V)" onClick={handlePaste}>
          {/* clipboard */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1"/>
          </svg>
        </TBtn>
      </div>

      {/* ── Terminal area ── */}
      <div className="relative flex-1 overflow-hidden">
        {/* Search bar */}
        {searchVisible && (
          <div className="absolute right-2 top-1.5 z-10 flex items-center gap-1 rounded-sm border border-[#454545] bg-[#252526] px-2 py-1 shadow-lg">
            <input
              autoFocus
              className="w-44 rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-0.5 text-[12px] text-[#cccccc] outline-none focus:border-[#007acc]"
              placeholder="Find in terminal…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.shiftKey ? handleSearchPrev() : handleSearchNext() }
                if (e.key === 'Escape') setSearchVisible(false)
              }}
            />
            <TBtn title="Previous (Shift+Enter)" onClick={handleSearchPrev}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 7l3-4 3 4"/></svg>
            </TBtn>
            <TBtn title="Next (Enter)" onClick={handleSearchNext}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3l3 4 3-4"/></svg>
            </TBtn>
            <TBtn title="Close" onClick={() => setSearchVisible(false)}>
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l7 7M8 1L1 8"/></svg>
            </TBtn>
          </div>
        )}

        {/* xterm.js mount point — fills the area */}
        <div ref={containerRef} className="h-full w-full" style={{ padding: '2px 4px 0' }} />
      </div>

      {/* ── Status bar ── */}
      <div className="flex h-[22px] shrink-0 items-center gap-2 border-t border-[#3e3e42] bg-[#1a1a1a] px-3">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: status === 'idle' ? '#3e3e42' : statusColor }}
        />
        <span className="text-[11px]" style={{ color: statusColor }}>
          {statusText}
        </span>
      </div>
    </div>
  )
}
