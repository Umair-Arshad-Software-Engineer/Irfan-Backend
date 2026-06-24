// src/models/BankTransfer.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class BankTransfer extends Model {
    static associate(models) {
      BankTransfer.belongsTo(models.Bank, {
        foreignKey: 'from_bank_id',
        as: 'fromBank'
      });
      BankTransfer.belongsTo(models.Bank, {
        foreignKey: 'to_bank_id',
        as: 'toBank'
      });
      BankTransfer.belongsTo(models.User, {
        foreignKey: 'created_by',
        as: 'creator'
      });
      // Links to both generated bank transactions
      BankTransfer.belongsTo(models.BankTransaction, {
        foreignKey: 'debit_transaction_id',
        as: 'debitTransaction'
      });
      BankTransfer.belongsTo(models.BankTransaction, {
        foreignKey: 'credit_transaction_id',
        as: 'creditTransaction'
      });
    }
  }

  BankTransfer.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    from_bank_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'banks', key: 'id' }
    },
    to_bank_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'banks', key: 'id' }
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: {
        isDecimal: true,
        min: 0.01
      }
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: false,
      validate: { notEmpty: { msg: 'Description is required' } }
    },
    reference_number: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    transfer_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    // Link to the two bank_transactions created
    debit_transaction_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'bank_transactions', key: 'id' },
      onDelete: 'SET NULL'
    },
    credit_transaction_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'bank_transactions', key: 'id' },
      onDelete: 'SET NULL'
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' }
    }
  }, {
    sequelize,
    modelName: 'BankTransfer',
    tableName: 'bank_transfers',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['from_bank_id'] },
      { fields: ['to_bank_id'] },
      { fields: ['transfer_date'] }
    ]
  });

  return BankTransfer;
};