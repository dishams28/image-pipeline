# Vehicle Image Processing Pipeline

An async backend that accepts vehicle photos uploaded from the field, queues them
for analysis, and detects likely issues (blur, low light, duplicates,
screenshots/re-photographs, possible tampering, invalid plate format) so a
human reviewer can triage uploads faster instead of eyeballing every one.

## Stack

- **API**: Node.js + Express
- **Queue**: BullMQ (Redis-backed)
- **DB**: PostgreSQL via Prisma ORM
- **Image processing**: `sharp` (libvips) for pixel-level heuristics, `tesseract.js` for OCR, `exifr` for metadata
- **Containerization**: Docker + docker-compose (Postgres, Redis, API, Worker)

No cloud account, API keys, or GPU required — everything runs locally.

---

## Architecture

### Service flow (upload)

```
Client
  │  POST /api/v1/images (multipart "image")
  ▼
Express API ──▶ multer validates size/mime ──▶ storage.service saves file to disk
  │
  ▼
Prisma creates ImageJob row (status = pending)
  │
  ▼
BullMQ: imageQueue.add({ jobId })         ◀── jobId used as BullMQ job id (idempotent re-enqueue)
  │
  ▼
API responds 202 Accepted { id, statusUrl, resultsUrl }   ← client never blocks on analysis
```

### Processing flow (worker, separate process)

```
BullMQ Worker (concurrency: 2)
  │
  ▼
Job picked up ──▶ ImageJob.status = processing (persisted immediately)
  │
  ▼
runAllChecks(imagePath, jobId)   [src/services/analysis/index.js]
  ├─ blur              (Laplacian variance)
  ├─ brightness        (mean luminance, over/under-exposure)
  ├─ dimensions        (min resolution)
  ├─ duplicate         (aHash + Hamming distance vs. recent history)
  ├─ metadata (EXIF)   (camera info, editing-software tag)
  ├─ screenshot/re-photo (resolution match + EXIF + flat status-bar + glare)
  ├─ tampering (ELA)   (JPEG re-save diff)
  └─ ocr_plate         (Tesseract OCR + Indian plate regex)
        │
        │  Promise.allSettled — one check throwing never kills the job
        ▼
computeOverallScore(results)   [src/services/scoring.service.js]
  → aggregated issueCount + 0-1 riskScore (weighted by severity)
  │
  ▼
Prisma transaction: write AnalysisResult rows + ImageHash + update ImageJob
  (status = completed, or failed if something outside the checks throws)
```

### Queue strategy

- **BullMQ over Redis** was chosen over an in-memory queue because the brief
  asks for reliability/retries, and BullMQ gives durable persistence, retry
  backoff, and concurrency control out of the box without extra plumbing.
  An in-memory queue would lose all pending jobs on an API restart.
- **API and worker are separate processes** (`src/server.js` vs.
  `src/queue/worker.js`), each independently scalable — the whole point of
  making analysis async is that CPU-heavy OCR/pixel work shouldn't block the
  HTTP request thread.
- **Retries**: 3 attempts, exponential backoff (5s, 10s, 20s). Covers
  transient failures (disk hiccup, OCR worker init). The job is only marked
  `failed` in Postgres once BullMQ has exhausted all attempts, so the status
  API doesn't flip-flop between `failed` and `processing` mid-retry.
- **`jobId` doubles as the BullMQ job id**, so re-submitting the same
  `imageQueue.add()` call is naturally deduped.

### Major design decisions

| Decision | Reasoning |
|---|---|
| Each check is its own `AnalysisResult` row, not a fixed set of columns | Adding a 9th heuristic later is an `INSERT`, not an `ALTER TABLE`. Keeps the schema stable while heuristics evolve. |
| `sharp` instead of native OpenCV bindings | `sharp` ships prebuilt binaries for every major platform/arch and covers everything this pipeline needs (raw pixel access, stats, resize). Avoids the OpenCV native-build/Docker-image-size headache for a take-home. |
| One check failing doesn't fail the job | A corrupt-enough image to break OCR shouldn't erase the blur/brightness/dimension results that *did* succeed. Failure isolation per check, `Promise.allSettled`. |
| Denormalized summary fields on `ImageJob` (`overallRiskScore`, `detectedPlateText`, etc.) | Lets list/filter queries (`GET /images?status=completed`) avoid joining/aggregating `AnalysisResult` on every request. Full breakdown is still available via `/results`. |
| Local disk storage behind a small `storage.service` interface | Swapping to S3/GCS later only touches one file. No cloud credentials needed to run this take-home. |
| Weighted-sum risk score, not a trained classifier | The brief explicitly says the goal is "structure uncertainty," not ML accuracy. A transparent, tunable weight table is more debuggable than a black-box score for a human reviewer. |

