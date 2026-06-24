// backend/src/routes/productImageRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const productImageController = require('../controllers/productImageController');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/products';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Use original extension or default to .jpg
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'product-' + uniqueSuffix + ext);
  }
});

// More permissive file filter
const fileFilter = (req, file, cb) => {
  // Accept all common image types
  const allowedMimeTypes = [
    'image/jpeg', 
    'image/jpg', 
    'image/png', 
    'image/gif', 
    'image/webp',
    'image/bmp',
    'image/tiff',
    'application/octet-stream', // Sometimes files are sent as this
    'image/heic',
    'image/heif'
  ];
  
  // Check by MIME type
  if (allowedMimeTypes.includes(file.mimetype)) {
    return cb(null, true);
  }
  
  // Also check by file extension if MIME type is not recognized
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.heic', '.heif'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedExtensions.includes(ext)) {
    return cb(null, true);
  }
  
  // Log the rejected file for debugging
  console.log('Rejected file:', {
    fieldname: file.fieldname,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size
  });
  
  cb(new Error('Only image files are allowed. Received: ' + file.mimetype));
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // Increased to 10MB limit
  },
  fileFilter: fileFilter
});

// Product image routes
router.get('/products/:productId/images', productImageController.getProductImages);
router.post('/products/:productId/images', upload.array('images', 20), productImageController.uploadImages);
router.patch('/product-images/:id/set-primary', productImageController.setPrimaryImage);
router.delete('/product-images/:id', productImageController.deleteImage);
router.post('/products/:productId/images/reorder', productImageController.reorderImages);

module.exports = router;