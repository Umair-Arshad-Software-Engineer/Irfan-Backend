// backend/src/models/dailyExpense.js
'use strict';
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class DailyExpense extends Model {
    static associate(models) {
      DailyExpense.belongsTo(models.DailyExpenseSession, {
        foreignKey: 'session_id',
        as: 'session',
      });
      DailyExpense.belongsTo(models.Supplier, {
        foreignKey: 'supplier_id',
        as: 'supplier',
      });
      DailyExpense.belongsTo(models.Bank, {
        foreignKey: 'bank_id',
        as: 'bank',
      });
    }
  }

  DailyExpense.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      session_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'daily_expense_sessions', key: 'id' },
      },
      entry_type: {
        type: DataTypes.ENUM('expense', 'supplier_payment', 'bill_payment'),
        allowNull: false,
        defaultValue: 'expense',
      },
      category: { type: DataTypes.STRING(100), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: false },
      amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        validate: { min: 0.01 },
      },
      payment_method: {
        type: DataTypes.ENUM('cash', 'bank', 'cheque', 'slip'),
        allowNull: false,
        defaultValue: 'cash',
      },
      bank_id: { type: DataTypes.INTEGER, allowNull: true },
      bank_name: { type: DataTypes.STRING(100), allowNull: true },
      cheque_number: { type: DataTypes.STRING(50), allowNull: true },
      cheque_date: { type: DataTypes.DATEONLY, allowNull: true },
      cheque_id: { type: DataTypes.INTEGER, allowNull: true },
      reference_number: { type: DataTypes.STRING(50), allowNull: true },
      supplier_id: { type: DataTypes.INTEGER, allowNull: true },
      supplier_ledger_id: { type: DataTypes.INTEGER, allowNull: true },
      cashbook_entry_id: { type: DataTypes.INTEGER, allowNull: true },
      // Bill payment specific fields
      bill_type: { type: DataTypes.STRING(50), allowNull: true }, // electricity, gas, telephone, water, internet, tv, other
      bill_number: { type: DataTypes.STRING(100), allowNull: true },
      consumer_number: { type: DataTypes.STRING(100), allowNull: true },
      bill_image: { type: DataTypes.TEXT('long'), allowNull: true }, // base64 encoded image
      entry_time: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'DailyExpense',
      tableName: 'daily_expenses',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['session_id'] },
        { fields: ['entry_type'] },
        { fields: ['supplier_id'] },
        { fields: ['bill_type'] }, // Add index for bill type queries
      ],
    }
  );

  return DailyExpense;
};