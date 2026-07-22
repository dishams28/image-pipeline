require('dotenv').config();

function int(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: int(process.env.PORT, 3000),

  DATABASE_URL: process.env.DATABASE_URL,

  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: int(process.env.REDIS_PORT, 6379),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,

  STORAGE_DIR: process.env.STORAGE_DIR || './uploads',
  MAX_UPLOAD_MB: int(process.env.MAX_UPLOAD_MB, 10),

  DUPLICATE_HASH_DISTANCE_THRESHOLD: int(process.env.DUPLICATE_HASH_DISTANCE_THRESHOLD, 6),
  DUPLICATE_LOOKBACK_COUNT: int(process.env.DUPLICATE_LOOKBACK_COUNT, 500),

  RATE_LIMIT_WINDOW_MS: int(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  RATE_LIMIT_MAX: int(process.env.RATE_LIMIT_MAX, 30),
};

module.exports = env;
