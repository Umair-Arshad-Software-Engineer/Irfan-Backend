// backend/src/routes/simpleCashbookRoutes.js
const express = require('express');
const router = express.Router();
const simpleCashbookController = require('../controllers/simpleCashbookController');

router.get('/', simpleCashbookController.getSimpleCashbook);
router.post('/manual', simpleCashbookController.addManualEntry);
router.get('/summary/daily', simpleCashbookController.getDailySummary);
// PUT /simple-cashbook/:id/description
router.put('/:id/description', simpleCashbookController.updateEntryDescription);
// PUT /simple-cashbook/manual/:id
router.put('/manual/:id', simpleCashbookController.updateManualEntry);
router.delete('/:id', simpleCashbookController.deleteEntry);

module.exports = router;