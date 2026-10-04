// backend/src/controllers/customerPaymentController.js
const { Op } = require('sequelize');
const { 
  CustomerLedger, 
  Customer, 
  Bank, 
  BankTransaction, 
  Cheque, 
  SimpleCashbook, 
  Sale,
  sequelize 
} = require('../models');
// Import ledger helpers (no circular dependency)
const { createLedgerEntry, recalculateBalances } = require('./customerLedgerController');
const { createCashbookEntry } = require('./cashbookController');
const { createSimpleCashbookEntry } = require('./simpleCashbookController');


// ═══════════════════════════════════════════════════════════════════════════
// ✅ CREATE CUSTOMER PAYMENT + AUTO BANK TRANSACTION
//    Cheque payments are recorded as CLEARED immediately (bank balance is
//    credited right away, cheque status = cleared).
// ═══════════════════════════════════════════════════════════════════════════
exports.createCustomerPayment = async (req, res) => {
  const dbTransaction = await sequelize.transaction();
  
  try {
    const { customerId } = req.params;
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
      from_simple_cashbook,
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

    // ── Get customer ──
    const customer = await Customer.findByPk(customerId, { transaction: dbTransaction });
    if (!customer) {
      await dbTransaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const paymentAmount = parseFloat(amount);
    const isCheque = payment_method === 'cheque';
    const paymentDateObj = transaction_date ? new Date(transaction_date) : new Date();
    const paymentDateStr = paymentDateObj.toISOString().split('T')[0];

    // ✅ Cheque is cleared on entry, so cheque number + bank are mandatory
    if (isCheque) {
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

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Validate bank if bank/cheque payment
    // ═══════════════════════════════════════════════════════════════════════
    let selectedBank = null;
    let finalBankName = bank_name;
    
    if ((payment_method === 'bank' || isCheque) && bank_id) {
      selectedBank = await Bank.findByPk(bank_id, { transaction: dbTransaction });
      
      if (!selectedBank) {
        await dbTransaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Selected bank not found'
        });
      }
      
      finalBankName = selectedBank.name;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Update bank balance + bank transaction (bank AND cheque)
    // ═══════════════════════════════════════════════════════════════════════
    let bankTransaction = null;
    
    if (selectedBank && (payment_method === 'bank' || isCheque)) {
      const newBankBalance = parseFloat(selectedBank.balance) + paymentAmount;
      await selectedBank.update(
        { balance: newBankBalance.toFixed(2) },
        { transaction: dbTransaction }
      );

      bankTransaction = await BankTransaction.create({
        bank_id: bank_id,
        transaction_type: 'in',
        amount: paymentAmount.toFixed(2),
        description: isCheque
          ? `Cheque cleared - #${cheque_number} from ${customer.name}`
          : `Payment received from ${customer.name}`,
        reference_number: isCheque ? cheque_number : (reference_number || null),
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
    if (isCheque) {
      const chequeFields = {
        status: 'cleared',
        cleared_date: paymentDateStr,
        bank_transaction_id: bankTransaction?.id || null,
        customer_id: customerId,
        payee_payer_name: customer.name,
        description: description || `Payment received from customer: ${customer.name}`,
        amount: paymentAmount,
        cheque_number: cheque_number,
        due_date: cheque_date ? new Date(cheque_date) : null,
      };

      if (chequeRecordId) {
        await Cheque.update(
          chequeFields,
          { where: { id: chequeRecordId }, transaction: dbTransaction }
        );
      } else {
        const newCheque = await Cheque.create({
          bank_id: bank_id,
          cheque_type: 'received',
          issue_date: paymentDateObj,
          created_by: req.user?.id,
          ...chequeFields,
        }, { transaction: dbTransaction });
        chequeRecordId = newCheque.id;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Create customer ledger entry (payment = DEBIT reduces balance)
    // ═══════════════════════════════════════════════════════════════════════
    const methodLabels = {
      'cash': 'Cash Payment',
      'bank': 'Bank Transfer',
      'cheque': 'Cheque Payment',
      'slip': 'Pay Slip'
    };

    const methodLabel = methodLabels[payment_method] || payment_method;
    
    const autoDesc = [
      `${methodLabel} from ${customer.name}`,
      finalBankName ? `| Bank: ${finalBankName}` : null,
      cheque_number ? `| Chq#: ${cheque_number}` : null,
      reference_number ? `| Ref: ${reference_number}` : null,
    ].filter(Boolean).join(' ');

    const finalDescription = description?.trim() || autoDesc;

    const ledgerEntry = await createLedgerEntry({
      customer_id: customerId,
      transaction_type: 'payment',
      reference_id: chequeRecordId || null,
      reference_number: reference_number || cheque_number || `PAY-${Date.now()}`,
      debit: paymentAmount,
      credit: 0,
      description: finalDescription,
      transaction_date: paymentDateObj,
      created_by: req.user?.id,
      payment_method,
      bank_name: finalBankName,
      bank_id: bank_id || null,
      cheque_number: cheque_number || null,
      cheque_date: cheque_date ? new Date(cheque_date) : null,
      // ✅ cheque payments are already cleared
      cheque_cleared: isCheque ? true : null,
      cheque_cleared_date: isCheque ? paymentDateObj : null,
      transaction: dbTransaction,
    });

    // Link ledger entry back to the cheque
    if (isCheque && chequeRecordId) {
      await Cheque.update(
        { customer_ledger_id: ledgerEntry.id },
        { where: { id: chequeRecordId }, transaction: dbTransaction }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Cashbook entries
    // ═══════════════════════════════════════════════════════════════════════
    if (payment_method === 'cash') {
      await createCashbookEntry({
        entry_date: transaction_date || new Date(),
        entry_type: 'cash_in',
        source_type: 'customer_payment',
        reference_id: ledgerEntry.id,
        reference_number: ledgerEntry.reference_number,
        description: `وصل کیش ${customer.name}`,
        amount: paymentAmount,
        created_by: req.user?.id,
        transaction: dbTransaction,
      });
    }

    // Simple cashbook — ALL methods, only when from_simple_cashbook
    if (from_simple_cashbook) {
      const methodDescMap = {
        cash: 'Cash',
        bank: 'Bank Transfer',
        cheque: 'Cheque',
        slip: 'Slip',
      };
      const simpleLabel = methodDescMap[payment_method] || payment_method;

      const descParts = [
        `${simpleLabel} received from ${customer.name}`,
        finalBankName ? `| Bank: ${finalBankName}` : null,
        cheque_number ? `| Chq#: ${cheque_number}` : null,
      ].filter(Boolean).join(' ');

      await createSimpleCashbookEntry({
        entry_date: transaction_date || new Date(),
        entry_type: 'cash_in',
        source_type: 'customer_payment',
        reference_id: ledgerEntry.id,
        reference_number: ledgerEntry.reference_number || cheque_number || null,
        description: descParts,
        amount: paymentAmount,
        created_by: req.user?.id,
        transaction: dbTransaction,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Update customer balance (using the recalculated balance)
    // ═══════════════════════════════════════════════════════════════════════
    const finalBalance = await CustomerLedger.findOne({
      where: { customer_id: customerId },
      order: [['date', 'DESC'], ['id', 'DESC']],
      transaction: dbTransaction,
    });

    await Customer.update(
      { balance: finalBalance.balance },
      { where: { id: customerId }, transaction: dbTransaction }
    );

    await dbTransaction.commit();

    const responseData = {
      entry: ledgerEntry,
      ...(bankTransaction && { bankTransaction }),
      ...(chequeRecordId && { cheque_id: chequeRecordId })
    };

    return res.status(201).json({
      success: true,
      message: isCheque 
        ? `Cheque #${cheque_number} recorded as cleared. ${finalBankName || 'Bank'} balance updated.`
        : 'Payment recorded successfully' + (bankTransaction ? ' and bank transaction created' : ''),
      data: responseData
    });

  } catch (error) {
    await dbTransaction.rollback();
    console.error('Customer payment error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ DELETE CUSTOMER PAYMENT + CREATE REVERSAL
// ═══════════════════════════════════════════════════════════════════════════

exports.deleteCustomerPayment = async (req, res) => {
  const dbTransaction = await sequelize.transaction();
  
  try {
    const { customerId, paymentId } = req.params;

    // Find the payment entry
    const entry = await CustomerLedger.findOne({
      where: {
        id: paymentId,
        customer_id: customerId,
        transaction_type: 'payment'
      },
      transaction: dbTransaction
    });

    if (!entry) {
      await dbTransaction.rollback();
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const paymentAmount = parseFloat(entry.debit);
    
    // Check if this payment is linked to a sale (reference_id points to sale)
    // (cheque payments made here point reference_id at the cheque, so skip them)
    let sale = null;
    if (entry.reference_id && entry.transaction_type === 'payment' && !entry.cheque_number) {
      sale = await Sale.findByPk(entry.reference_id, { transaction: dbTransaction });
    }

    // STEP 1: Reverse bank transaction if bank payment
    if (entry.payment_method === 'bank' && entry.bank_id) {
      const bank = await Bank.findByPk(entry.bank_id, { transaction: dbTransaction });
      if (bank) {
        const newBankBalance = parseFloat(bank.balance) - paymentAmount;

        if (newBankBalance < 0) {
          await dbTransaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Cannot delete this payment: reversing Rs ${paymentAmount.toFixed(2)} from "${bank.name}" would take its balance negative (current: Rs ${parseFloat(bank.balance).toFixed(2)}).`
          });
        }

        await bank.update(
          { balance: newBankBalance.toFixed(2) },
          { transaction: dbTransaction }
        );
        
        await BankTransaction.destroy({
          where: {
            bank_id: entry.bank_id,
            reference_number: entry.reference_number,
            amount: paymentAmount.toFixed(2),
            transaction_type: 'in'
          },
          transaction: dbTransaction
        });
      }
    }

    // STEP 2: Cheque payment — cheques are recorded as cleared, so reverse the
    //         bank credit and remove its bank transaction, then delete the cheque.
    if (entry.cheque_number && entry.reference_id) {
      const cheque = await Cheque.findByPk(entry.reference_id, { transaction: dbTransaction });

      if (cheque && cheque.status === 'cleared' && cheque.bank_transaction_id) {
        const bank = await Bank.findByPk(cheque.bank_id, { transaction: dbTransaction });
        if (bank) {
          const restoredBalance = parseFloat(bank.balance) - parseFloat(cheque.amount);

          if (restoredBalance < 0) {
            await dbTransaction.rollback();
            return res.status(400).json({
              success: false,
              message: `Cannot delete this payment: reversing Rs ${parseFloat(cheque.amount).toFixed(2)} from "${bank.name}" would take its balance negative (current: Rs ${parseFloat(bank.balance).toFixed(2)}).`
            });
          }

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

    // STEP 3: Delete cashbook entry if exists
    const cashbookEntry = await SimpleCashbook.findOne({
      where: {
        source_type: 'customer_payment',
        reference_id: entry.id,
      },
      transaction: dbTransaction,
    });

    if (cashbookEntry) {
      await SimpleCashbook.destroy({
        where: {
          source_type: 'customer_payment',
          reference_id: entry.id,
        },
        transaction: dbTransaction,
      });
    }

    // STEP 4: Update sale if this payment is linked to a sale
    let newAmountPaid = null;
    let newPaymentStatus = null;
    if (sale) {
      const currentAmountPaid = parseFloat(sale.amount_paid) || 0;
      newAmountPaid = Math.max(currentAmountPaid - paymentAmount, 0);
      const grandTotal = parseFloat(sale.grand_total) || 0;
      
      if (newAmountPaid >= grandTotal) {
        newPaymentStatus = 'paid';
      } else if (newAmountPaid > 0) {
        newPaymentStatus = 'partial';
      } else {
        newPaymentStatus = 'unpaid';
      }
      
      await sale.update({
        amount_paid: newAmountPaid,
        payment_status: newPaymentStatus,
        notes: sale.notes 
          ? `${sale.notes}\n[Payment of Rs ${paymentAmount.toFixed(2)} deleted on ${new Date().toLocaleDateString()}]`
          : `[Payment of Rs ${paymentAmount.toFixed(2)} deleted on ${new Date().toLocaleDateString()}]`
      }, { transaction: dbTransaction });
    }

    // STEP 5: Delete the original payment entry
    await entry.destroy({ transaction: dbTransaction });

    // STEP 6: Recalculate all remaining ledger balances
    const remainingEntries = await CustomerLedger.findAll({
      where: { customer_id: customerId },
      order: [['date', 'ASC'], ['id', 'ASC']],
      transaction: dbTransaction,
    });

    let runningBalance = 0;
    for (const remainingEntry of remainingEntries) {
      runningBalance += parseFloat(remainingEntry.credit) - parseFloat(remainingEntry.debit);
      await remainingEntry.update({ balance: runningBalance.toFixed(2) }, { transaction: dbTransaction });
    }

    // STEP 7: Update customer balance
    await Customer.update(
      { balance: runningBalance.toFixed(2) },
      { where: { id: customerId }, transaction: dbTransaction }
    );

    await dbTransaction.commit();

    const responseMessage = sale 
      ? `Payment deleted successfully and sale #${sale.invoice_number} updated`
      : 'Payment deleted successfully';

    return res.json({
      success: true,
      message: responseMessage,
      data: sale ? {
        sale_id: sale.id,
        invoice_number: sale.invoice_number,
        new_amount_paid: newAmountPaid,
        new_payment_status: newPaymentStatus
      } : null
    });

  } catch (error) {
    await dbTransaction.rollback();
    console.error('Delete payment error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ GET CUSTOMER PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════
exports.getCustomerPayments = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { payment_method, from, to, page = 1, limit = 50, show_uncleared_cheques = 'false' } = req.query;

    const where = {
      customer_id: customerId,
      transaction_type: 'payment',
    };

    if (payment_method && payment_method !== 'all') {
      where.payment_method = payment_method;
    }

    // Filter cheque clearing status
    if (show_uncleared_cheques !== 'true') {
      where[Op.or] = [
        { payment_method: { [Op.ne]: 'cheque' } },
        { payment_method: 'cheque', cheque_cleared: true },
        { payment_method: null },
      ];
    }

    if (from || to) {
      where.date = {};
      if (from) where.date[Op.gte] = from;
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.date[Op.lte] = toDate;
      }
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: payments } = await CustomerLedger.findAndCountAll({
      where,
      order: [['date', 'DESC'], ['id', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    const totalPaid = await CustomerLedger.sum('debit', { where }) || 0;

    return res.json({
      success: true,
      data: {
        payments,
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
// ✅ UPDATE CHEQUE CLEARED STATUS
//    (kept for manual un-clear / re-clear of an existing cheque entry)
// ═══════════════════════════════════════════════════════════════════════════
exports.updateChequeClearedStatus = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { ledgerEntryId } = req.params;
    const { cheque_cleared, cheque_cleared_date } = req.body;

    const ledgerEntry = await CustomerLedger.findByPk(ledgerEntryId, { transaction: t });
    
    if (!ledgerEntry) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Ledger entry not found' });
    }

    if (ledgerEntry.payment_method !== 'cheque') {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'This entry is not a cheque payment' });
    }

    const paymentAmount = parseFloat(ledgerEntry.debit);
    const wasCleared = ledgerEntry.cheque_cleared;
    
    // If clearing a cheque (false → true), update bank balance
    if (cheque_cleared === true && wasCleared === false) {
      let clearedTxn = null;
      if (ledgerEntry.bank_id) {
        const bank = await Bank.findByPk(ledgerEntry.bank_id, { transaction: t });
        if (bank) {
          const newBankBalance = parseFloat(bank.balance) + paymentAmount;
          await bank.update(
            { balance: newBankBalance.toFixed(2) },
            { transaction: t }
          );

          clearedTxn = await BankTransaction.create({
            bank_id: ledgerEntry.bank_id,
            transaction_type: 'in',
            amount: paymentAmount.toFixed(2),
            description: `Cheque cleared - ${ledgerEntry.description || 'Customer payment'}`,
            reference_number: ledgerEntry.cheque_number,
            balance_after: newBankBalance.toFixed(2),
            created_by: req.user?.id,
            transaction_date: cheque_cleared_date || new Date()
          }, { transaction: t });
        }
      }
      
      if (ledgerEntry.reference_id) {
        await Cheque.update(
          {
            status: 'cleared',
            cleared_date: cheque_cleared_date || new Date(),
            bank_transaction_id: clearedTxn?.id || null
          },
          { where: { id: ledgerEntry.reference_id }, transaction: t }
        );
      }
    }
    
    // If un-clearing a cheque (true → false), reverse bank balance
    if (cheque_cleared === false && wasCleared === true) {
      if (ledgerEntry.bank_id) {
        const bank = await Bank.findByPk(ledgerEntry.bank_id, { transaction: t });
        if (bank) {
          const newBankBalance = parseFloat(bank.balance) - paymentAmount;

          if (newBankBalance < 0) {
            await t.rollback();
            return res.status(400).json({
              success: false,
              message: `Cannot un-clear: would take "${bank.name}" balance negative (current: Rs ${parseFloat(bank.balance).toFixed(2)}).`
            });
          }

          await bank.update(
            { balance: newBankBalance.toFixed(2) },
            { transaction: t }
          );

          await BankTransaction.create({
            bank_id: ledgerEntry.bank_id,
            transaction_type: 'out',
            amount: paymentAmount.toFixed(2),
            description: `Cheque uncleared reversal - ${ledgerEntry.description || 'Customer payment'}`,
            reference_number: ledgerEntry.cheque_number,
            balance_after: newBankBalance.toFixed(2),
            created_by: req.user?.id,
            transaction_date: new Date()
          }, { transaction: t });
        }
      }
      
      if (ledgerEntry.reference_id) {
        await Cheque.update(
          {
            status: 'pending',
            cleared_date: null,
            bank_transaction_id: null
          },
          { where: { id: ledgerEntry.reference_id }, transaction: t }
        );
      }
    }

    await ledgerEntry.update({
      cheque_cleared: cheque_cleared,
      cheque_cleared_date: cheque_cleared ? (cheque_cleared_date || new Date()) : null,
    }, { transaction: t });

    await recalculateBalances(ledgerEntry.customer_id, t);

    const finalBalance = await CustomerLedger.findOne({
      where: { customer_id: ledgerEntry.customer_id },
      order: [['date', 'DESC'], ['id', 'DESC']],
      transaction: t,
    });

    await Customer.update(
      { balance: finalBalance ? finalBalance.balance : 0 },
      { where: { id: ledgerEntry.customer_id }, transaction: t }
    );

    await t.commit();

    res.json({
      success: true,
      message: cheque_cleared ? 'Cheque marked as cleared' : 'Cheque marked as uncleared',
      data: ledgerEntry
    });
  } catch (error) {
    await t.rollback();
    console.error('Update cheque cleared status error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ GET SINGLE PAYMENT DETAILS
// ═══════════════════════════════════════════════════════════════════════════
exports.getPaymentDetails = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await CustomerLedger.findByPk(paymentId, {
      where: { transaction_type: 'payment' }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    return res.json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('Get payment details error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};