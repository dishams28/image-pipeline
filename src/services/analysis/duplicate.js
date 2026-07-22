const sharp = require('sharp');
const prisma = require('../../db/prisma');
const env = require('../../config/env');
const { hammingDistanceHex } = require('../../utils/hash');

/**
 * Average hash (aHash): resize to 8x8 grayscale, threshold each pixel
 * against the mean -> 64 bits -> 16 hex chars. Cheap and robust to
 * minor recompression/resizing, which is exactly the kind of "near
 * duplicate" we expect from field re-uploads.
 */
async function computeAHash(imagePath) {
  const { data } = await sharp(imagePath)
    .resize(8, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mean = data.reduce((a, b) => a + b, 0) / data.length;

  let bits = '';
  for (let i = 0; i < data.length; i++) {
    bits += data[i] >= mean ? '1' : '0';
  }

  // pack bits into hex
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Compares the new image's hash against a bounded lookback window of
 * previously processed images. A full-table scan-per-upload does not
 * scale; in production this would be an ANN index (e.g. pgvector, or a
 * dedicated perceptual-hash index) -- see README trade-offs.
 */
async function detectDuplicate(imagePath, currentJobId) {
  const aHash = await computeAHash(imagePath);

  const recentHashes = await prisma.imageHash.findMany({
    take: env.DUPLICATE_LOOKBACK_COUNT,
    orderBy: { createdAt: 'desc' },
    where: { jobId: { not: currentJobId } },
  });

  let closestMatch = null;
  let closestDistance = Infinity;

  for (const record of recentHashes) {
    const distance = hammingDistanceHex(aHash, record.aHash);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestMatch = record;
    }
  }

  const isDuplicate = closestMatch && closestDistance <= env.DUPLICATE_HASH_DISTANCE_THRESHOLD;

  return {
    aHash,
    result: {
      checkName: 'duplicate',
      passed: !isDuplicate,
      severity: isDuplicate ? 'warning' : 'info',
      score: closestMatch ? closestDistance : null,
      message: isDuplicate
        ? `Image looks like a duplicate of job ${closestMatch.jobId} (hash distance ${closestDistance})`
        : 'No close duplicate found in recent history',
      details: {
        hammingDistance: closestMatch ? closestDistance : null,
        matchedJobId: isDuplicate ? closestMatch.jobId : null,
        threshold: env.DUPLICATE_HASH_DISTANCE_THRESHOLD,
        comparedAgainst: recentHashes.length,
      },
    },
  };
}

module.exports = { computeAHash, detectDuplicate };
