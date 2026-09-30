// backend/src/routes/supplierReturnRoutes.js
const express = require('express');
const router = express.Router();
const supplierReturnController = require('../controllers/supplierReturnController');

// Get all supplier returns
router.get('/', supplierReturnController.getAllSupplierReturns);

// Get single supplier return
router.get('/:id', supplierReturnController.getSupplierReturnById);

// Create supplier return
router.post('/', supplierReturnController.createSupplierReturn);

// Delete supplier return
router.delete('/:id', supplierReturnController.deleteSupplierReturn);

module.exports = router;