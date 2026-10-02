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
| Protect / Unlock PDF | Needs `qpdf` installed (bundled automatically in the Docker image) |

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

---

## Running it as a hosted service

The browser UI above (`/api/*`) is synchronous, unauthenticated, and meant for one person on
one machine. There's a second, parallel API — `/api/v1/*` — built for selling this as a hosted
service to multiple customers: API-key auth, a job queue, usage metering, and storage that
scales past one disk. Same PDF logic underneath (`src/lib/pdfOps.js`, `src/lib/security.js`);
the v1 layer just wraps it with the plumbing a real product needs.

It runs in one of two modes, chosen entirely by environment variables — no code fork:

| | **Inline mode** (default) | **Redis mode** |
|---|---|---|
| Trigger | `REDIS_URL` unset | `REDIS_URL` set |
| Where jobs run | Same process as the web server | Separate `src/worker.js` process(es) via BullMQ |
| Scaling | Single process | Add worker replicas independently of the web tier |
| Needs Redis? | No | Yes |

### Quick start (Docker Compose — Redis mode, horizontally scalable)

```bash
docker compose up -d --build
docker compose exec web node scripts/manage-keys.mjs create --name "Acme Inc"
# → prints an id and a one-time API key (pdftk_...)
```

Scale PDF processing independently of the web tier:

```bash
docker compose up -d --scale worker=4
```

### API key management

```bash
npm run keys -- create --name "Customer name"   # prints id + one-time key
npm run keys -- list
npm run keys -- revoke <id>
```

Keys are stored hashed (SHA-256) in SQLite (`DATA_DIR/app.db`, via Node's built-in
`node:sqlite` — no native DB driver to compile). There's no self-serve signup; keys are
issued by whoever operates the service.

### v1 API

Every request needs `X-API-Key: <key>` (or `Authorization: Bearer <key>`). Requests are
rate-limited per key (`API_RATE_LIMIT_MAX` per `API_RATE_LIMIT_WINDOW_MS`, default 60/min) —
Redis-backed when `REDIS_URL` is set, so the limit holds across every web replica, not just
one process.

```bash
# List available tools
curl -H "X-API-Key: $KEY" http://localhost:4321/api/v1/tools

# Submit a job (tool name + JSON options, matching the tool's fields in src/lib/jobRegistry.js)
curl -H "X-API-Key: $KEY" \
  -F "files=@input.pdf" \
  -F "tool=rotate" \
  -F 'options={"angle":90,"pages":"all"}' \
  http://localhost:4321/api/v1/jobs
# → {"id": "...", "status": "queued", "statusUrl": "/api/v1/jobs/..."}

# Poll for completion
curl -H "X-API-Key: $KEY" http://localhost:4321/api/v1/jobs/<id>
# → {"status": "completed", "files": [{"name": "rotated.pdf", "url": "/api/v1/jobs/<id>/files/rotated.pdf"}]}

# Download a result
curl -H "X-API-Key: $KEY" -OJ http://localhost:4321/api/v1/jobs/<id>/files/rotated.pdf

# Usage (for metering/billing)
curl -H "X-API-Key: $KEY" http://localhost:4321/api/v1/usage
```

Jobs and API keys are scoped per key — one customer can never see or fetch another's job,
even by guessing the job id.

### Storage

Job inputs/outputs default to local disk (`DATA_DIR/storage`). Set `S3_BUCKET` (+
`S3_REGION`) to use S3 instead — **required once you run more than one host**, since a local
disk isn't shared across machines. `docker-compose.yml` uses a shared Docker volume as a
single-host stand-in for S3.

### What's still manual beyond this

This gets you queue + storage + auth + metering. Still missing for a real commercial launch:
billing integration (Stripe etc. — `usage_events` in SQLite gives you the raw numbers to bill
from), a signup/key-delivery flow, TLS termination (put this behind a reverse proxy / managed
load balancer), and structured monitoring. The PDF logic itself needed none of this — it was
already stateless per-request.

### Licensing note for hosted deployment

`Dockerfile` installs `qpdf` (Apache-2.0 — safe to bundle) so Protect/Unlock work out of the
box in containers. It deliberately does **not** install Ghostscript: Ghostscript's open-source
license is AGPL, and bundling it inside an image you distribute/run as a paid service is a
different situation than a user installing it on their own machine. Compress still works via
pdf-lib's basic pass without it. If you want Ghostscript-grade compression in a hosted
deployment, get a commercial license from Artifex rather than adding `apt-get install
ghostscript` to the Dockerfile.
