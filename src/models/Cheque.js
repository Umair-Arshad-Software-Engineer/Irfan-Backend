// backend/src/models/Cheque.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Cheque extends Model {
    static associate(models) {
      // Existing associations
      Cheque.belongsTo(models.Bank, {
        foreignKey: 'bank_id',
        as: 'bank'
      });
      Cheque.belongsTo(models.User, {
        foreignKey: 'created_by',
        as: 'creator'
      });
      Cheque.belongsTo(models.Supplier, {
        foreignKey: 'supplier_id',
        as: 'supplier'
      });
      Cheque.belongsTo(models.Customer, {
        foreignKey: 'customer_id',
        as: 'customer'
      });
      Cheque.belongsTo(models.SupplierLedger, {
        foreignKey: 'supplier_ledger_id',
        as: 'supplierLedger'
      });
      Cheque.belongsTo(models.Sale, {
        foreignKey: 'sale_id',
        as: 'sale'
      });
      
      // Bank Transaction associations
      Cheque.belongsTo(models.BankTransaction, {
        foreignKey: 'bank_transaction_id',
        as: 'clearedTransaction'
      });
      Cheque.belongsTo(models.BankTransaction, {
        foreignKey: 'reversal_of_transaction_id',
        as: 'reversedTransaction'
      });
      
      // NEW: User who deleted the cheque
      Cheque.belongsTo(models.User, {
        foreignKey: 'deleted_by',
        as: 'deleter'
      });
      
      // NEW: Self-reference for cheque reversals
      Cheque.belongsTo(models.Cheque, {
        foreignKey: 'original_cheque_id',
        as: 'originalCheque'
      });
      Cheque.hasMany(models.Cheque, {
        foreignKey: 'original_cheque_id',
        as: 'reversalCheques'
      });
    }
  }

  Cheque.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    bank_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'banks', key: 'id' },
      onDelete: 'CASCADE'
    },
    cheque_number: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    cheque_type: {
      type: DataTypes.ENUM('issued', 'received'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'cleared', 'bounced', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      get() {
        const value = this.getDataValue('amount');
        return value === null ? null : parseFloat(value);
      }
    },
    payee_payer_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    issue_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    cleared_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    bounce_reason: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    bank_transaction_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'bank_transactions', key: 'id' },
      onDelete: 'SET NULL'
    },
    // Reversal tracking fields
    reversal_of_transaction_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'bank_transactions', key: 'id' },
      onDelete: 'SET NULL'
    },
    is_reversal: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    original_cheque_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'cheques', key: 'id' },
      onDelete: 'SET NULL'
    },
    supplier_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'suppliers', key: 'id' },
      onDelete: 'SET NULL'
    },
    customer_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'customers', key: 'id' },
      onDelete: 'SET NULL'
    },
    sale_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'sales', key: 'id' },
      onDelete: 'SET NULL'
    },
    supplier_ledger_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'supplier_ledger', key: 'id' },
      onDelete: 'SET NULL'
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' }
    },
    // Deletion tracking fields
    deleted_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' }
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deletion_reason: {
      type: DataTypes.STRING(500),
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Cheque',
    tableName: 'cheques',
    timestamps: true,
    underscored: true,
    paranoid: true, // Enable soft delete
    indexes: [
      { fields: ['bank_id'] },
      { fields: ['status'] },
      { fields: ['cheque_type'] },
      { fields: ['cheque_number'] },
      { fields: ['issue_date'] },
      { fields: ['due_date'] },
      { fields: ['supplier_id'] },
      { fields: ['customer_id'] },
      { fields: ['sale_id'] },
      { fields: ['supplier_ledger_id'] },
      { fields: ['reversal_of_transaction_id'] },
      { fields: ['original_cheque_id'] },
      { fields: ['is_reversal'] },
      { fields: ['deleted_at'] },
      { fields: ['created_by'] },
      { fields: ['deleted_by'] }
    ],
    hooks: {
      beforeCreate: (cheque, options) => {
        // Ensure amount is stored as proper decimal
        if (cheque.amount) {
          cheque.amount = parseFloat(cheque.amount).toFixed(2);
        }
      },
      beforeUpdate: (cheque, options) => {
        if (cheque.amount) {
          cheque.amount = parseFloat(cheque.amount).toFixed(2);
        }
      }
    }
  });

  return Cheque;
};