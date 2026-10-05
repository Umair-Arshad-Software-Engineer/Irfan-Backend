// backend/src/models/SupplierReturnItem.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class SupplierReturnItem extends Model {
    static associate(models) {
      SupplierReturnItem.belongsTo(models.SupplierReturn, {
        foreignKey: 'supplier_return_id',
        as: 'supplierReturn'
      });
      SupplierReturnItem.belongsTo(models.Product, {
        foreignKey: 'product_id',
        as: 'product'
      });
    }
  }

  SupplierReturnItem.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    supplier_return_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'supplier_returns', key: 'id' },
      onDelete: 'CASCADE'
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'products', key: 'id' }
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    // ✅ Manual pieces
    pcs: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    // ✅ NEW: manual weight (used to compute line_total)
    weight: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0.000
    },
    unit_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    line_total: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00
    },
    // Kept for backward compatibility (no longer populated)
    selected_lengths: {
      type: DataTypes.JSON,
      allowNull: true
    },
    total_pieces: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'SupplierReturnItem',
    tableName: 'supplier_return_items',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['supplier_return_id'] },
      { fields: ['product_id'] }
    ]
  });

  return SupplierReturnItem;
};