const { PrismaClient } = require('@prisma/client');

// A single shared Prisma client instance across the app/worker process.
// Avoids exhausting the Postgres connection pool from repeated instantiation
// (a common footgun with hot-reload/dev servers).
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
