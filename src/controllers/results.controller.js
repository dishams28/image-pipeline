const prisma = require('../db/prisma');

/**
 * GET /api/v1/images/:id
 * Lightweight status check -- deliberately does NOT include the full
 * analysis payload so clients can poll this cheaply/frequently.
 */
async function getStatus(req, res, next) {
  try {
    const job = await prisma.imageJob.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    return res.json({
      id: job.id,
      status: job.status,
      failureReason: job.status === 'failed' ? job.failureReason : undefined,
      queuedAt: job.queuedAt,
      processingStartedAt: job.processingStartedAt,
      processingEndedAt: job.processingEndedAt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/images/:id/results
 * Full structured analysis output. Returns 409 while still pending/processing
 * so clients get a clear signal to keep polling rather than an empty body.
 */
async function getResults(req, res, next) {
  try {
    const job = await prisma.imageJob.findUnique({
      where: { id: req.params.id },
      include: { analysisResults: true },
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status === 'pending' || job.status === 'processing') {
      return res.status(409).json({
        error: `Job is still ${job.status}`,
        status: job.status,
        statusUrl: `/api/v1/images/${job.id}`,
      });
    }

    if (job.status === 'failed') {
      return res.status(200).json({
        id: job.id,
        status: job.status,
        failureReason: job.failureReason,
        checks: job.analysisResults, // may include partial results from before the failure
      });
    }

    return res.json({
      id: job.id,
      status: job.status,
      vehicle: {
        detectedPlateText: job.detectedPlateText,
        isPlateFormatValid: job.isPlateFormatValid,
      },
      overall: {
        issueCount: job.overallIssueCount,
        riskScore: job.overallRiskScore,
      },
      checks: job.analysisResults.map((r) => ({
        checkName: r.checkName,
        passed: r.passed,
        severity: r.severity,
        score: r.score,
        message: r.message,
        details: r.details,
      })),
      processingStartedAt: job.processingStartedAt,
      processingEndedAt: job.processingEndedAt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/images?status=&limit=&offset=
 * Simple listing endpoint - useful for a dashboard/bonus UI and for
 * manual QA during development.
 */
async function listJobs(req, res, next) {
  try {
    const { status, limit = '20', offset = '0' } = req.query;
    const where = status ? { status } : {};

    const [items, total] = await Promise.all([
      prisma.imageJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(limit, 10) || 20, 100),
        skip: parseInt(offset, 10) || 0,
        select: {
          id: true, status: true, originalFilename: true,
          overallIssueCount: true, overallRiskScore: true,
          detectedPlateText: true, isPlateFormatValid: true, createdAt: true,
        },
      }),
      prisma.imageJob.count({ where }),
    ]);

    return res.json({ total, items });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStatus, getResults, listJobs };
