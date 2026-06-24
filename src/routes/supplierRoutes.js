const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const supplierLedgerController = require('../controllers/supplierLedgerController'); // ADD
const supplierPaymentController = require('../controllers/supplierPaymentController');

// Get all suppliers
router.get('/', supplierController.getAllSuppliers);

// Get active suppliers (for dropdowns)
router.get('/active', supplierController.getActiveSuppliers);

// ── Ledger routes ──────────────────────────────────────────────────────────
router.get('/balances', supplierLedgerController.getAllSupplierBalances);  // ADD
router.get('/:supplierId/ledger', supplierLedgerController.getSupplierLedger); // ADD
router.post('/:supplierId/ledger', supplierLedgerController.createManualEntry); // ADD

// Get single supplier  ← must come AFTER /active and /balances
router.get('/:id', supplierController.getSupplierById);

// Create supplier
router.post('/', supplierController.createSupplier);

// Update supplier
router.put('/:id', supplierController.updateSupplier);

// Delete supplier
router.delete('/:id', supplierController.deleteSupplier);

// Toggle supplier status
router.patch('/:id/toggle-status', supplierController.toggleSupplierStatus);

router.post('/:supplierId/payments', supplierPaymentController.createSupplierPayment);

router.get('/:supplierId/payments', supplierPaymentController.getSupplierPayments);

router.delete('/:supplierId/payments/:paymentId', supplierPaymentController.deleteSupplierPayment);


module.exports = router;