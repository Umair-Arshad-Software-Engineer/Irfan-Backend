// backend/src/controllers/saleImageController.js
const { SaleImage, Sale } = require('../models');

// ─────────────────────────────────────────────
//  GET /api/sales/:saleId/images
//  Returns all images for a sale (without heavy base64 in list)
// ─────────────────────────────────────────────
exports.getSaleImages = async (req, res) => {
  try {
    const { saleId } = req.params;

    const sale = await Sale.findByPk(saleId);
    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    const images = await SaleImage.findAll({
      where: { sale_id: saleId },
      attributes: ['id', 'sale_id', 'image_type', 'description', 'created_at'],
      order: [['created_at', 'ASC']],
    });

    res.json({ success: true, data: images });
  } catch (error) {
    console.error('Get sale images error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  GET /api/sales/:saleId/images/:imageId
//  Returns single image WITH base64 data
// ─────────────────────────────────────────────
exports.getSaleImageById = async (req, res) => {
  try {
    const { saleId, imageId } = req.params;

    const image = await SaleImage.findOne({
      where: { id: imageId, sale_id: saleId },
    });

    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    res.json({ success: true, data: image });
  } catch (error) {
    console.error('Get sale image error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  POST /api/sales/:saleId/images
//  Upload / replace an image for a sale
//  Body: { image_type, image_data (base64), description? }
// ─────────────────────────────────────────────
exports.uploadSaleImage = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { image_type = 'custom', image_data, description } = req.body;

    if (!image_data) {
      return res.status(400).json({ success: false, message: 'image_data (base64) is required' });
    }

    const sale = await Sale.findByPk(saleId);
    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    const validTypes = ['signature', 'stamp', 'note', 'delivery', 'custom'];
    if (!validTypes.includes(image_type)) {
      return res.status(400).json({
        success: false,
        message: `image_type must be one of: ${validTypes.join(', ')}`,
      });
    }

    // One image per type per sale — upsert pattern
    const existing = await SaleImage.findOne({
      where: { sale_id: saleId, image_type },
    });

    let image;
    if (existing) {
      await existing.update({
        image_data,
        description: description ?? existing.description,
        uploaded_by: req.user?.id ?? null,
      });
      image = existing;
    } else {
      image = await SaleImage.create({
        sale_id: saleId,
        image_type,
        image_data,
        description: description ?? null,
        uploaded_by: req.user?.id ?? null,
      });
    }

    // Return without the heavy base64 blob
    res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        id: image.id,
        sale_id: image.sale_id,
        image_type: image.image_type,
        description: image.description,
        created_at: image.created_at,
      },
    });
  } catch (error) {
    console.error('Upload sale image error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  DELETE /api/sales/:saleId/images/:imageId
// ─────────────────────────────────────────────
exports.deleteSaleImage = async (req, res) => {
  try {
    const { saleId, imageId } = req.params;

    const image = await SaleImage.findOne({
      where: { id: imageId, sale_id: saleId },
    });

    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    await image.destroy();

    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Delete sale image error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};