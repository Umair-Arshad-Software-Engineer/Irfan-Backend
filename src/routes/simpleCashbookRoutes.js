// backend/src/routes/simpleCashbookRoutes.js
const express = require('express');
const router = express.Router();
const simpleCashbookController = require('../controllers/simpleCashbookController');

router.get('/', simpleCashbookController.getSimpleCashbook);
router.post('/manual', simpleCashbookController.addManualEntry);
router.get('/summary/daily', simpleCashbookController.getDailySummary);
router.delete('/:id', simpleCashbookController.deleteEntry);

module.exports = router;