// backend/src/controllers/dailyExpenseController.js
'use strict';

const { Op } = require('sequelize');
const {
  DailyExpenseSession,
  DailyExpense,
  Supplier,
  Bank,
  BankTransaction,
  Cheque,
  SupplierLedger,
  sequelize,
} = require('../models');
const { recalculateBalances } = require('./supplierLedgerController');
const { createCashbookEntry } = require('./cashbookController');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Recalculate session totals and closing balance
// ─────────────────────────────────────────────────────────────────────────────
async function recalculateSession(sessionId, dbTransaction) {
  const [expenseSum, supplierSum, billSum] = await Promise.all([
    DailyExpense.sum('amount', {
      where: { session_id: sessionId, entry_type: 'expense' },
      transaction: dbTransaction,
    }),
    DailyExpense.sum('amount', {
      where: { session_id: sessionId, entry_type: 'supplier_payment' },
      transaction: dbTransaction,
    }),
    DailyExpense.sum('amount', {          // ← ADD THIS
      where: { session_id: sessionId, entry_type: 'bill_payment' },
      transaction: dbTransaction,
    }),
  ]);

  const totalExpenses = parseFloat(expenseSum || 0);
  const totalSupplierPayments = parseFloat(supplierSum || 0);
  const totalBillPayments = parseFloat(billSum || 0);   // ← ADD THIS

  const session = await DailyExpenseSession.findByPk(sessionId, {
    transaction: dbTransaction,
  });

  const openingBalance = parseFloat(session.opening_balance);
  const closingBalance =
    openingBalance - totalExpenses - totalSupplierPayments - totalBillPayments; // ← ADD THIS

  await session.update(
    {
      total_expenses: totalExpenses.toFixed(2),
      total_supplier_payments: totalSupplierPayments.toFixed(2),
      closing_balance: closingBalance.toFixed(2),
    },
    { transaction: dbTransaction }
  );

  return session;
}

// ═════════════════════════════════════════════════════════════════════════════
// SESSION ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

