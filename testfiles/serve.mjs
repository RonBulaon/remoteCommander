// Zero-dependency static file server for the Web Console test files.
// Serves its own directory over http://127.0.0.1:<PORT> with correct MIME types
// (the viewer's content-type detection depends on .md → text/markdown, etc.).
//
//   node testfiles/serve.mjs            → http://127.0.0.1:8080/
//   PORT=9000 node testfiles/serve.mjs

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath of a directory URL keeps a trailing slash; strip it so the
// containment check below compares against `<root><sep>` cleanly.
let root = fileURLToPath(new URL('.', import.meta.url))
if (root.endsWith(sep)) root = root.slice(0, -1)
const port = Number(process.env.PORT) || 8080

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

createServer(async (req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  if (urlPath === '/') urlPath = '/index.html'

  // Contain the request inside the served directory.
  const filePath = normalize(join(root, urlPath))
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('forbidden')
    return
  }

  try {
    const data = await readFile(filePath)
    res.writeHead(200, { 'content-type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`testfiles → http://127.0.0.1:${port}/`)
})
