const { Queue } = require('bullmq');
const connection = require('./connection');

const QUEUE_NAME = 'image-analysis';

// Central queue used by the API (producer) and the worker (consumer).
// Retry/backoff strategy:
//   - 3 attempts total, exponential backoff starting at 5s.
//   - Covers transient failures (disk hiccup, OCR worker crash) without
//     hammering the system on deterministic failures (e.g. corrupt file),
//     which will exhaust retries and land in `failed` with a clear reason.
const imageQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

module.exports = { imageQueue, QUEUE_NAME };
