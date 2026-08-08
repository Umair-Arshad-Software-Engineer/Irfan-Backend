// controllers/advanceController.js
const { Op } = require('sequelize');
const { AdvancePayment, Employee, sequelize } = require('../models');

// ── Helper: Update employee balances ─────────────────────────────────────────
async function updateEmployeeBalances(employee_id, transaction = null) {
  const advances = await AdvancePayment.findAll({
    where: { employee_id },
    order: [['date', 'ASC'], ['createdAt', 'ASC']],
    transaction
  });

  let balance = 0;
  for (const advance of advances) {
    const amount = parseFloat(advance.amount);
    if (advance.entry_type === 'credit') {
      balance += amount;
    } else if (advance.entry_type === 'debit') {
      balance -= amount;
    }
    await advance.update({ balance }, { transaction });
  }
  return balance;
}

// ── GET advances for an employee ──────────────────────────────────────────────
exports.getAdvancesByEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { entry_type } = req.query;

    const where = { employee_id: employeeId };
    if (entry_type) where.entry_type = entry_type;

    const advances = await AdvancePayment.findAll({
      where,
      include: [{ 
        model: Employee, 
        as: 'employee',
        attributes: ['id', 'name'] 
      }],
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
    });

    // ── Summary with running balance ───────────────────────────────────────────
    const allAdvances = await AdvancePayment.findAll({
      where: { employee_id: employeeId },
      order: [['date', 'ASC'], ['createdAt', 'ASC']],
    });

    let runningBalance = 0;
    const advancesWithBalance = allAdvances.map(adv => {
      const amount = parseFloat(adv.amount);
      if (adv.entry_type === 'credit') {
        runningBalance += amount;
      } else {
        runningBalance -= amount;
      }
      return {
        ...adv.toJSON(),
        running_balance: Math.round(runningBalance * 100) / 100
      };
    });

    const creditEntries = advancesWithBalance.filter(a => a.entry_type === 'credit');
    const debitEntries = advancesWithBalance.filter(a => a.entry_type === 'debit');

    const totalCredit = creditEntries.reduce((sum, a) => sum + parseFloat(a.amount), 0);
    const totalDebit = debitEntries.reduce((sum, a) => sum + parseFloat(a.amount), 0);
    const currentBalance = totalCredit - totalDebit;

    res.json({
      success: true,
      data: advances,
      count: advances.length,
      summary: {
        total_credit: Math.round(totalCredit * 100) / 100,
        total_debit: Math.round(totalDebit * 100) / 100,
        current_balance: Math.round(currentBalance * 100) / 100,
        credit_count: creditEntries.length,
        debit_count: debitEntries.length,
      },
    });
  } catch (error) {
    console.error('Get advances error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── CREATE advance ────────────────────────────────────────────────────────────
exports.createAdvance = async (req, res) => {
  try {
    const { employee_id, amount, date, description } = req.body;

    if (!employee_id || amount == null || !date) {
      return res.status(400).json({ success: false, message: 'employee_id, amount and date are required' });
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
      const advance = await AdvancePayment.create({
        employee_id,
        amount: parseFloat(amount),
        date,
        description: description || 'Salary advance',
        entry_type: 'credit',
        balance: 0,
        salary_payment_id: null,
      }, { transaction });

      const currentBalance = await updateEmployeeBalances(employee_id, transaction);

      await transaction.commit();

      const createdAdvance = await AdvancePayment.findByPk(advance.id, {
        include: [{ 
          model: Employee, 
          as: 'employee',
          attributes: ['id', 'name'] 
        }]
      });

      res.status(201).json({
        success: true,
        message: 'Advance created',
        data: createdAdvance,
        current_balance: currentBalance
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Create advance error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── UPDATE advance ────────────────────────────────────────────────────────────
exports.updateAdvance = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, date, description } = req.body;

    const advance = await AdvancePayment.findByPk(id);
    if (!advance) return res.status(404).json({ success: false, message: 'Advance not found' });

    // Only credit (employee-owes) entries can be edited
    if (advance.entry_type !== 'credit') {
      return res.status(400).json({ success: false, message: 'Only credit entries can be edited' });
    }

    // Don't allow updating if it's already been recovered
    if (advance.salary_payment_id) {
      return res.status(400).json({ success: false, message: 'Cannot edit an advance that has been recovered in a salary payment' });
    }

    if (amount != null && parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    const transaction = await sequelize.transaction();

    try {
      await advance.update({
        amount: amount ? parseFloat(amount) : advance.amount,
        date: date || advance.date,
        description: description || advance.description,
      }, { transaction });

      const currentBalance = await updateEmployeeBalances(advance.employee_id, transaction);

      await transaction.commit();

      const updatedAdvance = await AdvancePayment.findByPk(id, {
        include: [{ 
          model: Employee, 
          as: 'employee',
          attributes: ['id', 'name'] 
        }]
      });

      res.json({
        success: true,
        message: 'Advance updated',
        data: updatedAdvance,
        current_balance: currentBalance
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Update advance error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── DELETE advance ────────────────────────────────────────────────────────────
exports.deleteAdvance = async (req, res) => {
  try {
    const { id } = req.params;

    const advance = await AdvancePayment.findByPk(id);
    if (!advance) return res.status(404).json({ success: false, message: 'Advance not found' });

    // Only credit (employee-owes) entries can be deleted
    if (advance.entry_type !== 'credit') {
      return res.status(400).json({ success: false, message: 'Only credit entries can be deleted' });
    }

    // Don't allow deleting if it's already been recovered
    if (advance.salary_payment_id) {
      return res.status(400).json({ success: false, message: 'Cannot delete an advance that has been recovered in a salary payment' });
    }

    const transaction = await sequelize.transaction();

    try {
      const employee_id = advance.employee_id;
      await advance.destroy({ transaction });

      // Fully recalculates every remaining entry's balance from scratch, in date/createdAt orders
      const currentBalance = await updateEmployeeBalances(employee_id, transaction);

      await transaction.commit();

      res.json({
        success: true,
        message: 'Advance deleted',
        current_balance: currentBalance
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Delete advance error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};