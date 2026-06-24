// src/models/BankTransaction.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class BankTransaction extends Model {
    static associate(models) {
      // Existing associations
      BankTransaction.belongsTo(models.Bank, {
        foreignKey: 'bank_id',
        as: 'bank'
      });
      
      BankTransaction.belongsTo(models.User, {
        foreignKey: 'created_by',
        as: 'creator'
      });

      // Cheque associations
      BankTransaction.belongsTo(models.Cheque, {
        foreignKey: 'cheque_id',
        as: 'cheque'
      });
      
      // User who reversed the transaction
      BankTransaction.belongsTo(models.User, {
        foreignKey: 'reversed_by',
        as: 'reverser'
      });

      // Self-references for reversal tracking
      BankTransaction.belongsTo(models.BankTransaction, {
        foreignKey: 'reversal_of_transaction_id',
        as: 'reversedTransaction'
      });
      BankTransaction.hasMany(models.BankTransaction, {
        foreignKey: 'reversal_of_transaction_id',
        as: 'reversals'
      });

      // Track original transaction
      BankTransaction.belongsTo(models.BankTransaction, {
        foreignKey: 'original_transaction_id',
        as: 'originalTransaction'
      });
      BankTransaction.hasMany(models.BankTransaction, {
        foreignKey: 'original_transaction_id',
        as: 'relatedReversals'
      });
    }
  }

  BankTransaction.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    bank_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'banks',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    transaction_type: {
      type: DataTypes.ENUM('in', 'out'),
      allowNull: false,
      validate: {
        isIn: [['in', 'out']]
      }
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      get() {
        const value = this.getDataValue('amount');
        return value === null ? null : parseFloat(value);
      },
      validate: {
        isDecimal: true,
        min: 0.01,
        notZero(value) {
          if (parseFloat(value) <= 0) {
            throw new Error('Amount must be greater than 0');
          }
        }
      }
    },
    description: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: {
          msg: 'Description is required'
        },
        len: {
          args: [2, 500],
          msg: 'Description must be between 2 and 500 characters'
        }
      }
    },
    reference_number: {
      type: DataTypes.STRING,
      allowNull: true
    },
    balance_after: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      get() {
        const value = this.getDataValue('balance_after');
        return value === null ? null : parseFloat(value);
      }
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    transaction_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    // Reversal tracking fields
    is_reversal: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    reversal_of_transaction_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'bank_transactions',
        key: 'id'
      },
      onDelete: 'SET NULL'
    },
    cheque_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'cheques',
        key: 'id'
      },
      onDelete: 'SET NULL'
    },
    original_transaction_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'bank_transactions',
        key: 'id'
      },
      onDelete: 'SET NULL'
    },
    reversal_reason: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    reversed_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    is_protected: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    source_type: {
      type: DataTypes.ENUM('manual', 'cheque', 'transfer', 'supplier_payment', 'customer_payment'),
      allowNull: false,
      defaultValue: 'manual'
    },
    source_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    // Additional useful fields
    cheque_number: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Stored for quick reference without joining'
    },
    payee_payer_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Stored for quick reference without joining'
    }
  }, {
    sequelize,
    modelName: 'BankTransaction',
    tableName: 'bank_transactions',
    timestamps: true,
    underscored: true,
    paranoid: true, // Enable soft delete for transactions
    indexes: [
      // Existing indexes
      { fields: ['bank_id'] },
      { fields: ['transaction_date'] },
      { fields: ['transaction_type'] },
      // New indexes for performance
      { fields: ['is_reversal'] },
      { fields: ['reversal_of_transaction_id'] },
      { fields: ['cheque_id'] },
      { fields: ['original_transaction_id'] },
      { fields: ['source_type', 'source_id'] },
      { fields: ['is_protected'] },
      { fields: ['deleted_at'] },
      { fields: ['created_by'] },
      { fields: ['reversed_by'] },
      { fields: ['cheque_number'] },
      { fields: ['reference_number'] },
      // Composite indexes for common queries
      { fields: ['bank_id', 'transaction_date'] },
      { fields: ['bank_id', 'is_reversal'] },
      { fields: ['source_type', 'source_id', 'is_reversal'] }
    ],
    hooks: {
      beforeCreate: async (transaction, options) => {
        // Auto-set is_protected based on source_type
        if (transaction.source_type !== 'manual') {
          transaction.is_protected = true;
        }
        
        // Auto-set description prefix for reversals
        if (transaction.is_reversal && transaction.description && 
            !transaction.description.startsWith('REVERSAL:')) {
          transaction.description = `REVERSAL: ${transaction.description}`;
        }
        
        // Format amount
        if (transaction.amount) {
          transaction.amount = parseFloat(transaction.amount).toFixed(2);
        }
        if (transaction.balance_after) {
          transaction.balance_after = parseFloat(transaction.balance_after).toFixed(2);
        }
      },
      beforeUpdate: async (transaction, options) => {
        // If this is being marked as a reversal, ensure is_reversal is true
        if (transaction.reversal_of_transaction_id && !transaction.is_reversal) {
          transaction.is_reversal = true;
        }
        
        // Format amounts
        if (transaction.amount) {
          transaction.amount = parseFloat(transaction.amount).toFixed(2);
        }
        if (transaction.balance_after) {
          transaction.balance_after = parseFloat(transaction.balance_after).toFixed(2);
        }
      },
      afterFind: async (instances, options) => {
        // Optional: Post-processing after find
        if (instances && !Array.isArray(instances)) {
          instances = [instances];
        }
        if (instances) {
          for (const instance of instances) {
            if (instance && instance.amount) {
              instance.amount = parseFloat(instance.amount);
            }
            if (instance && instance.balance_after) {
              instance.balance_after = parseFloat(instance.balance_after);
            }
          }
        }
      }
    }
  });

  return BankTransaction;
};