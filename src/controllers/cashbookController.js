const { Op, fn, col } = require('sequelize');
const sequelize = require('../config/db');
const { Cashbook } = require('../models');

// ── Recalculate ALL balances in correct date+id order ───────────────────────
async function recalculateBalances(transaction) {
  const all = await Cashbook.findAll({
    order: [['entry_date', 'ASC'], ['id', 'ASC']],
    transaction,
  });
  let running = 0;
  for (const entry of all) {
    running += entry.entry_type === 'cash_in'
      ? parseFloat(entry.amount)
      : -parseFloat(entry.amount);
    await entry.update({ balance: running.toFixed(2) }, { transaction });
  }
  return running;
}

// ── Get balance up to a specific date ────────────────────────────────────────
async function getBalanceUpToDate(date, transaction = null) {
  const entries = await Cashbook.findAll({
    where: {
      entry_date: {
        [Op.lte]: date
      }
    },
    order: [['entry_date', 'ASC'], ['id', 'ASC']],
    attributes: ['entry_type', 'amount'],
    raw: true,
    transaction,
  });
  
  return entries.reduce((balance, entry) => {
    return balance + (entry.entry_type === 'cash_in' 
      ? parseFloat(entry.amount) 
      : -parseFloat(entry.amount));
  }, 0);
}

// ── Create entry then recalculate ────────────────────────────────────────────
const createCashbookEntry = async ({
  entry_date,
  entry_type,
  source_type,
  reference_id,
  reference_number,
  description,
  amount,
  created_by,
  transaction,
}) => {
  const entry = await Cashbook.create(
    {
      entry_date: entry_date || new Date(),
      entry_type,
      source_type,
      reference_id: reference_id || null,
      reference_number: reference_number || null,
      description,
      amount: parseFloat(amount).toFixed(2),
      balance: '0.00',
      created_by: created_by || null,
    },
    { transaction }
  );

  await recalculateBalances(transaction);
  await entry.reload({ transaction });
  return entry;
};

