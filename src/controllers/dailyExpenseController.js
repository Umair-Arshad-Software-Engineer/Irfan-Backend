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
const models = require('../models');
const { recalculateBalances } = require('./supplierLedgerController');
const { createCashbookEntry } = require('./cashbookController');
const { deleteSupplierPaymentCascade } = require('../services/supplierPaymentCleanup');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Resolve the "effective" date for a record.
// Use the caller-supplied entry_date whenever provided; otherwise "now".
// ─────────────────────────────────────────────────────────────────────────────
function resolveEffectiveDate(entry_date) {
  return entry_date ? new Date(entry_date) : new Date();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Format a Date as YYYY-MM-DD using the SERVER'S LOCAL timezone
// (NOT UTC). Prevents the classic off-by-one-day bug for users east of UTC.
// ─────────────────────────────────────────────────────────────────────────────
function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
    DailyExpense.sum('amount', {
      where: { session_id: sessionId, entry_type: 'bill_payment' },
      transaction: dbTransaction,
    }),
  ]);

  const totalExpenses = parseFloat(expenseSum || 0);
  const totalSupplierPayments = parseFloat(supplierSum || 0);
  const totalBillPayments = parseFloat(billSum || 0);

  const session = await DailyExpenseSession.findByPk(sessionId, {
    transaction: dbTransaction,
  });

  const openingBalance = parseFloat(session.opening_balance);
  const closingBalance =
    openingBalance - totalExpenses - totalSupplierPayments - totalBillPayments;

  await session.update(
    {
      total_expenses: totalExpenses.toFixed(2),
      total_supplier_payments: totalSupplierPayments.toFixed(2),
      total_bill_payments: totalBillPayments.toFixed(2),
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

    const formattedSessions = rows.map((session) => ({
      id: session.id,
      session_date: session.session_date,
      opening_balance: parseFloat(session.opening_balance),
      total_expenses: parseFloat(session.total_expenses),
      total_supplier_payments: parseFloat(session.total_supplier_payments),
      total_bill_payments: parseFloat(session.total_bill_payments || 0),
      closing_balance: parseFloat(session.closing_balance),
      notes: session.notes,
      is_closed: session.is_closed,
      closed_at: session.closed_at,
      created_at: session.created_at,
      updated_at: session.updated_at,
    }));

    return res.json({
      success: true,
      data: {
        sessions: formattedSessions,
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

// GET /expense-sessions/today
exports.getTodaySession = async (req, res) => {
  try {
    const today = formatLocalDate(new Date());

    const session = await DailyExpenseSession.findOne({
      where: { session_date: today },
      include: [{ model: DailyExpense, as: 'entries', order: [['entry_time', 'ASC']] }],
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'No session found for today. Please create one with opening balance.',
        data: null,
      });
    }

    const formattedSession = {
      id: session.id,
      session_date: session.session_date,
      opening_balance: parseFloat(session.opening_balance),
      total_expenses: parseFloat(session.total_expenses),
      total_supplier_payments: parseFloat(session.total_supplier_payments),
      total_bill_payments: parseFloat(session.total_bill_payments || 0),
      closing_balance: parseFloat(session.closing_balance),
      notes: session.notes,
      is_closed: session.is_closed,
      closed_at: session.closed_at,
      entries:
        session.entries?.map((entry) => ({
          id: entry.id,
          entry_type: entry.entry_type,
          category: entry.category,
          description: entry.description,
          amount: parseFloat(entry.amount),
          payment_method: entry.payment_method,
          bank_name: entry.bank_name,
          cheque_number: entry.cheque_number,
          reference_number: entry.reference_number,
          supplier_id: entry.supplier_id,
          bill_type: entry.bill_type,
          bill_number: entry.bill_number,
          consumer_number: entry.consumer_number,
          bill_image: entry.bill_image,
          entry_time: entry.entry_time,
          supplier: entry.supplier,
        })) || [],
    };

    return res.json({ success: true, data: formattedSession });
  } catch (err) {
    console.error('getTodaySession error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /expense-sessions/by-date?date=YYYY-MM-DD
exports.getSessionByDate = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, message: 'date query param is required' });
    }

    const session = await DailyExpenseSession.findOne({
      where: { session_date: date },
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
      return res.status(404).json({ success: false, message: 'No session found for this date' });
    }

    const formattedSession = {
      id: session.id,
      session_date: session.session_date,
      opening_balance: parseFloat(session.opening_balance),
      total_expenses: parseFloat(session.total_expenses),
      total_supplier_payments: parseFloat(session.total_supplier_payments),
      total_bill_payments: parseFloat(session.total_bill_payments || 0),
      closing_balance: parseFloat(session.closing_balance),
      notes: session.notes,
      is_closed: session.is_closed,
      closed_at: session.closed_at,
      entries:
        session.entries?.map((entry) => ({
          id: entry.id,
          entry_type: entry.entry_type,
          category: entry.category,
          description: entry.description,
          amount: parseFloat(entry.amount),
          payment_method: entry.payment_method,
          bank_name: entry.bank_name,
          cheque_number: entry.cheque_number,
          reference_number: entry.reference_number,
          supplier_id: entry.supplier_id,
          supplier: entry.supplier,
          bill_type: entry.bill_type,
          bill_number: entry.bill_number,
          consumer_number: entry.consumer_number,
          bill_image: entry.bill_image,
          entry_time: entry.entry_time,
        })) || [],
    };

    return res.json({ success: true, data: formattedSession });
  } catch (err) {
    console.error('getSessionByDate error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /expense-sessions/:id
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

    const formattedSession = {
      id: session.id,
      session_date: session.session_date,
      opening_balance: parseFloat(session.opening_balance),
      total_expenses: parseFloat(session.total_expenses),
      total_supplier_payments: parseFloat(session.total_supplier_payments),
      total_bill_payments: parseFloat(session.total_bill_payments || 0),
      closing_balance: parseFloat(session.closing_balance),
      notes: session.notes,
      is_closed: session.is_closed,
      closed_at: session.closed_at,
      entries:
        session.entries?.map((entry) => ({
          id: entry.id,
          entry_type: entry.entry_type,
          category: entry.category,
          description: entry.description,
          amount: parseFloat(entry.amount),
          payment_method: entry.payment_method,
          bank_name: entry.bank_name,
          cheque_number: entry.cheque_number,
          reference_number: entry.reference_number,
          supplier_id: entry.supplier_id,
          supplier: entry.supplier,
          bill_type: entry.bill_type,
          bill_number: entry.bill_number,
          consumer_number: entry.consumer_number,
          bill_image: entry.bill_image,
          entry_time: entry.entry_time,
        })) || [],
    };

    return res.json({ success: true, data: formattedSession });
  } catch (err) {
    console.error('getSession error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /expense-sessions
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
      total_bill_payments: '0.00',
      closing_balance: ob.toFixed(2),
      notes: notes || null,
      created_by: req.user?.id,
    });

    return res.status(201).json({ success: true, data: session });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Session already exists for this date' });
    }
    console.error('createSession error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /expense-sessions/:id/opening-balance
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
      parseFloat(session.total_expenses) +
      parseFloat(session.total_supplier_payments) +
      parseFloat(session.total_bill_payments || 0);

    await session.update({
      opening_balance: ob.toFixed(2),
      closing_balance: (ob - totalSpent).toFixed(2),
    });

    return res.json({ success: true, data: session });
  } catch (err) {
    console.error('updateOpeningBalance error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /expense-sessions/:id/close
exports.closeSession = async (req, res) => {
  try {
    const session = await DailyExpenseSession.findByPk(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    await session.update({ is_closed: true, closed_at: new Date() });
    return res.json({ success: true, message: 'Session closed', data: session });
  } catch (err) {
    console.error('closeSession error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// EXPENSE ENTRY ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

// POST /expense-sessions/:sessionId/expenses
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
      entry_date,
    } = req.body;

    const effectiveDate = resolveEffectiveDate(entry_date);

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
        cheque_date: cheque_date || null, // DATEONLY → string
        cheque_id: cheque_id || null,
        reference_number: reference_number || null,
        entry_time: effectiveDate,
        created_by: req.user?.id,
      },
      { transaction: dbTransaction }
    );

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
          transaction_date: effectiveDate,
        },
        { transaction: dbTransaction }
      );
    }

    if (payment_method === 'cash') {
      const cbEntry = await createCashbookEntry({
        entry_date: effectiveDate,
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

    await recalculateSession(sessionId, dbTransaction);

    await dbTransaction.commit();

    const updatedSession = await DailyExpenseSession.findByPk(sessionId);
    return res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      data: {
        entry,
        session: {
          ...updatedSession.toJSON(),
          total_bill_payments: parseFloat(updatedSession.total_bill_payments || 0),
        },
      },
    });
  } catch (err) {
    await dbTransaction.rollback();
    console.error('addExpense error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /expense-sessions/:sessionId/supplier-payments
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
      entry_date,
    } = req.body;

    const effectiveDate = resolveEffectiveDate(entry_date);

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
    const isCheque = payment_method === 'cheque';
    const isBank = payment_method === 'bank';

    // ── Validate bank if needed ──
    let selectedBank = null;
    if ((isBank || isCheque) && bank_id) {
      selectedBank = await Bank.findByPk(bank_id, { transaction: dbTransaction });
      if (!selectedBank) {
        await dbTransaction.rollback();
        return res.status(404).json({ success: false, message: 'Bank not found' });
      }
      if (parseFloat(selectedBank.balance) < paymentAmount) {
        await dbTransaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient bank balance. Available: Rs ${parseFloat(selectedBank.balance).toFixed(2)}`,
        });
      }
    }

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
    // STEP 1: Cheque → create BankTransaction FIRST (so we can link it)
    // ═══════════════════════════════════════════════════════════════════════
    let bankTransaction = null;
    let newBankBalance = null;

    if (isCheque && selectedBank && bank_id) {
      newBankBalance = parseFloat(selectedBank.balance) - paymentAmount;
      await selectedBank.update(
        { balance: newBankBalance.toFixed(2) },
        { transaction: dbTransaction }
      );

      bankTransaction = await BankTransaction.create(
        {
          bank_id,
          transaction_type: 'out',
          amount: paymentAmount.toFixed(2),
          description: `Cheque cleared - #${cheque_number} to ${supplier.name}`,
          reference_number: cheque_number,
          balance_after: newBankBalance.toFixed(2),
          created_by: req.user?.id,
          transaction_date: cheque_date
            ? new Date(cheque_date + 'T00:00:00')
            : effectiveDate,
        },
        { transaction: dbTransaction }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Create CHEQUE row (auto-cleared) with all required fields
    // ═══════════════════════════════════════════════════════════════════════
    let resolvedChequeId = cheque_id || null;
    let clearedDateObj = null;

    if (isCheque) {
      clearedDateObj = cheque_date
        ? new Date(cheque_date + 'T00:00:00') // local time
        : effectiveDate;

      const clearedDateStr = formatLocalDate(clearedDateObj);
      const issueDateStr = cheque_date || formatLocalDate(effectiveDate);
      const safePayeeName =
        supplier.name && supplier.name.trim()
          ? supplier.name.trim()
          : `Supplier #${supplier_id}`;

      if (!cheque_id) {
        const cheque = await Cheque.create(
          {
            bank_id,
            cheque_number,
            cheque_type: 'issued',
            status: 'cleared',
            amount: paymentAmount.toFixed(2),
            payee_payer_name: safePayeeName,
            description:
              description?.trim() || `Payment to supplier: ${safePayeeName}`,
            issue_date: issueDateStr,
            due_date: cheque_date || null,
            cleared_date: clearedDateStr,
            bank_transaction_id: bankTransaction?.id || null,
            supplier_id,
            created_by: req.user?.id,
          },
          { transaction: dbTransaction }
        );
        resolvedChequeId = cheque.id;
      } else {
        const existingCheque = await Cheque.findByPk(cheque_id, {
          transaction: dbTransaction,
        });
        if (!existingCheque) {
          await dbTransaction.rollback();
          return res.status(404).json({ success: false, message: 'Cheque not found' });
        }
        await existingCheque.update(
          {
            status: 'cleared',
            cleared_date: clearedDateStr,
            bank_transaction_id: bankTransaction?.id || existingCheque.bank_transaction_id,
            supplier_id,
            payee_payer_name: safePayeeName,
          },
          { transaction: dbTransaction }
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Supplier ledger entry — ALWAYS cheque_cleared=true for cheques
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
        transaction_date: effectiveDate,
        payment_method,
        bank_name: bank_name || null,
        bank_id: bank_id || null,
        cheque_number: cheque_number || null,
        cheque_date: cheque_date || null, // DATEONLY → string
        cheque_cleared: isCheque ? true : false,
        cheque_cleared_date: isCheque ? clearedDateObj : null,
        created_by: req.user?.id,
      },
      { transaction: dbTransaction }
    );

    if (resolvedChequeId) {
      await Cheque.update(
        { supplier_ledger_id: ledgerEntry.id },
        { where: { id: resolvedChequeId }, transaction: dbTransaction }
      );
    }

    await recalculateBalances(supplier_id, dbTransaction);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Bank transaction for 'bank' method
    // ═══════════════════════════════════════════════════════════════════════
    if (selectedBank && isBank) {
      const newBalance = parseFloat(selectedBank.balance) - paymentAmount;
      await selectedBank.update(
        { balance: newBalance.toFixed(2) },
        { transaction: dbTransaction }
      );
      await BankTransaction.create(
        {
          bank_id,
          transaction_type: 'out',
          amount: paymentAmount.toFixed(2),
          description: `Bank transfer to ${supplier.name} (via expense desk)`,
          reference_number: reference_number || null,
          balance_after: newBalance.toFixed(2),
          created_by: req.user?.id,
          transaction_date: effectiveDate,
        },
        { transaction: dbTransaction }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Cashbook for cash
    // ═══════════════════════════════════════════════════════════════════════
    if (payment_method === 'cash') {
      await createCashbookEntry({
        entry_date: effectiveDate,
        entry_type: 'cash_out',
        source_type: 'supplier_payment',
        reference_id: ledgerEntry.id,
        reference_number: reference_number || null,
        description: `Cash paid to ${supplier.name} (expense desk)`,
        amount: paymentAmount,
        created_by: req.user?.id,
        transaction: dbTransaction,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: DailyExpense entry
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
        cheque_date: cheque_date || null, // DATEONLY → string
        cheque_id: resolvedChequeId,
        reference_number: reference_number || null,
        supplier_id,
        supplier_ledger_id: ledgerEntry.id,
        entry_time: effectiveDate,
        created_by: req.user?.id,
      },
      { transaction: dbTransaction }
    );

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: Recalculate session totals
    // ═══════════════════════════════════════════════════════════════════════
    await recalculateSession(sessionId, dbTransaction);

    await dbTransaction.commit();

    const updatedSession = await DailyExpenseSession.findByPk(sessionId);
    return res.status(201).json({
      success: true,
      message: isCheque
        ? 'Cheque payment recorded, auto-cleared, and bank balance updated.'
        : 'Supplier payment recorded and deducted from session balance',
      data: {
        expense_entry: expenseEntry,
        ledger_entry: ledgerEntry,
        session: {
          ...updatedSession.toJSON(),
          total_bill_payments: parseFloat(updatedSession.total_bill_payments || 0),
        },
        ...(resolvedChequeId && {
          cheque_id: resolvedChequeId,
          cheque_status: 'cleared',
        }),
        ...(bankTransaction && {
          bank_transaction_id: bankTransaction.id,
          bank_balance_after: newBankBalance.toFixed(2),
        }),
      },
    });
  } catch (err) {
    await dbTransaction.rollback();
    console.error('addSupplierPayment error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /expense-sessions/:sessionId/bill-payments
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
      entry_date,
    } = req.body;

    const effectiveDate = resolveEffectiveDate(entry_date);

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

    const entry = await DailyExpense.create(
      {
        session_id: sessionId,
        entry_type: 'bill_payment',
        category: bill_type,
        description:
          description ||
          `${bill_name || 'Bill'} Payment${bill_number ? ` - Bill #${bill_number}` : ''}`,
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
        entry_time: effectiveDate,
        created_by: req.user?.id,
      },
      { transaction: dbTransaction }
    );

    if (selectedBank && payment_method === 'bank') {
      const newBalance = parseFloat(selectedBank.balance) - billAmount;
      await selectedBank.update({ balance: newBalance.toFixed(2) }, { transaction: dbTransaction });
      await BankTransaction.create(
        {
          bank_id: bank_id,
          transaction_type: 'out',
          amount: billAmount.toFixed(2),
          description: `Bill Payment: ${description || bill_name || 'Bill'}`,
          reference_number: reference_number || null,
          balance_after: newBalance.toFixed(2),
          created_by: req.user?.id,
          transaction_date: effectiveDate,
        },
        { transaction: dbTransaction }
      );
    }

    if (payment_method === 'cash') {
      const cbEntry = await createCashbookEntry({
        entry_date: effectiveDate,
        entry_type: 'cash_out',
        source_type: 'bill_payment',
        reference_id: entry.id,
        reference_number: reference_number || null,
        description: `Bill Payment: ${description || bill_name || 'Bill'}`,
        amount: billAmount,
        created_by: req.user?.id,
        transaction: dbTransaction,
      });
      if (cbEntry?.id) {
        await entry.update({ cashbook_entry_id: cbEntry.id }, { transaction: dbTransaction });
      }
    }

    await recalculateSession(sessionId, dbTransaction);

    await dbTransaction.commit();

    const updatedSession = await DailyExpenseSession.findByPk(sessionId);
    return res.status(201).json({
      success: true,
      message: 'Bill payment recorded successfully',
      data: {
        entry,
        session: {
          ...updatedSession.toJSON(),
          total_bill_payments: parseFloat(updatedSession.total_bill_payments || 0),
        },
      },
    });
  } catch (err) {
    await dbTransaction.rollback();
    console.error('addBillPayment error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /expense-sessions/bills
exports.getBillPayments = async (req, res) => {
  try {
    const billPayments = await DailyExpense.findAll({
      where: { entry_type: 'bill_payment' },
      order: [['entry_time', 'DESC']],
    });

    const formattedBills = billPayments.map((bill) => ({
      id: bill.id,
      bill_type: bill.bill_type || 'other',
      bill_name: bill.description || 'Bill Payment',
      bill_number: bill.bill_number,
      consumer_number: bill.consumer_number,
      description: bill.description || '',
      amount: parseFloat(bill.amount),
      payment_method: bill.payment_method || 'cash',
      bank_name: bill.bank_name,
      cheque_number: bill.cheque_number,
      reference_number: bill.reference_number,
      entry_time: bill.entry_time,
      bill_image: bill.bill_image,
      session_id: bill.session_id,
      created_at: bill.created_at,
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
      message: error.message,
    });
  }
};

// DELETE /expense-sessions/:sessionId/entries/:entryId
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

    // ── Hard delete, no reversal rows ────────────────────────────────────────
    // Supplier payment → remove the supplier ledger row together with its
    // bank transaction, cheque and cashbook rows, then recalculate the
    // supplier's running balances. Nothing is written as a "reversal".
    let supplierLedgerHandled = false;
    if (entry.entry_type === 'supplier_payment' && entry.supplier_ledger_id) {
      const ledgerEntry = await SupplierLedger.findByPk(entry.supplier_ledger_id, {
        transaction: dbTransaction,
      });
      if (ledgerEntry) {
        await deleteSupplierPaymentCascade(ledgerEntry, dbTransaction);
        supplierLedgerHandled = true;
      } else if (entry.supplier_id) {
        // Ledger row already gone — still make sure balances are right.
        await recalculateBalances(entry.supplier_id, dbTransaction);
      }
    }

    // Everything else (expenses, bill payments, and supplier payments whose
    // ledger row no longer exists): undo the bank and cashbook side directly.
    if (!supplierLedgerHandled) {
      const amount = parseFloat(entry.amount) || 0;

      if (entry.payment_method === 'bank' && entry.bank_id && amount > 0) {
        const bank = await Bank.findByPk(entry.bank_id, { transaction: dbTransaction });
        if (bank) {
          // The 'out' row was written with the same timestamp as entry_time.
          const originalTxn = await BankTransaction.findOne({
            where: {
              bank_id: entry.bank_id,
              transaction_type: 'out',
              amount: amount.toFixed(2),
              transaction_date: entry.entry_time,
            },
            order: [['id', 'DESC']],
            transaction: dbTransaction,
          });
          await bank.update(
            { balance: (parseFloat(bank.balance) + amount).toFixed(2) },
            { transaction: dbTransaction }
          );
          if (originalTxn) await originalTxn.destroy({ transaction: dbTransaction });
        }
      }

      if (entry.entry_type === 'supplier_payment' && entry.cheque_id) {
        await Cheque.destroy({ where: { id: entry.cheque_id }, transaction: dbTransaction });
      }

      // Cash expenses / bill payments wrote a cashbook row keyed to this entry.
      for (const model of [models.SimpleCashbook, models.Cashbook]) {
        if (!model) continue;
        await model.destroy({
          where: {
            source_type: { [Op.in]: ['daily_expense', 'bill_payment'] },
            reference_id: entry.id,
          },
          transaction: dbTransaction,
        });
      }
    }

    await entry.destroy({ transaction: dbTransaction });
    await recalculateSession(sessionId, dbTransaction);

    await dbTransaction.commit();

    const updatedSession = await DailyExpenseSession.findByPk(sessionId);
    return res.json({
      success: true,
      message: entry.entry_type === 'supplier_payment'
        ? 'Supplier payment deleted from expenses, supplier ledger, bank and cashbook'
        : 'Entry deleted and session recalculated',
      data: {
        session: {
          ...updatedSession.toJSON(),
          total_bill_payments: parseFloat(updatedSession.total_bill_payments || 0),
        },
      },
    });
  } catch (err) {
    await dbTransaction.rollback();
    console.error('deleteEntry error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
// Shared with supplierPaymentController so deleting a payment from the
// supplier screen also fixes that day's cash-desk totals.
exports.recalculateSession = recalculateSession;