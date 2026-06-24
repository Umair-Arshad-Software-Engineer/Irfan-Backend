// backend/src/routes/customerLedgerRoutes.js
const express = require('express');
const router = express.Router();
const customerLedgerController = require('../controllers/customerLedgerController');

router.get('/summary', customerLedgerController.getAllCustomersLedgerSummary);
router.get('/:customerId', customerLedgerController.getCustomerLedger);
router.post('/:customerId/adjustment', customerLedgerController.addAdjustment);
// router.get('/:customerId/payments', customerLedgerController.getCustomerPayments);


module.exports = router;