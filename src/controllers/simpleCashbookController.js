// backend/src/controllers/simpleCashbookController.js
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { SimpleCashbook } = require('../models');

// Recalculate ALL balances in correct date+id order
async function recalculateBalances(transaction) {
  const all = await SimpleCashbook.findAll({
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

// Get balance up to a specific date
async function getBalanceUpToDate(date, transaction = null) {
  const entries = await SimpleCashbook.findAll({
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

// Create entry then recalculate
const createSimpleCashbookEntry = async ({
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
  const entry = await SimpleCashbook.create(
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

// GET /simple-cashbook
exports.getSimpleCashbook = async (req, res) => {
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

    const { count, rows: entries } = await SimpleCashbook.findAndCountAll({
      where, 
      order, 
      limit: limitNum, 
      offset,
    });

    // Calculate period summary (filtered by date range)
    const filteredEntries = await SimpleCashbook.findAll({
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

    // Daily cash on hand: For the selected date, it's (cash_in - cash_out) for that day
    const dayNetFlow = periodIn - periodOut;

    res.json({
      success: true,
      data: {
        entries: entries,
        summary: {
          current_balance: parseFloat(dayNetFlow.toFixed(2)),
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
    console.error('Get simple cashbook error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// POST /simple-cashbook/manual
exports.addManualEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { 
      entry_date, 
      entry_type, 
      description, 
      amount, 
      reference_number,
      // ✅ New fields
      payment_method,  // 'cash', 'bank', 'cheque', 'slip'
      bank_id,
      bank_name,
      cheque_number,
      cheque_date,
      slip_number,
      slip_date,
    } = req.body;

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

    // Cash out ke liye balance check
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

    // ✅ Reference number build karo method ke hisaab se
    const finalRefNumber = reference_number 
      || cheque_number 
      || slip_number 
      || null;

    // ✅ Description mein method detail add karo
    const methodDetails = {
      bank: bank_name ? ` | Bank: ${bank_name}` : '',
      cheque: [bank_name ? ` | Bank: ${bank_name}` : '', cheque_number ? ` | Chq#: ${cheque_number}` : ''].join(''),
      slip: [bank_name ? ` | Bank: ${bank_name}` : '', slip_number ? ` | Slip#: ${slip_number}` : ''].join(''),
    };
    
    const finalDescription = description.trim() + (methodDetails[payment_method] || '');

    const entry = await createSimpleCashbookEntry({
      entry_date: entry_date || new Date(),
      entry_type,
      source_type: 'manual',
      reference_number: finalRefNumber,
      description: finalDescription,
      amount: parseFloat(amount),
      created_by: req.user?.id,
      transaction: t,
    });

    // ✅ Bank transaction create karo agar bank/slip method ho
    if ((payment_method === 'bank' || payment_method === 'slip') && bank_id) {
      const { Bank, BankTransaction } = require('../models');
      const bank = await Bank.findByPk(bank_id, { transaction: t });
      
      if (bank) {
        const isIn = entry_type === 'cash_in';
        const newBalance = isIn 
          ? parseFloat(bank.balance) + parseFloat(amount)
          : parseFloat(bank.balance) - parseFloat(amount);

        await bank.update(
          { balance: newBalance.toFixed(2) },
          { transaction: t }
        );

        await BankTransaction.create({
          bank_id: bank_id,
          transaction_type: isIn ? 'in' : 'out',
          amount: parseFloat(amount).toFixed(2),
          description: finalDescription,
          reference_number: slip_number || finalRefNumber || null,
          balance_after: newBalance.toFixed(2),
          created_by: req.user?.id,
          transaction_date: entry_date || new Date(),
        }, { transaction: t });
      }
    }

    // ✅ Cheque record create karo
    if (payment_method === 'cheque' && cheque_number) {
      const { Cheque } = require('../models');
      await Cheque.create({
        cheque_number,
        cheque_date: cheque_date ? new Date(cheque_date) : null,
        amount: parseFloat(amount),
        bank_id: bank_id || null,
        bank_name: bank_name || null,
        cheque_type: entry_type === 'cash_in' ? 'received' : 'issued',
        status: 'pending',
        description: finalDescription,
        created_by: req.user?.id,
      }, { transaction: t });
    }

    await t.commit();
    res.status(201).json({
      success: true,
      message: `Entry recorded successfully`,
      data: entry,
    });
  } catch (error) {
    await t.rollback();
    console.error('Add manual simple cashbook entry error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// DELETE /simple-cashbook/:id
exports.deleteEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const entry = await SimpleCashbook.findByPk(id, { transaction: t });

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

// GET /simple-cashbook/summary/daily
exports.getDailySummary = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const entries = await SimpleCashbook.findAll({
      where: { entry_date: targetDate },
      order: [['id', 'ASC']],
    });

    const cashIn = entries.filter(e => e.entry_type === 'cash_in').reduce((s, e) => s + parseFloat(e.amount), 0);
    const cashOut = entries.filter(e => e.entry_type === 'cash_out').reduce((s, e) => s + parseFloat(e.amount), 0);
    
    // Daily cash on hand is cash_in - cash_out for the selected date
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
          current_balance: parseFloat(dailyCashOnHand.toFixed(2)),
          cumulative_balance: parseFloat(cumulativeBalance.toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error('Daily summary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

module.exports.createSimpleCashbookEntry = createSimpleCashbookEntry;