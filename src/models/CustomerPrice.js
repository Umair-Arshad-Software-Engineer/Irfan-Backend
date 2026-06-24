// models/CustomerPrice.js
const { DataTypes } = require('sequelize');
const { Op } = require('sequelize'); // Add this if you're using Op in this file

module.exports = (sequelize) => {
  const CustomerPrice = sequelize.define('CustomerPrice', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id'
      }
    },
    customer_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'customers',
        key: 'id'
      }
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        isDecimal: { msg: 'Price must be a decimal number' },
        min: { args: [0], msg: 'Price cannot be negative' }
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: 'customer_prices',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['product_id', 'customer_id']
      }
    ]
  });

  return CustomerPrice;
};