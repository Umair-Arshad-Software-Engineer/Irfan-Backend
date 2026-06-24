// controllers/salaryController.js  (updated)
const { Op } = require('sequelize');
const { Employee, Attendance, SalaryPayment, AdvancePayment, EmployeeExpense } = require('../models');

// ── Helper: calendar days (inclusive) ────────────────────────────────────────
function countCalendarDays(from, to) {
  const diff = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}

// ── Helper: attendance summary ────────────────────────────────────────────────
function summarise(records, totalDays) {
  let present = 0, absent = 0, halfDays = 0, leave = 0;
  for (const r of records) {
    if      (r.status === 'Present')  present++;
    else if (r.status === 'Absent')   absent++;
    else if (r.status === 'Half_Day') { halfDays++; present += 0.5; }
    else if (r.status === 'Leave')    leave++;
  }
  absent += totalDays - records.length;   // unmarked days = absent
  return { present, absent, halfDays, leave };
}

// ── Helper: check for overlapping salary period ───────────────────────────────
async function hasOverlap(employee_id, from_date, to_date, excludeId = null) {
  const where = {
    employee_id,
    [Op.or]: [
      // existing record starts inside new range
      { from_date: { [Op.between]: [from_date, to_date] } },
      // existing record ends inside new range
      { to_date:   { [Op.between]: [from_date, to_date] } },
      // existing record completely wraps the new range
      {
        from_date: { [Op.lte]: from_date },
        to_date:   { [Op.gte]: to_date },
      },
    ],
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const count = await SalaryPayment.count({ where });
  return count > 0;
}

// ── CALCULATE salary (preview — does NOT save) ────────────────────────────────
exports.calculateSalary = async (req, res) => {
  try {
    const { employee_id, from_date, to_date } = req.query;

    if (!employee_id || !from_date || !to_date) {
      return res.status(400).json({ success: false, message: 'employee_id, from_date and to_date are required' });
    }

    const employee = await Employee.findByPk(employee_id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const totalDays = countCalendarDays(from_date, to_date);
    const records   = await Attendance.findAll({
      where: { employee_id, date: { [Op.between]: [from_date, to_date] } },
    });

    const { present, absent, halfDays, leave } = summarise(records, totalDays);

    let calculatedSalary = 0;
    const baseSalary = parseFloat(employee.salary);

    if (employee.salary_type === 'Monthly') {
      calculatedSalary = present * (baseSalary / 30);
    } else if (employee.salary_type === 'Daily') {
      calculatedSalary = present * baseSalary;
    } else {
      calculatedSalary = baseSalary;   // Contract
    }

    // ── Pending advances & expenses for this employee ─────────────────────────
    const pendingAdvances = await AdvancePayment.findAll({
      where: { employee_id, status: 'pending' },
      order: [['date', 'ASC']],
    });
    const pendingExpenses = await EmployeeExpense.findAll({
      where: { employee_id, status: 'pending' },
      order: [['date', 'ASC']],
    });

    const totalAdvance  = pendingAdvances.reduce((s, a) => s + parseFloat(a.amount), 0);
    const totalExpense  = pendingExpenses.reduce((s, e) => s + parseFloat(e.amount), 0);
    const totalDeductions = totalAdvance + totalExpense;
    const netSalary       = Math.max(0, calculatedSalary - totalDeductions);

    res.json({
      success: true,
      data: {
        employee_id:       employee.id,
        employee_name:     employee.name,
        salary_type:       employee.salary_type,
        base_salary:       baseSalary,
        from_date,
        to_date,
        total_days:        totalDays,
        present_days:      present,
        absent_days:       absent,
        half_days:         halfDays,
        leave_days:        leave,
        calculated_salary: Math.round(calculatedSalary * 100) / 100,
        total_advance:     Math.round(totalAdvance  * 100) / 100,
        total_expense:     Math.round(totalExpense  * 100) / 100,
        total_deductions:  Math.round(totalDeductions * 100) / 100,
        net_salary:        Math.round(netSalary * 100) / 100,
        pending_advances:  pendingAdvances,
        pending_expenses:  pendingExpenses,
      },
    });
  } catch (error) {
    console.error('Calculate salary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── SAVE salary payment (with overlap guard + deduction marking) ──────────────
exports.saveSalaryPayment = async (req, res) => {
  try {
    const {
      employee_id, from_date, to_date,
      total_days, present_days, absent_days, half_days, leave_days,
      base_salary, calculated_salary, paid_amount,
      advance_deduction, expense_deduction,
      advance_ids, expense_ids,      // arrays of IDs to mark as recovered
      notes, payment_date,
    } = req.body;

    const employee = await Employee.findByPk(employee_id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // ── Overlap check ─────────────────────────────────────────────────────────
    const overlap = await hasOverlap(employee_id, from_date, to_date);
    if (overlap) {
      return res.status(409).json({
        success: false,
        message: `A salary record already exists for ${employee.name} that overlaps with ${from_date} to ${to_date}. Please choose a different date range.`,
      });
    }

    // ── Save payment ──────────────────────────────────────────────────────────
    const payment = await SalaryPayment.create({
      employee_id, from_date, to_date,
      total_days, present_days, absent_days, half_days, leave_days,
      base_salary, calculated_salary,
      advance_deduction: advance_deduction ?? 0,
      expense_deduction: expense_deduction ?? 0,
      paid_amount: paid_amount ?? calculated_salary,
      notes,
      payment_date: payment_date ?? from_date,
    });

    // ── Mark advances as recovered ────────────────────────────────────────────
    if (Array.isArray(advance_ids) && advance_ids.length > 0) {
      await AdvancePayment.update(
        { status: 'recovered', salary_payment_id: payment.id },
        { where: { id: { [Op.in]: advance_ids }, employee_id } }
      );
    }

    // ── Mark expenses as recovered ────────────────────────────────────────────
    if (Array.isArray(expense_ids) && expense_ids.length > 0) {
      await EmployeeExpense.update(
        { status: 'recovered', salary_payment_id: payment.id },
        { where: { id: { [Op.in]: expense_ids }, employee_id } }
      );
    }

    const result = await SalaryPayment.findByPk(payment.id, {
      include: [{ model: Employee, as: 'employee', attributes: ['id', 'name', 'salary_type'] }],
    });

    res.status(201).json({ success: true, message: 'Salary payment saved', data: result });
  } catch (error) {
    console.error('Save salary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET salary history for an employee ───────────────────────────────────────
exports.getSalaryHistory = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const payments = await SalaryPayment.findAll({
      where: { employee_id: employeeId },
      include: [{ model: Employee, as: 'employee', attributes: ['id', 'name', 'salary_type'] }],
      order: [['from_date', 'DESC']],
    });
    res.json({ success: true, data: payments, count: payments.length });
  } catch (error) {
    console.error('Salary history error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET all salary payments ───────────────────────────────────────────────────
exports.getAllSalaryPayments = async (req, res) => {
  try {
    const payments = await SalaryPayment.findAll({
      include: [{ model: Employee, as: 'employee', attributes: ['id', 'name', 'salary_type'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: payments, count: payments.length });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── DELETE salary payment (also un-recovers advances/expenses) ────────────────
exports.deleteSalaryPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await SalaryPayment.findByPk(id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    // Revert advances and expenses back to pending
    await AdvancePayment.update(
      { status: 'pending', salary_payment_id: null },
      { where: { salary_payment_id: id } }
    );
    await EmployeeExpense.update(
      { status: 'pending', salary_payment_id: null },
      { where: { salary_payment_id: id } }
    );

    await payment.destroy();
    res.json({ success: true, message: 'Payment deleted and deductions reversed' });
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};