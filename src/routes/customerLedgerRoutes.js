// backend/src/routes/customerLedgerRoutes.js
const express = require('express');
const router = express.Router();
const customerLedgerController = require('../controllers/customerLedgerController');

// Get all customers ledger summary
router.get('/summary', customerLedgerController.getAllCustomersLedgerSummary);

// Get customer ledger entries
router.get('/:customerId', customerLedgerController.getCustomerLedger);

// Get customer payments (separate endpoint)
router.get('/:customerId/payments', customerLedgerController.getCustomerPayments);

// Add manual adjustment
router.post('/:customerId/adjustment', customerLedgerController.addAdjustment);

// Delete adjustment
router.delete('/:customerId/ledger/:adjustmentId', customerLedgerController.deleteAdjustment);

// ⚠️ COMMENTED OUT - These methods don't exist yet in the controller
// router.patch('/customer-ledger/:ledgerEntryId/cheque-status', customerLedgerController.updateChequeClearedStatus);
// router.get('/payments/:paymentId', customerLedgerController.getPaymentDetails);

module.exports = router;