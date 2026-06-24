const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SaleItem = sequelize.define('SaleItem', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    sale_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'sales',
        key: 'id'
      }
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id'
      }
    },
    product_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Product name is required' }
      }
    },
    barcode: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    unit_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        isDecimal: { msg: 'Unit price must be a valid decimal number' },
        min: { args: [0], msg: 'Unit price cannot be negative' }
      }
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        isInt: { msg: 'Quantity must be an integer' },
        min: { args: [0], msg: 'Quantity must be at least 0' }
      }
    },
    total_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      validate: {
        isDecimal: { msg: 'Total price must be a valid decimal number' }
      }
    },
    selected_lengths_display: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Human-readable display of selected lengths with quantities'
    },
    selected_lengths: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      comment: 'Array of selected length identifiers'
    },
    length_quantities: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      comment: 'Map of length to quantity for each selected length'
    },
    total_pieces: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      comment: 'Sum of all length quantities (pieces count)'
    },
    weight: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true,
      defaultValue: null,
      comment: 'Weight in kg for this item (used for SARYA mode)'
    },
    used_customer_price: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Whether a customer-specific price was applied'
    }
  }, {
    tableName: 'sale_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['sale_id'] },
      { fields: ['product_id'] }
    ]
  });

  return SaleItem;
};