---

## API Reference

### `POST /api/v1/images`
Upload an image (`multipart/form-data`, field name `image`, max 10MB, jpeg/png/webp/heic).

**Response `202 Accepted`**
```json
{
  "id": "1b2c3d4e-...",
  "status": "pending",
  "message": "Image accepted for processing",
  "statusUrl": "/api/v1/images/1b2c3d4e-...",
  "resultsUrl": "/api/v1/images/1b2c3d4e-.../results"
}
```

### `GET /api/v1/images/:id`
Lightweight status poll.
```json
{
  "id": "1b2c3d4e-...",
  "status": "processing",
  "queuedAt": "2026-07-22T09:00:00.000Z",
  "processingStartedAt": "2026-07-22T09:00:02.000Z",
  "processingEndedAt": null
}
```

### `GET /api/v1/images/:id/results`
Full structured analysis. Returns `409` while `pending`/`processing`.
```json
{
  "id": "1b2c3d4e-...",
  "status": "completed",
  "vehicle": { "detectedPlateText": "KA05MH1234", "isPlateFormatValid": true },
  "overall": { "issueCount": 1, "riskScore": 0.15 },
  "checks": [
    { "checkName": "blur", "passed": true, "severity": "info", "score": 412.3, "message": "...", "details": { "...": "..." } },
    { "checkName": "duplicate", "passed": false, "severity": "warning", "score": 3, "message": "Image looks like a duplicate of job ...", "details": { "...": "..." } }
  ]
}
```

### `GET /api/v1/images?status=completed&limit=20&offset=0`
Paginated listing (dashboard/QA use).

### `GET /health`
Basic liveness check.

---

## Running locally

### Option A — Docker Compose (recommended)
```bash
cp .env.example .env
docker compose up --build
```
This starts Postgres, Redis, the API (port 3000), and the worker, and runs
migrations automatically on API startup.

### Option B — Manual (Node + local Postgres/Redis)
```bash
npm install
cp .env.example .env        # point DATABASE_URL / REDIS_HOST at your instances
npx prisma migrate dev --name init
npm run dev                 # API on :3000
npm run dev:worker           # separate terminal — the worker process
```

### Seeding sample data
```bash
node scripts/seed.js
```
Generates a handful of synthetic sample images (clean plate, blurry, low
light, invalid plate format, screenshot-shaped) and uploads them through the
real HTTP API so you can immediately poll `/results` and see the pipeline
work end-to-end.

