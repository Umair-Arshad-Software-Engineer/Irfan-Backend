// models/Employee.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Employee = sequelize.define('Employee', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true, len: [2, 100] },
    },
    father_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true },
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { notEmpty: true },
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    salary: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: { min: 0 },
    },
    salary_type: {
      type: DataTypes.ENUM('Daily', 'Monthly', 'Contract'),
      allowNull: false,
      defaultValue: 'Monthly',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    join_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    contract_unit: {
      type: DataTypes.ENUM('bag', 'kg', 'ton', 'meter', 'piece'),
      allowNull: true,
    },
    unit_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: { min: 0 },
    },
    overtime_rate: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: { min: 0 },
    },
    standard_working_hours: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 8,
      validate: { min: 0 },
    },
  }, {
    tableName: 'employees',
    timestamps: true,
    underscored: false,
  });

  return Employee;
};