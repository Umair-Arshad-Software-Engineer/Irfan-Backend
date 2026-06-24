// backend/src/controllers/productImageController.js
const { ProductImage, Product } = require('../models');
const fs = require('fs');
const path = require('path');

// Get all images for a product
exports.getProductImages = async (req, res) => {
  try {
    const { productId } = req.params;

    const images = await ProductImage.findAll({
      where: { product_id: productId },
      order: [
        ['is_primary', 'DESC'],
        ['sort_order', 'ASC'],
        ['created_at', 'ASC']
      ]
    });

    res.json({
      success: true,
      data: images
    });
  } catch (error) {
    console.error('Get product images error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Upload images for a product
exports.uploadImages = async (req, res) => {
  try {
    const { productId } = req.params;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded'
      });
    }

    // Check if product exists
    const product = await Product.findByPk(productId);
    if (!product) {
      // Delete uploaded files if product doesn't exist
      files.forEach(file => {
        fs.unlinkSync(file.path);
      });
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if this is the first image for the product
    const existingImagesCount = await ProductImage.count({
      where: { product_id: productId }
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const uploadedImages = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const imageUrl = `${baseUrl}/uploads/products/${file.filename}`;

      const productImage = await ProductImage.create({
        product_id: productId,
        image_url: imageUrl,
        is_primary: existingImagesCount === 0 && i === 0, // First image is primary if no images exist
        sort_order: existingImagesCount + i,
        file_name: file.originalname,
        file_size: file.size,
        mime_type: file.mimetype
      });

      uploadedImages.push(productImage);
    }

    res.status(201).json({
      success: true,
      message: `${uploadedImages.length} image(s) uploaded successfully`,
      data: uploadedImages
    });
  } catch (error) {
    console.error('Upload images error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Set image as primary
exports.setPrimaryImage = async (req, res) => {
  try {
    const { id } = req.params;

    const image = await ProductImage.findByPk(id);
    if (!image) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    // Remove primary flag from all other images of this product
    await ProductImage.update(
      { is_primary: false },
      { where: { product_id: image.product_id } }
    );

    // Set this image as primary
    await image.update({ is_primary: true });

    res.json({
      success: true,
      message: 'Primary image updated successfully',
      data: image
    });
  } catch (error) {
    console.error('Set primary image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Delete image
exports.deleteImage = async (req, res) => {
  try {
    const { id } = req.params;

    const image = await ProductImage.findByPk(id);
    if (!image) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    // Delete file from filesystem
    const filename = path.basename(image.image_url);
    const filepath = path.join('uploads/products', filename);
    
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    // Check if this was the primary image
    const wasPrimary = image.is_primary;

    // Delete from database
    await image.destroy();

    // If this was the primary image, set another image as primary
    if (wasPrimary) {
      const nextImage = await ProductImage.findOne({
        where: { product_id: image.product_id },
        order: [['sort_order', 'ASC']]
      });

      if (nextImage) {
        await nextImage.update({ is_primary: true });
      }
    }

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Reorder images
exports.reorderImages = async (req, res) => {
  try {
    const { productId } = req.params;
    const { image_ids } = req.body;

    if (!image_ids || !Array.isArray(image_ids)) {
      return res.status(400).json({
        success: false,
        message: 'Image IDs array is required'
      });
    }

    // Update sort order for each image
    for (let i = 0; i < image_ids.length; i++) {
      await ProductImage.update(
        { sort_order: i },
        { where: { id: image_ids[i], product_id: productId } }
      );
    }

    res.json({
      success: true,
      message: 'Images reordered successfully'
    });
  } catch (error) {
    console.error('Reorder images error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};