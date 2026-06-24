const { EmployeeExpense } = require('../models');

// ── GET expenses for an employee ──────────────────────────────────────────────
exports.getExpensesByEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { status, category } = req.query;

    const where = { employee_id: employeeId };
    if (status)   where.status   = status;
    if (category) where.category = category;

    const expenses = await EmployeeExpense.findAll({
      where,
      order: [['date', 'DESC']],
    });

    // ── Summary ───────────────────────────────────────────────────────────────
    const all = await EmployeeExpense.findAll({ where: { employee_id: employeeId } });
    const totalAmount    = all.reduce((s, e) => s + parseFloat(e.amount), 0);
    const totalRecovered = all.filter(e => e.status === 'recovered').reduce((s, e) => s + parseFloat(e.amount), 0);
    const pendingBalance = totalAmount - totalRecovered;

    res.json({
      success: true,
      data: expenses,
      count: expenses.length,
      summary: {
        total_amount:    Math.round(totalAmount    * 100) / 100,
        total_recovered: Math.round(totalRecovered * 100) / 100,
        pending_balance: Math.round(pendingBalance * 100) / 100,
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

    const expense = await EmployeeExpense.create({
      employee_id, amount, date, category, description: description || null,
    });

    res.status(201).json({ success: true, message: 'Expense created', data: expense });
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

    if (expense.status === 'recovered') {
      return res.status(400).json({ success: false, message: 'Cannot edit a recovered expense' });
    }

    await expense.update({ amount, date, category, description: description || null });
    res.json({ success: true, message: 'Expense updated', data: expense });
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

    if (expense.status === 'recovered') {
      return res.status(400).json({ success: false, message: 'Cannot delete a recovered expense' });
    }

    await expense.destroy();
    res.json({ success: true, message: 'Expense deleted' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};