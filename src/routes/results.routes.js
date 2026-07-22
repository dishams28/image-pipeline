const express = require('express');
const { getStatus, getResults, listJobs } = require('../controllers/results.controller');

const router = express.Router();

router.get('/images', listJobs);
router.get('/images/:id', getStatus);
router.get('/images/:id/results', getResults);

module.exports = router;
