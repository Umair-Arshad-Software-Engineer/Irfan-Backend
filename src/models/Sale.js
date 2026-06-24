const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Sale = sequelize.define('Sale', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    invoice_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: { msg: 'Invoice number is required' }
      }
    },
    sale_type: {
      type: DataTypes.ENUM('pos', 'invoice'),
      allowNull: false,
      defaultValue: 'pos'
    },
    sale_category: {
      type: DataTypes.ENUM('sarya', 'filled'),
      allowNull: true,
      defaultValue: 'filled',
      comment: 'sarya = weight-based pricing, filled = piece-based pricing'
    },
    customer_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'customers',
        key: 'id'
      }
    },
    sale_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    discount_type: {
      type: DataTypes.ENUM('percent', 'fixed'),
      allowNull: false,
      defaultValue: 'fixed'
    },
    discount_value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    discount_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    tax_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    grand_total: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    amount_paid: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    change_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    payment_method: {
      type: DataTypes.ENUM('cash', 'card', 'bank', 'bank_transfer', 'cheque', 'slip', 'credit'),
      allowNull: false,
      defaultValue: 'cash'
    },
    payment_status: {
      type: DataTypes.ENUM('paid', 'partial', 'unpaid', 'draft'),
      allowNull: false,
      defaultValue: 'paid'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    reference: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Reference number or document number'
    },
  }, {
    tableName: 'sales',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { unique: true, fields: ['invoice_number'] },
      { fields: ['customer_id'] },
      { fields: ['sale_date'] },
      { fields: ['payment_status'] },
      { fields: ['sale_type'] },
      { fields: ['sale_category'] },
      { fields: ['reference'] }
    ]
  });

  return Sale;
};