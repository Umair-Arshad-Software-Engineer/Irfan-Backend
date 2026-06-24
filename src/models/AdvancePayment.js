const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AdvancePayment = sequelize.define('AdvancePayment', {
    id:                { type: DataTypes.INTEGER,       primaryKey: true, autoIncrement: true },
    employee_id:       { type: DataTypes.INTEGER,       allowNull: false },
    amount:            { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    date:              { type: DataTypes.DATEONLY,       allowNull: false },
    description:       { type: DataTypes.TEXT,           allowNull: true },
    status:            {
      type: DataTypes.ENUM('pending', 'recovered'),
      allowNull: false,
      defaultValue: 'pending',
    },
    salary_payment_id: { type: DataTypes.INTEGER,       allowNull: true, defaultValue: null },
  }, {
    tableName: 'advance_payments',
    timestamps: true,
    underscored: false,
  });

  return AdvancePayment;
};