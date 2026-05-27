import 'xterm/css/xterm.css'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useTabStore, Tab } from '../../store/tabStore'
import { ipc } from '../../lib/ipc'

type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

const DARK_THEME = {
  background:        '#1e1e1e',
  foreground:        '#d4d4d4',
  cursor:            '#aeafad',
  cursorAccent:      '#1e1e1e',
  selectionBackground: '#264f78',
  black:   '#1e1e1e', brightBlack:   '#808080',
  red:     '#f44747', brightRed:     '#f44747',
  green:   '#6a9955', brightGreen:   '#b5cea8',
  yellow:  '#d7ba7d', brightYellow:  '#dcdcaa',
  blue:    '#569cd6', brightBlue:    '#9cdcfe',
  magenta: '#c586c0', brightMagenta: '#c586c0',
  cyan:    '#4ec9b0', brightCyan:    '#4fc1ff',
  white:   '#d4d4d4', brightWhite:   '#ffffff',
}

function TBtn({ title, onClick, disabled, children }: {
  title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex h-6 min-w-[24px] items-center justify-center rounded-sm px-1 transition-colors',
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

export function LocalTerminalTab({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<Terminal | null>(null)
  const fitRef       = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const sessionCleanupRef = useRef<(() => void) | null>(null)
  const [reconnectTick, setReconnectTick] = useState(0)
  const [status, setStatus] = useState<SessionStatus>('idle')

  const { setTabStatus } = useTabStore()

  // ── Terminal lifecycle (once per tab) ──────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: DARK_THEME,
      fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 3000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    try { fit.fit() } catch { /* 0×0 before layout */ }

    termRef.current = term
    fitRef.current = fit

    const inputDispose = term.onData((data) => {
      if (sessionIdRef.current) ipc.local.send(sessionIdRef.current, data)
    })

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        const sel = term.getSelection()
        if (sel) navigator.clipboard.writeText(sel).catch(() => {})
        return false
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        navigator.clipboard.readText()
          .then((t) => { if (sessionIdRef.current) ipc.local.send(sessionIdRef.current, t) })
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
      termRef.current = null
      fitRef.current = null
      sessionIdRef.current = null
    }
  }, [tab.id])

  // ── Connect / restart ──────────────────────────────────────────────────────
  useEffect(() => {
    const term = termRef.current
    if (!term) return

    sessionCleanupRef.current?.()
    sessionCleanupRef.current = null
    sessionIdRef.current = null

    let cancelled = false
    setStatus('connecting')
    setTabStatus(tab.id, 'connecting')
    try { fitRef.current?.fit() } catch { /* */ }

    ipc.local.connect(term.cols, term.rows)
      .then((res) => {
        if (cancelled) return
        if ('error' in res) {
          setStatus('error')
          setTabStatus(tab.id, 'disconnected')
          term.writeln(`\r\n\x1b[31mFailed to start shell: ${res.error}\x1b[0m`)
          return
        }
        const { sessionId } = res
        sessionIdRef.current = sessionId
        setStatus('connected')
        setTabStatus(tab.id, 'connected')

        const unsubData = ipc.local.onData(sessionId, (raw) => termRef.current?.write(raw as string))
        const unsubStatus = ipc.local.onStatus(sessionId, (st) => {
          if ((st as string) === 'disconnected') {
            setStatus('disconnected')
            setTabStatus(tab.id, 'disconnected')
            termRef.current?.writeln('\r\n\x1b[90m[process exited — press Restart]\x1b[0m')
          }
        })

        sessionCleanupRef.current = () => {
          unsubData(); unsubStatus()
          if (sessionIdRef.current) ipc.local.disconnect(sessionIdRef.current)
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
  }, [tab.id, reconnectTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fit on activate ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return
    requestAnimationFrame(() => {
      const fit = fitRef.current, term = termRef.current
      if (!fit || !term) return
      try {
        fit.fit()
        if (sessionIdRef.current) ipc.local.resize(sessionIdRef.current, term.cols, term.rows)
      } catch { /* disposed */ }
    })
  }, [isActive])

  // ── ResizeObserver ─────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const obs = new ResizeObserver(() => {
      const fit = fitRef.current, term = termRef.current
      if (!fit || !term) return
      try {
        fit.fit()
        if (sessionIdRef.current) ipc.local.resize(sessionIdRef.current, term.cols, term.rows)
      } catch { /* disposed */ }
    })
    obs.observe(container)
    return () => obs.disconnect()
  }, [tab.id])

  const handleRestart = useCallback(() => { termRef.current?.clear(); setReconnectTick((n) => n + 1) }, [])
  const handleClear = useCallback(() => { termRef.current?.clear() }, [])
  const handleCopy = useCallback(() => {
    const sel = termRef.current?.getSelection()
    if (sel) navigator.clipboard.writeText(sel).catch(() => {})
  }, [])
  const handlePaste = useCallback(() => {
    navigator.clipboard.readText()
      .then((t) => { if (sessionIdRef.current) ipc.local.send(sessionIdRef.current, t) })
      .catch(() => {})
  }, [])

  const statusColor =
    status === 'connected'   ? '#4ec9b0' :
    status === 'connecting'  ? '#dcdcaa' :
    status === 'disconnected' || status === 'error' ? '#f44747' : '#858585'
  const statusText =
    status === 'connecting'  ? 'Starting shell…' :
    status === 'connected'   ? 'Local shell' :
    status === 'disconnected' ? 'Process exited' :
    status === 'error'       ? 'Failed to start' : ''

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-[#3e3e42] bg-[#252526] px-2">
        <TBtn title="Restart shell" onClick={handleRestart} disabled={status === 'connecting'}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/>
          </svg>
        </TBtn>
        <Sep />
        <TBtn title="Clear terminal" onClick={handleClear}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 20 9 20 4.586 15.586 12.172 8 20 15.828"/><line x1="4" y1="20" x2="20" y2="20"/>
          </svg>
        </TBtn>
        <TBtn title="Copy selection (Ctrl+Shift+C)" onClick={handleCopy}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </TBtn>
        <TBtn title="Paste (Ctrl+Shift+V)" onClick={handlePaste}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>
          </svg>
        </TBtn>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div ref={containerRef} className="h-full w-full" style={{ padding: '2px 4px 0' }} />
      </div>

      <div className="flex h-[22px] shrink-0 items-center gap-2 border-t border-[#3e3e42] bg-[#1a1a1a] px-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: status === 'idle' ? '#3e3e42' : statusColor }} />
        <span className="text-[11px]" style={{ color: statusColor }}>{statusText}</span>
      </div>
    </div>
  )
}
