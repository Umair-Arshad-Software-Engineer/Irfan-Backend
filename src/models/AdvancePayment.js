const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AdvancePayment = sequelize.define('AdvancePayment', {
    id:                { type: DataTypes.INTEGER,       primaryKey: true, autoIncrement: true },
    employee_id:       { type: DataTypes.INTEGER,       allowNull: false },
    amount:            { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    date:              { type: DataTypes.DATEONLY,       allowNull: false },
    description:       { type: DataTypes.TEXT,           allowNull: true },
    entry_type:        {
      type: DataTypes.ENUM('credit', 'debit'),
      allowNull: false,
      defaultValue: 'credit', // Credit means employee owes this amount
    },
    balance:           { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.00 },
    salary_payment_id: { type: DataTypes.INTEGER,       allowNull: true, defaultValue: null },
    source_entry_id:   { type: DataTypes.INTEGER,       allowNull: true, defaultValue: null }, // ← NEW: links a debit entry back to the credit it recovered
  }, {
    tableName: 'advance_payments',
    timestamps: true,
    underscored: false,
  });

  return AdvancePayment;
};