// backend/src/models/Customer.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Customer extends Model {
    static associate(models) {
      // Add associations later if needed
    }
  }

  Customer.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Customer name is required' },
        len: { args: [2, 100], msg: 'Customer name must be between 2 and 100 characters' }
      }
    },
    contact: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Contact information is required' },
        len: { args: [2, 50], msg: 'Contact must be between 2 and 50 characters' }
      }
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: { args: [0, 500], msg: 'Address must not exceed 500 characters' }
      }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: { msg: 'Please provide a valid email address' }
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    customer_type: {
      type: DataTypes.ENUM('regular', 'wholesale', 'retail'),
      defaultValue: 'regular'
    },
    balance: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00,
      validate: {
        isDecimal: { msg: 'Balance must be a decimal number' }
      }
    },
    // ── NEW: Customer-level discount percentage ──────────────
    // Stored as a percentage (0–100). Automatically applied
    // on new sales when this customer is selected.
    discount_percent: {
      type: DataTypes.DECIMAL(5, 2),
      defaultValue: 0.00,
      validate: {
        isDecimal: { msg: 'Discount percent must be a decimal number' },
        min: { args: [0],   msg: 'Discount percent cannot be negative' },
        max: { args: [100], msg: 'Discount percent cannot exceed 100' }
      }
    }
  }, {
    sequelize,
    modelName: 'Customer',
    tableName: 'customers',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['contact'] },
      { fields: ['name'] },
      { fields: ['customer_type'] }
    ]
  });

  return Customer;
};