// controllers/customerPriceController.js
const { Op } = require('sequelize');
const { CustomerPrice, Customer, Product, Unit, Category } = require('../models');

// Get all customer prices with optional filters
exports.getAllCustomerPrices = async (req, res) => {
  try {
    const { customer_id, product_id, active } = req.query;

    const whereClause = {};
    if (customer_id) whereClause.customer_id = customer_id;
    if (product_id) whereClause.product_id = product_id;
    if (active !== undefined) whereClause.is_active = active === 'true';

    const prices = await CustomerPrice.findAll({
      where: whereClause,
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'name', 'contact', 'customer_type'],
        },
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'item_name', 'sale_price', 'cost_price', 'barcode'],
          include: [
            { model: Unit, as: 'unit', attributes: ['id', 'name', 'symbol'] },
            { model: Category, as: 'category', attributes: ['id', 'name'] },
          ],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    res.json({ success: true, data: prices, count: prices.length });
  } catch (error) {
    console.error('Get all customer prices error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get price for a specific customer-product pair
exports.getCustomerPrice = async (req, res) => {
  try {
    const { productId, customerId } = req.params;

    const price = await CustomerPrice.findOne({
      where: { product_id: productId, customer_id: customerId },
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'customer_type'] },
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'item_name', 'sale_price', 'cost_price'],
          include: [{ model: Unit, as: 'unit', attributes: ['id', 'name', 'symbol'] }],
        },
      ],
    });

    if (!price) {
      return res.status(404).json({ success: false, message: 'Customer price not found' });
    }

    res.json({ success: true, data: price });
  } catch (error) {
    console.error('Get customer price error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get prices for multiple products for a specific customer (used at POS/sale time)
exports.getBulkCustomerPrices = async (req, res) => {
  try {
    const { customer_id, product_ids } = req.body;

    if (!customer_id || !product_ids || !Array.isArray(product_ids)) {
      return res.status(400).json({
        success: false,
        message: 'customer_id and product_ids array are required',
      });
    }

    const prices = await CustomerPrice.findAll({
      where: {
        customer_id,
        product_id: { [Op.in]: product_ids },
        is_active: true,
      },
      attributes: ['id', 'customer_id', 'product_id', 'price', 'is_active'],
    });

    // Return a map: { productId: price }
    const priceMap = {};
    prices.forEach((p) => {
      priceMap[p.product_id] = p.price;
    });

    res.json({ success: true, data: priceMap });
  } catch (error) {
    console.error('Get bulk customer prices error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Create or update a customer price (upsert)
exports.setCustomerPrice = async (req, res) => {
  try {
    const { customer_id, product_id, price } = req.body;

    if (!customer_id || !product_id || price === undefined || price === null) {
      return res.status(400).json({
        success: false,
        message: 'customer_id, product_id, and price are required',
      });
    }

    if (parseFloat(price) < 0) {
      return res.status(400).json({ success: false, message: 'Price cannot be negative' });
    }

    // Validate customer exists
    const customer = await Customer.findByPk(customer_id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Validate product exists
    const product = await Product.findByPk(product_id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Upsert: update if exists, create if not
    const [customerPrice, created] = await CustomerPrice.findOrCreate({
      where: { customer_id, product_id },
      defaults: { price, is_active: true },
    });

    if (!created) {
      await customerPrice.update({ price, is_active: true });
    }

    const result = await CustomerPrice.findByPk(customerPrice.id, {
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'customer_type'] },
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'item_name', 'sale_price', 'cost_price'],
          include: [{ model: Unit, as: 'unit', attributes: ['id', 'name', 'symbol'] }],
        },
      ],
    });

    res.status(created ? 201 : 200).json({
      success: true,
      message: created ? 'Customer price created successfully' : 'Customer price updated successfully',
      data: result,
    });
  } catch (error) {
    console.error('Set customer price error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Delete a customer price
exports.deleteCustomerPrice = async (req, res) => {
  try {
    const { id } = req.params;

    const price = await CustomerPrice.findByPk(id);
    if (!price) {
      return res.status(404).json({ success: false, message: 'Customer price not found' });
    }

    await price.destroy();

    res.json({ success: true, message: 'Customer price deleted successfully' });
  } catch (error) {
    console.error('Delete customer price error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Toggle active status
exports.toggleCustomerPriceStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const price = await CustomerPrice.findByPk(id, {
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: Product, as: 'product', attributes: ['id', 'item_name'] },
      ],
    });

    if (!price) {
      return res.status(404).json({ success: false, message: 'Customer price not found' });
    }

    await price.update({ is_active: !price.is_active });

    res.json({
      success: true,
      message: `Customer price ${price.is_active ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: price.id,
        is_active: price.is_active,
        customer: price.customer,
        product: price.product,
      },
    });
  } catch (error) {
    console.error('Toggle customer price status error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};