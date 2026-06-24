// backend/src/routes/purchaseOrderRoutes.js
const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');
const purchaseReceiptController = require('../controllers/purchaseReceiptController');

// ── Purchase Order routes ──────────────────────────────────────────────────
router.get('/',           purchaseOrderController.getAllPurchaseOrders);
router.get('/:id',        purchaseOrderController.getPurchaseOrderById);
router.post('/',          purchaseOrderController.createPurchaseOrder);
router.patch('/:id/status', purchaseOrderController.updatePurchaseOrderStatus);
router.delete('/:id',     purchaseOrderController.deletePurchaseOrder);   // draft only

// ── Purchase Receipt routes ────────────────────────────────────────────────
router.post('/receipts',                     purchaseReceiptController.createPurchaseReceipt);
router.get('/receipts/:id',                  purchaseReceiptController.getPurchaseReceiptById);  // ← ADD
router.delete('/receipts/:id',               purchaseReceiptController.deletePurchaseReceipt);
router.get('/:purchaseOrderId/receipts',     purchaseReceiptController.getReceiptsByPurchaseOrder);



module.exports = router;