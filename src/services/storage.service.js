const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');

/**
 * Storage is deliberately behind a tiny interface (`saveBuffer`/`resolvePath`)
 * so swapping local disk for S3/GCS later only touches this one file --
 * nothing upstream (controllers, worker) needs to know where bytes
 * physically live. For this take-home, local disk keeps the setup to
 * "docker compose up" with no cloud credentials required.
 */
async function ensureStorageDir() {
  await fs.mkdir(env.STORAGE_DIR, { recursive: true });
}

function buildStoredFilename(originalFilename) {
  const ext = path.extname(originalFilename) || '.jpg';
  return `${uuidv4()}${ext}`;
}

async function saveBuffer(buffer, originalFilename) {
  await ensureStorageDir();
  const storedFilename = buildStoredFilename(originalFilename);
  const storagePath = path.join(env.STORAGE_DIR, storedFilename);
  await fs.writeFile(storagePath, buffer);
  return { storedFilename, storagePath };
}

function resolvePath(storagePath) {
  return path.resolve(storagePath);
}

module.exports = { saveBuffer, resolvePath, ensureStorageDir };
