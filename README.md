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

