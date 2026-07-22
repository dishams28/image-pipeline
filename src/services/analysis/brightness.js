const sharp = require('sharp');

const LOW_LIGHT_THRESHOLD = 60; // mean pixel value out of 255
const OVEREXPOSED_THRESHOLD = 220;

/**
 * Uses sharp's built-in stats() (fast, native libvips histogram) to get
 * the mean luminance of the image. Flags both under- and over-exposed
 * images since both hurt downstream OCR/plate-reading accuracy.
 */
async function analyzeBrightness(imagePath) {
  const stats = await sharp(imagePath).grayscale().stats();
  const mean = stats.channels[0].mean; // 0-255

  let issue = null;
  if (mean < LOW_LIGHT_THRESHOLD) issue = 'low_light';
  else if (mean > OVEREXPOSED_THRESHOLD) issue = 'overexposed';

  return {
    checkName: 'brightness',
    passed: !issue,
    severity: issue ? 'warning' : 'info',
    score: Number(mean.toFixed(2)),
    message: issue
      ? `Image is ${issue === 'low_light' ? 'too dark' : 'overexposed'} (mean brightness ${mean.toFixed(1)}/255)`
      : `Brightness looks acceptable (mean ${mean.toFixed(1)}/255)`,
    details: { meanBrightness: mean, lowLightThreshold: LOW_LIGHT_THRESHOLD, overexposedThreshold: OVEREXPOSED_THRESHOLD, issue },
  };
}

module.exports = { analyzeBrightness };
