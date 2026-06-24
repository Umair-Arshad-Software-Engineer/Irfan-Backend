// backend/src/models/Cashbook.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Cashbook = sequelize.define('Cashbook', {
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
    tableName: 'cashbook',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Cashbook.associate = (models) => {
    // no FK constraints needed — reference_id can point to different tables
  };

  return Cashbook;
};