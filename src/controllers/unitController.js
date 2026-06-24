const { Op } = require('sequelize');
const { Unit } = require('../models');

// Get all units
exports.getAllUnits = async (req, res) => {
  try {
    const units = await Unit.findAll({
      include: [{
        model: Unit,
        as: 'baseUnit',
        attributes: ['id', 'name', 'symbol']
      }],
      attributes: ['id', 'name', 'symbol', 'type', 'is_active', 'conversion_factor', 'base_unit_id', 'createdAt', 'updatedAt'],
      order: [
        ['type', 'ASC'],
        ['name', 'ASC']
      ]
    });

    res.json({
      success: true,
      data: units,
      count: units.length
    });
  } catch (error) {
    console.error('Get units error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get units by type
exports.getUnitsByType = async (req, res) => {
  try {
    const { type } = req.params;
    
    const units = await Unit.findAll({
      where: { 
        type,
        is_active: true 
      },
      attributes: ['id', 'name', 'symbol', 'conversion_factor'],
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      data: units
    });
  } catch (error) {
    console.error('Get units by type error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get base units (units without base_unit_id)
exports.getBaseUnits = async (req, res) => {
  try {
    const baseUnits = await Unit.findAll({
      where: { 
        base_unit_id: null,
        is_active: true 
      },
      include: [{
        model: Unit,
        as: 'derivedUnits',
        where: { is_active: true },
        required: false,
        attributes: ['id', 'name', 'symbol', 'conversion_factor']
      }],
      attributes: ['id', 'name', 'symbol', 'type'],
      order: [['type', 'ASC']]
    });

    res.json({
      success: true,
      data: baseUnits
    });
  } catch (error) {
    console.error('Get base units error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.createUnit = async (req, res) => {
  try {
    const { name, symbol, type, conversion_factor, base_unit_id } = req.body;

    // Check if unit already exists by name or symbol - FIXED
    const existingUnit = await Unit.findOne({
      where: {
        [Op.or]: [
          { name },
          { symbol }
        ]
      }
    });

    if (existingUnit) {
      return res.status(400).json({
        success: false,
        message: 'Unit with this name or symbol already exists'
      });
    }

    // Validate base unit if provided
    if (base_unit_id) {
      const baseUnit = await Unit.findByPk(base_unit_id);
      if (!baseUnit) {
        return res.status(404).json({
          success: false,
          message: 'Base unit not found'
        });
      }
    }

    const unit = await Unit.create({
      name,
      symbol,
      type: type || 'custom',
      conversion_factor: conversion_factor || 1,
      base_unit_id,
      is_active: true
    });

    // If it has base unit, include it in response
    if (base_unit_id) {
      const unitWithBase = await Unit.findByPk(unit.id, {
        include: [{
          model: Unit,
          as: 'baseUnit',
          attributes: ['id', 'name', 'symbol']
        }]
      });
      return res.status(201).json({
        success: true,
        message: 'Unit created successfully',
        data: unitWithBase
      });
    }

    res.status(201).json({
      success: true,
      message: 'Unit created successfully',
      data: unit
    });
  } catch (error) {
    console.error('Create unit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Update unit - FIXED HERE
exports.updateUnit = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, symbol, type, is_active, conversion_factor, base_unit_id } = req.body;

    const unit = await Unit.findByPk(id);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Unit not found'
      });
    }

    // Check if new name or symbol already exists (excluding current unit) - FIXED
    const whereConditions = [];
    
    if (name) whereConditions.push({ name });
    if (symbol) whereConditions.push({ symbol });
    
    if (whereConditions.length > 0) {
      const existingUnit = await Unit.findOne({
        where: {
          [Op.or]: whereConditions,
          id: { [Op.ne]: id }
        }
      });

      if (existingUnit) {
        return res.status(400).json({
          success: false,
          message: 'Unit with this name or symbol already exists'
        });
      }
    }

    // Validate base unit if changing
    if (base_unit_id && base_unit_id !== unit.base_unit_id) {
      if (base_unit_id === parseInt(id)) {
        return res.status(400).json({
          success: false,
          message: 'Unit cannot be its own base unit'
        });
      }

      const baseUnit = await Unit.findByPk(base_unit_id);
      if (!baseUnit) {
        return res.status(404).json({
          success: false,
          message: 'Base unit not found'
        });
      }
    }

    await unit.update({
      name: name || unit.name,
      symbol: symbol || unit.symbol,
      type: type || unit.type,
      is_active: is_active !== undefined ? is_active : unit.is_active,
      conversion_factor: conversion_factor || unit.conversion_factor,
      base_unit_id: base_unit_id !== undefined ? base_unit_id : unit.base_unit_id
    });

    const updatedUnit = await Unit.findByPk(id, {
      include: [{
        model: Unit,
        as: 'baseUnit',
        attributes: ['id', 'name', 'symbol']
      }]
    });

    res.json({
      success: true,
      message: 'Unit updated successfully',
      data: updatedUnit
    });
  } catch (error) {
    console.error('Update unit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Delete unit
exports.deleteUnit = async (req, res) => {
  try {
    const { id } = req.params;

    const unit = await Unit.findByPk(id);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Unit not found'
      });
    }

    // Check if unit is being used as base unit
    const derivedUnits = await Unit.count({
      where: { base_unit_id: id }
    });

    if (derivedUnits > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete unit that is used as base unit for other units'
      });
    }

    await unit.destroy();

    res.json({
      success: true,
      message: 'Unit deleted successfully'
    });
  } catch (error) {
    console.error('Delete unit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Convert between units
exports.convertUnits = async (req, res) => {
  try {
    const { from_unit_id, to_unit_id, value } = req.body;

    if (!from_unit_id || !to_unit_id || value === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: from_unit_id, to_unit_id, value'
      });
    }

    const fromUnit = await Unit.findByPk(from_unit_id);
    const toUnit = await Unit.findByPk(to_unit_id);

    if (!fromUnit || !toUnit) {
      return res.status(404).json({
        success: false,
        message: 'One or both units not found'
      });
    }

    // Check if units are compatible (same base unit or same type)
    if (fromUnit.type !== toUnit.type && !(fromUnit.base_unit_id === toUnit.id || toUnit.base_unit_id === fromUnit.id)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot convert between incompatible unit types'
      });
    }

    // Convert to base unit first, then to target unit
    let baseValue = parseFloat(value) * fromUnit.conversion_factor;
    
    // If fromUnit has a base unit, we need to handle differently
    if (fromUnit.base_unit_id) {
      const fromBaseUnit = await Unit.findByPk(fromUnit.base_unit_id);
      if (fromBaseUnit) {
        baseValue = parseFloat(value) * fromUnit.conversion_factor;
      }
    }

    let convertedValue;
    if (toUnit.base_unit_id) {
      convertedValue = baseValue / toUnit.conversion_factor;
    } else {
      convertedValue = baseValue;
    }

    res.json({
      success: true,
      data: {
        from_unit: fromUnit.name,
        to_unit: toUnit.name,
        original_value: parseFloat(value),
        converted_value: convertedValue,
        symbol: toUnit.symbol
      }
    });
  } catch (error) {
    console.error('Convert units error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Seed default units - FIXED HERE
exports.seedDefaultUnits = async (req, res) => {
  try {
    const defaultUnits = [
      // Weight units
      { name: 'Kilogram', symbol: 'kg', type: 'weight', conversion_factor: 1 },
      { name: 'Gram', symbol: 'g', type: 'weight', conversion_factor: 1000 },
      { name: 'Pound', symbol: 'lb', type: 'weight', conversion_factor: 2.20462 },
      { name: 'Ounce', symbol: 'oz', type: 'weight', conversion_factor: 35.274 },
      { name: 'Bag (50kg)', symbol: 'bag', type: 'weight', conversion_factor: 0.02 },
      { name: 'Ton', symbol: 't', type: 'weight', conversion_factor: 0.001 },
      
      // Volume units
      { name: 'Liter', symbol: 'L', type: 'volume', conversion_factor: 1 },
      { name: 'Milliliter', symbol: 'ml', type: 'volume', conversion_factor: 1000 },
      { name: 'Gallon', symbol: 'gal', type: 'volume', conversion_factor: 0.264172 },
      { name: 'Cubic Meter', symbol: 'm³', type: 'volume', conversion_factor: 0.001 },
      
      // Count units
      { name: 'Piece', symbol: 'pcs', type: 'count', conversion_factor: 1 },
      { name: 'Dozen', symbol: 'dz', type: 'count', conversion_factor: 0.083333 },
      { name: 'Box', symbol: 'box', type: 'count', conversion_factor: 1 },
      { name: 'Pack', symbol: 'pack', type: 'count', conversion_factor: 1 },
      { name: 'Carton', symbol: 'ctn', type: 'count', conversion_factor: 1 },
      
      // Length units
      { name: 'Meter', symbol: 'm', type: 'length', conversion_factor: 1 },
      { name: 'Centimeter', symbol: 'cm', type: 'length', conversion_factor: 100 },
      { name: 'Millimeter', symbol: 'mm', type: 'length', conversion_factor: 1000 },
      { name: 'Foot', symbol: 'ft', type: 'length', conversion_factor: 3.28084 },
      { name: 'Inch', symbol: 'in', type: 'length', conversion_factor: 39.3701 },
      
      // Area units
      { name: 'Square Meter', symbol: 'm²', type: 'area', conversion_factor: 1 },
      { name: 'Square Foot', symbol: 'ft²', type: 'area', conversion_factor: 10.7639 },
    ];

    const createdUnits = [];
    
    for (const unitData of defaultUnits) {
      const existingUnit = await Unit.findOne({
        where: { 
          [Op.or]: [
            { name: unitData.name },
            { symbol: unitData.symbol }
          ]
        }
      });

      if (!existingUnit) {
        const unit = await Unit.create({
          ...unitData,
          is_active: true
        });
        createdUnits.push(unit);
      }
    }

    res.json({
      success: true,
      message: 'Default units seeded successfully',
      data: createdUnits,
      count: createdUnits.length
    });
  } catch (error) {
    console.error('Seed default units error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};