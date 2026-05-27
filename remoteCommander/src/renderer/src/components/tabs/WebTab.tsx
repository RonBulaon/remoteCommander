/* eslint-disable react/no-unknown-property -- <webview> exposes Electron-specific
   attributes (partition, allowpopups, …) that React's DOM rule doesn't know. */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useTabStore, Tab } from '../../store/tabStore'
import { useProfileStore } from '../../store/profileStore'
import { ipc } from '../../lib/ipc'
import type { CertErrorInfo } from '../../lib/ipc'
import type { WebviewTag } from '../../types/webview'
import { detectDocMode, formatJson, renderMarkdown, buildDocSrcDoc, type DocMode } from '../../lib/docFormat'

// ── Types ─────────────────────────────────────────────────────────────────

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

// What the cert interstitial renders. `description` is Chromium's human-readable
// error text; `certificate` (when available) comes from the main process.
type CertErrorView = {
  url: string
  description: string
  certificate?: CertErrorInfo['certificate']
}

// Chromium net error codes for certificate problems live in [-219, -200]
// (ERR_CERT_COMMON_NAME_INVALID … ERR_CERT_END). Anything else is a normal
// load failure (DNS, connection refused, …).
function isCertErrorCode(code: number): boolean {
  return code <= -200 && code >= -219
}

// Per-session memory of the last URL each web tab visited. Web tabs aren't kept
// alive (one live <webview> at a time), so on re-activation we reload where the
// user left off instead of jumping back to the profile's home URL.
const lastUrlByTab = new Map<string, string>()

// ── Small UI helpers (kept local, mirroring the other tab components) ───────

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

function StatusDot({ status }: { status: LoadStatus }) {
  const color =
    status === 'ready'   ? 'bg-[#89d185]' :
    status === 'loading' ? 'bg-[#d7ba7d] animate-pulse' :
    status === 'error'   ? 'bg-[#f48771]' :
    'bg-[#6d6d6d]'
  return <div className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
}

// ── URL helpers ─────────────────────────────────────────────────────────────

// Normalize address-bar input to an http(s) or file URL. A bare absolute path
// (POSIX /… or Windows C:\…) becomes a file URL. Returns null for anything else
// (blocks javascript:, data:, etc.).
function normalizeNavInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let candidate: string
  if (/^(https?|file):\/\//i.test(trimmed)) {
    candidate = trimmed
  } else if (/^\//.test(trimmed)) {
    candidate = `file://${trimmed}`                       // /home/ron/x → file:///home/ron/x
  } else if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    candidate = `file:///${trimmed.replace(/\\/g, '/')}`  // C:\Users\x → file:///C:/Users/x
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    candidate = trimmed                                   // some other scheme — rejected below
  } else {
    candidate = `https://${trimmed}`
  }

  try {
    const u = new URL(candidate)
    return ['http:', 'https:', 'file:'].includes(u.protocol) ? u.toString() : null
  } catch {
    return null
  }
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

// ── WebTab ────────────────────────────────────────────────────────────────

