// backend/src/controllers/simpleCashbookController.js
const { Op } = require('sequelize');
const sequelize = require('../config/db');
// const { SimpleCashbook } = require('../models');
const {
  SimpleCashbook,
  CustomerLedger,
  Sale,
  Bank,
  BankTransaction,
  Cheque,
  Cashbook,      // legacy cashbook model (if named differently, adjust)
  Customer,      // to update customer balance
} = require('../models');

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
  bank_transaction_id = null,
  cheque_id = null,
  legacy_cashbook_id = null,   // ✅ NEW
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
      bank_transaction_id,
      cheque_id,
      legacy_cashbook_id,        // ✅ NEW
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

// backend/src/controllers/simpleCashbookController.js
exports.addManualEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { 
      entry_date, 
      entry_type, 
      description, 
      amount, 
      reference_number,
      payment_method,
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

    const finalRefNumber = reference_number || cheque_number || slip_number || null;

    const methodDetails = {
      bank: bank_name ? ` | Bank: ${bank_name}` : '',
      cheque: [bank_name ? ` | Bank: ${bank_name}` : '', cheque_number ? ` | Chq#: ${cheque_number}` : ''].join(''),
      slip: [bank_name ? ` | Bank: ${bank_name}` : '', slip_number ? ` | Slip#: ${slip_number}` : ''].join(''),
    };
    
    const finalDescription = description.trim() + (methodDetails[payment_method] || '');

    let linkedBankTransactionId = null;
    let linkedChequeId = null;

    if ((payment_method === 'bank' || payment_method === 'slip') && bank_id) {
      const { Bank, BankTransaction } = require('../models');
      const bank = await Bank.findByPk(bank_id, { transaction: t });

      if (bank) {
        const isIn = entry_type === 'cash_in';
        const newBalance = isIn
          ? parseFloat(bank.balance) + parseFloat(amount)
          : parseFloat(bank.balance) - parseFloat(amount);

        await bank.update({ balance: newBalance.toFixed(2) }, { transaction: t });

        const bankTx = await BankTransaction.create({
          bank_id: bank_id,
          transaction_type: isIn ? 'in' : 'out',
          amount: parseFloat(amount).toFixed(2),
          description: finalDescription,
          reference_number: slip_number || finalRefNumber || null,
          balance_after: newBalance.toFixed(2),
          created_by: req.user?.id,
          transaction_date: entry_date || new Date(),
        }, { transaction: t });

        linkedBankTransactionId = bankTx.id;
      }
    }

    // if (payment_method === 'cheque' && cheque_number) {
    //   const { Cheque } = require('../models');
    //   const cheque = await Cheque.create({
    //     cheque_number,
    //     cheque_date: cheque_date ? new Date(cheque_date) : null,
    //     amount: parseFloat(amount),
    //     bank_id: bank_id || null,
    //     bank_name: bank_name || null,
    //     cheque_type: entry_type === 'cash_in' ? 'received' : 'issued',
    //     status: 'pending',
    //     description: finalDescription,
    //     created_by: req.user?.id,
    //   }, { transaction: t });

    //   linkedChequeId = cheque.id;
    // }
    if (payment_method === 'cheque' && cheque_number) {
        const { Cheque } = require('../models');

        if (!bank_id) {
          await t.rollback();
          return res.status(400).json({ success: false, message: 'Bank is required for cheque entries' });
        }

        const cheque = await Cheque.create({
          cheque_number,
          cheque_date: cheque_date ? new Date(cheque_date) : null,
          issue_date: entry_date ? new Date(entry_date) : new Date(),
          amount: parseFloat(amount),
          bank_id,
          bank_name: bank_name || null,
          payee_payer_name: description.trim(),
          cheque_type: entry_type === 'cash_in' ? 'received' : 'issued',
          status: 'pending',
          description: finalDescription,
          created_by: req.user?.id,
        }, { transaction: t });

        linkedChequeId = cheque.id;
      }

    const entry = await createSimpleCashbookEntry({
      entry_date: entry_date || new Date(),
      entry_type,
      source_type: 'manual',
      reference_number: finalRefNumber,
      description: finalDescription,
      amount: parseFloat(amount),
      bank_transaction_id: linkedBankTransactionId,
      cheque_id: linkedChequeId,
      created_by: req.user?.id,
      transaction: t,
    });

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

// ── UPDATE description for customer entry ────────────────────────────────────
exports.updateEntryDescription = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { description } = req.body;

    if (!description || !description.trim()) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: 'Description is required',
      });
    }

    const entry = await SimpleCashbook.findByPk(id, { transaction: t });
    if (!entry) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: 'Entry not found',
      });
    }

    const newDescription = description.trim();
    const updated = {
      cashbook: true,
      ledger: 0,
      sale: 0,
      bank_transaction: false,
      cheque: false,
      legacy_cashbook: false,   // ✅ NEW
    };

    // 1. The cashbook entry itself
    await entry.update({ description: newDescription }, { transaction: t });

    // 2. Customer ledger payment entry — matched by reference_id + type
    if (entry.source_type === 'customer_payment' && entry.reference_id) {
      const { CustomerLedger } = require('../models');
      const [ledgerCount] = await CustomerLedger.update(
        { description: newDescription },
        {
          where: {
            reference_id: entry.reference_id,
            transaction_type: 'payment',
          },
          transaction: t,
        }
      );
      updated.ledger = ledgerCount;

      const { Sale } = require('../models');
      const sale = await Sale.findByPk(entry.reference_id, { transaction: t });
      if (sale) {
        updated.sale = 1;
        // sale.notes is intentionally left alone — see note in original code.
      }
    }

    // 3. Bank transaction — direct FK, no string search
    if (entry.bank_transaction_id) {
      const { BankTransaction } = require('../models');
      const [bankCount] = await BankTransaction.update(
        { description: newDescription },
        { where: { id: entry.bank_transaction_id }, transaction: t }
      );
      updated.bank_transaction = bankCount > 0;
    }

    // 4. Cheque — direct FK, no string search
    if (entry.cheque_id) {
      const { Cheque } = require('../models');
      const [chequeCount] = await Cheque.update(
        { description: newDescription },
        { where: { id: entry.cheque_id }, transaction: t }
      );
      updated.cheque = chequeCount > 0;
    }

    // 5. Legacy cashbook entry — direct FK, no string search
    // ✅ NEW — mirrors the bank_transaction/cheque pattern. Requires
    // legacy_cashbook_id column added to SimpleCashbook, and that
    // createCashbookEntry() returns the created row (or at least an .id)
    // so recordPayment() can capture and pass it in.
    if (entry.legacy_cashbook_id) {
      const { Cashbook } = require('../models'); // adjust model name if different
      if (Cashbook) {
        const [legacyCount] = await Cashbook.update(
          { description: newDescription },
          { where: { id: entry.legacy_cashbook_id }, transaction: t }
        );
        updated.legacy_cashbook = legacyCount > 0;
      }
    }

    await t.commit();

    const updatedEntry = await SimpleCashbook.findByPk(id);

    res.json({
      success: true,
      message: 'Description updated successfully',
      data: updatedEntry,
      debug: updated,
    });
  } catch (error) {
    await t.rollback();
    console.error('Update entry description error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ── UPDATE manual entry ──────────────────────────────────────────────────────
exports.updateManualEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { entry_type, amount, description, entry_date } = req.body;

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

    const entry = await SimpleCashbook.findByPk(id, { transaction: t });
    if (!entry) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }

    if (entry.source_type !== 'manual') {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Only manual entries can be edited' });
    }

    const newDate = entry_date ? new Date(entry_date) : entry.entry_date;
    const newAmount = parseFloat(amount);
    const newDescription = description.trim();

    await entry.update({
      entry_type: entry_type,
      amount: newAmount.toFixed(2),
      description: newDescription,
      entry_date: newDate,
    }, { transaction: t });

    if (entry.bank_transaction_id) {
      const { BankTransaction } = require('../models');
      await BankTransaction.update(
        { description: newDescription },
        { where: { id: entry.bank_transaction_id }, transaction: t }
      );
    }
    if (entry.cheque_id) {
      const { Cheque } = require('../models');
      await Cheque.update(
        { description: newDescription },
        { where: { id: entry.cheque_id }, transaction: t }
      );
    }
    // ✅ NEW — keep legacy cashbook in sync for manual entries too, if ever linked
    if (entry.legacy_cashbook_id) {
      const { Cashbook } = require('../models');
      if (Cashbook) {
        await Cashbook.update(
          { description: newDescription },
          { where: { id: entry.legacy_cashbook_id }, transaction: t }
        );
      }
    }

    await recalculateBalances(t);

    await t.commit();

    const updatedEntry = await SimpleCashbook.findByPk(id);

    res.json({
      success: true,
      message: 'Entry updated successfully',
      data: updatedEntry,
    });
  } catch (error) {
    await t.rollback();
    console.error('Update manual entry error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// DELETE /simple-cashbook/:id
// exports.deleteEntry = async (req, res) => {
//   const t = await sequelize.transaction();
//   try {
//     const { id } = req.params;
//     const entry = await SimpleCashbook.findByPk(id, { transaction: t });

//     if (!entry) {
//       await t.rollback();
//       return res.status(404).json({ success: false, message: 'Entry not found' });
//     }
//     if (entry.source_type !== 'manual') {
//       await t.rollback();
//       return res.status(400).json({
//         success: false,
//         message: 'Only manual entries can be deleted.',
//       });
//     }

//     await entry.destroy({ transaction: t });
//     await recalculateBalances(t);
//     await t.commit();

//     res.json({ success: true, message: 'Entry deleted and balances updated' });
//   } catch (error) {
//     await t.rollback();
//     console.error('Delete entry error:', error);
//     res.status(500).json({ success: false, message: 'Server error', error: error.message });
//   }
// };

exports.deleteEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const entry = await SimpleCashbook.findByPk(id, { transaction: t });

    if (!entry) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }

    // --- Handle different source types ---
    if (entry.source_type === 'customer_payment' && entry.reference_id) {
      // 1. Delete the corresponding customer ledger entry
      const ledgerEntries = await CustomerLedger.findAll({
        where: {
          reference_id: entry.reference_id,
          transaction_type: 'payment',
          debit: parseFloat(entry.amount),  // match amount
        },
        transaction: t,
      });
      // If multiple matches, delete all (edge case)
      for (const led of ledgerEntries) {
        await led.destroy({ transaction: t });
      }

      // 2. Update the sale's amount_paid
      const sale = await Sale.findByPk(entry.reference_id, { transaction: t });
      if (sale) {
        const newPaid = Math.max(0, parseFloat(sale.amount_paid) - parseFloat(entry.amount));
        await sale.update({
          amount_paid: newPaid,
          payment_status: newPaid >= parseFloat(sale.grand_total) ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid'),
        }, { transaction: t });
      }

      // 3. Recalculate customer balance
      if (entry.reference_id) {
        // We need the customer_id – fetch from sale or from ledger entry
        let customerId = null;
        if (sale) customerId = sale.customer_id;
        else {
          // fallback: get from ledger entry
          const led = await CustomerLedger.findOne({
            where: { reference_id: entry.reference_id, transaction_type: 'payment' },
            attributes: ['customer_id'],
            transaction: t,
          });
          if (led) customerId = led.customer_id;
        }
        if (customerId) {
          const remainingEntries = await CustomerLedger.findAll({
            where: { customer_id: customerId },
            order: [['date', 'ASC'], ['id', 'ASC']],
            transaction: t,
          });
          let running = 0;
          for (const e of remainingEntries) {
            running = running + parseFloat(e.credit) - parseFloat(e.debit);
            await e.update({ balance: running.toFixed(2) }, { transaction: t });
          }
          await Customer.update(
            { balance: running.toFixed(2) },
            { where: { id: customerId }, transaction: t }
          );
        }
      }
    }

    // --- Delete linked bank transaction (if any) ---
    if (entry.bank_transaction_id) {
      const bankTx = await BankTransaction.findByPk(entry.bank_transaction_id, { transaction: t });
      if (bankTx) {
        // Reverse bank balance
        const bank = await Bank.findByPk(bankTx.bank_id, { transaction: t });
        if (bank) {
          const reverseAmount = parseFloat(bankTx.amount);
          const newBalance = parseFloat(bank.balance) - reverseAmount; // because it was an 'in' transaction
          await bank.update({ balance: newBalance.toFixed(2) }, { transaction: t });
        }
        await bankTx.destroy({ transaction: t });
      }
    }

    // --- Delete linked cheque (if any) ---
    if (entry.cheque_id) {
      await Cheque.destroy({ where: { id: entry.cheque_id }, transaction: t });
    }

    // --- Delete linked legacy cashbook entry (if any) ---
    if (entry.legacy_cashbook_id) {
      const { Cashbook } = require('../models');
      await Cashbook.destroy({ where: { id: entry.legacy_cashbook_id }, transaction: t });
    }

    // --- Finally, delete the cashbook entry itself ---
    await entry.destroy({ transaction: t });

    // --- Recalculate all cashbook balances ---
    await recalculateBalances(t);

    await t.commit();

    res.json({ success: true, message: 'Entry and all related records deleted successfully' });
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
    
    const dailyCashOnHand = cashIn - cashOut;
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