const express = require('express');
const router = express.Router();
const bankController = require('../controllers/bankController');
const bankTransactionController = require('../controllers/bankTransactionController');
const bankTransferController = require('../controllers/bankTransferController'); // Add this


// ═══════════════════════════════════════════════════════════════════════════
// ✅ STATIC ROUTES FIRST - BEFORE ANY PARAM ROUTES (:id, :bank_id)
// ═══════════════════════════════════════════════════════════════════════════

// Initialize default banks
router.post('/initialize', bankController.initializeDefaultBanks);

// Transfer between banks
router.post('/transfer', bankController.transferBetweenBanks);

// Payment out from bank (for supplier payments, etc)
router.post('/payment-out', bankTransactionController.recordBankPaymentOut);

// Get summary
router.get('/summary', bankController.getBankSummary);

// Get active banks
router.get('/active', bankController.getActiveBanks);

// ═══════════════════════════════════════════════════════════════════════════
// ✅ TRANSFER ROUTES - Following the pattern from the comment
// ═══════════════════════════════════════════════════════════════════════════

// Get all transfers (optionally filter by bank_id query param)
router.get('/transfers', bankTransferController.getAllTransfers);

// Create new transfer between banks
router.post('/transfers', bankTransferController.transferBetweenBanks);

// Reverse/delete a transfer by ID
router.delete('/transfers/:id', bankTransferController.reverseTransfer);

// ═══════════════════════════════════════════════════════════════════════════
// ✅ COLLECTION ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// Get all banks
router.get('/', bankController.getAllBanks);

// Create new bank
router.post('/', bankController.createBank);

// ═══════════════════════════════════════════════════════════════════════════
// ✅ PARAM ROUTES LAST - THESE USE :id AND :bank_id
// ═══════════════════════════════════════════════════════════════════════════

// Get single bank by ID
router.get('/:id', bankController.getBankById);

// Update bank
router.put('/:id', bankController.updateBank);

// Delete bank
router.delete('/:id', bankController.deleteBank);

// Toggle bank status
router.patch('/:id/toggle-status', bankController.toggleBankStatus);

// ═══════════════════════════════════════════════════════════════════════════
// ✅ TRANSACTION ROUTES - USING :bank_id PARAM
// ═══════════════════════════════════════════════════════════════════════════

// Add transaction to bank
router.post('/:bank_id/transactions', bankTransactionController.addTransaction);

// Get all transactions for a bank
router.get('/:bank_id/transactions', bankTransactionController.getBankTransactions);

// Get transaction summary
router.get('/:bank_id/transactions/summary', bankTransactionController.getTransactionSummary);

// Delete transaction
router.delete('/:bank_id/transactions/:transaction_id', bankTransactionController.deleteTransaction);

module.exports = router;