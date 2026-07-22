const sharp = require('sharp');

// Common device/screen resolutions. Exact matches are a strong screenshot signal.
const KNOWN_SCREEN_RESOLUTIONS = [
  [1170, 2532], [1080, 1920], [1080, 2400], [1440, 3200], [828, 1792],
  [750, 1334], [1242, 2688], [1284, 2778], [1920, 1080], [2560, 1440],
  [1366, 768], [1536, 864],
];

function isKnownScreenResolution(width, height) {
  return KNOWN_SCREEN_RESOLUTIONS.some(
    ([w, h]) => (width === w && height === h) || (width === h && height === w)
  );
}

/**
 * Heuristic screenshot / photo-of-photo detector. This is explicitly a
 * *heuristic combination*, not a trained classifier -- see README for
 * limitations. Signals combined:
 *
 *  1. Exact match against common device screen resolutions.
 *  2. Missing camera EXIF (screenshots have no camera Make/Model, and
 *     a photo of a screen taken on a phone still *will* have EXIF --
 *     so this mainly helps catch true screenshots, not re-photographs).
 *  3. Uniform, low-variance top strip (status bar) -- screenshots
 *     typically have a flat-color row of pixels at the very top.
 *  4. Very low color diversity overall, common in UI screenshots
 *     versus photos of physical scenes.
 *
 * "Photo of a photo" (re-photographing a printed/screen image) is
 * intentionally scored as a *softer* signal here (glare/moire patterns
 * are hard to detect reliably without a trained model); it piggybacks
 * on the same "no camera EXIF" + "known screen resolution" signals plus
 * a hot-spot glare check.
 */
async function detectScreenshot(imagePath, exifRaw) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  const resolutionMatch = isKnownScreenResolution(width, height);

  // Top 5% strip - check variance (flat = likely a status bar)
  const stripHeight = Math.max(1, Math.round(height * 0.05));
  const stats = await image.clone().extract({ left: 0, top: 0, width, height: stripHeight }).grayscale().stats();
  const topStripStdDev = stats.channels[0].stdev;

  // Glare hotspot check: fraction of near-white pixels (>250) - a common
  // artifact of photographing a glossy screen/printed photo.
  const { data } = await image.clone().resize({ width: 256 }).grayscale().raw().toBuffer({ resolveWithObject: true });
  let brightPixels = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > 250) brightPixels++;
  const brightFraction = brightPixels / data.length;

  const noCameraInfo = !exifRaw?.hasCameraInfo;

  const screenshotSignals = [
    resolutionMatch && 'known_screen_resolution',
    noCameraInfo && 'no_camera_exif',
    topStripStdDev < 5 && 'flat_status_bar_region',
  ].filter(Boolean);

  const photoOfPhotoSignals = [
    brightFraction > 0.03 && 'glare_hotspot',
    noCameraInfo && 'no_camera_exif',
  ].filter(Boolean);

  const isLikelyScreenshot = screenshotSignals.length >= 2;
  const isLikelyPhotoOfPhoto = !isLikelyScreenshot && photoOfPhotoSignals.length >= 2;

  const flagged = isLikelyScreenshot || isLikelyPhotoOfPhoto;

  return {
    checkName: 'screenshot_or_rephoto',
    passed: !flagged,
    severity: flagged ? 'warning' : 'info',
    score: Number((screenshotSignals.length + photoOfPhotoSignals.length).toFixed(2)),
    message: isLikelyScreenshot
      ? `Image looks like a screenshot (signals: ${screenshotSignals.join(', ')})`
      : isLikelyPhotoOfPhoto
      ? `Image may be a photo-of-a-photo/screen (signals: ${photoOfPhotoSignals.join(', ')})`
      : 'No screenshot/re-photograph signals detected',
    details: {
      width, height, resolutionMatch, topStripStdDev, brightFraction,
      screenshotSignals, photoOfPhotoSignals, confidence: 'heuristic-only, low-to-medium reliability',
    },
  };
}

module.exports = { detectScreenshot };
