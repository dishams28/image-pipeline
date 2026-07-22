const multer = require('multer');
const logger = require('../config/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError || /Unsupported file type/.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }

  logger.error({ err }, 'Unhandled error');
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
}

module.exports = errorHandler;
