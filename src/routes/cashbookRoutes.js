// backend/src/routes/cashbookRoutes.js
const express = require('express');
const router = express.Router();
const cashbookController = require('../controllers/cashbookController');

router.get('/', cashbookController.getCashbook);
router.post('/manual', cashbookController.addManualEntry);
router.get('/summary/daily', cashbookController.getDailySummary);
router.put('/:id', cashbookController.editManualEntry);
router.delete('/:id', cashbookController.deleteEntry);


module.exports = router;