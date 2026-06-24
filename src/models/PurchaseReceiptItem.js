// backend/src/models/PurchaseReceiptItem.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PurchaseReceiptItem = sequelize.define('PurchaseReceiptItem', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    purchase_receipt_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'purchase_receipts',
        key: 'id'
      }
    },
    purchase_order_item_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'purchase_order_items',
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
    quantity_received: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: { args: [1], msg: 'Quantity must be at least 1' }
      }
    },
    unit_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false
    },
    batch_number: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    expiry_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'purchase_receipt_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return PurchaseReceiptItem;
};