// ── GET /cashbook ────────────────────────────────────────────────────────────
exports.getCashbook = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      from_date,
      to_date,
      entry_type,
      source_type,
      search,
      sort_order = 'desc',
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const where = {};
    if (entry_type) where.entry_type = entry_type;
    if (source_type) where.source_type = source_type;
    if (from_date || to_date) {
      where.entry_date = {};
      if (from_date) where.entry_date[Op.gte] = from_date;
      if (to_date) where.entry_date[Op.lte] = to_date;
    }
    if (search) {
      where[Op.or] = [
        { description: { [Op.like]: `%${search}%` } },
        { reference_number: { [Op.like]: `%${search}%` } },
      ];
    }

    const order = sort_order.toUpperCase() === 'ASC'
      ? [['entry_date', 'ASC'], ['id', 'ASC']]
      : [['entry_date', 'DESC'], ['id', 'DESC']];

    const { count, rows: entries } = await Cashbook.findAndCountAll({
      where, 
      order, 
      limit: limitNum, 
      offset,
    });

    // ── Calculate period summary (filtered by date range) ──
    const filteredEntries = await Cashbook.findAll({
      where,
      attributes: ['entry_type', 'amount'],
      raw: true,
    });

    const periodIn = filteredEntries
      .filter(e => e.entry_type === 'cash_in')
      .reduce((s, e) => s + parseFloat(e.amount), 0);

    const periodOut = filteredEntries
      .filter(e => e.entry_type === 'cash_out')
      .reduce((s, e) => s + parseFloat(e.amount), 0);

    // ── Daily cash on hand: For the selected date, it's (cash_in - cash_out) for that day ──
    const dayNetFlow = periodIn - periodOut;

    // ── Cumulative balance: All transactions up to the selected date ──
    const balanceDate = to_date || from_date || new Date().toISOString().split('T')[0];
    const cumulativeBalance = await getBalanceUpToDate(balanceDate);

    // Format response to match Flutter's expected structure
    res.json({
      success: true,
      data: {
        entries: entries,
        summary: {
          // ✅ FIXED: Cash on hand for the selected date = cash_in - cash_out for that day
          current_balance: parseFloat(dayNetFlow.toFixed(2)),
          // Alternative: If you need cumulative balance, add this field:
          // cumulative_balance: parseFloat(cumulativeBalance.toFixed(2)),
          total_cash_in: parseFloat(periodIn.toFixed(2)),
          total_cash_out: parseFloat(periodOut.toFixed(2)),
          net_flow: parseFloat((periodIn - periodOut).toFixed(2)),
        },
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(count / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Get cashbook error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── POST /cashbook/manual ────────────────────────────────────────────────────
exports.addManualEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { entry_date, entry_type, description, amount, reference_number } = req.body;

    if (!entry_type || !['cash_in', 'cash_out'].includes(entry_type)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'entry_type must be cash_in or cash_out' });
    }
    if (!amount || parseFloat(amount) <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }
    if (!description?.trim()) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Description is required' });
    }

    // Check sufficient cash for cash_out (using balance up to the entry date)
    if (entry_type === 'cash_out') {
      const balanceBeforeEntry = await getBalanceUpToDate(entry_date, t);
      if (balanceBeforeEntry < parseFloat(amount)) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient cash on ${entry_date}. Available: Rs ${balanceBeforeEntry.toFixed(2)}`,
        });
      }
    }

    const entry = await createCashbookEntry({
      entry_date: entry_date || new Date(),
      entry_type,
      source_type: 'manual',
      reference_number: reference_number || null,
      description: description.trim(),
      amount: parseFloat(amount),
      created_by: req.user?.id,
      transaction: t,
    });

    await t.commit();
    res.status(201).json({
      success: true,
      message: `Cash ${entry_type === 'cash_in' ? 'received' : 'paid out'} recorded`,
      data: entry,
    });
  } catch (error) {
    await t.rollback();
    console.error('Add manual cashbook entry error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── PUT /cashbook/:id ─────────────────────────────────────────────────────
exports.editManualEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { entry_date, entry_type, description, amount, reference_number } = req.body;

    // Find existing entry
    const entry = await Cashbook.findByPk(id, { transaction: t });

    if (!entry) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }

    if (entry.source_type !== 'manual') {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: 'Only manual entries can be edited.',
      });
    }

    // Validate inputs
    if (!entry_type || !['cash_in', 'cash_out'].includes(entry_type)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'entry_type must be cash_in or cash_out' });
    }

    if (!amount || parseFloat(amount) <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }

    if (!description?.trim()) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Description is required' });
    }

    if (!entry_date) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Entry date is required' });
    }

    // For cash_out: Check sufficient cash excluding current entry
    if (entry_type === 'cash_out') {
      // Get balance up to entry date, excluding this entry if it's being edited
      const allEntries = await Cashbook.findAll({
        where: {
          entry_date: {
            [Op.lte]: entry_date
          },
          id: { [Op.ne]: id } // Exclude current entry
        },
        order: [['entry_date', 'ASC'], ['id', 'ASC']],
        attributes: ['entry_type', 'amount'],
        raw: true,
        transaction: t,
      });
      
      const balanceBeforeEntry = allEntries.reduce((balance, e) => {
        return balance + (e.entry_type === 'cash_in' 
          ? parseFloat(e.amount) 
          : -parseFloat(e.amount));
      }, 0);

      if (balanceBeforeEntry < parseFloat(amount)) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient cash on ${entry_date}. Available: Rs ${balanceBeforeEntry.toFixed(2)}`,
        });
      }
    }

    // Update the entry
    await entry.update({
      entry_date: entry_date,
      entry_type: entry_type,
      description: description.trim(),
      amount: parseFloat(amount).toFixed(2),
      reference_number: reference_number || null,
    }, { transaction: t });

    // Recalculate all balances
    await recalculateBalances(t);
    await t.commit();

    // Get the updated entry
    const updatedEntry = await Cashbook.findByPk(id);
    
    res.json({
      success: true,
      message: 'Entry updated successfully',
      data: updatedEntry,
    });
  } catch (error) {
    await t.rollback();
    console.error('Edit entry error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── DELETE /cashbook/:id ─────────────────────────────────────────────────────
exports.deleteEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const entry = await Cashbook.findByPk(id, { transaction: t });

    if (!entry) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    if (entry.source_type !== 'manual') {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: 'Only manual entries can be deleted.',
      });
    }

    await entry.destroy({ transaction: t });
    await recalculateBalances(t);
    await t.commit();

    res.json({ success: true, message: 'Entry deleted and balances updated' });
  } catch (error) {
    await t.rollback();
    console.error('Delete entry error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET /cashbook/summary/daily ──────────────────────────────────────────────
exports.getDailySummary = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const entries = await Cashbook.findAll({
      where: { entry_date: targetDate },
      order: [['id', 'ASC']],
    });

    const cashIn = entries.filter(e => e.entry_type === 'cash_in').reduce((s, e) => s + parseFloat(e.amount), 0);
    const cashOut = entries.filter(e => e.entry_type === 'cash_out').reduce((s, e) => s + parseFloat(e.amount), 0);
    
    // ✅ FIXED: Daily cash on hand is cash_in - cash_out for the selected date
    const dailyCashOnHand = cashIn - cashOut;

    // Get cumulative balance up to this date (all-time)
    const cumulativeBalance = await getBalanceUpToDate(targetDate);

    res.json({
      success: true,
      data: {
        date: targetDate,
        entries,
        summary: {
          total_cash_in: parseFloat(cashIn.toFixed(2)),
          total_cash_out: parseFloat(cashOut.toFixed(2)),
          net: parseFloat((cashIn - cashOut).toFixed(2)),
          // ✅ Daily cash on hand for selected date
          current_balance: parseFloat(dailyCashOnHand.toFixed(2)),
          // Cumulative balance (optional, for reference)
          cumulative_balance: parseFloat(cumulativeBalance.toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error('Daily summary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

module.exports.createCashbookEntry = createCashbookEntry;
module.exports.getCashbook = exports.getCashbook;
module.exports.addManualEntry = exports.addManualEntry;
module.exports.deleteEntry = exports.deleteEntry;
module.exports.getDailySummary = exports.getDailySummary;