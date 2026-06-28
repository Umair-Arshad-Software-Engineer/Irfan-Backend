// backend/src/routes/saleImageRoutes.js
// Mount this INSIDE your existing sale router or as a standalone router.
//
// Option A – standalone (add to app.js):
//   const saleImageRoutes = require('./routes/saleImageRoutes');
//   app.use('/api', saleImageRoutes);
//
// Option B – merge with existing saleRoutes.js:
//   Copy the four route definitions below into your saleRoutes file.

const express = require('express');
const router = express.Router();
const {
  getSaleImages,
  getSaleImageById,
  uploadSaleImage,
  deleteSaleImage,
} = require('../controllers/saleImageController');

// If you have an auth middleware, add it here:
// const { authenticate } = require('../middleware/auth');
// router.use(authenticate);

router.get('/sales/:saleId/images', getSaleImages);
router.get('/sales/:saleId/images/:imageId', getSaleImageById);
router.post('/sales/:saleId/images', uploadSaleImage);
router.delete('/sales/:saleId/images/:imageId', deleteSaleImage);

module.exports = router;