import { useEffect, useState, useCallback, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import type { Extension } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'
import { useTabStore, Tab } from '../../store/tabStore'
import { ipc } from '../../lib/ipc'

// ── Language detection ──────────────────────────────────────────────────────

function langName(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    json: 'JSON', yaml: 'YAML', yml: 'YAML', js: 'JavaScript', jsx: 'JavaScript',
    mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript',
    html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'CSS', less: 'CSS',
    md: 'Markdown', markdown: 'Markdown', py: 'Python', xml: 'XML', svg: 'XML',
  }
  return map[ext] ?? 'Plain Text'
}

function langExtensions(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'json': return [json()]
    case 'yaml': case 'yml': return [yaml()]
    case 'js': case 'jsx': case 'mjs': case 'cjs': return [javascript({ jsx: true })]
    case 'ts': case 'tsx': return [javascript({ jsx: true, typescript: true })]
    case 'html': case 'htm': return [html()]
    case 'css': case 'scss': case 'less': return [css()]
    case 'md': case 'markdown': return [markdown()]
    case 'py': return [python()]
    case 'xml': case 'svg': return [xml()]
    default: return []
  }
}

// ── EditorTab ─────────────────────────────────────────────────────────────

export function EditorTab({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const ed = tab.editor
  const filename = ed?.path.split('/').pop() ?? 'untitled'

  const { renameTab, setEditorDirty } = useTabStore()

  const [content,      setContent]      = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loadState,    setLoadState]    = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg,     setErrorMsg]     = useState('')
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState<string | null>(null)
  const [reloadTick,   setReloadTick]   = useState(0)

  const dirty = loadState === 'ready' && content !== savedContent
  const extensions = useMemo(() => langExtensions(ed?.path ?? ''), [ed?.path])

  // ── Load the file ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ed) { setLoadState('error'); setErrorMsg('No file is associated with this tab.'); return }
    let cancelled = false
    setLoadState('loading')
    setSaveError(null)
    ;(async () => {
      const res = ed.isLocal
        ? await ipc.sftp.readLocalFile(ed.path)
        : await ipc.sftp.readFile(ed.sessionId, ed.path)
      if (cancelled) return
      if ('error' in res) { setLoadState('error'); setErrorMsg(res.error); return }
      setContent(res.content)
      setSavedContent(res.content)
      setLoadState('ready')
    })()
    return () => { cancelled = true }
  }, [ed?.path, ed?.sessionId, ed?.isLocal, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reflect dirty state in the tab strip (● prefix + store flag) ────────────
  useEffect(() => {
    setEditorDirty(tab.id, dirty)
    renameTab(tab.id, dirty ? `● ${filename}` : filename)
  }, [dirty, tab.id, filename, setEditorDirty, renameTab])

  // ── Save ────────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!ed || saving || content === savedContent) return
    setSaving(true)
    setSaveError(null)
    const res = ed.isLocal
      ? await ipc.sftp.writeLocalFile(ed.path, content)
      : await ipc.sftp.writeFile(ed.sessionId, ed.path, content)
    setSaving(false)
    if ('error' in res) { setSaveError(res.error); return }
    setSavedContent(content)
  }, [ed, content, savedContent, saving])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    }
  }, [save])

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadState === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#1e1e1e]">
        <p className="text-[13px] text-[#858585] animate-pulse">Opening {filename}…</p>
      </div>
    )
  }

  if (loadState === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#1e1e1e]">
        <div className="max-w-md text-center">
          <div className="mb-3 text-[32px] opacity-60">✕</div>
          <p className="mb-2 text-[13px] font-semibold text-[#f48771]">Can’t open {filename}</p>
          <p className="mb-4 text-[12px] text-[#858585]">{errorMsg}</p>
          <button
            className="rounded-sm bg-[#007acc] px-4 py-1.5 text-[12px] text-white hover:bg-[#0069ac]"
            onClick={() => setReloadTick((t) => t + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#1e1e1e]" onKeyDownCapture={onKeyDown}>
      {/* Toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[#3e3e42] bg-[#252526] px-3">
        <span
          className="shrink-0 rounded-sm border px-1 text-[9px] font-semibold leading-4"
          style={{ color: '#569cd6', backgroundColor: '#569cd618', borderColor: '#569cd640' }}
        >
          {ed?.isLocal ? 'LOCAL' : 'REMOTE'}
        </span>
        <span className="truncate text-[12px] text-[#cccccc]" title={ed?.path}>{filename}</span>
        {dirty && <span className="shrink-0 text-[11px] text-[#d7ba7d]" title="Unsaved changes">● unsaved</span>}

        <div className="flex-1" />

        <button
          className="shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] text-[#858585] hover:bg-white/[0.07] hover:text-[#cccccc]"
          onClick={() => {
            if (dirty && !confirm('Discard unsaved changes and reload from disk?')) return
            setReloadTick((t) => t + 1)
          }}
          title="Reload from disk"
        >
          Reload
        </button>
        <button
          className={[
            'shrink-0 rounded-sm px-2.5 py-0.5 text-[11px] font-medium transition-colors',
            dirty && !saving
              ? 'bg-[#007acc] text-white hover:bg-[#0069ac]'
              : 'cursor-not-allowed bg-[#3a3a3a] text-[#6d6d6d]',
          ].join(' ')}
          onClick={() => void save()}
          disabled={!dirty || saving}
          title="Save (Ctrl+S)"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {saveError && (
        <div className="shrink-0 border-b border-[#5a1a1a] bg-[#3a1212] px-3 py-1 text-[11px] text-[#f48771]">
          Save failed: {saveError}
        </div>
      )}

      {/* Editor */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={content}
          height="100%"
          theme={vscodeDark}
          extensions={extensions}
          onChange={setContent}
          autoFocus={isActive}
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, highlightActiveLineGutter: true }}
          style={{ height: '100%', fontSize: '13px' }}
        />
      </div>

      {/* Status bar */}
      <div className="flex h-[22px] shrink-0 items-center gap-3 border-t border-[#3e3e42] bg-[#1a1a1a] px-3 text-[11px] text-[#858585]">
        <span className="truncate" title={ed?.path}>{ed?.path}</span>
        <span className="ml-auto shrink-0">{langName(ed?.path ?? '')}</span>
        <span className="shrink-0">{dirty ? 'Modified' : 'Saved'}</span>
      </div>
    </div>
  )
}
