// backend/src/models/CustomerLedger.js
const { DataTypes } = require('sequelize');
const { Op } = require('sequelize');

module.exports = (sequelize) => {
  const CustomerLedger = sequelize.define('CustomerLedger', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    customer_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'customers',
        key: 'id'
      }
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    transaction_type: {
      type: DataTypes.ENUM('sale', 'payment', 'opening_balance', 'adjustment', 'reversal'), // ✅ Added 'reversal'
      allowNull: false
    },
    reference_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID of the related transaction (sale_id, payment_id, etc.)'
    },
    reference_number: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Invoice number or payment reference'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    debit: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        isDecimal: { msg: 'Debit must be a decimal number' },
        min: { args: [0], msg: 'Debit cannot be negative' }
      },
      comment: 'Amount customer owes (increases balance)'
    },
    credit: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        isDecimal: { msg: 'Credit must be a decimal number' },
        min: { args: [0], msg: 'Credit cannot be negative' }
      },
      comment: 'Amount paid by customer (decreases balance)'
    },
    balance: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        isDecimal: { msg: 'Balance must be a decimal number' }
      },
      comment: 'Running balance after this transaction'
    },
    payment_method: {
      type: DataTypes.ENUM('cash', 'bank', 'cheque', 'slip'),
      allowNull: true,
      comment: 'Payment method for payment transactions'
    },
    bank_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Bank name for bank/cheque payments'
    },
    bank_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'banks',
        key: 'id'
      },
      comment: 'Reference to bank for bank/cheque payments'
    },
    cheque_number: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Cheque number for cheque payments'
    },
    cheque_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Date on cheque'
    },
    cheque_cleared: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Whether cheque has been cleared'
    },
    cheque_cleared_date: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When cheque was cleared'
    }
  }, {
    tableName: 'customer_ledgers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['customer_id']
      },
      {
        fields: ['date']
      },
      {
        fields: ['reference_id', 'transaction_type']
      }
    ]
  });

  // ✅ Add association method
  CustomerLedger.associate = (models) => {
    CustomerLedger.belongsTo(models.Customer, {
      foreignKey: 'customer_id',
      as: 'customer'
    });
    
    CustomerLedger.belongsTo(models.Bank, {
      foreignKey: 'bank_id',
      as: 'bank'
    });
  };

  return CustomerLedger;
};