// GET /expense-sessions  — list sessions (paginated)
exports.getSessions = async (req, res) => {
  try {
    const { page = 1, limit = 30, from, to } = req.query;
    const where = {};

    if (from || to) {
      where.session_date = {};
      if (from) where.session_date[Op.gte] = from;
      if (to) where.session_date[Op.lte] = to;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { count, rows } = await DailyExpenseSession.findAndCountAll({
      where,
      order: [['session_date', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    return res.json({
      success: true,
      data: {
        sessions: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          pages: Math.ceil(count / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    console.error('getSessions error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /expense-sessions/today  — get or create today's session
exports.getTodaySession = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    let session = await DailyExpenseSession.findOne({
      where: { session_date: today },
      include: [{ model: DailyExpense, as: 'entries', order: [['entry_time', 'ASC']] }],
    });

    if (!session) {
      // Auto-create today's session with 0 opening balance (user sets it)
      session = await DailyExpenseSession.create({
        session_date: today,
        opening_balance: 0.0,
        total_expenses: 0.0,
        total_supplier_payments: 0.0,
        closing_balance: 0.0,
        created_by: req.user?.id,
      });
      session = await DailyExpenseSession.findByPk(session.id, {
        include: [{ model: DailyExpense, as: 'entries' }],
      });
    }

    return res.json({ success: true, data: session });
  } catch (err) {
    console.error('getTodaySession error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /expense-sessions/:id  — single session with all entries
exports.getSession = async (req, res) => {
  try {
    const session = await DailyExpenseSession.findByPk(req.params.id, {
      include: [
        {
          model: DailyExpense,
          as: 'entries',
          include: [{ model: Supplier, as: 'supplier', attributes: ['id', 'name', 'contact'] }],
          order: [['entry_time', 'ASC']],
        },
      ],
    });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    return res.json({ success: true, data: session });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /expense-sessions  — create a session for a specific date
exports.createSession = async (req, res) => {
  try {
    const { session_date, opening_balance = 0, notes } = req.body;

    if (!session_date) {
      return res.status(400).json({ success: false, message: 'session_date is required' });
    }

    const existing = await DailyExpenseSession.findOne({ where: { session_date } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A session already exists for this date',
        data: existing,
      });
    }

    const ob = parseFloat(opening_balance) || 0;
    const session = await DailyExpenseSession.create({
      session_date,
      opening_balance: ob.toFixed(2),
      total_expenses: '0.00',
      total_supplier_payments: '0.00',
      closing_balance: ob.toFixed(2),
      notes: notes || null,
      created_by: req.user?.id,
    });

    return res.status(201).json({ success: true, data: session });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Session already exists for this date' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /expense-sessions/:id/opening-balance  — update opening balance
exports.updateOpeningBalance = async (req, res) => {
  try {
    const { opening_balance } = req.body;
    if (opening_balance === undefined || parseFloat(opening_balance) < 0) {
      return res.status(400).json({ success: false, message: 'Valid opening_balance required' });
    }

    const session = await DailyExpenseSession.findByPk(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (session.is_closed) {
      return res.status(400).json({ success: false, message: 'Cannot edit a closed session' });
    }

    const ob = parseFloat(opening_balance);
    const totalSpent =
      parseFloat(session.total_expenses) + parseFloat(session.total_supplier_payments);

    await session.update({
      opening_balance: ob.toFixed(2),
      closing_balance: (ob - totalSpent).toFixed(2),
    });

    return res.json({ success: true, data: session });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /expense-sessions/:id/close  — close/lock a session
exports.closeSession = async (req, res) => {
  try {
    const session = await DailyExpenseSession.findByPk(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    await session.update({ is_closed: true, closed_at: new Date() });
    return res.json({ success: true, message: 'Session closed', data: session });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// EXPENSE ENTRY ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

// POST /expense-sessions/:sessionId/expenses  — add a general expense
exports.addExpense = async (req, res) => {
  const dbTransaction = await sequelize.transaction();
  try {
    const { sessionId } = req.params;
    const {
      category,
      description,
      amount,
      payment_method = 'cash',
      bank_id,
      bank_name,
      cheque_number,
      cheque_id,
      cheque_date,
      reference_number,
    } = req.body;

    // ── Validate ──
    if (!description || !description.trim()) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Description is required' });
    }
    if (!amount || parseFloat(amount) <= 0) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }

    const session = await DailyExpenseSession.findByPk(sessionId, {
      transaction: dbTransaction,
    });
    if (!session) {
      await dbTransaction.rollback();
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    if (session.is_closed) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Session is closed' });
    }

    const expenseAmount = parseFloat(amount);

    // ── Validate bank if needed ──
    let selectedBank = null;
    if ((payment_method === 'bank' || payment_method === 'cheque') && bank_id) {
      selectedBank = await Bank.findByPk(bank_id, { transaction: dbTransaction });
      if (!selectedBank) {
        await dbTransaction.rollback();
        return res.status(404).json({ success: false, message: 'Bank not found' });
      }
      if (payment_method === 'bank') {
        if (parseFloat(selectedBank.balance) < expenseAmount) {
          await dbTransaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient bank balance. Available: Rs ${parseFloat(selectedBank.balance).toFixed(2)}`,
          });
        }
      }
    }

    // ── Check session cash balance for cash payments ──
    if (payment_method === 'cash') {
      const currentClosing = parseFloat(session.closing_balance);
      if (currentClosing < expenseAmount) {
        await dbTransaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient cash balance. Available: Rs ${currentClosing.toFixed(2)}`,
        });
      }
    }

    // ── Create expense entry ──
    const entry = await DailyExpense.create(
      {
        session_id: sessionId,
        entry_type: 'expense',
        category: category || null,
        description: description.trim(),
        amount: expenseAmount.toFixed(2),
        payment_method,
        bank_id: bank_id || null,
        bank_name: bank_name || null,
        cheque_number: cheque_number || null,
        cheque_date: cheque_date || null,
        cheque_id: cheque_id || null,
        reference_number: reference_number || null,
        entry_time: new Date(),
        created_by: req.user?.id,
      },
      { transaction: dbTransaction }
    );

    // ── Update bank balance for bank transfers ──
    if (selectedBank && payment_method === 'bank') {
      const newBalance = parseFloat(selectedBank.balance) - expenseAmount;
      await selectedBank.update({ balance: newBalance.toFixed(2) }, { transaction: dbTransaction });
      await BankTransaction.create(
        {
          bank_id: bank_id,
          transaction_type: 'out',
          amount: expenseAmount.toFixed(2),
          description: `Expense: ${description.trim()}`,
          reference_number: reference_number || null,
          balance_after: newBalance.toFixed(2),
          created_by: req.user?.id,
          transaction_date: new Date(),
        },
        { transaction: dbTransaction }
      );
    }

    // ── Create cashbook entry for cash expenses ──
    if (payment_method === 'cash') {
      const cbEntry = await createCashbookEntry({
        entry_date: new Date(),
        entry_type: 'cash_out',
        source_type: 'daily_expense',
        reference_id: entry.id,
        reference_number: reference_number || null,
        description: `Expense: ${description.trim()}`,
        amount: expenseAmount,
        created_by: req.user?.id,
        transaction: dbTransaction,
      });
      if (cbEntry?.id) {
        await entry.update({ cashbook_entry_id: cbEntry.id }, { transaction: dbTransaction });
      }
    }

    // ── Recalculate session totals ──
    await recalculateSession(sessionId, dbTransaction);

    await dbTransaction.commit();

    const updatedSession = await DailyExpenseSession.findByPk(sessionId);
    return res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      data: { entry, session: updatedSession },
    });
  } catch (err) {
    await dbTransaction.rollback();
    console.error('addExpense error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /expense-sessions/:sessionId/supplier-payments
// Adds a supplier payment FROM this cash session + records in supplier ledger
exports.addSupplierPayment = async (req, res) => {
  const dbTransaction = await sequelize.transaction();
  try {
    const { sessionId } = req.params;
    const {
      supplier_id,
      amount,
      description,
      payment_method = 'cash',
      bank_id,
      bank_name,
      cheque_number,
      cheque_id,
      cheque_date,
      reference_number,
    } = req.body;

    if (!supplier_id) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'supplier_id is required' });
    }
    if (!amount || parseFloat(amount) <= 0) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }

    const [session, supplier] = await Promise.all([
      DailyExpenseSession.findByPk(sessionId, { transaction: dbTransaction }),
      Supplier.findByPk(supplier_id, { transaction: dbTransaction }),
    ]);

    if (!session) {
      await dbTransaction.rollback();
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    if (session.is_closed) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Session is closed' });
    }
    if (!supplier) {
      await dbTransaction.rollback();
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    const paymentAmount = parseFloat(amount);

    // ── Validate bank if needed ──
    let selectedBank = null;
    if ((payment_method === 'bank' || payment_method === 'cheque') && bank_id) {
      selectedBank = await Bank.findByPk(bank_id, { transaction: dbTransaction });
      if (!selectedBank) {
        await dbTransaction.rollback();
        return res.status(404).json({ success: false, message: 'Bank not found' });
      }
      if (payment_method === 'bank') {
        if (parseFloat(selectedBank.balance) < paymentAmount) {
          await dbTransaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient bank balance. Available: Rs ${parseFloat(selectedBank.balance).toFixed(2)}`,
          });
        }
      }
    }

    // ── Check session cash balance for cash payments ──
    if (payment_method === 'cash') {
      const currentClosing = parseFloat(session.closing_balance);
      if (currentClosing < paymentAmount) {
        await dbTransaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient cash balance. Available: Rs ${currentClosing.toFixed(2)}`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Create cheque record if method = cheque
    // ═══════════════════════════════════════════════════════════════════════
    let resolvedChequeId = cheque_id || null;
    if (payment_method === 'cheque' && !cheque_id && bank_id && cheque_number) {
      const cheque = await Cheque.create(
        {
          bank_id,
          cheque_number,
          cheque_type: 'issued',
          amount: paymentAmount.toFixed(2),
          payee_payer_name: supplier.name,
          description: description || `Payment to supplier: ${supplier.name}`,
          issue_date: cheque_date || new Date().toISOString().slice(0, 10),
          due_date: cheque_date || null,
          supplier_id,
        },
        { transaction: dbTransaction }
      );
      resolvedChequeId = cheque.id;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Create supplier ledger payment entry
    // ═══════════════════════════════════════════════════════════════════════
    const autoDesc = [
      `Cash Desk Payment to ${supplier.name}`,
      bank_name ? `| Bank: ${bank_name}` : null,
      cheque_number ? `| Chq#: ${cheque_number}` : null,
      reference_number ? `| Ref: ${reference_number}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    const finalDescription = description?.trim() || autoDesc;

    const ledgerEntry = await SupplierLedger.create(
      {
        supplier_id,
        reference_type: 'payment',
        reference_id: resolvedChequeId || null,
        reference_number: reference_number || cheque_number || null,
        debit: paymentAmount.toFixed(2),
        credit: '0.00',
        balance: '0.00',
        description: finalDescription,
        transaction_date: new Date(),
        payment_method,
        bank_name: bank_name || null,
        bank_id: bank_id || null,
        cheque_number: cheque_number || null,
        cheque_date: cheque_date ? new Date(cheque_date + 'T00:00:00.000Z') : null,
        cheque_cleared: false,
        created_by: req.user?.id,
      },
      { transaction: dbTransaction }
    );

    // Update cheque with ledger id
    if (resolvedChequeId) {
      await Cheque.update(
        { supplier_ledger_id: ledgerEntry.id },
        { where: { id: resolvedChequeId }, transaction: dbTransaction }
      );
    }

    // Recalculate supplier ledger balances
    await recalculateBalances(supplier_id, dbTransaction);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Update bank balance for bank transfers
    // ═══════════════════════════════════════════════════════════════════════
    if (selectedBank && payment_method === 'bank') {
      const newBalance = parseFloat(selectedBank.balance) - paymentAmount;
      await selectedBank.update({ balance: newBalance.toFixed(2) }, { transaction: dbTransaction });
      await BankTransaction.create(
        {
          bank_id,
          transaction_type: 'out',
          amount: paymentAmount.toFixed(2),
          description: `Bank transfer to ${supplier.name} (via expense desk)`,
          reference_number: reference_number || null,
          balance_after: newBalance.toFixed(2),
          created_by: req.user?.id,
          transaction_date: new Date(),
        },
        { transaction: dbTransaction }
      );
    }

    // ── Cashbook for cash payments ──
    if (payment_method === 'cash') {
      const cbEntry = await createCashbookEntry({
        entry_date: new Date(),
        entry_type: 'cash_out',
        source_type: 'supplier_payment',
        reference_id: ledgerEntry.id,
        reference_number: reference_number || null,
        description: `Cash paid to ${supplier.name} (expense desk)`,
        amount: paymentAmount,
        created_by: req.user?.id,
        transaction: dbTransaction,
      });
      if (cbEntry?.id) {
        // stored in DailyExpense below
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Create DailyExpense entry (entry_type = supplier_payment)
    // ═══════════════════════════════════════════════════════════════════════
    const expenseEntry = await DailyExpense.create(
      {
        session_id: sessionId,
        entry_type: 'supplier_payment',
        description: finalDescription,
        amount: paymentAmount.toFixed(2),
        payment_method,
        bank_id: bank_id || null,
        bank_name: bank_name || null,
        cheque_number: cheque_number || null,
        cheque_date: cheque_date || null,
        cheque_id: resolvedChequeId,
        reference_number: reference_number || null,
        supplier_id,
        supplier_ledger_id: ledgerEntry.id,
        entry_time: new Date(),
        created_by: req.user?.id,
      },
      { transaction: dbTransaction }
    );

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Recalculate session totals
    // ═══════════════════════════════════════════════════════════════════════
    await recalculateSession(sessionId, dbTransaction);

    await dbTransaction.commit();

    const updatedSession = await DailyExpenseSession.findByPk(sessionId);
    return res.status(201).json({
      success: true,
      message:
        payment_method === 'cheque'
          ? 'Cheque payment recorded. Bank balance updates when cheque clears.'
          : 'Supplier payment recorded and deducted from session balance',
      data: {
        expense_entry: expenseEntry,
        ledger_entry: ledgerEntry,
        session: updatedSession,
        ...(resolvedChequeId && { cheque_id: resolvedChequeId }),
      },
    });
  } catch (err) {
    await dbTransaction.rollback();
    console.error('addSupplierPayment error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /expense-sessions/:sessionId/entries/:entryId  — delete an entry + reverse
exports.deleteEntry = async (req, res) => {
  const dbTransaction = await sequelize.transaction();
  try {
    const { sessionId, entryId } = req.params;

    const entry = await DailyExpense.findOne({
      where: { id: entryId, session_id: sessionId },
      transaction: dbTransaction,
    });

    if (!entry) {
      await dbTransaction.rollback();
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }

    const session = await DailyExpenseSession.findByPk(sessionId, {
      transaction: dbTransaction,
    });
    if (session.is_closed) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Cannot delete from a closed session' });
    }

    // If supplier payment, create a reversal in supplier ledger
    if (entry.entry_type === 'supplier_payment' && entry.supplier_ledger_id) {
      const ledgerEntry = await SupplierLedger.findByPk(entry.supplier_ledger_id, {
        transaction: dbTransaction,
      });
      if (ledgerEntry) {
        // Create reversal
        await SupplierLedger.create(
          {
            supplier_id: entry.supplier_id,
            reference_type: 'reversal',
            reference_id: ledgerEntry.id,
            debit: '0.00',
            credit: parseFloat(ledgerEntry.debit).toFixed(2),
            balance: '0.00',
            description: `Reversal of expense-desk payment: ${ledgerEntry.description}`,
            transaction_date: new Date(),
            created_by: req.user?.id,
          },
          { transaction: dbTransaction }
        );
        await ledgerEntry.destroy({ transaction: dbTransaction });
        await recalculateBalances(entry.supplier_id, dbTransaction);
      }
    }

    // Reverse bank balance if bank payment
    if (
      (entry.payment_method === 'bank') &&
      entry.bank_id
    ) {
      const bank = await Bank.findByPk(entry.bank_id, { transaction: dbTransaction });
      if (bank) {
        const newBal = parseFloat(bank.balance) + parseFloat(entry.amount);
        await bank.update({ balance: newBal.toFixed(2) }, { transaction: dbTransaction });
        await BankTransaction.create(
          {
            bank_id: entry.bank_id,
            transaction_type: 'in',
            amount: parseFloat(entry.amount).toFixed(2),
            description: `Reversal: ${entry.description}`,
            balance_after: newBal.toFixed(2),
            created_by: req.user?.id,
            transaction_date: new Date(),
          },
          { transaction: dbTransaction }
        );
      }
    }

    await entry.destroy({ transaction: dbTransaction });
    await recalculateSession(sessionId, dbTransaction);

    await dbTransaction.commit();

    const updatedSession = await DailyExpenseSession.findByPk(sessionId);
    return res.json({
      success: true,
      message: 'Entry deleted and session recalculated',
      data: { session: updatedSession },
    });
  } catch (err) {
    await dbTransaction.rollback();
    console.error('deleteEntry error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /expense-sessions/:sessionId/bill-payments
// Adds a bill payment FROM this cash session
exports.addBillPayment = async (req, res) => {
  const dbTransaction = await sequelize.transaction();
  try {
    const { sessionId } = req.params;
    const {
      bill_type,
      bill_name,
      bill_number,
      consumer_number,
      description,
      amount,
      payment_method = 'cash',
      bank_id,
      bank_name,
      cheque_number,
      cheque_id,
      cheque_date,
      reference_number,
      bill_image,
    } = req.body;

    if (!bill_type) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'bill_type is required' });
    }
    if (!amount || parseFloat(amount) <= 0) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }

    const session = await DailyExpenseSession.findByPk(sessionId, {
      transaction: dbTransaction,
    });
    if (!session) {
      await dbTransaction.rollback();
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    if (session.is_closed) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Session is closed' });
    }

    const billAmount = parseFloat(amount);

    // ── Validate bank if needed ──
    let selectedBank = null;
    if ((payment_method === 'bank' || payment_method === 'cheque') && bank_id) {
      selectedBank = await Bank.findByPk(bank_id, { transaction: dbTransaction });
      if (!selectedBank) {
        await dbTransaction.rollback();
        return res.status(404).json({ success: false, message: 'Bank not found' });
      }
      if (payment_method === 'bank') {
        if (parseFloat(selectedBank.balance) < billAmount) {
          await dbTransaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient bank balance. Available: Rs ${parseFloat(selectedBank.balance).toFixed(2)}`,
          });
        }
      }
    }

    // ── Check session cash balance for cash payments ──
    if (payment_method === 'cash') {
      const currentClosing = parseFloat(session.closing_balance);
      if (currentClosing < billAmount) {
        await dbTransaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient cash balance. Available: Rs ${currentClosing.toFixed(2)}`,
        });
      }
    }

    // ── Create bill payment entry ──
    const entry = await DailyExpense.create(
      {
        session_id: sessionId,
        entry_type: 'bill_payment',
        category: bill_type,
        description: description || `${bill_name} Payment${bill_number ? ` - Bill #${bill_number}` : ''}`,
        amount: billAmount.toFixed(2),
        payment_method,
        bank_id: bank_id || null,
        bank_name: bank_name || null,
        cheque_number: cheque_number || null,
        cheque_date: cheque_date || null,
        cheque_id: cheque_id || null,
        reference_number: reference_number || null,
        bill_type: bill_type,
        bill_number: bill_number || null,
        consumer_number: consumer_number || null,
        bill_image: bill_image || null,
        entry_time: new Date(),
        created_by: req.user?.id,
      },
      { transaction: dbTransaction }
    );

    // ── Update bank balance for bank transfers ──
    if (selectedBank && payment_method === 'bank') {
      const newBalance = parseFloat(selectedBank.balance) - billAmount;
      await selectedBank.update({ balance: newBalance.toFixed(2) }, { transaction: dbTransaction });
      await BankTransaction.create(
        {
          bank_id: bank_id,
          transaction_type: 'out',
          amount: billAmount.toFixed(2),
          description: `Bill Payment: ${description || bill_name}`,
          reference_number: reference_number || null,
          balance_after: newBalance.toFixed(2),
          created_by: req.user?.id,
          transaction_date: new Date(),
        },
        { transaction: dbTransaction }
      );
    }

    // ── Create cashbook entry for cash payments ──
    if (payment_method === 'cash') {
      const cbEntry = await createCashbookEntry({
        entry_date: new Date(),
        entry_type: 'cash_out',
        source_type: 'bill_payment',
        reference_id: entry.id,
        reference_number: reference_number || null,
        description: `Bill Payment: ${description || bill_name}`,
        amount: billAmount,
        created_by: req.user?.id,
        transaction: dbTransaction,
      });
      if (cbEntry?.id) {
        await entry.update({ cashbook_entry_id: cbEntry.id }, { transaction: dbTransaction });
      }
    }

    // ── Recalculate session totals ──
    await recalculateSession(sessionId, dbTransaction);

    await dbTransaction.commit();

    const updatedSession = await DailyExpenseSession.findByPk(sessionId);
    return res.status(201).json({
      success: true,
      message: 'Bill payment recorded successfully',
      data: { entry, session: updatedSession },
    });
  } catch (err) {
    await dbTransaction.rollback();
    console.error('addBillPayment error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Add this new method or update existing getBillPayments
exports.getBillPayments = async (req, res) => {
  try {
    console.log('getBillPayments called'); // check if route is hit
    
    const billPayments = await DailyExpense.findAll({
      where: {
        entry_type: 'bill_payment',
      },
      order: [['entry_time', 'DESC']],
    });

    console.log('Found bills:', billPayments.length); // check count

    const formattedBills = billPayments.map(bill => ({
      id: bill.id,
      bill_type: bill.bill_type || 'other',
      bill_name: bill.description || 'Bill Payment',
      bill_number: bill.bill_number,
      consumer_number: bill.consumer_number,
      description: bill.description || '',
      amount: bill.amount,
      payment_method: bill.payment_method || 'cash',
      bank_name: bill.bank_name,
      cheque_number: bill.cheque_number,
      reference_number: bill.reference_number,
      entry_time: bill.entry_time,
      bill_image: bill.bill_image,
    }));

    return res.json({
      success: true,
      data: formattedBills,
      count: formattedBills.length,
    });

  } catch (error) {
    console.error('getBillPayments error:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message, // send actual error to Flutter
    });
  }
};