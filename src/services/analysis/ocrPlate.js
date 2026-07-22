const { createWorker } = require('tesseract.js');
const sharp = require('sharp');

// Standard Indian registration plate format: SS DD LL(L) DDDD
// e.g. "KA05MH1234", "MH12AB1234", "DL3CAB1234"
// SS = state code (2 letters), DD = RTO code (1-2 digits),
// L(L)(L) = series (1-3 letters), DDDD = 4 digit unique number.
const PLATE_REGEX = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/;

function normalizeCandidate(rawText) {
  return rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Scans OCR output for substrings that match the plate regex. We slide
 * over the cleaned text because Tesseract may merge the plate with
 * surrounding noise (borders, stickers, watermarks) into one blob.
 */
function findPlateCandidates(cleanedText) {
  const candidates = new Set();
  for (let start = 0; start < cleanedText.length; start++) {
    for (let len = 8; len <= 11 && start + len <= cleanedText.length; len++) {
      const chunk = cleanedText.slice(start, start + len);
      if (PLATE_REGEX.test(chunk)) candidates.add(chunk);
    }
  }
  return Array.from(candidates);
}

let workerPromise = null;
function getWorker() {
  // Lazily initialize a single shared Tesseract worker per process
  // (the worker instance is expensive to spin up - avoid doing it per job).
  if (!workerPromise) {
    workerPromise = createWorker('eng');
  }
  return workerPromise;
}

async function runOcr(imagePath) {
  // Upscale + grayscale + normalize contrast tends to noticeably improve
  // Tesseract accuracy on small/blurry plate regions.
  const preprocessed = await sharp(imagePath)
    .resize({ width: 1600, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .toBuffer();

  const worker = await getWorker();
  const { data } = await worker.recognize(preprocessed);
  return data.text || '';
}

async function extractAndValidatePlate(imagePath) {
  let rawText = '';
  let ocrError = null;
  try {
    rawText = await runOcr(imagePath);
  } catch (err) {
    ocrError = err.message;
  }

  if (ocrError) {
    return {
      checkName: 'ocr_plate',
      passed: false,
      severity: 'warning',
      score: null,
      message: `OCR failed: ${ocrError}`,
      details: { ocrError },
      detectedPlateText: null,
      isPlateFormatValid: false,
    };
  }

  const cleaned = normalizeCandidate(rawText);
  const candidates = findPlateCandidates(cleaned);
  const bestMatch = candidates[0] || null;

  return {
    checkName: 'ocr_plate',
    passed: Boolean(bestMatch),
    severity: bestMatch ? 'info' : 'warning',
    score: candidates.length,
    message: bestMatch
      ? `Detected valid-format plate candidate: ${bestMatch}`
      : 'No valid-format Indian plate number found in OCR text',
    details: {
      rawOcrTextSample: rawText.slice(0, 200),
      candidatesFound: candidates,
      plateRegex: PLATE_REGEX.toString(),
    },
    detectedPlateText: bestMatch,
    isPlateFormatValid: Boolean(bestMatch),
  };
}

async function terminateOcrWorker() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

module.exports = { extractAndValidatePlate, terminateOcrWorker, PLATE_REGEX };
