// controllers/empExpenseController.js
const { Op } = require('sequelize');
const { EmployeeExpense, Employee, sequelize } = require('../models');

// ── Helper: Update employee balances ─────────────────────────────────────────
async function updateEmployeeBalances(employee_id, transaction = null) {
  const expenses = await EmployeeExpense.findAll({
    where: { employee_id },
    order: [['date', 'ASC'], ['createdAt', 'ASC']],
    transaction
  });

  let balance = 0;
  for (const expense of expenses) {
    const amount = parseFloat(expense.amount);
    if (expense.entry_type === 'credit') {
      balance += amount;
    } else if (expense.entry_type === 'debit') {
      balance -= amount;
    }
    await expense.update({ balance }, { transaction });
  }
  return balance;
}

// ── GET expenses for an employee ──────────────────────────────────────────────
exports.getExpensesByEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { entry_type, category } = req.query;

    const where = { employee_id: employeeId };
    if (entry_type) where.entry_type = entry_type;
    if (category) where.category = category;

    const expenses = await EmployeeExpense.findAll({
      where,
      include: [{ 
        model: Employee, 
        as: 'employee',  // ← FIX: Added 'as' keyword
        attributes: ['id', 'name'] 
      }],
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
    });

    // ── Summary with running balance ───────────────────────────────────────────
    const allExpenses = await EmployeeExpense.findAll({
      where: { employee_id: employeeId },
      order: [['date', 'ASC'], ['createdAt', 'ASC']],
    });

    let runningBalance = 0;
    const expensesWithBalance = allExpenses.map(exp => {
      const amount = parseFloat(exp.amount);
      if (exp.entry_type === 'credit') {
        runningBalance += amount;
      } else {
        runningBalance -= amount;
      }
      return {
        ...exp.toJSON(),
        running_balance: Math.round(runningBalance * 100) / 100
      };
    });

    const creditEntries = expensesWithBalance.filter(e => e.entry_type === 'credit');
    const debitEntries = expensesWithBalance.filter(e => e.entry_type === 'debit');

    const totalCredit = creditEntries.reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const totalDebit = debitEntries.reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const currentBalance = totalCredit - totalDebit;

    // Group by category
    const categorySummary = {};
    creditEntries.forEach(expense => {
      const cat = expense.category || 'Other';
      if (!categorySummary[cat]) {
        categorySummary[cat] = { total: 0, count: 0 };
      }
      categorySummary[cat].total += parseFloat(expense.amount);
      categorySummary[cat].count++;
    });

    res.json({
      success: true,
      data: expenses,
      count: expenses.length,
      summary: {
        total_credit: Math.round(totalCredit * 100) / 100,
        total_debit: Math.round(totalDebit * 100) / 100,
        current_balance: Math.round(currentBalance * 100) / 100,
        credit_count: creditEntries.length,
        debit_count: debitEntries.length,
        category_summary: categorySummary
      },
    });
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── CREATE expense ────────────────────────────────────────────────────────────
exports.createExpense = async (req, res) => {
  try {
    const { employee_id, amount, date, category, description } = req.body;

    if (!employee_id || amount == null || !date || !category) {
      return res.status(400).json({ success: false, message: 'employee_id, amount, date and category are required' });
    }

    const employee = await Employee.findByPk(employee_id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    if (parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    const transaction = await sequelize.transaction();

    try {
      const expense = await EmployeeExpense.create({
        employee_id,
        amount: parseFloat(amount),
        date,
        category,
        description: description || 'Employee expense',
        entry_type: 'credit',
        balance: 0,
        salary_payment_id: null,
      }, { transaction });

      const currentBalance = await updateEmployeeBalances(employee_id, transaction);

      await transaction.commit();

      const createdExpense = await EmployeeExpense.findByPk(expense.id, {
        include: [{ 
          model: Employee, 
          as: 'employee',  // ← FIX: Added 'as' keyword
          attributes: ['id', 'name'] 
        }]
      });

      res.status(201).json({
        success: true,
        message: 'Expense created',
        data: createdExpense,
        current_balance: currentBalance
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── UPDATE expense ────────────────────────────────────────────────────────────
exports.updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, date, category, description } = req.body;

    const expense = await EmployeeExpense.findByPk(id);
    if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

    // Don't allow updating if it's already been recovered
    if (expense.salary_payment_id) {
      return res.status(400).json({ success: false, message: 'Cannot edit an expense that has been recovered in a salary payment' });
    }

    const transaction = await sequelize.transaction();

    try {
      await expense.update({
        amount: amount ? parseFloat(amount) : expense.amount,
        date: date || expense.date,
        category: category || expense.category,
        description: description || expense.description,
      }, { transaction });

      const currentBalance = await updateEmployeeBalances(expense.employee_id, transaction);

      await transaction.commit();

      const updatedExpense = await EmployeeExpense.findByPk(id, {
        include: [{ 
          model: Employee, 
          as: 'employee',  // ← FIX: Added 'as' keyword
          attributes: ['id', 'name'] 
        }]
      });

      res.json({
        success: true,
        message: 'Expense updated',
        data: updatedExpense,
        current_balance: currentBalance
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── DELETE expense ────────────────────────────────────────────────────────────
exports.deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;

    const expense = await EmployeeExpense.findByPk(id);
    if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

    // Don't allow deleting if it's already been recovered
    if (expense.salary_payment_id) {
      return res.status(400).json({ success: false, message: 'Cannot delete an expense that has been recovered in a salary payment' });
    }

    const transaction = await sequelize.transaction();

    try {
      const employee_id = expense.employee_id;
      await expense.destroy({ transaction });

      const currentBalance = await updateEmployeeBalances(employee_id, transaction);

      await transaction.commit();

      res.json({
        success: true,
        message: 'Expense deleted',
        current_balance: currentBalance
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};