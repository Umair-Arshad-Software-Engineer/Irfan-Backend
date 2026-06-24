// routes/customerPriceRoutes.js
const express = require('express');
const router = express.Router();
const customerPriceController = require('../controllers/customerPriceController');



// Customer price routes
router.get('/', customerPriceController.getAllCustomerPrices);
router.get('/product/:productId/customer/:customerId', customerPriceController.getCustomerPrice);
router.post('/bulk', customerPriceController.getBulkCustomerPrices);
router.post('/', customerPriceController.setCustomerPrice);
router.delete('/:id', customerPriceController.deleteCustomerPrice);
router.patch('/:id/toggle-status', customerPriceController.toggleCustomerPriceStatus);

module.exports = router;