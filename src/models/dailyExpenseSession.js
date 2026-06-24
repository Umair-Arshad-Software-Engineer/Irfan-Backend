// backend/src/models/dailyExpenseSession.js
'use strict';
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class DailyExpenseSession extends Model {
    static associate(models) {
      DailyExpenseSession.hasMany(models.DailyExpense, {
        foreignKey: 'session_id',
        as: 'entries',
      });
      DailyExpenseSession.belongsTo(models.User, {
        foreignKey: 'created_by',
        as: 'creator',
      });
    }
  }

  DailyExpenseSession.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      session_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        validate: { isDate: true },
      },
      opening_balance: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
        validate: { min: 0 },
      },
      total_expenses: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.0,
      },
      total_supplier_payments: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.0,
      },
      closing_balance: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.0,
      },
      notes: { type: DataTypes.TEXT, allowNull: true },
      is_closed: { type: DataTypes.BOOLEAN, defaultValue: false },
      closed_at: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'DailyExpenseSession',
      tableName: 'daily_expense_sessions',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [{ unique: true, fields: ['session_date'] }],
    }
  );

  return DailyExpenseSession;
};