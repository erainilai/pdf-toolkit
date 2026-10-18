# PDF Toolkit

A self-hostable document toolkit: the everyday [iLovePDF](https://www.ilovepdf.com/)-style PDF
tools, plus Office ↔ PDF, Tamil OCR and font conversion, an exam photo/signature resizer,
background removal, a GST invoice generator and spreadsheet tools. Files are processed and then
deleted — nothing is kept or sent to third parties.

## Run it

```bash
npm install          # also downloads the 4.6 MB background-removal model into models/
npm start
```

Then open http://localhost:4321

On Linux x64, set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` before `npm install` so onnxruntime
doesn't download CUDA libraries you don't need.

## Tools

| Category | Tool | Runs | Notes |
|---|---|---|---|
| Popular | Exam Photo & Signature | Browser | TNPSC, SSC, IBPS, UPSC, passport presets; exact px + KB range; optional name/date strip |
| | Word / Excel / PPT to PDF | Server | Needs LibreOffice |
| | GST Invoice Generator | Server | CGST+SGST or IGST from GSTIN/place of supply, GSTIN check digit, amount in words (lakh/crore), Tamil text |
| PDF | Merge, Split, Remove/Extract pages, Rotate, Organize | Server | |
| | Watermark, Page Numbers | Server | Unicode fonts — Tamil and ₹ work |
| | Compress PDF | Server | Re-compresses embedded images (no Ghostscript needed); never returns a bigger file |
| Convert | Images → PDF | Server | JPG, PNG, WebP, AVIF, TIFF, GIF, iPhone HEIC; EXIF rotation applied |
| | PDF → Images / Text / Word / PowerPoint | Server | Word/PPT need LibreOffice; layout kept as positioned text boxes |
| Images | Remove Background | Server | U²-Net (ONNX); transparent PNG or solid white/blue for ID photos |
| | Convert & Compress Images | Server | JPG/PNG/WebP/AVIF, resize, quality |
| Tamil | Tamil OCR | Server | tesseract.js, Tamil + English data bundled; outputs searchable PDF + text |
| | Tamil Font Converter | Browser | Bamini / SunTommy ↔ Unicode |
| Data | Clean / Convert / Merge Excel & CSV | Server | Trim, drop empty rows/cols, dedupe by columns; XLSX ↔ CSV ↔ JSON; UTF-8 BOM so Excel shows Tamil |
| Security | Protect / Unlock | Server | Needs `qpdf` |

Every server tool is also available through the hosted job API (`/api/v1/jobs`, below) and through
`POST /api/tool/<name>` for the browser UI.

### Optional system tools

```bash
brew install qpdf                        # Protect / Unlock
brew install --cask libreoffice          # Office ↔ PDF (set SOFFICE_PATH if soffice isn't on PATH)
brew install ghostscript                 # optional, even stronger compression (see licensing note)
```

Everything else is pure Node (WebAssembly or prebuilt binaries) and works out of the box. The
Docker image includes qpdf, LibreOffice and Noto fonts.

## Stack

Node.js + Express backend, vanilla HTML/CSS/JS frontend (no build step). PDF manipulation via
`pdf-lib`; rendering via `pdfjs-dist` + `@napi-rs/canvas`; zipping multi-file results via
`archiver`. The hosted-service layer below adds `bullmq`/`ioredis` (job queue), Node's built-in
`node:sqlite` (API keys/jobs/usage — no native DB driver), `@aws-sdk/client-s3` (optional
storage backend), and `stripe` (billing). All MIT/Apache-2.0, confirmed with `npm view <pkg>
license` before adding.
`pdf-lib` (+ `@pdf-lib/fontkit` for Unicode/Tamil shaping); rendering via `pdfjs-dist` +
`@napi-rs/canvas`; images via `sharp`; OCR via `tesseract.js`; background removal via
`onnxruntime-node`; spreadsheets via `exceljs`; Office conversion via LibreOffice.

Adding a tool = one function in `src/lib/jobRegistry.js` (it is then exposed on both APIs) plus
one entry in the `TOOLS` list in `public/js/app.js`.

### Limits and privacy settings

See `.env.example`. The important ones for a public deployment: `MAX_UPLOAD_MB` (default 100),
`WEB_RATE_LIMIT_MAX` (per-IP limit on the browser routes, default 30/min), `TRUST_PROXY=1`
behind a load balancer, and `FILE_RETENTION_MINUTES` (job outputs deleted after 60 minutes by
default; inputs are deleted as soon as a job finishes).

---

## Commercial web app

The browser app is a full product: tool suites, search, accounts, plans, checkout, usage limits
and legal pages. Everything commercial is configured with environment variables (see
`.env.example`) — brand, prices, limits and payment keys — so a rebrand or price change is a
deploy setting, not a code change.

### Plans and limits

| | Guest | Free account | Day Pass | Pro |
|---|---|---|---|---|
| Tasks | 10/day | 20/day | 500 in 24 h | 500/day |
| File size | 20 MB | 25 MB | 100 MB | 100 MB |
| Files per task | 5 | 10 | 50 | 50 |
| OCR pages per task | 3 | 5 | 50 | 50 |
| Queue | normal | normal | priority | priority |
| Default price | — | — | ₹49 / $2.99 | ₹199/mo, ₹1,499/yr ($6.99 / $49.99) |

Guests are limited per IP address (clearing cookies doesn't reset it); accounts are limited per
account. A task that fails doesn't count against the daily allowance when submitted through the
async `/api/jobs` API; the synchronous `/api/*` browser routes count on submission regardless of
outcome. Browser-only tools (exam photo, Tamil font converter) never count — they don't touch
the server.

Day Pass and Pro are **prepaid periods** that don't auto-renew. That keeps UPI (most Indian
payments) simple, avoids mandate/recurring-billing setup, and matches what Indian customers
expect. Buying again stacks time on top. Recurring subscriptions can be added later on the same
`entitlements` table.

### Checkout: Razorpay (India) and Stripe (international)

- **₹ prices → Razorpay**: UPI, cards, netbanking, wallets. Server creates an Order, the browser
  opens Razorpay Checkout, the server verifies the signature (HMAC of `order_id|payment_id`),
  makes sure the payment is captured, then activates the plan.
- **$ prices → Stripe Checkout**: cards, Apple Pay, Google Pay. Uses inline prices, so nothing
  needs creating in the Stripe dashboard. Shares the existing `STRIPE_SECRET_KEY` and webhook
  with the API's metered billing below — distinguished by `metadata.kind === 'web_plan'`.
- **Webhooks are the backstop** (user paid, then closed the tab): Razorpay
  `POST /api/webhooks/razorpay`, Stripe `POST /api/v1/stripe/webhook`. Plan activation is
  idempotent — browser confirmation, webhooks and retries grant exactly once — and the amount
  and currency are checked against what was priced.
- With only one gateway configured, the pricing page shows only that currency (Stripe can also
  charge INR if Razorpay isn't set up). With none, plans are shown but checkout is disabled.
- Which provider serves which currency is a plain config map (`src/config.js`'s `CURRENCIES`,
  consumed by `src/lib/payments/index.js`'s `providerFor()`) — switching or adding a gateway is
  a config change, not a code change.

Razorpay activation asks for terms, privacy, refund and contact pages — starter versions are at
`#/legal/*`. Highlighted text marks details only you can fill in; have them reviewed before
launch.

### Scaling

Everything that holds state is behind an environment switch, so the same code runs on a laptop
or across many machines:

| Concern | Single host (default) | Multi-host |
|---|---|---|
| Database (users, payments, jobs, quotas) | SQLite in `DATA_DIR` | `DATABASE_URL` → PostgreSQL |
| Job queue | In-process, bounded concurrency | `REDIS_URL` → BullMQ workers |
| Files | Local disk | `S3_BUCKET` |
| Rate limits | In memory | Redis |

- The browser app submits **asynchronous jobs** (`POST /api/jobs` → poll → download), so long
  OCR or Office conversions never hold an HTTP request open past load-balancer timeouts, and any
  web replica can serve any user.
- OCR, Office conversion and background removal run on a separate **heavy queue**
  (`WORKER_QUEUES=heavy`), so a burst of slow jobs can't starve quick merges. Paid plans get
  queue priority.
- `/readyz` checks the database and Redis (for load-balancer health checks); `SIGTERM` drains
  in-flight requests and jobs before exiting.
- `docker-compose.yml` runs the production shape on one machine: Postgres, Redis, web, a
  standard worker pool and a heavy worker pool —
  `docker compose up -d --scale web=2 --scale worker=4 --scale worker-heavy=2`.

### Security

Passwords are hashed with scrypt; sessions are random tokens stored hashed, in `HttpOnly`,
`SameSite=Lax` cookies (`Secure` in production). State-changing browser requests must come from
the same origin. Sign-in and checkout are rate limited. A Content-Security-Policy allows only
this site plus Razorpay Checkout; the UI uses system fonts rather than a web-font CDN, so
visitors' browsers make no third-party requests except to the payment window.

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

# Tools that need no upload take everything in options, e.g. a GST invoice:
curl -H "X-API-Key: $KEY" -F tool=gst-invoice \
  -F 'options={"invoice":{"invoiceNo":"INV-1","seller":{"name":"Acme","gstin":"33…"},"items":[{"description":"Service","qty":1,"rate":1000,"gstRate":18}]}}' \
  http://localhost:4321/api/v1/jobs

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

### Billing (Stripe)

Each API key can be linked to a Stripe subscription on a **metered** price. Every completed
job reports one usage event to Stripe (or bytes-out, if you set `STRIPE_METER_UNIT=bytes_out`);
Stripe aggregates and invoices automatically. A key with no Stripe customer linked (the
default) is simply unmetered — nothing breaks if you never touch this.

**One-time Stripe setup** (test mode to start — [dashboard.stripe.com/test](https://dashboard.stripe.com/test)):

1. **Meters** page → Create meter. Event name: `pdf_toolkit_jobs` (must match
   `STRIPE_METER_EVENT_NAME`), aggregation: Sum.
2. **Product catalog** → Create product → Usage-based price → pick the meter from step 1,
   set your per-unit rate, monthly billing. Copy the Price ID (`price_...`).
3. Get your secret key from **Developers → API keys** (`sk_test_...`).
4. For webhooks locally: `stripe listen --forward-to localhost:4321/api/v1/stripe/webhook`
   prints a `whsec_...` signing secret. In production, add the same URL under
   **Developers → Webhooks** and subscribe to `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.

Set the four `STRIPE_*` vars from `.env.example`, then:

```bash
# Customer self-serve: get a Stripe Checkout link for their own key
curl -X POST -H "X-API-Key: $KEY" \
  -d '{"email":"customer@example.com"}' -H "Content-Type: application/json" \
  http://localhost:4321/api/v1/billing/checkout-session
# → {"url": "https://checkout.stripe.com/..."}  — send/open this; they add a card and subscribe

curl -H "X-API-Key: $KEY" http://localhost:4321/api/v1/billing/status
# → {"status": "active", ...}   (flips from "pending" once checkout completes, via webhook)

curl -H "X-API-Key: $KEY" http://localhost:4321/api/v1/billing/invoice-preview
```

Keys whose billing status isn't `none` / `pending` / `active` / `trialing` (e.g. `past_due`,
`canceled`, `unpaid` — Stripe's own subscription status strings, kept in sync via webhook) get
a `402` on new job submissions. They can still reach `/billing/status` and download results
from jobs they already paid for.

Usage reporting to Stripe never fails a job — if Stripe is down or misconfigured, the error is
logged (`[billing] failed to report usage event ...`) and the customer still gets their PDF;
nothing here can turn your own product's availability into a Stripe outage.

**Note on Stripe's own guidance:** Stripe currently points *new* usage-based billing
integrations at [Metronome](https://docs.stripe.com/billing/usage-based) (a separate platform
Stripe partners with) for anything beyond simple pay-as-you-go — prepaid credits, contracts,
multiple pricing dimensions. The Billing Meters API used here remains fully supported and is
the right fit for straightforward per-job metering like this; moving to Metronome later is a
separate integration, not a refactor of this code.

### What's still manual beyond this

Before taking real payments:

- **Email**: there's no email sending yet, so no password-reset or receipt emails. Add an SMTP /
  transactional email provider and a reset-token flow.
- **GST invoices for your own sales**: as a GST-registered seller you must issue a tax invoice
  for each sale. The account page lists payments; generating an invoice PDF per payment can
  reuse the existing GST invoice tool's rendering code.
- **Legal pages**: fill in the highlighted placeholders on `#/legal/*` and have them reviewed.
- **Developer API keys** are still issued by the operator via CLI (see above) — there's no
  self-serve signup/key-delivery flow for hosted `/api/v1` consumers.
- TLS termination and monitoring (put this behind a reverse proxy / managed load balancer).

### Licensing note for hosted deployment

`Dockerfile` installs `qpdf` (Apache-2.0 — safe to bundle) so Protect/Unlock work out of the
box in containers. It deliberately does **not** install Ghostscript: Ghostscript's open-source
license is AGPL, and bundling it inside an image you distribute/run as a paid service is a
different situation than a user installing it on their own machine. Compress still works without
it, using the built-in image recompression pass. If you want Ghostscript-grade compression in a hosted
deployment, get a commercial license from Artifex rather than adding `apt-get install
ghostscript` to the Dockerfile.

### Third-party data bundled in this repo

- `assets/fonts/` — Noto Sans and Noto Sans Tamil, SIL Open Font License 1.1.
- `public/js/lib/tamilFontData.js` — Bamini/SunTommy tables derived from
  [app-tamil-fonts-unicode-converter](https://github.com/ag-sanjjeev/app-tamil-fonts-unicode-converter)
  (MIT, © 2023 ag-sanjjeev).
- Background-removal model (downloaded, not committed) — U²-Net, Apache-2.0.
- Tesseract language data — `@tesseract.js-data/*` npm packages, Apache-2.0.
- Exam photo presets (`public/data/exam-presets.json`) reflect commonly published specs as of
  Oct 2026; exam bodies change them, so the UI tells users to check their notification.
