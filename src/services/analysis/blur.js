const sharp = require('sharp');

// Below this variance, the image is considered "blurry". This threshold
// was picked empirically against a handful of sharp vs. blurred sample
// photos (not a rigorously tuned value) -- see README trade-offs section.
const BLUR_VARIANCE_THRESHOLD = 100;

/**
 * Classic "variance of Laplacian" blur metric:
 *  1. Convert to grayscale.
 *  2. Convolve with a Laplacian kernel (edge detector).
 *  3. A sharp image has high-frequency edges -> high variance in the
 *     Laplacian response. A blurry image has smoothed-out edges -> low variance.
 *
 * Implemented by hand on raw pixel buffers (no native OpenCV binding)
 * so the whole pipeline only depends on `sharp`, which ships prebuilt
 * binaries and is trivial to install/deploy.
 */
async function detectBlur(imagePath) {
  const width = 512; // downscale for speed; relative sharpness is preserved
  const { data, info } = await sharp(imagePath)
    .resize({ width, withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const laplacian = new Float32Array(w * h);

  // 3x3 Laplacian kernel: [0 1 0; 1 -4 1; 0 1 0]
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const val =
        data[idx - w] + data[idx + w] + data[idx - 1] + data[idx + 1] - 4 * data[idx];
      laplacian[idx] = val;
    }
  }

  let sum = 0;
  let sumSq = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    sum += laplacian[i];
    sumSq += laplacian[i] * laplacian[i];
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;

  const isBlurry = variance < BLUR_VARIANCE_THRESHOLD;

  return {
    checkName: 'blur',
    passed: !isBlurry,
    severity: isBlurry ? 'critical' : 'info',
    score: Number(variance.toFixed(2)),
    message: isBlurry
      ? `Image appears blurry (Laplacian variance ${variance.toFixed(1)} < threshold ${BLUR_VARIANCE_THRESHOLD})`
      : `Image sharpness looks acceptable (Laplacian variance ${variance.toFixed(1)})`,
    details: { laplacianVariance: variance, threshold: BLUR_VARIANCE_THRESHOLD },
  };
}

module.exports = { detectBlur, BLUR_VARIANCE_THRESHOLD };
