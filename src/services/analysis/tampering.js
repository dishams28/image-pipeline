const sharp = require('sharp');

const ELA_MEAN_THRESHOLD = 12; // above this, flag as "possibly edited"

/**
 * Error Level Analysis (ELA): re-save the image at a known JPEG quality,
 * then diff it against the original pixel-by-pixel. Regions that were
 * edited/composited after the last save tend to have a different
 * compression error signature than the rest of the (untouched) image,
 * showing up as localized bright spots in the ELA diff.
 *
 * We only compute a *global* mean/stddev of the diff here (cheap, no
 * region segmentation) as a coarse "was this likely re-saved/edited"
 * signal -- not a pinpoint tamper-region detector. Also inherently
 * weaker for already-low-quality or non-JPEG source images; that
 * caveat is surfaced in `details`.
 */
async function detectTampering(imagePath) {
  const original = sharp(imagePath);
  const metadata = await original.metadata();

  const originalRaw = await original.clone().ensureAlpha(false).raw().toBuffer({ resolveWithObject: true });
  const resaved = await original.clone().jpeg({ quality: 90 }).toBuffer();
  const resavedRaw = await sharp(resaved).raw().toBuffer({ resolveWithObject: true });

  const a = originalRaw.data;
  const b = resavedRaw.data;
  const n = Math.min(a.length, b.length);

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = Math.abs(a[i] - b[i]);
    sum += diff;
    sumSq += diff * diff;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const stddev = Math.sqrt(Math.max(variance, 0));

  const flagged = mean > ELA_MEAN_THRESHOLD;

  return {
    checkName: 'tampering_ela',
    passed: !flagged,
    severity: flagged ? 'warning' : 'info',
    score: Number(mean.toFixed(2)),
    message: flagged
      ? `Elevated compression-error signature (ELA mean ${mean.toFixed(1)}) - image may have been edited or re-saved`
      : `No strong tampering signature (ELA mean ${mean.toFixed(1)})`,
    details: {
      elaMean: mean,
      elaStdDev: Number(stddev.toFixed(2)),
      threshold: ELA_MEAN_THRESHOLD,
      sourceFormat: metadata.format,
      caveat: 'Global ELA only; not localized. Less reliable for already-heavily-compressed or non-JPEG originals.',
    },
  };
}

module.exports = { detectTampering };
