// Offline, dependency-free formatters for the web-console document viewer.
// All output is HTML-escaped and rendered inside a script-disabled
// <iframe sandbox> (see WebTab), so even malformed/hostile input cannot execute.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── JSON ──────────────────────────────────────────────────────────────────

export function formatJson(raw: string): string {
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // Not valid JSON — show the raw text rather than nothing.
    return `<pre class="doc-raw">${escapeHtml(raw)}</pre>`
  }

  const highlighted = escapeHtml(pretty).replace(
    /(&quot;.*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match: string, str?: string, colon?: string, kw?: string, num?: string) => {
      if (str !== undefined) {
        const cls = colon ? 'k' : 's'
        return `<span class="${cls}">${str}</span>${colon ?? ''}`
      }
      if (kw !== undefined) return `<span class="b">${kw}</span>`
      if (num !== undefined) return `<span class="n">${num}</span>`
      return match
    },
  )
  return `<pre class="doc-json">${highlighted}</pre>`
}

// ── Markdown (compact subset: headings, lists, code, quotes, rules, inline) ─

function inlineMd(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    // Links: only http(s) or relative targets (the regex won't match javascript:).
    .replace(
      /\[([^\]]+)\]\(((?:https?:\/\/|\/|\.)[^)\s]+)\)/g,
      (_m, text: string, url: string) => `<a href="${url}" rel="noopener noreferrer">${text}</a>`,
    )
}

const BLOCK_START = /^(#{1,6}\s|```|>\s?|\s*[-*+]\s|\s*\d+\.\s)/
const HR = /^\s*([-*_])\1\1+\s*$/

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let inUl = false
  let inOl = false

  const closeLists = (): void => {
    if (inUl) { out.push('</ul>'); inUl = false }
    if (inOl) { out.push('</ol>'); inOl = false }
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (/^\s*```/.test(line)) {
      closeLists()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++ // skip closing fence
      out.push(`<pre class="doc-code"><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeLists()
      const lvl = heading[1].length
      out.push(`<h${lvl}>${inlineMd(escapeHtml(heading[2].trim()))}</h${lvl}>`)
      i++
      continue
    }

    if (HR.test(line)) { closeLists(); out.push('<hr/>'); i++; continue }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) { closeLists(); out.push(`<blockquote>${inlineMd(escapeHtml(quote[1]))}</blockquote>`); i++; continue }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (ul) {
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inUl) { out.push('<ul>'); inUl = true }
      out.push(`<li>${inlineMd(escapeHtml(ul[1]))}</li>`)
      i++
      continue
    }

    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false }
      if (!inOl) { out.push('<ol>'); inOl = true }
      out.push(`<li>${inlineMd(escapeHtml(ol[1]))}</li>`)
      i++
      continue
    }

    if (line.trim() === '') { closeLists(); i++; continue }

    // Paragraph: gather consecutive plain lines.
    closeLists()
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !BLOCK_START.test(lines[i]) && !HR.test(lines[i])) {
      para.push(lines[i])
      i++
    }
    out.push(`<p>${inlineMd(escapeHtml(para.join(' ')))}</p>`)
  }

  closeLists()
  return out.join('\n')
}

// ── srcDoc wrapper (dark theme matching the app) ────────────────────────────

const DOC_CSS = `
  :root { color-scheme: dark; }
  html,body { margin:0; background:#1e1e1e; color:#cccccc; }
  body { padding:16px 20px; font:13px/1.6 -apple-system,Segoe UI,Roboto,sans-serif; }
  pre,code { font-family:"Cascadia Code",Consolas,Menlo,monospace; font-size:12.5px; }
  pre { background:#252526; border:1px solid #3e3e42; border-radius:4px; padding:12px; overflow:auto; }
  code { background:#2d2d2d; padding:1px 4px; border-radius:3px; }
  pre code { background:none; padding:0; }
  .doc-json .k { color:#9cdcfe; } .doc-json .s { color:#ce9178; }
  .doc-json .n { color:#b5cea8; } .doc-json .b { color:#569cd6; }
  h1,h2,h3,h4,h5,h6 { color:#e8e8e8; line-height:1.3; margin:1.2em 0 .5em; }
  h1 { border-bottom:1px solid #3e3e42; padding-bottom:.3em; }
  a { color:#4ec9b0; } hr { border:none; border-top:1px solid #3e3e42; }
  blockquote { margin:.5em 0; padding:.2em 1em; border-left:3px solid #3e3e42; color:#a0a0a0; }
  ul,ol { padding-left:1.6em; } li { margin:.2em 0; }
  table { border-collapse:collapse; } td,th { border:1px solid #3e3e42; padding:4px 8px; }
`

export function buildDocSrcDoc(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${DOC_CSS}</style></head><body>${bodyHtml}</body></html>`
}

// ── Detection ───────────────────────────────────────────────────────────────

export type DocMode = 'json' | 'markdown'

export function detectDocMode(contentType: string, url: string): DocMode | null {
  const ct = contentType.toLowerCase()
  let path = ''
  try { path = new URL(url).pathname.toLowerCase() } catch { path = url.toLowerCase() }

  if (ct.includes('application/json') || ct.includes('+json') || path.endsWith('.json')) return 'json'
  if (ct.includes('markdown') || path.endsWith('.md') || path.endsWith('.markdown')) return 'markdown'
  return null
}
