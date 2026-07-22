const prisma = require('../db/prisma');
const storageService = require('../services/storage.service');
const { imageQueue } = require('../queue/imageQueue');
const logger = require('../config/logger');

/**
 * POST /api/v1/images
 *
 * Flow:
 *   1. Validate presence of file (multer already validated type/size).
 *   2. Persist bytes to storage.
 *   3. Create ImageJob row with status=pending.
 *   4. Enqueue a BullMQ job referencing the ImageJob id.
 *   5. Return 202 Accepted with the id immediately -- the client polls
 *      GET /api/v1/images/:id for status, per the async requirement.
 */
async function uploadImage(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided (field name must be "image")' });
    }

    const { storedFilename, storagePath } = await storageService.saveBuffer(
      req.file.buffer,
      req.file.originalname
    );

    const job = await prisma.imageJob.create({
      data: {
        originalFilename: req.file.originalname,
        storedFilename,
        storagePath,
        mimeType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        status: 'pending',
      },
    });

    await imageQueue.add(
      'analyze-image',
      { jobId: job.id },
      { jobId: job.id } // idempotency: BullMQ dedupes on jobId if retried by caller
    );

    logger.info({ jobId: job.id }, 'Image uploaded and queued for analysis');

    return res.status(202).json({
      id: job.id,
      status: job.status,
      message: 'Image accepted for processing',
      statusUrl: `/api/v1/images/${job.id}`,
      resultsUrl: `/api/v1/images/${job.id}/results`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadImage };
