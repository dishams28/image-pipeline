const exifr = require('exifr');
const fs = require('fs/promises');

/**
 * Pulls EXIF metadata (camera make/model, timestamps, software tag, GPS).
 * This is used both as a standalone informational check and as an input
 * signal for the screenshot/tampering heuristics below.
 *
 * Note: EXIF is trivially strippable, so absence of EXIF is only ever
 * treated as a *weak* signal, never a hard failure on its own.
 */
async function extractExif(imagePath) {
  const buffer = await fs.readFile(imagePath);
  let exif = null;
  try {
    exif = await exifr.parse(buffer, { tiff: true, exif: true, gps: true });
  } catch (err) {
    exif = null; // corrupt/absent EXIF segment - not fatal
  }

  const hasCameraInfo = Boolean(exif && (exif.Make || exif.Model));
  const editedWithSoftware = Boolean(exif && exif.Software && /photoshop|gimp|snapseed|lightroom/i.test(exif.Software));

  const flags = [];
  if (!hasCameraInfo) flags.push('no_camera_metadata');
  if (editedWithSoftware) flags.push('editing_software_tag_present');

  return {
    checkName: 'metadata',
    passed: flags.length === 0,
    severity: editedWithSoftware ? 'warning' : 'info',
    score: null,
    message:
      flags.length === 0
        ? 'EXIF metadata present with camera info, no editing software tag'
        : `Metadata flags: ${flags.join(', ')}`,
    details: {
      hasExif: Boolean(exif),
      hasCameraInfo,
      make: exif?.Make || null,
      model: exif?.Model || null,
      software: exif?.Software || null,
      dateTimeOriginal: exif?.DateTimeOriginal || null,
      gps: exif?.latitude ? { lat: exif.latitude, lon: exif.longitude } : null,
      flags,
    },
    // exposed for reuse by other heuristics (not persisted separately)
    _raw: { hasCameraInfo, editedWithSoftware },
  };
}

module.exports = { extractExif };
