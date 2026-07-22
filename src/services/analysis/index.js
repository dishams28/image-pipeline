const { detectBlur } = require('./blur');
const { analyzeBrightness } = require('./brightness');
const { detectDuplicate } = require('./duplicate');
const { validateDimensions } = require('./dimensions');
const { extractExif } = require('./exifMeta');
const { detectScreenshot } = require('./screenshot');
const { detectTampering } = require('./tampering');
const { extractAndValidatePlate } = require('./ocrPlate');

/**
 * Runs every check against a single image and returns a flat list of
 * results ready to persist as AnalysisResult rows, plus the pieces
 * needed to update the parent ImageJob's denormalized summary fields.
 *
 * Checks are run with Promise.allSettled: one check throwing (e.g. a
 * corrupt image confusing the OCR engine) must not take down the whole
 * job -- it should be recorded as a failed *check*, while the other
 * checks still complete normally. The job as a whole only moves to
 * `failed` if something outside the checks themselves blows up (see
 * worker.js).
 */
async function runAllChecks(imagePath, jobId) {
  const exifResult = await extractExif(imagePath).catch((err) => ({
    checkName: 'metadata', passed: false, severity: 'warning', score: null,
    message: `EXIF extraction failed: ${err.message}`, details: {}, _raw: { hasCameraInfo: false },
  }));

  const [
    blur,
    brightness,
    dimensions,
    duplicateOutcome,
    screenshot,
    tampering,
    ocrPlate,
  ] = await Promise.allSettled([
    detectBlur(imagePath),
    analyzeBrightness(imagePath),
    validateDimensions(imagePath),
    detectDuplicate(imagePath, jobId),
    detectScreenshot(imagePath, exifResult._raw),
    detectTampering(imagePath),
    extractAndValidatePlate(imagePath),
  ]);

  const results = [exifResult];
  let aHash = null;

  function unwrap(settled, checkName) {
    if (settled.status === 'fulfilled') return settled.value;
    return {
      checkName,
      passed: false,
      severity: 'warning',
      score: null,
      message: `Check "${checkName}" threw an error: ${settled.reason?.message || settled.reason}`,
      details: { error: String(settled.reason) },
    };
  }

  results.push(unwrap(blur, 'blur'));
  results.push(unwrap(brightness, 'brightness'));
  results.push(unwrap(dimensions, 'dimensions'));

  if (duplicateOutcome.status === 'fulfilled') {
    aHash = duplicateOutcome.value.aHash;
    results.push(duplicateOutcome.value.result);
  } else {
    results.push(unwrap(duplicateOutcome, 'duplicate'));
  }

  results.push(unwrap(screenshot, 'screenshot_or_rephoto'));
  results.push(unwrap(tampering, 'tampering_ela'));

  const ocrResult = unwrap(ocrPlate, 'ocr_plate');
  results.push(ocrResult);

  return {
    results,
    aHash,
    detectedPlateText: ocrResult.detectedPlateText ?? null,
    isPlateFormatValid: ocrResult.isPlateFormatValid ?? false,
  };
}

module.exports = { runAllChecks };
