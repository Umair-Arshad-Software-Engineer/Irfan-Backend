// backend/src/models/SimpleCashbook.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SimpleCashbook = sequelize.define('SimpleCashbook', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    entry_date: { type: DataTypes.DATEONLY, allowNull: false },
    entry_type: {
      type: DataTypes.ENUM('cash_in', 'cash_out'),
      allowNull: false,
    },
    source_type: {
      type: DataTypes.ENUM('customer_payment', 'supplier_payment', 'manual', 'opening_balance'),
      allowNull: false,
    },
    reference_id: { type: DataTypes.INTEGER, allowNull: true },
    reference_number: { type: DataTypes.STRING(100), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: false },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: { min: 0.01 },
    },
    balance: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    tableName: 'simple_cashbook',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  SimpleCashbook.associate = (models) => {
    // No FK constraints needed
  };

  return SimpleCashbook;
};