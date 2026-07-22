/**
 * Generates a handful of synthetic sample images (sharp-rendered SVGs
 * rasterized to JPEG/PNG) covering the main scenarios the pipeline is
 * meant to catch, then uploads each one through the real HTTP API.
 *
 * Usage:
 *   node scripts/seed.js
 * Requires the API server to already be running on PORT (see .env).
 */
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config();

const API_BASE = `http://localhost:${process.env.PORT || 3000}/api/v1`;
const TMP_DIR = path.join(__dirname, '_seed_tmp');

function plateSvg(text, opts = {}) {
  const { blur = 0, dark = false, width = 900, height = 600 } = opts;
  const bg = dark ? '#111' : '#dfe6ee';
  return `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${bg}"/>
    <rect x="${width * 0.25}" y="${height * 0.55}" width="${width * 0.5}" height="${height * 0.12}" fill="white" stroke="black" stroke-width="4"/>
    <text x="${width / 2}" y="${height * 0.64}" font-size="42" font-family="monospace" font-weight="bold" text-anchor="middle" fill="black">${text}</text>
    <rect x="${width * 0.2}" y="${height * 0.15}" width="${width * 0.6}" height="${height * 0.3}" fill="#8899aa"/>
  </svg>`;
}

const samples = [
  { name: 'clean_valid_plate.jpg', svg: plateSvg('KA05MH1234'), blur: 0 },
  { name: 'blurry_plate.jpg', svg: plateSvg('MH12AB1234'), blur: 15 },
  { name: 'low_light.jpg', svg: plateSvg('DL3CAB1234', { dark: true }), blur: 0 },
  { name: 'invalid_plate_format.jpg', svg: plateSvg('ABCDEF'), blur: 0 },
  { name: 'screenshot_like.png', svg: plateSvg('KA05MH1234', { width: 1080, height: 1920 }), blur: 0, png: true },
];

async function buildSamples() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const files = [];
  for (const sample of samples) {
    const outPath = path.join(TMP_DIR, sample.name);
    let pipeline = sharp(Buffer.from(sample.svg));
    if (sample.blur > 0) pipeline = pipeline.blur(sample.blur);
    if (sample.png) await pipeline.png().toFile(outPath);
    else await pipeline.jpeg().toFile(outPath);
    files.push(outPath);
  }
  return files;
}

async function uploadFile(filePath) {
  const buffer = await fs.readFile(filePath);
  const form = new FormData();
  const blob = new Blob([buffer]);
  form.append('image', blob, path.basename(filePath));

  const res = await fetch(`${API_BASE}/images`, { method: 'POST', body: form });
  const json = await res.json();
  console.log(`Uploaded ${path.basename(filePath)} -> ${res.status}`, json);
  return json;
}

async function main() {
  console.log('Building synthetic sample images...');
  const files = await buildSamples();

  console.log('\nUploading samples to', API_BASE);
  const uploaded = [];
  for (const file of files) {
    uploaded.push(await uploadFile(file));
  }

  console.log('\nSeed complete. Poll these with:');
  for (const job of uploaded) {
    if (job.id) console.log(`  curl ${API_BASE}/images/${job.id}/results`);
  }
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
