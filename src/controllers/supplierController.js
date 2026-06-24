// supplierController.js - Updated
const { Op } = require('sequelize');
const { Supplier } = require('../models');

// In supplierController.js - getAllSuppliers function
exports.getAllSuppliers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20, active } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Build where clause
    const whereClause = {};
    
    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { contact: { [Op.like]: `%${search}%` } },
        { address: { [Op.like]: `%${search}%` } }
      ];
    }

    if (active !== undefined) {
      whereClause.is_active = active === 'true';
    }

    // FIX: Remove product inclusion since we don't have Product model yet
    const { count, rows: suppliers } = await Supplier.findAndCountAll({
      where: whereClause,
      attributes: ['id', 'name', 'address', 'contact', 'is_active', 'discount_percent', 'createdAt', 'updatedAt'],
      order: [['name', 'ASC']],
      limit: limitNum,
      offset: offset,
      distinct: true
    });

    res.json({
      success: true,
      data: suppliers,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get active suppliers (for dropdowns)
exports.getActiveSuppliers = async (req, res) => {
  try {
    const suppliers = await Supplier.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'contact'],
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      data: suppliers
    });
  } catch (error) {
    console.error('Get active suppliers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get single supplier by ID
exports.getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;

    const supplier = await Supplier.findByPk(id, {
      attributes: ['id', 'name', 'address', 'contact', 'is_active', 'createdAt', 'updatedAt']
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    res.json({
      success: true,
      data: supplier
    });
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Create new supplier
exports.createSupplier = async (req, res) => {
  try {
    const { name, address, contact, discount_percent } = req.body;

    // Validate required fields
    if (!name || !contact) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name and contact are required'
      });
    }

    // Check if supplier already exists
    const existingSupplier = await Supplier.findOne({
      where: { name }
    });

    if (existingSupplier) {
      return res.status(400).json({
        success: false,
        message: 'Supplier with this name already exists'
      });
    }

    const supplier = await Supplier.create({
      name,
      address: address || null,
      contact,
      is_active: true,
        discount_percent: discount_percent ?? 0
    });

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: supplier
    });
  } catch (error) {
    console.error('Create supplier error:', error);
    
    // Handle validation errors
    if (error.name === 'SequelizeValidationError') {
      const messages = error.errors.map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Update supplier
exports.updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, contact, is_active, discount_percent } = req.body;


    const supplier = await Supplier.findByPk(id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Check if new name already exists (excluding current supplier)
    if (name && name !== supplier.name) {
      const existingSupplier = await Supplier.findOne({
        where: {
          name,
          id: { [Op.ne]: id }
        }
      });

      if (existingSupplier) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this name already exists'
        });
      }
    }

    await supplier.update({
      name: name || supplier.name,
      address: address !== undefined ? address : supplier.address,
      contact: contact || supplier.contact,
      is_active: is_active !== undefined ? is_active : supplier.is_active,
        discount_percent: discount_percent !== undefined ? discount_percent : supplier.discount_percent
    });

    const updatedSupplier = await Supplier.findByPk(id, {
      attributes: ['id', 'name', 'address', 'contact', 'is_active', 'createdAt', 'updatedAt']
    });

    res.json({
      success: true,
      message: 'Supplier updated successfully',
      data: updatedSupplier
    });
  } catch (error) {
    console.error('Update supplier error:', error);
    
    if (error.name === 'SequelizeValidationError') {
      const messages = error.errors.map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Delete supplier
exports.deleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;

    const supplier = await Supplier.findByPk(id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // FIX: Remove product count check since we don't have Product model yet
    await supplier.destroy();

    res.json({
      success: true,
      message: 'Supplier deleted successfully'
    });
  } catch (error) {
    console.error('Delete supplier error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Toggle supplier status
exports.toggleSupplierStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const supplier = await Supplier.findByPk(id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    await supplier.update({
      is_active: !supplier.is_active
    });

    res.json({
      success: true,
      message: `Supplier ${supplier.is_active ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: supplier.id,
        name: supplier.name,
        is_active: supplier.is_active
      }
    });
  } catch (error) {
    console.error('Toggle supplier status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};