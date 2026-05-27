import { useState, useEffect } from 'react'
import { ipc } from '../../lib/ipc'

// -webkit-app-region isn't in React's CSSProperties; cast through it.
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

interface MenuItemDef {
  label?: string
  accel?: string
  onClick?: () => void
  sep?: boolean
}

function MenuButton({ label, items }: { label: string; items: MenuItemDef[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative" style={NO_DRAG}>
      <button
        className={`rounded-sm px-2 py-0.5 text-[12px] ${open ? 'bg-white/10 text-[#cccccc]' : 'text-[#bbbbbb] hover:bg-white/[0.07]'}`}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-0.5 min-w-[210px] overflow-hidden rounded-sm border border-[#454545] bg-[#252526] py-1 shadow-2xl">
            {items.map((it, i) =>
              it.sep ? (
                <div key={i} className="my-1 h-px bg-[#454545]" />
              ) : (
                <button
                  key={i}
                  className="flex w-full items-center justify-between gap-8 px-3 py-[3px] text-left text-[13px] text-[#cccccc] hover:bg-[#094771]"
                  onClick={() => { setOpen(false); it.onClick?.() }}
                >
                  <span>{it.label}</span>
                  {it.accel && <span className="text-[11px] text-[#858585]">{it.accel}</span>}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  )
}

function WinBtn({ title, onClick, danger, children }: {
  title: string; onClick: () => void; danger?: boolean; children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-[30px] w-[46px] items-center justify-center text-[#cccccc] transition-colors ${
        danger ? 'hover:bg-[#e81123] hover:text-white' : 'hover:bg-white/[0.08]'
      }`}
    >
      {children}
    </button>
  )
}

export function TitleBar({
  onNewLocalTerminal, onExport, onImport, onConnectionHistory, onAbout,
}: {
  onNewLocalTerminal: () => void
  onExport: () => void
  onImport: () => void
  onConnectionHistory: () => void
  onAbout: () => void
}) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    ipc.window.isMaximized().then((r) => setMaximized(r.value)).catch(() => {})
    return ipc.window.onMaximizeState((m) => setMaximized(m))
  }, [])

  return (
    <div className="relative flex h-[30px] shrink-0 items-center border-b border-[#3e3e42] bg-[#2d2d2d] pl-2" style={DRAG}>
      {/* App mark */}
      <div className="mr-2 flex items-center" style={NO_DRAG}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 2.2 L19.5 5 V12 Q19.5 17.2 12 20.8 Q4.5 17.2 4.5 12 V5 Z" fill="#007acc" />
          <path d="M10 8.5 L13.2 11.7 L10 14.9" fill="none" stroke="#ffffff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Menus */}
      <div className="flex items-center gap-0.5" style={NO_DRAG}>
        <MenuButton
          label="File"
          items={[
            { label: 'New Local Terminal', accel: 'Ctrl+Shift+T', onClick: onNewLocalTerminal },
            { label: 'Export Profiles…', accel: 'Ctrl+Shift+E', onClick: onExport },
            { label: 'Import Profiles…', accel: 'Ctrl+Shift+I', onClick: onImport },
            { sep: true },
            { label: 'Quit', onClick: () => ipc.window.close() },
          ]}
        />
        <MenuButton
          label="View"
          items={[
            { label: 'Connection History', accel: 'Ctrl+Shift+H', onClick: onConnectionHistory },
            { sep: true },
            { label: 'Reload', onClick: () => ipc.window.reload() },
            { label: 'Toggle Full Screen', onClick: () => ipc.window.toggleFullScreen() },
            { label: 'Toggle Developer Tools', onClick: () => ipc.window.toggleDevTools() },
          ]}
        />
        <MenuButton
          label="Help"
          items={[
            { label: 'About Remote Commander', onClick: onAbout },
          ]}
        />
      </div>

      {/* Centered title (non-interactive so the drag region works through it) */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[12px] text-[#9d9d9d]">
        Remote Commander
      </div>

      <div className="flex-1" />

      {/* Window controls */}
      <div className="flex items-center" style={NO_DRAG}>
        <WinBtn title="Minimize" onClick={() => ipc.window.minimize()}>
          <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1"><line x1="1" y1="6" x2="10" y2="6" /></svg>
        </WinBtn>
        <WinBtn title={maximized ? 'Restore' : 'Maximize'} onClick={() => ipc.window.toggleMaximize()}>
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="1.5" y="3" width="6" height="6" /><path d="M3 3V1.5h6.5V8H8" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1"><rect x="1.5" y="1.5" width="8" height="8" /></svg>
          )}
        </WinBtn>
        <WinBtn title="Close" danger onClick={() => ipc.window.close()}>
          <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" /></svg>
        </WinBtn>
      </div>
    </div>
  )
}
