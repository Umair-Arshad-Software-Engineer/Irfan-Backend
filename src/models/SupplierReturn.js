// backend/src/models/SupplierReturn.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class SupplierReturn extends Model {
    static associate(models) {
      SupplierReturn.belongsTo(models.Supplier, {
        foreignKey: 'supplier_id',
        as: 'supplier'
      });
      SupplierReturn.hasMany(models.SupplierReturnItem, {
        foreignKey: 'supplier_return_id',
        as: 'items'
      });
      SupplierReturn.belongsTo(models.PurchaseOrder, {
        foreignKey: 'purchase_order_id',
        as: 'purchaseOrder'
      });
      SupplierReturn.belongsTo(models.User, {
        foreignKey: 'created_by',
        as: 'creator'
      });
    }
  }

  SupplierReturn.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    return_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    supplier_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'suppliers', key: 'id' }
    },
    purchase_order_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'purchase_orders', key: 'id' }
    },
    return_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    subtotal: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00
    },
    tax_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00
    },
    discount_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00
    },
    total_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00
    },
    status: {
      type: DataTypes.ENUM('draft', 'completed', 'cancelled'),
      defaultValue: 'completed'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    reference: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' }
    }
  }, {
    sequelize,
    modelName: 'SupplierReturn',
    tableName: 'supplier_returns',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['supplier_id'] },
      { fields: ['return_date'] },
      { fields: ['return_number'] }
    ]
  });

  return SupplierReturn;
};