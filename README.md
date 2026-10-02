# PDF Toolkit

A locally runnable PDF toolkit covering the most-used [iLovePDF](https://www.ilovepdf.com/)-style
tools: merge, split, compress, rotate, organize, watermark, page numbers, protect/unlock,
images↔PDF conversion, and text extraction. Everything runs on your own machine — files are
processed in memory/temp files and never sent anywhere else.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:4321

## Features

| Tool | Notes |
|---|---|
| Merge PDF | Combine any number of PDFs |
| Split PDF | By custom ranges or every N pages |
| Remove / Extract pages | Page-range based |
| Rotate PDF | 90°/180°/270°, all or selected pages |
| Organize Pages | Drag-to-reorder thumbnails, delete pages |
| Watermark | Text watermark with color/opacity/rotation/position |
| Page Numbers | Custom position, start number, format |
| Images → PDF | JPG/PNG to a single PDF |
| PDF → Images | Export pages as PNG/JPG |
| PDF → Text | Extract all text |
| Compress PDF | Basic (always available) or strong (needs Ghostscript) |
| Protect / Unlock PDF | Needs `qpdf` installed |

### Optional system tools

Two features use optional system binaries for stronger results, and fall back gracefully or
tell you what's missing if they're absent:

```bash
brew install qpdf         # enables Protect / Unlock (password encryption)
brew install ghostscript  # enables stronger PDF compression
```

Without these, every other tool still works fully; Compress falls back to a basic
(pdf-lib based) compression pass.

## Stack

Node.js + Express backend, vanilla HTML/CSS/JS frontend (no build step). PDF manipulation via
`pdf-lib`; rendering via `pdfjs-dist` + `@napi-rs/canvas`; zipping multi-file results via
`archiver`.
