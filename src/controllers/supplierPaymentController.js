// backend/src/controllers/supplierPaymentController.js
const { Op } = require('sequelize');
const { SupplierLedger, Supplier, Bank, BankTransaction, Cheque, sequelize } = require('../models');
const { recalculateBalances } = require('./supplierLedgerController');
const { createCashbookEntry } = require('./cashbookController');

// ═══════════════════════════════════════════════════════════════════════════
// ✅ CREATE SUPPLIER PAYMENT + AUTO BANK TRANSACTION
//    Cheque payments are recorded as CLEARED immediately (bank balance is
//    debited right away, cheque status = cleared).
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

    // ── Validate required fields ──
    if (!amount || parseFloat(amount) <= 0) {
      await dbTransaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    if (!payment_method) {
      await dbTransaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Payment method is required'
      });
    }

    // ── Get supplier ──
    const supplier = await Supplier.findByPk(supplierId, { transaction: dbTransaction });
    if (!supplier) {
      await dbTransaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    const paymentAmount = parseFloat(amount);
    const paymentDateObj = transaction_date ? new Date(transaction_date) : new Date();
    const paymentDateStr = paymentDateObj.toISOString().split('T')[0];

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Validate bank if bank/cheque payment
    // ═══════════════════════════════════════════════════════════════════════
    if (payment_method === 'cheque') {
      if (!cheque_number) {
        await dbTransaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Cheque number is required for cheque payment'
        });
      }
      if (!bank_id) {
        await dbTransaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Bank is required for cheque payment'
        });
      }
    }

    let selectedBank = null;
    if ((payment_method === 'bank' || payment_method === 'cheque') && bank_id) {
      selectedBank = await Bank.findByPk(bank_id, { transaction: dbTransaction });
      
      if (!selectedBank) {
        await dbTransaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Selected bank not found'
        });
      }

      // ✅ Both bank AND cheque debit the bank immediately (cheque is cleared)
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
    // STEP 2: Record bank transaction (bank / cheque)
    // ═══════════════════════════════════════════════════════════════════════
    let bankTransaction = null;
    if (selectedBank && (payment_method === 'bank' || payment_method === 'cheque')) {
      const newBankBalance = parseFloat(selectedBank.balance) - paymentAmount;
      await selectedBank.update(
        { balance: newBankBalance.toFixed(2) },
        { transaction: dbTransaction }
      );

      bankTransaction = await BankTransaction.create({
        bank_id: bank_id,
        transaction_type: 'out',
        amount: paymentAmount.toFixed(2),
        description: payment_method === 'cheque'
          ? `Cheque cleared - #${cheque_number} to ${supplier.name}`
          : `Bank transfer to ${supplier.name}`,
        reference_number: payment_method === 'cheque'
          ? cheque_number
          : (reference_number || null),
        balance_after: newBankBalance.toFixed(2),
        created_by: req.user?.id,
        transaction_date: paymentDateObj
      }, { transaction: dbTransaction });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Cheque record — update existing (from frontend) or create it.
    //         Always stored as CLEARED.
    // ═══════════════════════════════════════════════════════════════════════
    let chequeRecordId = cheque_id || null;
    if (payment_method === 'cheque') {
      const chequeFields = {
        status: 'cleared',
        cleared_date: paymentDateStr,
        bank_transaction_id: bankTransaction?.id || null,
        supplier_id: supplierId,
        payee_payer_name: supplier.name,
        description: description || `Payment to supplier: ${supplier.name}`,
      };

      if (chequeRecordId) {
        await Cheque.update(
          chequeFields,
          { where: { id: chequeRecordId }, transaction: dbTransaction }
        );
      } else {
        const newCheque = await Cheque.create({
          bank_id: bank_id,
          cheque_number: cheque_number,
          cheque_type: 'issued',
          amount: paymentAmount.toFixed(2),
          issue_date: paymentDateObj,
          due_date: cheque_date ? new Date(cheque_date) : null,
          created_by: req.user?.id,
          ...chequeFields,
        }, { transaction: dbTransaction });
        chequeRecordId = newCheque.id;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Create supplier ledger entry (payment)
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

    const isCheque = payment_method === 'cheque';

    const ledgerEntry = await SupplierLedger.create({
      supplier_id: supplierId,
      reference_type: 'payment',
      reference_id: chequeRecordId || null,  // Link to cheque if exists
      reference_number: reference_number || cheque_number || null,
      debit: paymentAmount.toFixed(2),
      credit: '0.00',
      balance: '0.00', // temporary - will be recalculated
      description: finalDescription,
      transaction_date: paymentDateObj,
      payment_method,
      bank_name: bank_name || selectedBank?.name || null,
      bank_id: bank_id || null,
      cheque_number: cheque_number || null,
      cheque_date: cheque_date 
        ? new Date(cheque_date + 'T00:00:00.000Z') 
        : null,
      // ✅ cheque payments are already cleared
      cheque_cleared: isCheque,
      cheque_cleared_date: isCheque ? paymentDateObj : null,
      created_by: req.user?.id,
    }, { transaction: dbTransaction });

    // Link ledger entry back to the cheque
    if (isCheque && chequeRecordId) {
      await Cheque.update(
        { supplier_ledger_id: ledgerEntry.id },
        { where: { id: chequeRecordId }, transaction: dbTransaction }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Recalculate supplier ledger balances
    // ═══════════════════════════════════════════════════════════════════════
    await recalculateBalances(supplierId, dbTransaction);

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

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Reload and commit
    // ═══════════════════════════════════════════════════════════════════════
    await ledgerEntry.reload({ transaction: dbTransaction });
    await dbTransaction.commit();

    const responseData = {
      entry: ledgerEntry,
      ...(bankTransaction && { bankTransaction }),
      ...(chequeRecordId && { cheque_id: chequeRecordId })
    };

    return res.status(201).json({
      success: true,
      message: payment_method === 'cheque' 
        ? `Cheque #${cheque_number} recorded as cleared. ${selectedBank?.name || 'Bank'} balance updated.`
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
// ✅ GET SUPPLIER PAYMENTS (now includes manual entries too)
// ═══════════════════════════════════════════════════════════════════════════
exports.getSupplierPayments = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { payment_method, from, to, page = 1, limit = 50 } = req.query;

    // Base filter: 'payment' entries + 'manual' entries are both shown here
    const where = {
      supplier_id: supplierId,
      reference_type: { [Op.in]: ['payment', 'manual'] },
    };

    if (payment_method && payment_method !== 'all') {
      if (payment_method === 'manual') {
        // Manual entries never have a payment_method set (null)
        where.reference_type = 'manual';
        where.payment_method = { [Op.is]: null };
      } else {
        // Restrict to actual payment entries with this method
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
// ✅ DELETE SUPPLIER PAYMENT - Delete from everywhere (now supports manual too)
// ═══════════════════════════════════════════════════════════════════════════
exports.deleteSupplierPayment = async (req, res) => {
  const dbTransaction = await sequelize.transaction();
  
  try {
    const { supplierId, paymentId } = req.params;

    // ── Get the payment entry with all details ──
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
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    const paymentAmount = parseFloat(entry.debit);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Reverse bank transaction if bank payment (delete the original)
    // ═══════════════════════════════════════════════════════════════════════
    if (entry.payment_method === 'bank' && entry.bank_id) {
      const bank = await Bank.findByPk(entry.bank_id, { transaction: dbTransaction });

      if (bank) {
        const newBankBalance = parseFloat(bank.balance) + paymentAmount;
        await bank.update(
          { balance: newBankBalance.toFixed(2) },
          { transaction: dbTransaction }
        );

        await BankTransaction.destroy({
          where: {
            bank_id: entry.bank_id,
            reference_number: entry.reference_number,
            amount: paymentAmount.toFixed(2),
            transaction_type: 'out'
          },
          transaction: dbTransaction
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Cheque payment — since cheques are recorded as cleared, give
    //         the money back to the bank and remove its bank transaction,
    //         then delete the cheque record.
    // ═══════════════════════════════════════════════════════════════════════
    if (entry.cheque_number && entry.reference_id) {
      const cheque = await Cheque.findByPk(entry.reference_id, { transaction: dbTransaction });

      if (cheque && cheque.status === 'cleared' && cheque.bank_transaction_id) {
        const bank = await Bank.findByPk(cheque.bank_id, { transaction: dbTransaction });
        if (bank) {
          const restoredBalance = parseFloat(bank.balance) + parseFloat(cheque.amount);
          await bank.update(
            { balance: restoredBalance.toFixed(2) },
            { transaction: dbTransaction }
          );
        }

        await BankTransaction.destroy({
          where: { id: cheque.bank_transaction_id },
          transaction: dbTransaction
        });
      }

      await Cheque.destroy({
        where: { id: entry.reference_id },
        transaction: dbTransaction
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Delete cashbook entry if exists
    // ═══════════════════════════════════════════════════════════════════════
    const { SimpleCashbook } = require('../models');
    
    const simpleCashbookEntry = await SimpleCashbook.findOne({
      where: {
        source_type: 'supplier_payment',
        reference_id: entry.id,
      },
      transaction: dbTransaction,
    });

    if (simpleCashbookEntry) {
      await SimpleCashbook.destroy({
        where: {
          source_type: 'supplier_payment',
          reference_id: entry.id,
        },
        transaction: dbTransaction,
      });
    }

    const { Cashbook } = require('../models');
    const cashbookEntry = await Cashbook.findOne({
      where: {
        source_type: 'supplier_payment',
        reference_id: entry.id,
      },
      transaction: dbTransaction,
    });

    if (cashbookEntry) {
      await Cashbook.destroy({
        where: {
          source_type: 'supplier_payment',
          reference_id: entry.id,
        },
        transaction: dbTransaction,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Delete the original payment entry
    // ═══════════════════════════════════════════════════════════════════════
    await entry.destroy({ transaction: dbTransaction });

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Recalculate all remaining ledger balances
    // ═══════════════════════════════════════════════════════════════════════
    const remainingEntries = await SupplierLedger.findAll({
      where: { supplier_id: supplierId },
      order: [['transaction_date', 'ASC'], ['id', 'ASC']],
      transaction: dbTransaction,
    });

    let runningBalance = 0;
    for (const remainingEntry of remainingEntries) {
      runningBalance += parseFloat(remainingEntry.credit) - parseFloat(remainingEntry.debit);
      await remainingEntry.update({ balance: runningBalance.toFixed(2) }, { transaction: dbTransaction });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Update supplier balance
    // ═══════════════════════════════════════════════════════════════════════
    await Supplier.update(
      { balance: runningBalance.toFixed(2) },
      { where: { id: supplierId }, transaction: dbTransaction }
    );

    await dbTransaction.commit();

    return res.json({
      success: true,
      message: 'Payment deleted successfully from all records'
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