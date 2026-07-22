const IORedis = require('ioredis');
const env = require('../config/env');

// BullMQ requires maxRetriesPerRequest: null on the connection it manages.
const connection = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

module.exports = connection;
