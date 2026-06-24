const { Op } = require('sequelize');
const { AdvancePayment } = require('../models');

// ── GET advances for an employee ──────────────────────────────────────────────
exports.getAdvancesByEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { status } = req.query;

    const where = { employee_id: employeeId };
    if (status) where.status = status;

    const advances = await AdvancePayment.findAll({
      where,
      order: [['date', 'DESC']],
    });

    // ── Summary ───────────────────────────────────────────────────────────────
    const all = await AdvancePayment.findAll({ where: { employee_id: employeeId } });
    const totalAmount    = all.reduce((s, a) => s + parseFloat(a.amount), 0);
    const totalRecovered = all.filter(a => a.status === 'recovered').reduce((s, a) => s + parseFloat(a.amount), 0);
    const pendingBalance = totalAmount - totalRecovered;

    res.json({
      success: true,
      data: advances,
      count: advances.length,
      summary: {
        total_amount:    Math.round(totalAmount    * 100) / 100,
        total_recovered: Math.round(totalRecovered * 100) / 100,
        pending_balance: Math.round(pendingBalance * 100) / 100,
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

    const advance = await AdvancePayment.create({
      employee_id, amount, date, description: description || null,
    });

    res.status(201).json({ success: true, message: 'Advance created', data: advance });
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

    if (advance.status === 'recovered') {
      return res.status(400).json({ success: false, message: 'Cannot edit a recovered advance' });
    }

    await advance.update({ amount, date, description: description || null });
    res.json({ success: true, message: 'Advance updated', data: advance });
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

    if (advance.status === 'recovered') {
      return res.status(400).json({ success: false, message: 'Cannot delete a recovered advance' });
    }

    await advance.destroy();
    res.json({ success: true, message: 'Advance deleted' });
  } catch (error) {
    console.error('Delete advance error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};