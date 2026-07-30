const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmployeeExpense = sequelize.define('EmployeeExpense', {
    id:                { type: DataTypes.INTEGER,        primaryKey: true, autoIncrement: true },
    employee_id:       { type: DataTypes.INTEGER,        allowNull: false },
    amount:            { type: DataTypes.DECIMAL(10, 2),  allowNull: false },
    date:              { type: DataTypes.DATEONLY,        allowNull: false },
    category:          {
      type: DataTypes.ENUM('Travel', 'Food', 'Medical', 'Uniform', 'Fine', 'Other'),
      allowNull: false,
      defaultValue: 'Other',
    },
    description:       { type: DataTypes.TEXT,            allowNull: true },
    entry_type:        {
      type: DataTypes.ENUM('credit', 'debit'),
      allowNull: false,
      defaultValue: 'credit', // Credit means employee owes this amount
    },
    balance:           { type: DataTypes.DECIMAL(10, 2),  allowNull: false, defaultValue: 0.00 },
    salary_payment_id: { type: DataTypes.INTEGER,        allowNull: true, defaultValue: null },
    source_entry_id:   { type: DataTypes.INTEGER,        allowNull: true, defaultValue: null }, // ← NEW: links a debit entry back to the credit it recovered
  }, {
    tableName: 'employee_expenses',
    timestamps: true,
    underscored: false,
  });

  return EmployeeExpense;
};