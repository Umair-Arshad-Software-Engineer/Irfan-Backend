const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dailyExpenseController');

// ── Session routes ──────────────────────────────────────────────────────────
router.get('/', ctrl.getSessions);
router.get('/today', ctrl.getTodaySession);
router.get('/bills', ctrl.getBillPayments);  // ← before /:id

router.get('/:id', ctrl.getSession);
router.post('/', ctrl.createSession);
router.patch('/:id/opening-balance', ctrl.updateOpeningBalance);
router.patch('/:id/close', ctrl.closeSession);

// ── Entry routes ────────────────────────────────────────────────────────────
router.post('/:sessionId/expenses', ctrl.addExpense);
router.post('/:sessionId/supplier-payments', ctrl.addSupplierPayment);
router.post('/:sessionId/bill-payments', ctrl.addBillPayment);  // ← THIS WAS MISSING
router.delete('/:sessionId/entries/:entryId', ctrl.deleteEntry);

module.exports = router;