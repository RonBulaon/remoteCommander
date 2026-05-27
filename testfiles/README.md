# Test files for the Web Console document viewer

These files exercise the Web Console tab's inline viewers (**PDF / JSON / Markdown**)
and normal HTML rendering. The Web Console only loads `http(s)` URLs — local
`file://` paths are blocked by design — so serve this folder over HTTP first.

> Run the server on the **same machine** the app runs on.

## 1. Start the local server

```bash
node testfiles/serve.mjs          # serves http://127.0.0.1:8080/
# pick another port:  PORT=9000 node testfiles/serve.mjs
```

It binds to `127.0.0.1` only and sets the right `Content-Type` for each file
(`.md` → `text/markdown`, `.json` → `application/json`, `.pdf` → `application/pdf`),
which the viewer's content-type detection relies on.

## 2. Add a Web Console profile

- **Protocol:** Web Console
- **URL:** `http://127.0.0.1:8080/`

Double-click it; the landing page links to every test file. Or paste a file URL
straight into the address bar, e.g. `http://127.0.0.1:8080/sample.json`.

## What each file checks

| File | What it tests |
|------|---------------|
| `index.html` | Normal HTML rendering, clickable links |
| `sample.json` | JSON pretty-print + highlighting + Raw/Formatted toggle |
| `sample.md` | Markdown rendering (plus an unsupported table, on purpose) |
| `sample.pdf` | Inline PDF (Chromium PDFium) |

## Regenerating the PDF

`sample.pdf` is produced by a small generator (no dependencies):

```bash
node testfiles/make-pdf.mjs
```

## Note on Markdown scope

The renderer is a deliberate compact subset: headings, lists, code blocks, inline
code, blockquotes, horizontal rules, links, **bold**/*italic*. **Tables and complex
nesting are not supported** and will show as raw text — that's expected.
