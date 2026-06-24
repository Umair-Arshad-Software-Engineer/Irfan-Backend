const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalaryPayment = sequelize.define('SalaryPayment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    employee_id:       { type: DataTypes.INTEGER,      allowNull: false },
    from_date:         { type: DataTypes.DATEONLY,      allowNull: false },
    to_date:           { type: DataTypes.DATEONLY,      allowNull: false },
    total_days:        { type: DataTypes.INTEGER,       allowNull: false, defaultValue: 0 },
    present_days:      { type: DataTypes.DECIMAL(4, 1), allowNull: false, defaultValue: 0 },
    absent_days:       { type: DataTypes.INTEGER,       allowNull: false, defaultValue: 0 },
    half_days:         { type: DataTypes.INTEGER,       allowNull: false, defaultValue: 0 },
    leave_days:        { type: DataTypes.INTEGER,       allowNull: false, defaultValue: 0 },
    base_salary:       { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    calculated_salary: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    // ── Deductions ──────────────────────────────────────────────────────────
    advance_deduction: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    expense_deduction: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    // paid_amount = calculated_salary - advance_deduction - expense_deduction (user can override)
    paid_amount:       { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    notes:             { type: DataTypes.TEXT,           allowNull: true },
    payment_date:      { type: DataTypes.DATEONLY,       allowNull: true },
  }, {
    tableName: 'salary_payments',
    timestamps: true,
    underscored: false,
  });

  return SalaryPayment;
};