### Running tests
```bash
npm test
```
Covers the pure-logic pieces (plate regex, Hamming distance, risk scoring) —
see [Trade-offs](#trade-offs) for what's *not* covered.

### Sample request
```bash
curl -X POST http://localhost:3000/api/v1/images \
  -F "image=@./scripts/_seed_tmp/clean_valid_plate.jpg"

curl http://localhost:3000/api/v1/images/<id>/results
```

---

## AI Usage Disclosure (mandatory)

I used Claude throughout this assignment as a hands-on pair-programmer, not
as a one-shot code generator. Breakdown:

**Where AI helped:**
- Scaffolding the repetitive boilerplate (Express routes, Prisma schema
  shape, Dockerfile/docker-compose structure) so more time could go into the
  actual heuristics and system design.
- Drafting the initial versions of the blur (Laplacian variance) and
  duplicate-detection (average hash) implementations from the well-known
  algorithms, then hand-checking the math (kernel definition, bit-packing
  into hex) against reference descriptions of each technique.
- Brainstorming which signals combine into the screenshot/re-photo and
  tampering heuristics, since the brief explicitly says perfect accuracy
  isn't the point — AI was useful for enumerating *candidate* signals
  (known screen resolutions, EXIF absence, flat status-bar strip, ELA) that
  I then had to judge for reasonableness and pick a combination rule for.
- Writing this README's structure.

**Where AI output was wrong or needed correction:**
- The first draft of the ELA (tampering) check compared raw buffers of
  different lengths when the recompressed JPEG had a different color
  channel count than the source — had to add explicit `ensureAlpha(false)`
  and clamp to `Math.min(a.length, b.length)` to avoid a silent
  out-of-bounds read.
- An early version of the plate regex was too permissive (didn't bound the
  RTO code digit count), which produced false-positive matches — tightened
  to `[0-9]{1,2}` after checking real Indian plate format references.
- The initial BullMQ retry config didn't guard against writing `status =
  failed` after every failed *attempt* (not just the final one), which
  would have made the status API show `failed` and then flip back to
  `processing` on retry. Fixed by checking `attemptsMade >= opts.attempts`
  in the `failed` event handler.

**How I validated AI-generated code:**
- Manually traced through each heuristic's math by hand against a couple of
  constructed examples (e.g., verifying the Hamming-distance helper against
  known bit patterns — see `tests/analysis.test.js`).
- Reasoned through the async failure paths explicitly (what happens if the
  DB write fails mid-transaction, what happens if OCR throws, what happens
  if BullMQ retries exhaust) rather than trusting the generated try/catch
  scaffolding at face value.
- Cross-checked the Indian vehicle plate format against publicly documented
  RTO conventions rather than trusting a remembered regex.

---

## Trade-offs

**Intentionally simplified:**
- Heuristics are hand-tuned thresholds (blur variance, brightness range,
  ELA mean, Hamming distance), not calibrated against a labeled dataset —
  there isn't one available for this exercise. Thresholds are called out
  as constants at the top of each check file so they're easy to retune.
- Screenshot/photo-of-photo detection is a signal-combination heuristic,
  explicitly documented as "heuristic-only, low-to-medium reliability" in
  the API response itself (`details.confidence`), not a trained classifier.
- Tampering detection (ELA) is global (whole-image mean/stddev), not
  region-segmented — it can say "this image shows compression-error
  irregularities" but not "this specific 200x200 patch was edited."
- Duplicate detection does a bounded lookback scan (last N hashes) rather
  than a proper similarity index — fine at demo scale, not at scale (see
  below).
- No auth/API-key layer — out of scope for the assignment, but the first
  thing to add before any real deployment.

**What I'd improve with more time:**
- Replace the linear duplicate-detection scan with a proper vector/ANN
  index (e.g. `pgvector` storing the hash as a bit-vector, or a dedicated
  perceptual-hash index) so duplicate checks stay O(log n) as history grows.
- Add a lightweight ML classifier (even a small CNN or a hosted vision API)
  for screenshot/tampering detection as a second opinion alongside the
  heuristics, surfaced as an additional independent check rather than a
  replacement — keeps the transparent heuristic path auditable.
- Region-level ELA (block-wise variance map) to actually localize
  suspected edited regions instead of a single global score.
- Object storage (S3-compatible) instead of local disk — the storage
  service is already behind an interface so this is a contained change.
- Structured request tracing (correlation id per upload propagated through
  queue job → worker logs) for easier debugging under load.

**Scalability concerns:**
- Worker concurrency is fixed at 2 per process; horizontal scaling means
  running more worker containers, which BullMQ supports natively (it's
  designed for multiple consumers on the same queue) — no code change
  needed, just `docker compose up --scale worker=N`.
- Tesseract OCR is the most CPU/latency-heavy check by far; under high
  upload volume this is the first thing to profile and likely the first
  candidate to move to a dedicated OCR service/queue with its own scaling.
- Local disk storage does not scale across multiple worker hosts without a
  shared volume or object storage — flagged above as the top storage
  improvement.

**Failure handling concerns:**
- If the worker process crashes mid-transaction, BullMQ's at-least-once
  delivery means the job will be retried; the Prisma transaction wrapping
  the result writes ensures a partial write (some `AnalysisResult` rows
  saved, others not) can't happen — either the whole batch commits or none
  of it does.
- If Redis is temporarily unavailable when a job is enqueued, the upload
  API call itself will fail loudly (500) rather than silently losing the
  upload — the ImageJob row would already exist, though, which is a known
  gap: a follow-up reconciliation job (find `pending` ImageJobs older than
  N minutes with no corresponding queue entry, re-enqueue them) would close
  this, and is the first thing I'd add next.

---

## Assumptions

- "Vehicle number" refers to the standard Indian registration plate format
  (`SS DD LLL DDDD`, e.g. `KA05MH1234`); the OCR check is scoped to that
  format per the brief's "Indian number plate format validation" example.
- A single image maps to a single processing job; batch/multi-image upload
  is out of scope.
- "Duplicate" means visually near-identical (perceptual hash match), not
  byte-identical file — the latter would miss re-compressed/re-sized
  re-uploads of the same photo, which is the realistic field scenario.
- Uploads are trusted-but-unverified field photos (no user auth layer was
  requested by the brief), so abuse mitigation is limited to file-type/size
  validation and basic IP rate limiting on the upload endpoint.
