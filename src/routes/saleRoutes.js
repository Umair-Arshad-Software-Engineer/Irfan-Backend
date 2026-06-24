// ═══════════════════════════════════════════════════════════════════
//  FILE: backend/src/routes/saleRoutes.js
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');

router.get('/',                   saleController.getAllSales);
router.post('/',                  saleController.createSale);
router.get('/summary/daily',      saleController.getDailySummary);
router.get('/:id',                saleController.getSaleById);
router.put('/:id',                saleController.updateSale);
router.delete('/:id',             saleController.deleteSale);
router.post('/:id/payment',       saleController.recordPayment);
router.get('/credit/summary', saleController.getCreditSalesSummary);

module.exports = router;