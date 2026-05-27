import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ipc } from '../lib/ipc'

const APP_VERSION = '0.1.0'
const REPO_URL = 'https://github.com/RonBulaon/remoteCommander'

// Runtime versions come straight from the preload-exposed process.versions —
// no IPC round-trip needed (see Versions.tsx for the same pattern).
function runtimeVersions(): { electron: string; chrome: string; node: string } {
  const v = window.electron?.process?.versions
  return { electron: v?.electron ?? '—', chrome: v?.chrome ?? '—', node: v?.node ?? '—' }
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [versions] = useState(runtimeVersions)

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded border border-[#454545] bg-[#252526] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#3e3e42] px-4 py-3">
            <Dialog.Title className="text-[13px] font-semibold text-[#cccccc]">About Remote Commander</Dialog.Title>
            <Dialog.Close className="rounded-sm p-0.5 text-[#858585] hover:bg-white/10 hover:text-[#cccccc]">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l10 10M12 2L2 12" />
              </svg>
            </Dialog.Close>
          </div>

          <div className="flex flex-col items-center gap-3 px-6 py-6">
            {/* App mark — secure shield + terminal prompt */}
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
              <defs>
                <linearGradient id="rcShield" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#1f9cf0" />
                  <stop offset="1" stopColor="#0069ac" />
                </linearGradient>
              </defs>
              <path d="M12 2 L20 5 V12 Q20 17.6 12 21.4 Q4 17.6 4 12 V5 Z" fill="url(#rcShield)" />
              <path d="M9.4 8.2 L12.6 11.6 L9.4 15" fill="none" stroke="#ffffff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="13.2" y="13.4" width="3.8" height="1.5" rx="0.75" fill="#ffffff" />
            </svg>

            <div className="text-center">
              <div className="text-[16px] font-semibold text-[#cccccc]">Remote Commander</div>
              <div className="text-[12px] text-[#858585]">Version {APP_VERSION}</div>
            </div>

            <p className="text-center text-[12px] leading-relaxed text-[#a0a0a0]">
              One window for every remote connection — SSH, SFTP, RDP, VNC, VPN,
              an embedded web console, and a remote file editor.
            </p>

            {/* Runtime versions */}
            <div className="grid w-full grid-cols-3 gap-2 rounded-sm border border-[#3e3e42] bg-[#1e1e1e] px-3 py-2 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#6d6d6d]">Electron</div>
                <div className="text-[12px] text-[#cccccc]">{versions.electron}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#6d6d6d]">Chromium</div>
                <div className="text-[12px] text-[#cccccc]">{versions.chrome}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#6d6d6d]">Node</div>
                <div className="text-[12px] text-[#cccccc]">{versions.node}</div>
              </div>
            </div>

            <div className="text-center text-[12px] text-[#858585]">
              <div>Created by <span className="text-[#cccccc]">Ron Bulaon</span></div>
              <div className="mt-0.5">© 2026 Ron Bulaon · MIT License</div>
            </div>

            <div className="flex gap-2">
              <button
                className="rounded-sm border border-[#3e3e42] px-3 py-1.5 text-[12px] text-[#cccccc] hover:border-[#6d6d6d] hover:bg-white/[0.06]"
                onClick={() => ipc.window.openExternal(REPO_URL)}
              >
                Project on GitHub
              </button>
              <button
                className="rounded-sm border border-[#3e3e42] px-3 py-1.5 text-[12px] text-[#cccccc] hover:border-[#6d6d6d] hover:bg-white/[0.06]"
                onClick={() => ipc.window.openExternal(`${REPO_URL}/blob/main/LICENSE`)}
              >
                License
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