export function WebTab({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const webviewRef    = useRef<WebviewTag | null>(null)
  const readyRef      = useRef(false)
  const editingUrlRef = useRef(false)

  const [status,      setStatus]      = useState<LoadStatus>('idle')
  const [statusMsg,   setStatusMsg]   = useState('')
  const [currentUrl,  setCurrentUrl]  = useState('')
  const [urlInput,    setUrlInput]    = useState('')
  const [canBack,     setCanBack]     = useState(false)
  const [canForward,  setCanForward]  = useState(false)
  // Document viewer: when the loaded resource is JSON/Markdown we render a
  // formatted view in a sandboxed iframe over the raw page. PDF is handled
  // natively by Chromium's PDFium viewer (no overlay).
  const [docMode,     setDocMode]     = useState<DocMode | null>(null)
  const [docHtml,     setDocHtml]     = useState('')
  const [rawView,     setRawView]     = useState(false)
  // Non-null while a TLS cert was rejected and the "Proceed anyway" interstitial
  // is showing over the (failed) webview.
  const [certError,   setCertError]   = useState<CertErrorView | null>(null)

  const [pageTitle,     setPageTitle]     = useState('')
  const [showBookmarks, setShowBookmarks] = useState(false)

  const { setTabStatus, renameTab } = useTabStore()
  const { profiles, updateProfile } = useProfileStore()
  const profile = tab.profileId ? profiles.find((p) => p.id === tab.profileId) : undefined
  const homeUrl = profile?.webUrl ?? ''
  const needsCertOptIn = !!profile?.webIgnoreCertErrors
  const proxyRules = profile?.webProxy?.trim() ?? ''
  const partition = `persist:web-${tab.profileId ?? 'default'}`
  const bookmarks = profile?.webBookmarks ?? []

  // Per-session/per-partition setup must complete BEFORE the first navigation:
  // register the cert opt-in (if any) and apply (or clear) the proxy. Only then
  // do we set src — to the last-visited URL if we have one, else the home URL.
  const [initialSrc, setInitialSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!homeUrl) return
    let cancelled = false
    ;(async () => {
      try {
        if (needsCertOptIn) await ipc.web.allowInsecureCerts(homeUrl)
        await ipc.web.setProxy(partition, proxyRules) // empty rules => direct
      } catch { /* fall through and load anyway */ }
      if (!cancelled) setInitialSrc(lastUrlByTab.get(tab.id) ?? homeUrl)
    })()
    return () => {
      cancelled = true
      if (needsCertOptIn) ipc.web.revokeInsecureCerts(homeUrl).catch(() => {})
    }
  }, [homeUrl, needsCertOptIn, proxyRules, partition, tab.id])

  // ── Wire webview lifecycle events once the element is mounted ─────────────
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const refreshNav = () => {
      if (!readyRef.current) return
      try {
        setCanBack(wv.canGoBack())
        setCanForward(wv.canGoForward())
      } catch { /* not attached yet */ }
    }

    // Inspect the loaded resource; if it's JSON/Markdown, build a formatted view.
    const evaluateDoc = async () => {
      let contentType = ''
      let url = ''
      try {
        contentType = String(await wv.executeJavaScript('document.contentType'))
        url = wv.getURL()
      } catch { setDocMode(null); return }

      const mode = detectDocMode(contentType, url)
      if (!mode) { setDocMode(null); setDocHtml(''); return }

      let text = ''
      try {
        text = String(await wv.executeJavaScript('(document.body && document.body.innerText) || ""'))
      } catch { setDocMode(null); return }

      setDocHtml(buildDocSrcDoc(mode === 'json' ? formatJson(text) : renderMarkdown(text)))
      setDocMode(mode)
    }

    const onDomReady = () => { readyRef.current = true; refreshNav() }
    const onStart = () => {
      setStatus('loading'); setStatusMsg('Loading…'); setTabStatus(tab.id, 'connecting')
      // A new navigation: drop any prior formatted view and default to formatted,
      // and dismiss any cert interstitial from a previous attempt.
      setDocMode(null); setRawView(false); setCertError(null)
    }
    const onStop = () => {
      setStatus((s) => (s === 'error' ? s : 'ready'))
      setStatusMsg((m) => (m.startsWith('Error') ? m : 'Done'))
      setTabStatus(tab.id, 'connected')
      refreshNav()
      void evaluateDoc()
    }
    const onNavigate = (e: Event) => {
      const url = (e as unknown as { url?: string }).url
      if (url) {
        lastUrlByTab.set(tab.id, url)
        setCurrentUrl(url)
        if (!editingUrlRef.current) setUrlInput(url)
      }
      refreshNav()
    }
    const onTitle = (e: Event) => {
      const title = (e as unknown as { title?: string }).title
      if (title) { setPageTitle(title); renameTab(tab.id, title) }
    }
    const onFail = (e: Event) => {
      const ev = e as unknown as {
        errorCode: number; errorDescription: string; isMainFrame: boolean; validatedURL?: string
      }
      // -3 == ERR_ABORTED (fires on normal stop/redirect); ignore it and subframes.
      if (ev.isMainFrame === false || ev.errorCode === -3) return
      setStatus('error')
      setTabStatus(tab.id, 'disconnected')

      // A rejected certificate: show the browser-style interstitial instead of
      // the dead error page. Pull the cert details the main process stashed.
      if (isCertErrorCode(ev.errorCode)) {
        const failedUrl = ev.validatedURL || wv.getURL()
        setStatusMsg(`Certificate error: ${ev.errorDescription}`)
        ;(async () => {
          let certificate: CertErrorView['certificate']
          try {
            const info = await ipc.web.getCertError(wv.getWebContentsId())
            certificate = info?.certificate
          } catch { /* details are optional — interstitial still renders */ }
          setCertError({ url: failedUrl, description: ev.errorDescription, certificate })
        })()
        return
      }

      setStatusMsg(`Error ${ev.errorCode}: ${ev.errorDescription}`)
    }

    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigate)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-fail-load', onFail)

    return () => {
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigate)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('did-fail-load', onFail)
    }
    // Re-run when the <webview> mounts (initialSrc transitions null → url).
  }, [tab.id, initialSrc, setTabStatus, renameTab])

  // ── Actions ───────────────────────────────────────────────────────────────

  const navigate = useCallback((raw: string) => {
    const url = normalizeNavInput(raw)
    if (!url || !readyRef.current) return
    // loadURL returns a promise; a rejected navigation (bad DNS, etc.) must be
    // caught here or Electron logs an unhandled "Failed to load URL" warning.
    try { webviewRef.current?.loadURL(url)?.catch(() => {}) } catch { /* not ready */ }
    editingUrlRef.current = false
  }, [])

  // Focus the guest page when this tab becomes active.
  useEffect(() => {
    if (isActive && readyRef.current) {
      try { webviewRef.current?.focus() } catch { /* not attached */ }
    }
  }, [isActive])

  const goHome   = useCallback(() => navigate(homeUrl), [homeUrl, navigate])
  // Cert interstitial: trust this origin for the session, then retry the load.
  const proceedInsecure = useCallback(async () => {
    if (!certError) return
    const url = certError.url
    try { await ipc.web.allowInsecureCerts(url) } catch { /* still try the reload */ }
    setCertError(null)
    setStatus('loading'); setStatusMsg('Loading…')
    try { webviewRef.current?.loadURL(url)?.catch(() => {}) } catch { /* not ready */ }
  }, [certError])

  // Cert interstitial: dismiss and step back to the last good page if there is one.
  const backToSafety = useCallback(() => {
    setCertError(null)
    try {
      if (webviewRef.current?.canGoBack()) webviewRef.current.goBack()
    } catch { /* nothing to go back to */ }
  }, [])

  const goBack   = useCallback(() => { try { webviewRef.current?.goBack() } catch { /* */ } }, [])
  const goForward = useCallback(() => { try { webviewRef.current?.goForward() } catch { /* */ } }, [])
  const reload   = useCallback(() => { try { webviewRef.current?.reload() } catch { /* */ } }, [])
  const stop     = useCallback(() => { try { webviewRef.current?.stop() } catch { /* */ } }, [])
  const openExternal = useCallback(() => {
    if (currentUrl) ipc.window.openExternal(currentUrl)
  }, [currentUrl])

  // ── Bookmarks (persisted on the profile) ──────────────────────────────────

  const isBookmarked = !!currentUrl && bookmarks.some((b) => b.url === currentUrl)

  const saveBookmarks = (profileId: string, next: typeof bookmarks) => {
    updateProfile(profileId, { webBookmarks: next })
    const st = useProfileStore.getState()
    ipc.store.save(st.groups, st.profiles).catch(() => {})
  }

  const toggleBookmark = useCallback(() => {
    if (!profile || !currentUrl) return
    const existing = profile.webBookmarks ?? []
    const next = existing.some((b) => b.url === currentUrl)
      ? existing.filter((b) => b.url !== currentUrl)
      : [...existing, { title: pageTitle || currentUrl, url: currentUrl }]
    saveBookmarks(profile.id, next)
  }, [profile, currentUrl, pageTitle]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeBookmark = useCallback((url: string) => {
    if (!profile) return
    saveBookmarks(profile.id, (profile.webBookmarks ?? []).filter((b) => b.url !== url))
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────

  const isLoading = status === 'loading'

  if (!homeUrl) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#1e1e1e]">
        <div className="max-w-sm text-center">
          <div className="mb-3 text-[32px] opacity-60">🌐</div>
          <p className="mb-2 text-[13px] font-semibold text-[#f48771]">No URL configured</p>
          <p className="text-[12px] text-[#858585]">Edit this profile and set a Web URL to use it.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#1e1e1e]">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[#3e3e42] bg-[#2d2d2d] px-2 py-1">
        <TBtn title="Back" onClick={goBack} disabled={!canBack}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2L4 6.5l4 4.5" />
          </svg>
        </TBtn>
        <TBtn title="Forward" onClick={goForward} disabled={!canForward}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 2l4 4.5L5 11" />
          </svg>
        </TBtn>
        {isLoading ? (
          <TBtn title="Stop" onClick={stop}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" />
            </svg>
          </TBtn>
        ) : (
          <TBtn title="Reload" onClick={reload}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.5 2A5 5 0 1 0 11 6.5" />
              <path d="M11 0v3H8" />
            </svg>
          </TBtn>
        )}
        <TBtn title="Home" onClick={goHome}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l9-8 9 8" />
            <path d="M5 10v10h14V10" />
          </svg>
        </TBtn>

        <Sep />

        {/* Address bar */}
        <input
          className="h-6 min-w-0 flex-1 rounded-sm border border-[#3e3e42] bg-[#3c3c3c] px-2 text-[12px] text-[#cccccc] outline-none placeholder:text-[#6d6d6d] focus:border-[#007acc]"
          value={urlInput}
          placeholder="Enter URL…"
          onChange={(e) => setUrlInput(e.target.value)}
          onFocus={() => { editingUrlRef.current = true }}
          onBlur={() => { editingUrlRef.current = false; setUrlInput(currentUrl) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(urlInput)
            if (e.key === 'Escape') { setUrlInput(currentUrl); (e.target as HTMLInputElement).blur() }
          }}
          spellCheck={false}
        />

        {/* Bookmark this page */}
        <TBtn
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          onClick={toggleBookmark}
          disabled={!currentUrl}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill={isBookmarked ? '#d7ba7d' : 'none'} stroke={isBookmarked ? '#d7ba7d' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3 7h7l-5.5 4.5 2 7L12 17l-6.5 3.5 2-7L2 9h7z" />
          </svg>
        </TBtn>

        {/* Bookmarks list */}
        <div className="relative">
          <TBtn title="Bookmarks" onClick={() => setShowBookmarks((v) => !v)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z" />
            </svg>
          </TBtn>
          {showBookmarks && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowBookmarks(false)} />
              <div className="absolute right-0 top-7 z-30 max-h-72 w-64 overflow-y-auto rounded border border-[#454545] bg-[#252526] py-1 shadow-2xl">
                {bookmarks.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-[#6d6d6d]">No bookmarks yet. Click the star to save this page.</p>
                ) : (
                  bookmarks.map((b) => (
                    <div key={b.url} className="group flex items-center gap-1 px-2 py-1 hover:bg-[#094771]">
                      <button
                        className="min-w-0 flex-1 truncate text-left text-[12px] text-[#cccccc]"
                        title={b.url}
                        onClick={() => { navigate(b.url); setShowBookmarks(false) }}
                      >
                        {b.title}
                      </button>
                      <button
                        className="shrink-0 px-1 text-[#858585] opacity-0 transition-opacity hover:text-[#f48771] group-hover:opacity-100"
                        title="Remove bookmark"
                        onClick={() => removeBookmark(b.url)}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {docMode && (
          <>
            <Sep />
            <div className="flex shrink-0 items-center rounded-sm border border-[#3e3e42] text-[11px]">
              <button
                className={`px-2 py-0.5 ${!rawView ? 'bg-[#094771] text-[#cccccc]' : 'text-[#858585] hover:text-[#cccccc]'}`}
                onClick={() => setRawView(false)}
                title={`Formatted ${docMode === 'json' ? 'JSON' : 'Markdown'} view`}
              >
                {docMode === 'json' ? 'JSON' : 'Markdown'}
              </button>
              <button
                className={`px-2 py-0.5 ${rawView ? 'bg-[#094771] text-[#cccccc]' : 'text-[#858585] hover:text-[#cccccc]'}`}
                onClick={() => setRawView(true)}
                title="Raw source"
              >
                Raw
              </button>
            </div>
          </>
        )}

        <Sep />

        <TBtn title="Open in system browser" onClick={openExternal} disabled={!currentUrl}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 4h6v6" />
            <path d="M20 4l-9 9" />
            <path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
          </svg>
        </TBtn>
      </div>

      {/* Web content */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden bg-white">
        {initialSrc && (
          <webview
            ref={webviewRef as unknown as React.Ref<WebviewTag>}
            src={initialSrc}
            partition={`persist:web-${tab.profileId ?? 'default'}`}
            className="absolute inset-0"
            style={{ width: '100%', height: '100%' }}
          />
        )}

        {/* Formatted document view (JSON/Markdown) — script-disabled sandbox. */}
        {docMode && !rawView && docHtml && (
          <iframe
            title="Document view"
            sandbox=""
            srcDoc={docHtml}
            className="absolute inset-0 h-full w-full border-0 bg-[#1e1e1e]"
          />
        )}

        {status === 'error' && !certError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]">
            <div className="max-w-sm text-center">
              <div className="mb-3 text-[32px] opacity-60">✕</div>
              <p className="mb-2 text-[13px] font-semibold text-[#f48771]">Failed to load</p>
              <p className="mb-4 text-[12px] text-[#858585]">{statusMsg}</p>
              <button
                className="rounded-sm bg-[#007acc] px-4 py-1.5 text-[12px] text-white hover:bg-[#0069ac]"
                onClick={() => { setStatus('loading'); reload() }}
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Certificate interstitial — browser-style "Your connection is not
            private" with an opt-in "Proceed anyway" that trusts the origin for
            this session and reloads. */}
        {certError && (
          <div className="absolute inset-0 flex items-center justify-center overflow-auto bg-[#1e1e1e] p-6">
            <div className="w-full max-w-md">
              <div className="mb-3 text-[36px]">🔓</div>
              <h2 className="mb-2 text-[16px] font-semibold text-[#e0e0e0]">Your connection is not private</h2>
              <p className="mb-3 text-[12px] leading-relaxed text-[#a0a0a0]">
                The certificate for <span className="text-[#d7ba7d]">{hostOf(certError.url)}</span> could not be
                verified ({certError.description}). This is expected for self-signed certificates on device
                consoles (iDRAC/iLO/ESXi), but it could also mean someone is intercepting the connection.
              </p>
              {certError.certificate && (
                <div className="mb-4 space-y-1 rounded border border-[#3e3e42] bg-[#252526] p-3 text-[11px] text-[#858585]">
                  <div><span className="text-[#6d6d6d]">Issued to:</span> {certError.certificate.subjectName || '—'}</div>
                  <div><span className="text-[#6d6d6d]">Issued by:</span> {certError.certificate.issuerName || '—'}</div>
                  <div>
                    <span className="text-[#6d6d6d]">Expires:</span>{' '}
                    {new Date(certError.certificate.validExpiry * 1000).toLocaleString()}
                  </div>
                  <div className="break-all"><span className="text-[#6d6d6d]">SHA-256:</span> {certError.certificate.fingerprint}</div>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  className="rounded-sm bg-[#007acc] px-4 py-1.5 text-[12px] text-white hover:bg-[#0069ac]"
                  onClick={backToSafety}
                >
                  Back to safety
                </button>
                <button
                  className="rounded-sm border border-[#5a3a3a] px-4 py-1.5 text-[12px] text-[#f48771] hover:bg-[#3a2a2a]"
                  onClick={() => void proceedInsecure()}
                >
                  Proceed anyway (unsafe)
                </button>
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-[#6d6d6d]">
                Proceeding trusts this origin only for the rest of this session. To trust it permanently, enable
                “Ignore TLS certificate errors” in this profile’s settings.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex h-[22px] shrink-0 items-center border-t border-[#3e3e42] bg-[#252526] px-3">
        <StatusDot status={status} />
        <span className="ml-2 truncate text-[11px] text-[#858585]">
          {status === 'idle' ? 'Idle' : statusMsg || currentUrl}
        </span>
        {profile?.webIgnoreCertErrors && (
          <span className="ml-auto shrink-0 text-[11px] text-[#d7ba7d]" title="TLS certificate validation is disabled for this profile's origin">
            ⚠ insecure TLS
          </span>
        )}
      </div>
    </div>
  )
}
