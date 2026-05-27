// Rasterize the logo SVG into the app's icon PNGs.
//
// electron-builder auto-generates the per-platform icon.ico (Windows) and icon.icns (macOS)
// from build/icon.png at packaging time, so we only need a high-res master PNG here.
//
// Usage (one-time rasterizer install, then run from anywhere):
//   cd remoteCommander && npm install --no-save @resvg/resvg-js
//   node ../imgs/generate-icons.mjs        # (or: node imgs/generate-icons.mjs from repo root)

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Resolve @resvg/resvg-js from the app folder's node_modules regardless of cwd.
const require = createRequire(new URL('../remoteCommander/package.json', import.meta.url))
const { Resvg } = require('@resvg/resvg-js')

const here = (p) => new URL(p, import.meta.url)
const SOURCE = './logo.svg' // the implemented Remote Commander logo (secure shield + prompt)

const svg = readFileSync(here(SOURCE), 'utf8')
const png = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

writeFileSync(here('../remoteCommander/build/icon.png'), png(1024)) // electron-builder master (≥512; 1024 ideal)
writeFileSync(here('../remoteCommander/resources/icon.png'), png(512)) // bundled runtime window icon

console.log('✓ wrote remoteCommander/build/icon.png (1024) and remoteCommander/resources/icon.png (512) from', SOURCE)
