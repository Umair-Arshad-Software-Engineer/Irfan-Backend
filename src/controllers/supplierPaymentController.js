// backend/src/controllers/supplierPaymentController.js
const { Op } = require('sequelize');
const { SupplierLedger, Supplier, Bank, BankTransaction, Cheque, DailyExpense, DailyExpenseSession, sequelize } = require('../models');
const { recalculateBalances } = require('./supplierLedgerController');
const { createCashbookEntry } = require('./cashbookController');
const { deleteSupplierPaymentCascade } = require('../services/supplierPaymentCleanup');
const { recalculateSession } = require('./dailyExpenseController');

// ═══════════════════════════════════════════════════════════════════════════
// ✅ CREATE SUPPLIER PAYMENT + AUTO BANK TRANSACTION
// ═══════════════════════════════════════════════════════════════════════════
exports.createSupplierPayment = async (req, res) => {
  const dbTransaction = await sequelize.transaction();

  try {
    const { supplierId } = req.params;
    const {
      amount,
      payment_method,
      bank_id,
      bank_name,
      cheque_number,
      cheque_id,
      cheque_date,
      reference_number,
      description,
      transaction_date,
    } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }

    if (!payment_method) {
      await dbTransaction.rollback();
      return res.status(400).json({ success: false, message: 'Payment method is required' });
    }

    const supplier = await Supplier.findByPk(supplierId, { transaction: dbTransaction });
    if (!supplier) {
      await dbTransaction.rollback();
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    const paymentAmount = parseFloat(amount);
    const isCheque = payment_method === 'cheque';

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Validate bank if bank/cheque payment
    // ═══════════════════════════════════════════════════════════════════════
    let selectedBank = null;
    if ((payment_method === 'bank' || isCheque) && bank_id) {
      selectedBank = await Bank.findByPk(bank_id, { transaction: dbTransaction });

      if (!selectedBank) {
        await dbTransaction.rollback();
        return res.status(404).json({ success: false, message: 'Selected bank not found' });
      }

      const bankBalance = parseFloat(selectedBank.balance);
      if (bankBalance < paymentAmount) {
        await dbTransaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient balance in ${selectedBank.name}. Available: Rs ${bankBalance.toFixed(2)}`
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Create supplier ledger entry (payment)
    // ═══════════════════════════════════════════════════════════════════════
    const methodLabels = {
      'cash': 'Cash Payment',
      'bank': 'Bank Transfer',
      'cheque': 'Cheque Payment',
      'slip': 'Pay Slip'
    };

    const methodLabel = methodLabels[payment_method] || payment_method;

    const autoDesc = [
      `${methodLabel} to ${supplier.name}`,
      bank_name ? `| Bank: ${bank_name}` : null,
      cheque_number ? `| Chq#: ${cheque_number}` : null,
      reference_number ? `| Ref: ${reference_number}` : null,
    ].filter(Boolean).join(' ');

    const finalDescription = description?.trim() || autoDesc;

    // Cheque is cleared instantly
    const clearedDate = isCheque
      ? (transaction_date ? new Date(transaction_date) : new Date())
      : null;

    const ledgerEntry = await SupplierLedger.create({
      supplier_id: supplierId,
      reference_type: 'payment',
      reference_id: cheque_id || null,
      reference_number: reference_number || cheque_number || null,
      debit: paymentAmount.toFixed(2),
      credit: '0.00',
      balance: '0.00',
      description: finalDescription,
      transaction_date: transaction_date ? new Date(transaction_date) : new Date(),
      payment_method,
      bank_name: bank_name || null,
      bank_id: bank_id || null,
      cheque_number: cheque_number || null,
      cheque_date: cheque_date ? new Date(cheque_date + 'T00:00:00.000Z') : null,
      cheque_cleared: isCheque ? true : false,
      cheque_cleared_date: clearedDate,
      created_by: req.user?.id,
    }, { transaction: dbTransaction });

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Update cheque record — mark cleared
    // ═══════════════════════════════════════════════════════════════════════
    if (cheque_id && isCheque) {
      await Cheque.update(
        {
          supplier_id: supplierId,
          supplier_ledger_id: ledgerEntry.id,
          payee_payer_name: supplier.name,
          description: description || `Payment to supplier: ${supplier.name}`,
          status: 'cleared',
          cleared_date: clearedDate || new Date(),
        },
        { where: { id: cheque_id }, transaction: dbTransaction }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Recalculate supplier ledger balances
    // ═══════════════════════════════════════════════════════════════════════
    await recalculateBalances(supplierId, dbTransaction);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Record bank transaction for bank OR cleared cheque
    // ═══════════════════════════════════════════════════════════════════════
    let bankTransaction = null;
    if (selectedBank && (payment_method === 'bank' || isCheque)) {
      const newBankBalance = parseFloat(selectedBank.balance) - paymentAmount;
      await selectedBank.update(
        { balance: newBankBalance.toFixed(2) },
        { transaction: dbTransaction }
      );

      bankTransaction = await BankTransaction.create({
        bank_id: bank_id,
        transaction_type: 'out',
        amount: paymentAmount.toFixed(2),
        description: isCheque
          ? `Cheque cleared to ${supplier.name} (Chq# ${cheque_number || 'N/A'})`
          : `Bank transfer to ${supplier.name}`,
        reference_number: cheque_number || reference_number || null,
        balance_after: newBankBalance.toFixed(2),
        created_by: req.user?.id,
        transaction_date: transaction_date ? new Date(transaction_date) : new Date()
      }, { transaction: dbTransaction });
    }

    if (payment_method === 'cash') {
      await createCashbookEntry({
        entry_date: transaction_date || new Date(),
        entry_type: 'cash_out',
        source_type: 'supplier_payment',
        reference_id: ledgerEntry.id,
        reference_number: reference_number || null,
        description: `Cash paid to ${supplier.name}`,
        amount: paymentAmount,
        created_by: req.user?.id,
        transaction: dbTransaction,
      });
    }

    await ledgerEntry.reload({ transaction: dbTransaction });
    await dbTransaction.commit();

    const responseData = {
      entry: ledgerEntry,
      ...(bankTransaction && { bankTransaction }),
      ...(cheque_id && { cheque_id })
    };

    return res.status(201).json({
      success: true,
      message: isCheque
        ? `Cheque #${cheque_number || ''} recorded and cleared. Bank balance updated.`
        : 'Payment recorded successfully' + (bankTransaction ? ' and bank transaction created' : ''),
      data: responseData
    });

  } catch (error) {
    await dbTransaction.rollback();
    console.error('Supplier payment error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ GET SUPPLIER PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════
exports.getSupplierPayments = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { payment_method, from, to, page = 1, limit = 50 } = req.query;

    const where = {
      supplier_id: supplierId,
      reference_type: { [Op.in]: ['payment', 'manual'] },
    };

    if (payment_method && payment_method !== 'all') {
      if (payment_method === 'manual') {
        where.reference_type = 'manual';
        where.payment_method = { [Op.is]: null };
      } else {
        where.reference_type = 'payment';
        where.payment_method = payment_method;
      }
    }

    if (from || to) {
      where.transaction_date = {};
      if (from) where.transaction_date[Op.gte] = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.transaction_date[Op.lte] = toDate;
      }
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await SupplierLedger.findAndCountAll({
      where,
      order: [['transaction_date', 'DESC'], ['id', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    const totalPaid = await SupplierLedger.sum('debit', { where }) || 0;

    return res.json({
      success: true,
      data: {
        payments: rows,
        totalPaid: parseFloat(totalPaid).toFixed(2),
        pagination: {
          total: count,
          page: parseInt(page),
          pages: Math.ceil(count / parseInt(limit)),
        },
      },
    });

  } catch (error) {
    console.error('Get payments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ DELETE SUPPLIER PAYMENT  (hard delete — never writes reversal rows)
//    - Deletes the ledger row, its BankTransaction, Cheque and cashbook rows
//    - Deletes the linked DailyExpense row (cash-desk payments) and
//      recalculates that day's session totals
//    - Recalculates the supplier's running balances
// ═══════════════════════════════════════════════════════════════════════════
exports.deleteSupplierPayment = async (req, res) => {
  const dbTransaction = await sequelize.transaction();

  try {
    const { supplierId, paymentId } = req.params;

    const entry = await SupplierLedger.findOne({
      where: {
        id: paymentId,
        supplier_id: supplierId,
        reference_type: { [Op.in]: ['payment', 'manual'] },
      },
      transaction: dbTransaction
    });

    if (!entry) {
      await dbTransaction.rollback();
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // ── Was this payment made from the daily expense (cash desk) screen? ──
    const linkedExpense = DailyExpense
      ? await DailyExpense.findOne({
          where: { supplier_ledger_id: entry.id },
          transaction: dbTransaction,
        })
      : null;

    if (linkedExpense) {
      const session = await DailyExpenseSession.findByPk(linkedExpense.session_id, {
        transaction: dbTransaction,
      });
      if (session && session.is_closed) {
        await dbTransaction.rollback();
        return res.status(400).json({
          success: false,
          message: `This payment was made from the cash desk on ${session.session_date}, and that day's session is closed. Re-open the session before deleting it.`,
        });
      }
    }

    // ── Hard delete: ledger row, bank txn, cheque, cashbook + recalc ──────
    // No reversal rows are created.
    const { closingBalance } = await deleteSupplierPaymentCascade(entry, dbTransaction);

    // ── Remove the matching daily-expense row and fix that day's totals ──
    if (linkedExpense) {
      const sessionId = linkedExpense.session_id;
      await linkedExpense.destroy({ transaction: dbTransaction });
      await recalculateSession(sessionId, dbTransaction);
    }

    await dbTransaction.commit();

    return res.json({
      success: true,
      message: linkedExpense
        ? 'Payment deleted from supplier ledger, daily expenses, bank and cashbook'
        : 'Payment deleted successfully from all records',
      data: { closing_balance: closingBalance },
    });

  } catch (error) {
    await dbTransaction.rollback();
    console.error('Delete payment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};