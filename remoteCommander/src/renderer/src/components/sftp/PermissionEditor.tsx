import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

interface Props {
  open: boolean
  path: string
  currentMode: number
  onSave: (mode: number) => Promise<void>
  onClose: () => void
}

const BITS = [
  { label: 'Read',    owner: 0o400, group: 0o040, other: 0o004 },
  { label: 'Write',   owner: 0o200, group: 0o020, other: 0o002 },
  { label: 'Execute', owner: 0o100, group: 0o010, other: 0o001 },
]

export function PermissionEditor({ open, path, currentMode, onSave, onClose }: Props) {
  const [mode, setMode] = useState(currentMode & 0o777)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMode(currentMode & 0o777)
      setError(null)
    }
  }, [open, currentMode])

  const toggle = (bit: number) => setMode((m) => m ^ bit)

  const octal = mode.toString(8).padStart(3, '0')

  const handleOctalInput = (val: string) => {
    const n = parseInt(val, 8)
    if (!isNaN(n) && n >= 0 && n <= 0o777) setMode(n)
  }

  const handleSave = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave(mode)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const Checkbox = ({ bit }: { bit: number }) => (
    <button
      type="button"
      onClick={() => toggle(bit)}
      className={[
        'flex h-5 w-5 items-center justify-center rounded-sm border transition-colors',
        mode & bit
          ? 'border-[#007acc] bg-[#007acc] text-white'
          : 'border-[#454545] bg-[#3c3c3c] text-transparent',
      ].join(' ')}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M1.5 5l2.5 3 4.5-6" />
      </svg>
    </button>
  )

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2 rounded border border-[#454545] bg-[#252526] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#3e3e42] px-4 py-3">
            <Dialog.Title className="text-[13px] font-semibold text-[#cccccc]">
              Permissions
            </Dialog.Title>
            <Dialog.Close className="rounded-sm p-0.5 text-[#858585] hover:bg-white/10 hover:text-[#cccccc]">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l10 10M12 2L2 12" />
              </svg>
            </Dialog.Close>
          </div>

          <div className="px-4 py-4">
            <p className="mb-4 truncate text-[11px] text-[#858585]">{path}</p>

            {/* Grid */}
            <table className="w-full text-[12px] text-[#cccccc]">
              <thead>
                <tr>
                  <th className="pb-2 text-left font-normal text-[#858585]" />
                  <th className="pb-2 text-center font-normal text-[#858585]">Owner</th>
                  <th className="pb-2 text-center font-normal text-[#858585]">Group</th>
                  <th className="pb-2 text-center font-normal text-[#858585]">Other</th>
                </tr>
              </thead>
              <tbody>
                {BITS.map(({ label, owner, group, other }) => (
                  <tr key={label}>
                    <td className="py-1.5 pr-4 text-[#bbbbbb]">{label}</td>
                    <td className="py-1.5 text-center"><Checkbox bit={owner} /></td>
                    <td className="py-1.5 text-center"><Checkbox bit={group} /></td>
                    <td className="py-1.5 text-center"><Checkbox bit={other} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Octal input */}
            <div className="mt-4 flex items-center gap-3">
              <span className="text-[12px] text-[#858585]">Octal</span>
              <input
                className="w-20 rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1 text-center font-mono text-[13px] text-[#cccccc] outline-none focus:border-[#007acc]"
                value={octal}
                onChange={(e) => handleOctalInput(e.target.value)}
                maxLength={3}
              />
              <span className="font-mono text-[12px] text-[#858585]">
                ({['owner', 'group', 'other'].map((_, i) => {
                  const shift = (2 - i) * 3
                  const bits = (mode >> shift) & 7
                  return (bits & 4 ? 'r' : '-') + (bits & 2 ? 'w' : '-') + (bits & 1 ? 'x' : '-')
                }).join('')})
              </span>
            </div>

            {error && <p className="mt-3 text-[12px] text-[#f48771]">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-[#3e3e42] px-4 py-3">
            <Dialog.Close asChild>
              <button className="rounded-sm border border-[#3e3e42] px-3 py-1.5 text-[12px] text-[#858585] hover:border-[#6d6d6d] hover:text-[#cccccc]">
                Cancel
              </button>
            </Dialog.Close>
            <button
              className="rounded-sm bg-[#007acc] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#0069ac] disabled:opacity-50"
              onClick={handleSave}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
