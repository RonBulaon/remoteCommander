import { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useProfileStore } from '../../store/profileStore'
import { useVpnStore } from '../../store/vpnStore'
import { ipc } from '../../lib/ipc'
import type { Profile, Protocol, AuthMethod } from '../../types/profile'

// ── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_PORTS: Record<Protocol, number> = {
  ssh: 22, sftp: 22, rdp: 3389, vnc: 5900, web: 443,
}

const PROTOCOLS: { value: Protocol; label: string }[] = [
  { value: 'ssh',  label: 'SSH'  },
  { value: 'sftp', label: 'SFTP' },
  { value: 'rdp',  label: 'RDP'  },
  { value: 'vnc',  label: 'VNC'  },
  { value: 'web',  label: 'Web Console' },
]

const AUTH_METHODS: { value: AuthMethod; label: string }[] = [
  { value: 'password', label: 'Password'  },
  { value: 'key',      label: 'SSH Key'   },
  { value: 'agent',    label: 'SSH Agent' },
]

// Parse a web-console URL, tolerating a missing scheme (defaults to https).
// Returns null unless the result is http/https.
function parseWebUrl(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(candidate)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

// ── Form state ────────────────────────────────────────────────────────────

interface FormState {
  name: string
  protocol: Protocol
  host: string
  port: string
  username: string
  authMethod: AuthMethod
  password: string
  privateKeyPath: string
  passphrase: string
  groupId: string
  newGroupName: string
  showNewGroup: boolean
  tagInput: string
  tags: string[]
  notes: string
  vpnProfileId: string
  showJumpHost: boolean
  jumpHost: { host: string; port: string; username: string }
  // RDP-specific
  rdpResolution: string
  rdpWidth: string
  rdpHeight: string
  rdpColorDepth: string
  rdpDomain: string
  rdpCertMode: string
  // VNC-specific
  vncDisplay: string
  vncPort: string
  vncEncoding: string
  // Web-specific
  webUrl: string
  webIgnoreCertErrors: boolean
  webProxy: string
}

function defaultForm(groups: { id: string }[]): FormState {
  return {
    name: '', protocol: 'ssh', host: '', port: '22',
    username: '', authMethod: 'password',
    password: '', privateKeyPath: '', passphrase: '',
    groupId: groups[0]?.id ?? '', newGroupName: '', showNewGroup: false,
    tagInput: '', tags: [], notes: '', vpnProfileId: '',
    showJumpHost: false,
    jumpHost: { host: '', port: '22', username: '' },
    rdpResolution: 'auto', rdpWidth: '1920', rdpHeight: '1080',
    rdpColorDepth: '32', rdpDomain: '', rdpCertMode: 'accept',
    vncDisplay: '0', vncPort: '', vncEncoding: 'tight',
    webUrl: '', webIgnoreCertErrors: false, webProxy: '',
  }
}

function profileToForm(p: Profile): FormState {
  return {
    name: p.name, protocol: p.protocol, host: p.host, port: String(p.port),
    username: p.username, authMethod: p.authMethod,
    password: '', privateKeyPath: p.privateKeyPath ?? '', passphrase: '',
    groupId: p.groupId, newGroupName: '', showNewGroup: false,
    tagInput: '', tags: [...p.tags], notes: p.notes, vpnProfileId: p.vpnProfileId ?? '',
    showJumpHost: !!p.jumpHost,
    jumpHost: {
      host: p.jumpHost?.host ?? '',
      port: String(p.jumpHost?.port ?? 22),
      username: p.jumpHost?.username ?? '',
    },
    rdpResolution: p.rdpResolution ?? 'auto',
    rdpWidth: String(p.rdpWidth ?? 1920),
    rdpHeight: String(p.rdpHeight ?? 1080),
    rdpColorDepth: String(p.rdpColorDepth ?? 32),
    rdpDomain: p.rdpDomain ?? '',
    rdpCertMode: p.rdpCertMode ?? 'accept',
    vncDisplay: String(p.vncDisplay ?? 0),
    vncPort: p.vncPort ? String(p.vncPort) : '',
    vncEncoding: p.vncEncoding ?? 'tight',
    webUrl: p.webUrl ?? '',
    webIgnoreCertErrors: p.webIgnoreCertErrors ?? false,
    webProxy: p.webProxy ?? '',
  }
}

// ── Shared input style ────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1.5 text-[13px] text-[#cccccc] outline-none placeholder:text-[#6d6d6d] focus:border-[#007acc]'

const selectCls =
  'w-full rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1.5 text-[13px] text-[#cccccc] outline-none focus:border-[#007acc]'

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[11px] font-medium text-[#bbbbbb]">{children}</label>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

// ── ProfileEditor ─────────────────────────────────────────────────────────

interface Props {
  /** 'new' = create mode; string = edit mode (profile ID); null = closed */
  editingId: string | 'new' | null
  onClose: () => void
}

export function ProfileEditor({ editingId, onClose }: Props) {
  const { groups, profiles, addProfile, updateProfile, addGroup } = useProfileStore()
  const vpnProfiles = useVpnStore((s) => s.profiles)
  const [form, setForm] = useState<FormState>(() => defaultForm(groups))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load profile into form when opening editor
  useEffect(() => {
    if (editingId === null) return
    if (editingId === 'new') {
      setForm(defaultForm(groups))
    } else {
      const p = profiles.find((x) => x.id === editingId)
      setForm(p ? profileToForm(p) : defaultForm(groups))
    }
    setError(null)
  }, [editingId]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val })), [])

  const setJH = useCallback(<K extends keyof FormState['jumpHost']>(key: K, val: string) =>
    setForm((f) => ({ ...f, jumpHost: { ...f.jumpHost, [key]: val } })), [])

  // ── Protocol change: update default port ───────────────────────────────
  const onProtocolChange = (proto: Protocol) => {
    setForm((f) => ({ ...f, protocol: proto, port: String(DEFAULT_PORTS[proto]) }))
  }

  // ── Tag chip helpers ───────────────────────────────────────────────────
  const addTag = () => {
    const t = form.tagInput.trim()
    if (t && !form.tags.includes(t)) {
      setForm((f) => ({ ...f, tags: [...f.tags, t], tagInput: '' }))
    } else {
      set('tagInput', '')
    }
  }

  const removeTag = (tag: string) =>
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }))

  // ── Private key file picker ────────────────────────────────────────────
  const browseKey = async () => {
    const res = await ipc.dialog.openFile({
      title: 'Select SSH Private Key',
      filters: [
        { name: 'Private Key', extensions: ['pem', 'key', 'ppk', 'rsa', 'ed25519', ''] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (res.filePath) set('privateKeyPath', res.filePath)
  }

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return }

    // Web consoles are addressed by URL; host/port are derived from it and
    // SSH-style auth does not apply.
    const isWeb = form.protocol === 'web'
    const webParsed = isWeb ? parseWebUrl(form.webUrl) : null
    if (isWeb) {
      if (!webParsed) { setError('A valid http(s) URL is required.'); return }
    } else {
      if (!form.host.trim()) { setError('Host is required.'); return }
      // VNC authenticates with password only; username is not required
      if (!form.username.trim() && form.protocol !== 'vnc') { setError('Username is required.'); return }
    }

    setSaving(true)
    setError(null)
    try {
      // Resolve groupId — create new group if selected
      let groupId = form.groupId
      if (form.showNewGroup && form.newGroupName.trim()) {
        groupId = addGroup(form.newGroupName.trim())
      }

      const isRdp = form.protocol === 'rdp'
      const isVnc = form.protocol === 'vnc'
      const webPort = webParsed
        ? (webParsed.port ? parseInt(webParsed.port) : webParsed.protocol === 'https:' ? 443 : 80)
        : 0
      const profileData: Omit<Profile, 'id'> = {
        name: form.name.trim(),
        host: isWeb ? webParsed!.hostname : form.host.trim(),
        port: isWeb ? webPort : (parseInt(form.port) || DEFAULT_PORTS[form.protocol]),
        protocol: form.protocol,
        username: form.username.trim(),
        authMethod: form.authMethod,
        privateKeyPath: form.authMethod === 'key' ? form.privateKeyPath : undefined,
        tags: form.tags,
        notes: form.notes,
        groupId,
        vpnProfileId: form.vpnProfileId || undefined,
        jumpHost: form.showJumpHost && form.jumpHost.host.trim()
          ? {
              host: form.jumpHost.host.trim(),
              port: parseInt(form.jumpHost.port) || 22,
              username: form.jumpHost.username.trim(),
            }
          : undefined,
        rdpResolution: isRdp ? (form.rdpResolution as Profile['rdpResolution']) : undefined,
        rdpWidth: isRdp && form.rdpResolution === 'custom' ? parseInt(form.rdpWidth) || 1920 : undefined,
        rdpHeight: isRdp && form.rdpResolution === 'custom' ? parseInt(form.rdpHeight) || 1080 : undefined,
        rdpColorDepth: isRdp ? (parseInt(form.rdpColorDepth) as 16 | 24 | 32) : undefined,
        rdpDomain: isRdp && form.rdpDomain.trim() ? form.rdpDomain.trim() : undefined,
        rdpCertMode: isRdp ? (form.rdpCertMode as Profile['rdpCertMode']) : undefined,
        vncDisplay: isVnc ? (parseInt(form.vncDisplay) || 0) : undefined,
        vncPort: isVnc && form.vncPort.trim() ? parseInt(form.vncPort) || undefined : undefined,
        vncEncoding: isVnc ? (form.vncEncoding as Profile['vncEncoding']) : undefined,
        webUrl: isWeb ? webParsed!.toString() : undefined,
        webIgnoreCertErrors: isWeb ? form.webIgnoreCertErrors : undefined,
        webProxy: isWeb && form.webProxy.trim() ? form.webProxy.trim() : undefined,
        // Bookmarks are managed inside the browser tab, not this form — preserve them.
        webBookmarks: isWeb
          ? (editingId !== 'new' ? profiles.find((p) => p.id === editingId)?.webBookmarks : undefined)
          : undefined,
      }

      const profileId =
        editingId === 'new' ? addProfile(profileData) : (updateProfile(editingId!, profileData), editingId!)

      // Persist credentials to keytar
      if (form.authMethod === 'password' && form.password) {
        await ipc.credentials.set(profileId, form.password)
      } else if (form.authMethod === 'key' && form.passphrase) {
        await ipc.credentials.set(`${profileId}:passphrase`, form.passphrase)
      }

      // Persist profiles to disk via main process
      const state = useProfileStore.getState()
      await ipc.store.save(state.groups, state.profiles)

      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const open = editingId !== null
  const isNew = editingId === 'new'
  const isWeb = form.protocol === 'web'

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[520px] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded border border-[#454545] bg-[#252526] shadow-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#3e3e42] px-4 py-3">
            <Dialog.Title className="text-[13px] font-semibold text-[#cccccc]">
              {isNew ? 'New Profile' : 'Edit Profile'}
            </Dialog.Title>
            <Dialog.Close className="rounded-sm p-0.5 text-[#858585] hover:bg-white/10 hover:text-[#cccccc]">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l10 10M12 2L2 12"/>
              </svg>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-4 px-4 py-4">
            {/* ── General ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label="Name">
                  <input
                    className={inputCls}
                    placeholder="My Server"
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Protocol">
                <select
                  className={selectCls}
                  value={form.protocol}
                  onChange={(e) => onProtocolChange(e.target.value as Protocol)}
                >
                  {PROTOCOLS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </Field>

              {!isWeb && (
                <Field label="Port">
                  <input
                    className={inputCls}
                    type="number"
                    min={1} max={65535}
                    value={form.port}
                    onChange={(e) => set('port', e.target.value)}
                  />
                </Field>
              )}

              {isWeb ? (
                <div className="col-span-2">
                  <Field label="URL">
                    <input
                      className={inputCls}
                      placeholder="https://192.168.1.1 or https://console.example.com"
                      value={form.webUrl}
                      onChange={(e) => set('webUrl', e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                </div>
              ) : (
                <div className="col-span-2">
                  <Field label="Host / IP">
                    <input
                      className={inputCls}
                      placeholder="192.168.1.1 or hostname.example.com"
                      value={form.host}
                      onChange={(e) => set('host', e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>

            {!isWeb && (
            <>
            <Divider />

            {/* ── Authentication ──────────────────────────────────────── */}
            <div className="flex flex-col gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#858585]">Authentication</p>

              <Field label="Username">
                <input
                  className={inputCls}
                  placeholder={form.protocol === 'vnc' ? 'Not used by VNC' : 'ubuntu'}
                  value={form.username}
                  onChange={(e) => set('username', e.target.value)}
                />
              </Field>
              {form.protocol === 'vnc' && (
                <p className="text-[11px] text-[#6d6d6d]">
                  VNC uses only a password — username is not required.
                </p>
              )}

              <Field label="Auth Method">
                <select
                  className={selectCls}
                  value={form.authMethod}
                  onChange={(e) => set('authMethod', e.target.value as AuthMethod)}
                >
                  {AUTH_METHODS
                    .filter((m) => form.protocol === 'rdp' || form.protocol === 'vnc' ? m.value === 'password' : true)
                    .map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>

              {form.authMethod === 'password' && (
                <Field label="Password">
                  <input
                    className={inputCls}
                    type="password"
                    placeholder={isNew ? 'Enter password' : '(saved — leave blank to keep)'}
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
              )}

              {form.authMethod === 'key' && (
                <>
                  <Field label="Private Key File">
                    <div className="flex gap-1.5">
                      <input
                        className={inputCls}
                        placeholder="~/.ssh/id_rsa"
                        value={form.privateKeyPath}
                        onChange={(e) => set('privateKeyPath', e.target.value)}
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2.5 text-[12px] text-[#cccccc] hover:border-[#007acc] hover:text-[#007acc]"
                        onClick={browseKey}
                      >
                        Browse
                      </button>
                    </div>
                  </Field>
                  <Field label="Passphrase">
                    <input
                      className={inputCls}
                      type="password"
                      placeholder={isNew ? 'Passphrase (if any)' : '(saved — leave blank to keep)'}
                      value={form.passphrase}
                      onChange={(e) => set('passphrase', e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                </>
              )}
            </div>
            </>
            )}

            <Divider />

            {/* ── Organization ────────────────────────────────────────── */}
            <div className="flex flex-col gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#858585]">Organization</p>

              <Field label="Group">
                {form.showNewGroup ? (
                  <div className="flex gap-1.5">
                    <input
                      className={inputCls}
                      placeholder="Group name"
                      value={form.newGroupName}
                      onChange={(e) => set('newGroupName', e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 text-[12px] text-[#858585] hover:text-[#cccccc]"
                      onClick={() => set('showNewGroup', false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <select
                    className={selectCls}
                    value={form.groupId}
                    onChange={(e) => {
                      if (e.target.value === '__new__') set('showNewGroup', true)
                      else set('groupId', e.target.value)
                    }}
                  >
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    <option value="">— Ungrouped —</option>
                    <option value="__new__">+ New Group…</option>
                  </select>
                )}
              </Field>

              <Field label="VPN Profile">
                <select
                  className={selectCls}
                  value={form.vpnProfileId}
                  onChange={(e) => set('vpnProfileId', e.target.value)}
                >
                  <option value="">— None —</option>
                  {vpnProfiles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </Field>

              <Field label="Tags">
                <div className="flex flex-wrap items-center gap-1 rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 py-1.5 focus-within:border-[#007acc]">
                  {form.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-0.5 rounded-sm bg-[#094771] px-1.5 py-0.5 text-[11px] text-[#cccccc]">
                      {tag}
                      <button type="button" className="ml-0.5 text-[#858585] hover:text-[#f48771]" onClick={() => removeTag(tag)}>×</button>
                    </span>
                  ))}
                  <input
                    className="min-w-[80px] flex-1 bg-transparent text-[13px] text-[#cccccc] outline-none placeholder:text-[#6d6d6d]"
                    placeholder="Add tag…"
                    value={form.tagInput}
                    onChange={(e) => set('tagInput', e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
                    onBlur={addTag}
                  />
                </div>
              </Field>

              <Field label="Notes">
                <textarea
                  className={`${inputCls} resize-none`}
                  rows={2}
                  placeholder="Optional notes"
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </Field>
            </div>

            {/* ── Advanced — Jump Host ─────────────────────────────────── */}
            {form.protocol !== 'rdp' && form.protocol !== 'vnc' && !isWeb && (
              <div className="rounded-sm border border-[#3e3e42]">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-[#858585] hover:text-[#cccccc]"
                  onClick={() => set('showJumpHost', !form.showJumpHost)}
                >
                  <svg
                    className={`shrink-0 transition-transform ${form.showJumpHost ? '' : '-rotate-90'}`}
                    width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
                  >
                    <path d="M0 2l4 4 4-4H0z"/>
                  </svg>
                  Jump Host / Bastion
                </button>

                {form.showJumpHost && (
                  <div className="grid grid-cols-3 gap-2 border-t border-[#3e3e42] px-3 pb-3 pt-2">
                    <div className="col-span-2">
                      <Field label="Jump Host">
                        <input className={inputCls} placeholder="bastion.example.com" value={form.jumpHost.host} onChange={(e) => setJH('host', e.target.value)} />
                      </Field>
                    </div>
                    <Field label="Port">
                      <input className={inputCls} type="number" placeholder="22" value={form.jumpHost.port} onChange={(e) => setJH('port', e.target.value)} />
                    </Field>
                    <div className="col-span-3">
                      <Field label="Jump Username">
                        <input className={inputCls} placeholder="ec2-user" value={form.jumpHost.username} onChange={(e) => setJH('username', e.target.value)} />
                      </Field>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── RDP Settings ─────────────────────────────────────────── */}
            {form.protocol === 'rdp' && (
              <>
                <Divider />
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#858585]">RDP Settings</p>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Resolution">
                      <select
                        className={selectCls}
                        value={form.rdpResolution}
                        onChange={(e) => set('rdpResolution', e.target.value)}
                      >
                        <option value="auto">Auto (fit tab)</option>
                        <option value="1024x768">1024×768</option>
                        <option value="1280x720">1280×720</option>
                        <option value="1920x1080">1920×1080</option>
                        <option value="custom">Custom…</option>
                      </select>
                    </Field>

                    <Field label="Color Depth">
                      <select
                        className={selectCls}
                        value={form.rdpColorDepth}
                        onChange={(e) => set('rdpColorDepth', e.target.value)}
                      >
                        <option value="16">16-bit</option>
                        <option value="24">24-bit</option>
                        <option value="32">32-bit</option>
                      </select>
                    </Field>
                  </div>

                  {form.rdpResolution === 'custom' && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Width (px)">
                        <input
                          className={inputCls}
                          type="number"
                          min={640} max={7680}
                          placeholder="1920"
                          value={form.rdpWidth}
                          onChange={(e) => set('rdpWidth', e.target.value)}
                        />
                      </Field>
                      <Field label="Height (px)">
                        <input
                          className={inputCls}
                          type="number"
                          min={480} max={4320}
                          placeholder="1080"
                          value={form.rdpHeight}
                          onChange={(e) => set('rdpHeight', e.target.value)}
                        />
                      </Field>
                    </div>
                  )}

                  <Field label="Domain (optional)">
                    <input
                      className={inputCls}
                      placeholder="MYDOMAIN"
                      value={form.rdpDomain}
                      onChange={(e) => set('rdpDomain', e.target.value)}
                    />
                  </Field>

                  <Field label="Certificate Trust Mode">
                    <select
                      className={selectCls}
                      value={form.rdpCertMode}
                      onChange={(e) => set('rdpCertMode', e.target.value)}
                    >
                      <option value="warn">Warn — prompt on unknown certificate</option>
                      <option value="accept">Auto-accept — ignore certificate errors</option>
                      <option value="reject">Reject — strict certificate validation</option>
                    </select>
                  </Field>
                </div>
              </>
            )}

            {/* ── VNC Settings ─────────────────────────────────────────── */}
            {form.protocol === 'vnc' && (
              <>
                <Divider />
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#858585]">VNC Settings</p>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Display Number">
                      <input
                        className={inputCls}
                        type="number"
                        min={0} max={99}
                        placeholder="0"
                        value={form.vncDisplay}
                        onChange={(e) => {
                          set('vncDisplay', e.target.value)
                          if (!form.vncPort) {
                            const d = parseInt(e.target.value) || 0
                            set('port', String(5900 + d))
                          }
                        }}
                      />
                    </Field>

                    <Field label="VNC Port Override">
                      <input
                        className={inputCls}
                        type="number"
                        min={1} max={65535}
                        placeholder={`${5900 + (parseInt(form.vncDisplay) || 0)} (auto)`}
                        value={form.vncPort}
                        onChange={(e) => {
                          set('vncPort', e.target.value)
                          if (e.target.value) set('port', e.target.value)
                        }}
                      />
                    </Field>
                  </div>

                  <Field label="Encoding Preference">
                    <select
                      className={selectCls}
                      value={form.vncEncoding}
                      onChange={(e) => set('vncEncoding', e.target.value)}
                    >
                      <option value="tight">Tight (best compression)</option>
                      <option value="zrle">ZRLE</option>
                      <option value="hextile">Hextile</option>
                      <option value="raw">Raw</option>
                    </select>
                  </Field>
                </div>
              </>
            )}

            {/* ── Web Console Settings ─────────────────────────────────── */}
            {isWeb && (
              <>
                <Divider />
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#858585]">Web Console Settings</p>

                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[#007acc]"
                      checked={form.webIgnoreCertErrors}
                      onChange={(e) => set('webIgnoreCertErrors', e.target.checked)}
                    />
                    <span className="flex flex-col">
                      <span className="text-[12px] text-[#cccccc]">Ignore TLS certificate errors</span>
                      <span className="text-[11px] text-[#6d6d6d]">
                        Trusts this URL’s origin even with a self-signed/invalid certificate — common for
                        device BMCs (iDRAC/iLO), ESXi and switches. Scoped to this profile’s origin only.
                      </span>
                    </span>
                  </label>

                  {form.webIgnoreCertErrors && (
                    <p className="rounded-sm border border-[#5a4a1a] bg-[#3a2f12] px-2.5 py-1.5 text-[11px] text-[#dcdcaa]">
                      ⚠ Disabling certificate validation removes protection against man-in-the-middle
                      attacks. Only enable for trusted hosts on a trusted network.
                    </p>
                  )}

                  <Field label="Proxy (optional)">
                    <input
                      className={inputCls}
                      placeholder="socks5://127.0.0.1:1080  or  http://proxy:8080"
                      value={form.webProxy}
                      onChange={(e) => set('webProxy', e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="mt-1 text-[11px] text-[#6d6d6d]">
                      Routes this console through a proxy (e.g. an SSH <code>-D</code> SOCKS tunnel to a
                      bastion). Leave blank for a direct connection.
                    </p>
                  </Field>

                  <p className="text-[11px] text-[#6d6d6d]">
                    The page loads in an isolated, sandboxed session. Links that open new windows are
                    sent to your system browser.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#3e3e42] px-4 py-3">
            {error
              ? <p className="text-[12px] text-[#f48771]">{error}</p>
              : <span />
            }
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <button className="rounded-sm border border-[#3e3e42] px-3 py-1.5 text-[12px] text-[#858585] hover:border-[#6d6d6d] hover:text-[#cccccc]">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                className="rounded-sm bg-[#007acc] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#0069ac] disabled:opacity-50"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Divider() {
  return <div className="h-px bg-[#3e3e42]" />
}
