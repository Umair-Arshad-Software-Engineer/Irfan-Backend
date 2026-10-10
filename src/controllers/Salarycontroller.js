// controllers/salaryController.js
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { Employee, Attendance, SalaryPayment, AdvancePayment, EmployeeExpense, ContractWorkEntry } = require('../models');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Helper: calendar days (inclusives) ────────────────────────────────────────
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

// ── Helper: overtime (hours, hourly rate, amount) ─────────────────────────────
// Rate = employee.overtime_rate if set (> 0), otherwise
//        (per-day salary / standard working hours).
// Monthly per-day salary = salary / 30, Daily per-day salary = salary.
function computeOvertime(records, employee, salaryTypeLower) {
  const base     = parseFloat(employee.salary) || 0;
  const stdHours = parseFloat(employee.standard_working_hours) || 8;
  const perDay   = salaryTypeLower === 'monthly' ? base / 30 : base;
  const custom   = parseFloat(employee.overtime_rate);
  const rate     = custom > 0 ? custom : (stdHours > 0 ? perDay / stdHours : 0);

  const hours = records
    .filter(r => r.status === 'Present' || r.status === 'Half_Day')
    .reduce((s, r) => s + (parseFloat(r.overtime_hours) || 0), 0);

  return { hours, rate, amount: hours * rate };
}

