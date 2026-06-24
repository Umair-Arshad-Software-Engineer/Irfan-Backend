// backend/src/routes/customerRoutes.js
const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const customerLedgerController = require('../controllers/customerLedgerController');
const customerPaymentController = require('../controllers/customerPaymentController');

// Customer CRUD routes
router.get('/', customerController.getAllCustomers);
router.get('/active', customerController.getActiveCustomers);
router.get('/balances', customerLedgerController.getAllCustomersLedgerSummary);
router.get('/:id', customerController.getCustomerById);
router.post('/', customerController.createCustomer);
router.put('/:id', customerController.updateCustomer);
router.delete('/:id', customerController.deleteCustomer);
router.patch('/:id/toggle-status', customerController.toggleCustomerStatus);
router.patch('/:id/update-balance', customerController.updateCustomerBalance);

// Customer Ledger routes
router.get('/:customerId/ledger', customerLedgerController.getCustomerLedger);
router.post('/:customerId/adjustment', customerLedgerController.addAdjustment);

// Customer Payment routes
router.post('/:customerId/payments', customerPaymentController.createCustomerPayment);
router.get('/:customerId/payments', customerPaymentController.getCustomerPayments);
router.delete('/:customerId/payments/:paymentId', customerPaymentController.deleteCustomerPayment);
router.get('/payments/:paymentId', customerPaymentController.getPaymentDetails);
router.patch('/payments/cheque/:ledgerEntryId/clear', customerPaymentController.updateChequeClearedStatus);

module.exports = router;