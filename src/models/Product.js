// models/Product.js
const { DataTypes } = require('sequelize');
const { Op } = require('sequelize');

module.exports = (sequelize) => {
  const Product = sequelize.define('Product', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    item_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Item name is required' }
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    cost_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        isDecimal: { msg: 'Cost price must be a decimal number' },
        min: { args: [0], msg: 'Cost price cannot be negative' }
      }
    },
    sale_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        isDecimal: { msg: 'Sale price must be a decimal number' },
        min: { args: [0], msg: 'Sale price cannot be negative' }
      }
    },
    supplier_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'suppliers',
        key: 'id'
      }
    },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'categories',
        key: 'id'
      }
    },
    subcategory_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'subcategories',
        key: 'id'
      }
    },
    unit_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'units',
        key: 'id'
      }
    },
    barcode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: {
        msg: 'Barcode must be unique'
      }
    },
    min_stock: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        isInt: { msg: 'Minimum stock must be an integer' },
        min: { args: [0], msg: 'Minimum stock cannot be negative' }
      }
    },
    physical_qty: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        isInt: { msg: 'Physical quantity must be an integer' },
        min: { args: [0], msg: 'Physical quantity cannot be negative' }
      }
    },
    available_qty: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        isInt: { msg: 'Available quantity must be an integer' },
        min: { args: [0], msg: 'Available quantity cannot be negative' }
      }
    },
    // Stores array of { id, length, lengthDecimal } objects as JSON
    length_combinations: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      comment: 'Array of length combinations, e.g. [{ id, length, lengthDecimal }]',
      get() {
        const rawValue = this.getDataValue('length_combinations');
        if (!rawValue) return null;
        return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      },
      set(value) {
        if (value) {
          this.setDataValue('length_combinations', value);
        } else {
          this.setDataValue('length_combinations', null);
        }
      }
    },
    has_multiple_lengths: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'True when length_combinations has one or more entries'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    // BOM fields
    is_bom: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'True if this is a Bill of Materials product'
    },
    bom_components: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      comment: 'Array of BOM components with quantities, costs, and details',
      get() {
        const rawValue = this.getDataValue('bom_components');
        if (!rawValue) return null;
        return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      },
      set(value) {
        if (value && Array.isArray(value) && value.length > 0) {
          this.setDataValue('bom_components', value);
        } else {
          this.setDataValue('bom_components', null);
        }
      }
    },
    bom_total_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
      comment: 'Calculated total cost of all BOM components',
      get() {
        const value = this.getDataValue('bom_total_cost');
        return value ? parseFloat(value) : null;
      }
    }
  }, {
    tableName: 'products',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['barcode'],
        where: {
          barcode: { [Op.ne]: null }
        }
      },
      { fields: ['item_name'] },
      { fields: ['supplier_id'] },
      { fields: ['category_id'] },
      { fields: ['subcategory_id'] },
      { fields: ['is_active'] },
      { fields: ['has_multiple_lengths'] },
      { fields: ['is_bom'] } // Add index for BOM filtering
    ],
    hooks: {
      // Automatically calculate BOM total cost before saving
      beforeUpdate: async (product) => {
        if (product.is_bom && product.bom_components && product.bom_components.length > 0) {
          const totalCost = product.bom_components.reduce((sum, comp) => {
            return sum + (parseFloat(comp.total_cost) || 0);
          }, 0);
          product.bom_total_cost = totalCost;
        } else if (!product.is_bom) {
          product.bom_components = null;
          product.bom_total_cost = null;
        }
      },
      beforeCreate: async (product) => {
        if (product.is_bom && product.bom_components && product.bom_components.length > 0) {
          const totalCost = product.bom_components.reduce((sum, comp) => {
            return sum + (parseFloat(comp.total_cost) || 0);
          }, 0);
          product.bom_total_cost = totalCost;
        }
      }
    }
  });

  return Product;
};