// ── Helper: check for overlapping salary period ───────────────────────────────
async function hasOverlap(employee_id, from_date, to_date, excludeId = null) {
  const where = {
    employee_id,
    [Op.or]: [
      { from_date: { [Op.between]: [from_date, to_date] } },
      { to_date:   { [Op.between]: [from_date, to_date] } },
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

// ── Helper: get employee balance ──────────────────────────────────────────────
async function getEmployeeBalance(employee_id) {
  const advances = await AdvancePayment.findAll({
    where: { employee_id, entry_type: 'credit', salary_payment_id: null },
  });

  const expenses = await EmployeeExpense.findAll({
    where: { employee_id, entry_type: 'credit', salary_payment_id: null },
  });

  const totalCredit = advances.reduce((sum, a) => sum + parseFloat(a.amount), 0) +
                     expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  const debitAdvances = await AdvancePayment.findAll({
    where: { employee_id, entry_type: 'debit' },
  });

  const debitExpenses = await EmployeeExpense.findAll({
    where: { employee_id, entry_type: 'debit' },
  });

  const totalDebit = debitAdvances.reduce((sum, a) => sum + parseFloat(a.amount), 0) +
                    debitExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  return totalCredit - totalDebit;
}

// ── CALCULATE salary (preview — does NOT save) ────────────────────────────────
exports.calculateSalary = async (req, res) => {
  try {
    const { employee_id, from_date, to_date } = req.query;

    if (!employee_id || !from_date || !to_date) {
      return res.status(400).json({ success: false, message: 'employee_id, from_date and to_date are required' });
    }

    const empId = parseInt(employee_id, 10);
    if (isNaN(empId)) {
      return res.status(400).json({ success: false, message: 'Invalid employee_id' });
    }

    const employee = await Employee.findByPk(empId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const totalDays = countCalendarDays(from_date, to_date);
    const records   = await Attendance.findAll({
      where: { employee_id: empId, date: { [Op.between]: [from_date, to_date] } },
    });

    const { present, absent, halfDays, leave } = summarise(records, totalDays);

    const baseSalary = parseFloat(employee.salary) || 0;
    const salaryType = (employee.salary_type || '').toString().trim().toLowerCase();

    let regularSalary = 0;
    let overtime = { hours: 0, rate: 0, amount: 0 };

    if (salaryType === 'monthly') {
      regularSalary = present * (baseSalary / 30);
      overtime = computeOvertime(records, employee, 'monthly');
    } else if (salaryType === 'daily') {
      regularSalary = present * baseSalary;
      overtime = computeOvertime(records, employee, 'daily');
    } else if (salaryType.includes('contract')) {
      const workEntries = await ContractWorkEntry.findAll({
        where: {
          employee_id: empId,
          date: {
            [Op.gte]: `${from_date} 00:00:00`,
            [Op.lte]: `${to_date} 23:59:59`,
          },
        },
      });
      regularSalary = workEntries.reduce((sum, e) => sum + (parseFloat(e.total_amount) || 0), 0);
      // Contract workers are paid per unit — no overtime
    }

    const calculatedSalary = regularSalary + overtime.amount;

    const outstandingAdvances = await AdvancePayment.findAll({
      where: { employee_id: empId, entry_type: 'credit', salary_payment_id: null },
      order: [['date', 'ASC']],
    });

    const outstandingExpenses = await EmployeeExpense.findAll({
      where: { employee_id: empId, entry_type: 'credit', salary_payment_id: null },
      order: [['date', 'ASC']],
    });

    const totalOutstandingAdvance = outstandingAdvances.reduce((s, a) => s + parseFloat(a.amount), 0);
    const totalOutstandingExpense = outstandingExpenses.reduce((s, e) => s + parseFloat(e.amount), 0);
    const totalOutstandingCredit  = totalOutstandingAdvance + totalOutstandingExpense;

    const currentBalance = await getEmployeeBalance(empId);

    const netSalary = Math.max(0, calculatedSalary - totalOutstandingCredit);

    // ── Suggested auto-deduction (advances first, then expenses) ─────────────
    let advanceDeduction = 0;
    let expenseDeduction = 0;

    if (calculatedSalary > 0) {
      let remainingSalary = calculatedSalary;

      for (const advance of outstandingAdvances) {
        if (remainingSalary <= 0) break;
        const amount = parseFloat(advance.amount);
        const take = Math.min(remainingSalary, amount);
        advanceDeduction += take;
        remainingSalary  -= take;
      }

      for (const expense of outstandingExpenses) {
        if (remainingSalary <= 0) break;
        const amount = parseFloat(expense.amount);
        const take = Math.min(remainingSalary, amount);
        expenseDeduction += take;
        remainingSalary  -= take;
      }
    }

    const remainingCredit = Math.max(0, totalOutstandingCredit - advanceDeduction - expenseDeduction);

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
        // calculated_salary = regular_salary + overtime_amount
        regular_salary:    round2(regularSalary),
        overtime_hours:    round2(overtime.hours),
        overtime_rate:     round2(overtime.rate),
        overtime_amount:   round2(overtime.amount),
        calculated_salary: round2(calculatedSalary),
        current_balance:   round2(currentBalance),
        total_outstanding_credit: round2(totalOutstandingCredit),
        advance_deduction: round2(advanceDeduction),
        expense_deduction: round2(expenseDeduction),
        remaining_credit:  round2(remainingCredit),
        net_salary:        round2(netSalary),
        outstanding_advances:  outstandingAdvances,
        outstanding_expenses:  outstandingExpenses,
      },
    });
  } catch (error) {
    console.error('Calculate salary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── SAVE salary payment ──────────────────────────────────────────────────────
exports.saveSalaryPayment = async (req, res) => {
  try {
    const {
      employee_id, from_date, to_date,
      total_days, present_days, absent_days, half_days, leave_days,
      base_salary, calculated_salary, paid_amount,
      overtime_hours, overtime_amount,
      advance_deduction, expense_deduction,
      advance_deductions, expense_deductions, // ← [{id, amount}]
      notes, payment_date,
    } = req.body;

    const employee = await Employee.findByPk(employee_id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const overlap = await hasOverlap(employee_id, from_date, to_date);
    if (overlap) {
      return res.status(409).json({
        success: false,
        message: `A salary record already exists for ${employee.name} that overlaps with ${from_date} to ${to_date}.`,
      });
    }

    const transaction = await sequelize.transaction();

    try {
      const payment = await SalaryPayment.create({
        employee_id, from_date, to_date,
        total_days, present_days, absent_days, half_days, leave_days,
        base_salary, calculated_salary,
        overtime_hours:  overtime_hours  ?? 0,
        overtime_amount: overtime_amount ?? 0,
        advance_deduction: advance_deduction ?? 0,
        expense_deduction: expense_deduction ?? 0,
        paid_amount: paid_amount ?? calculated_salary,
        notes,
        payment_date: payment_date ?? from_date,
      }, { transaction });

      // ── Process advances: recover exactly the amount the user selected ─────
      if (Array.isArray(advance_deductions) && advance_deductions.length > 0) {
        for (const item of advance_deductions) {
          const { id, amount } = item;
          const original = await AdvancePayment.findOne({
            where: { id, employee_id, entry_type: 'credit', salary_payment_id: null },
            transaction,
          });
          if (!original) continue;

          const fullAmount = parseFloat(original.amount);
          const deductAmount = Math.min(parseFloat(amount) || 0, fullAmount);
          if (deductAmount <= 0) continue;

          await AdvancePayment.create({
            employee_id,
            amount: deductAmount,
            date: payment_date || from_date,
            description: `Recovered from salary payment #${payment.id} - ${original.description || 'Advance recovery'}`,
            entry_type: 'debit',
            balance: 0,
            salary_payment_id: payment.id,
            source_entry_id: original.id,
          }, { transaction });

          if (deductAmount >= fullAmount) {
            await original.update({ salary_payment_id: payment.id }, { transaction });
          } else {
            await original.update({ amount: fullAmount - deductAmount }, { transaction });
          }
        }
      }

      // ── Process expenses: recover exactly the amount the user selected ─────
      if (Array.isArray(expense_deductions) && expense_deductions.length > 0) {
        for (const item of expense_deductions) {
          const { id, amount } = item;
          const original = await EmployeeExpense.findOne({
            where: { id, employee_id, entry_type: 'credit', salary_payment_id: null },
            transaction,
          });
          if (!original) continue;

          const fullAmount = parseFloat(original.amount);
          const deductAmount = Math.min(parseFloat(amount) || 0, fullAmount);
          if (deductAmount <= 0) continue;

          await EmployeeExpense.create({
            employee_id,
            amount: deductAmount,
            date: payment_date || from_date,
            category: original.category,
            description: `Recovered from salary payment #${payment.id} - ${original.description || 'Expense recovery'}`,
            entry_type: 'debit',
            balance: 0,
            salary_payment_id: payment.id,
            source_entry_id: original.id,
          }, { transaction });

          if (deductAmount >= fullAmount) {
            await original.update({ salary_payment_id: payment.id }, { transaction });
          } else {
            await original.update({ amount: fullAmount - deductAmount }, { transaction });
          }
        }
      }

      await updateEmployeeBalances(employee_id, transaction);

      await transaction.commit();

      const result = await SalaryPayment.findByPk(payment.id, {
        include: [{ model: Employee, as: 'employee', attributes: ['id', 'name', 'salary_type'] }],
      });

      const updatedBalance = await getEmployeeBalance(employee_id);

      res.status(201).json({
        success: true,
        message: 'Salary payment saved',
        data: result,
        current_balance: updatedBalance
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Save salary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── Helper: Update employee balances ─────────────────────────────────────────
async function updateEmployeeBalances(employee_id, transaction = null) {
  const advances = await AdvancePayment.findAll({
    where: { employee_id },
    order: [['date', 'ASC'], ['createdAt', 'ASC']],
    transaction
  });

  const expenses = await EmployeeExpense.findAll({
    where: { employee_id },
    order: [['date', 'ASC'], ['createdAt', 'ASC']],
    transaction
  });

  const allEntries = [...advances, ...expenses].sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    if (dateA - dateB !== 0) return dateA - dateB;
    return a.createdAt - b.createdAt;
  });

  let balance = 0;

  for (const entry of allEntries) {
    const amount = parseFloat(entry.amount);
    if (entry.entry_type === 'credit') {
      balance += amount;
    } else if (entry.entry_type === 'debit') {
      balance -= amount;
    }
    await entry.update({ balance }, { transaction });
  }
}

// ── GET salary history for an employee ───────────────────────────────────────
exports.getSalaryHistory = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const payments = await SalaryPayment.findAll({
      where: { employee_id: employeeId },
      include: [{ model: Employee, as: 'employee', attributes: ['id', 'name', 'salary_type'] }],
      order: [['from_date', 'DESC']],
    });

    const currentBalance = await getEmployeeBalance(parseInt(employeeId));

    res.json({
      success: true,
      data: payments,
      count: payments.length,
      current_balance: currentBalance
    });
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

// ── DELETE salary payment ────────────────────────────────────────────────────
exports.deleteSalaryPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await SalaryPayment.findByPk(id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    const transaction = await sequelize.transaction();

    try {
      // ── Reverse advance debit entries, restoring the original credit ────────
      const advanceDebits = await AdvancePayment.findAll({
        where: { salary_payment_id: id, entry_type: 'debit' },
        transaction,
      });

      for (const debit of advanceDebits) {
        if (debit.source_entry_id) {
          const original = await AdvancePayment.findByPk(debit.source_entry_id, { transaction });
          if (original) {
            if (original.salary_payment_id === parseInt(id, 10)) {
              await original.update({ salary_payment_id: null }, { transaction });
            } else {
              await original.update({
                amount: parseFloat(original.amount) + parseFloat(debit.amount),
              }, { transaction });
            }
          }
        }
        await debit.destroy({ transaction });
      }

      // ── Reverse expense debit entries, restoring the original credit ────────
      const expenseDebits = await EmployeeExpense.findAll({
        where: { salary_payment_id: id, entry_type: 'debit' },
        transaction,
      });

      for (const debit of expenseDebits) {
        if (debit.source_entry_id) {
          const original = await EmployeeExpense.findByPk(debit.source_entry_id, { transaction });
          if (original) {
            if (original.salary_payment_id === parseInt(id, 10)) {
              await original.update({ salary_payment_id: null }, { transaction });
            } else {
              await original.update({
                amount: parseFloat(original.amount) + parseFloat(debit.amount),
              }, { transaction });
            }
          }
        }
        await debit.destroy({ transaction });
      }

      await payment.destroy({ transaction });

      await updateEmployeeBalances(payment.employee_id, transaction);

      await transaction.commit();

      res.json({ success: true, message: 'Payment deleted and deductions reversed' });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET employee balance report ──────────────────────────────────────────────
exports.getEmployeeBalanceReport = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const advances = await AdvancePayment.findAll({
      where: { employee_id: employeeId },
      order: [['date', 'ASC']]
    });

    const expenses = await EmployeeExpense.findAll({
      where: { employee_id: employeeId },
      order: [['date', 'ASC']]
    });

    const allTransactions = [...advances, ...expenses].sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      if (dateA - dateB !== 0) return dateA - dateB;
      return a.createdAt - b.createdAt;
    });

    let runningBalance = 0;
    const transactionsWithBalance = allTransactions.map(transaction => {
      const amount = parseFloat(transaction.amount);
      if (transaction.entry_type === 'credit') {
        runningBalance += amount;
      } else {
        runningBalance -= amount;
      }
      return {
        ...transaction.toJSON(),
        running_balance: Math.round(runningBalance * 100) / 100
      };
    });

    const employee = await Employee.findByPk(employeeId);

    res.json({
      success: true,
      data: {
        employee_id: employeeId,
        employee_name: employee ? employee.name : 'Unknown',
        current_balance: Math.round(runningBalance * 100) / 100,
        transactions: transactionsWithBalance
      }
    });
  } catch (error) {
    console.error('Balance report error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};