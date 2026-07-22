const sharp = require('sharp');

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const MIN_MEGAPIXELS = 0.3;

/**
 * Rejects images too small to reliably contain a readable number plate.
 * Cheap metadata-only read (no pixel decode needed).
 */
async function validateDimensions(imagePath) {
  const metadata = await sharp(imagePath).metadata();
  const { width, height } = metadata;
  const megapixels = (width * height) / 1_000_000;

  const tooSmall = width < MIN_WIDTH || height < MIN_HEIGHT || megapixels < MIN_MEGAPIXELS;

  return {
    checkName: 'dimensions',
    passed: !tooSmall,
    severity: tooSmall ? 'critical' : 'info',
    score: Number(megapixels.toFixed(2)),
    message: tooSmall
      ? `Image resolution too low for reliable analysis (${width}x${height})`
      : `Resolution acceptable (${width}x${height})`,
    details: { width, height, megapixels, minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT },
  };
}

module.exports = { validateDimensions };
