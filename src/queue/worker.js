const { Worker } = require('bullmq');
const connection = require('./connection');
const { QUEUE_NAME } = require('./imageQueue');
const prisma = require('../db/prisma');
const logger = require('../config/logger');
const storageService = require('../services/storage.service');
const { runAllChecks } = require('../services/analysis');
const { computeOverallScore } = require('../services/scoring.service');
const { terminateOcrWorker } = require('../services/analysis/ocrPlate');

/**
 * Processes one ImageJob end-to-end:
 *   pending -> processing -> (completed | failed)
 *
 * Design notes:
 *  - Status transitions are written to Postgres immediately so the
 *    status API always reflects reality even mid-processing.
 *  - Individual check failures (see analysis/index.js) do NOT fail the
 *    whole job -- they're recorded as failed *checks*. The job only
 *    moves to `failed` if something outside the checks blows up
 *    (missing file, DB write failure, uncaught exception), which is
 *    exactly the class of error BullMQ's retry/backoff should retry.
 *  - concurrency: 2 keeps CPU-heavy OCR/pixel work from saturating a
 *    single small instance while still allowing some parallelism.
 */
async function processJob(bullJob) {
  const { jobId } = bullJob.data;

  const imageJob = await prisma.imageJob.findUnique({ where: { id: jobId } });
  if (!imageJob) throw new Error(`ImageJob ${jobId} not found - cannot process`);

  await prisma.imageJob.update({
    where: { id: jobId },
    data: { status: 'processing', processingStartedAt: new Date() },
  });

  const imagePath = storageService.resolvePath(imageJob.storagePath);

  const { results, aHash, detectedPlateText, isPlateFormatValid } = await runAllChecks(imagePath, jobId);
  const { overallIssueCount, overallRiskScore } = computeOverallScore(results);

  await prisma.$transaction(async (tx) => {
    await tx.analysisResult.createMany({
      data: results.map((r) => ({
        jobId,
        checkName: r.checkName,
        passed: r.passed,
        severity: r.severity,
        score: r.score ?? null,
        message: r.message,
        details: r.details ?? {},
      })),
    });

    if (aHash) {
      await tx.imageHash.create({ data: { jobId, aHash } });
    }

    await tx.imageJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        processingEndedAt: new Date(),
        overallIssueCount,
        overallRiskScore,
        detectedPlateText,
        isPlateFormatValid,
      },
    });
  });

  logger.info({ jobId, overallIssueCount, overallRiskScore }, 'Image analysis completed');
  return { overallIssueCount, overallRiskScore };
}

const worker = new Worker(
  QUEUE_NAME,
  async (bullJob) => {
    try {
      return await processJob(bullJob);
    } catch (err) {
      // Let BullMQ's retry/backoff handle transient errors. Only record
      // `failed` in Postgres once all attempts are exhausted (see
      // 'failed' event below) so the status API doesn't flip-flop
      // pending/failed/pending across retries.
      logger.error({ jobId: bullJob.data.jobId, attempt: bullJob.attemptsMade, err }, 'Job attempt failed');
      throw err;
    }
  },
  { connection, concurrency: 2 }
);

worker.on('failed', async (bullJob, err) => {
  if (!bullJob) return;
  const isFinalAttempt = bullJob.attemptsMade >= (bullJob.opts.attempts || 1);
  if (!isFinalAttempt) return;

  await prisma.imageJob.update({
    where: { id: bullJob.data.jobId },
    data: { status: 'failed', failureReason: err.message, processingEndedAt: new Date() },
  }).catch((e) => logger.error({ e }, 'Failed to persist failure state'));
});

worker.on('completed', (bullJob) => {
  logger.debug({ jobId: bullJob.data.jobId }, 'Worker reported job completed');
});

logger.info('Image analysis worker started');

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down worker gracefully');
  await worker.close();
  await terminateOcrWorker();
  process.exit(0);
});

module.exports = worker;
