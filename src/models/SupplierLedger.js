const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SupplierLedger = sequelize.define('SupplierLedger', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    supplier_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'suppliers', key: 'id' }
    },
    reference_type: {
      type: DataTypes.ENUM('purchase_receipt', 'payment', 'manual', 'reversal'),
      allowNull: false
    },
    reference_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    reference_number: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    debit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00
    },
    credit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00
    },
    balance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    transaction_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    // ── Payment-specific fields (nullable for non-payment entries) ──────────
    payment_method: {
      type: DataTypes.ENUM('cash', 'bank', 'cheque', 'slip'),
      allowNull: true
    },
    bank_name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    cheque_number: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    cheque_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    cheque_cleared: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    cheque_cleared_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    bank_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'banks', key: 'id' },
      onDelete: 'SET NULL'
    },
    // ────────────────────────────────────────────────────────────────────────
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' }
    },
  }, {
    tableName: 'supplier_ledger',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['supplier_id'] },
      { fields: ['reference_type', 'reference_id'] },
      { fields: ['transaction_date'] },
      { fields: ['payment_method'] }
    ]
  });

  return SupplierLedger;
};