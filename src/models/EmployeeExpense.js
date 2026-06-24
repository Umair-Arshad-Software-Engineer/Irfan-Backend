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
    status:            {
      type: DataTypes.ENUM('pending', 'recovered'),
      allowNull: false,
      defaultValue: 'pending',
    },
    salary_payment_id: { type: DataTypes.INTEGER,        allowNull: true, defaultValue: null },
  }, {
    tableName: 'employee_expenses',
    timestamps: true,
    underscored: false,
  });

  return EmployeeExpense;
};