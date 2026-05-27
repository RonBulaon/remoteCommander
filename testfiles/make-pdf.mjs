// Generates a minimal, valid single-page PDF (sample.pdf) with correct xref
// offsets — no dependencies. Text is ASCII-only so byte offsets are exact.
//
//   node testfiles/make-pdf.mjs

import { writeFileSync } from 'node:fs'

const stream = `BT
/F1 22 Tf
72 720 Td
(Remote Commander - PDF test) Tj
/F1 12 Tf
0 -40 Td
(If you can read this inline, the PDFium viewer is working.) Tj
0 -20 Td
(Served over http by testfiles/serve.mjs.) Tj
ET`

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
]

let pdf = '%PDF-1.4\n'
const offsets = []
objects.forEach((body, idx) => {
  offsets[idx] = Buffer.byteLength(pdf, 'latin1')
  pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`
})

const xrefStart = Buffer.byteLength(pdf, 'latin1')
pdf += `xref\n0 ${objects.length + 1}\n`
pdf += '0000000000 65535 f \n'
offsets.forEach((off) => {
  pdf += `${String(off).padStart(10, '0')} 00000 n \n`
})
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

writeFileSync(new URL('./sample.pdf', import.meta.url), Buffer.from(pdf, 'latin1'))
console.log('wrote sample.pdf')
