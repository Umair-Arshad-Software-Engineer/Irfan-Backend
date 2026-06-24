// backend/src/controllers/customerPaymentController.js
const { Op } = require('sequelize');
// const { CustomerLedger, Customer, Bank, BankTransaction, Cheque, sequelize } = require('../models');
// const { CustomerLedger, Customer, Bank, BankTransaction, Cheque, SimpleCashbook, sequelize } = require('../models');  // ← Add SimpleCashbook here
const { 
  CustomerLedger, 
  Customer, 
  Bank, 
  BankTransaction, 
  Cheque, 
  SimpleCashbook, 
  Sale,  // ← Add Sale model here
  sequelize 
} = require('../models');
// Import ledger helpers (no circular dependency)
const { createLedgerEntry, recalculateBalances } = require('./customerLedgerController');
const { createCashbookEntry } = require('./cashbookController');
const { createSimpleCashbookEntry } = require('./simpleCashbookController');


// ═══════════════════════════════════════════════════════════════════════════
// ✅ CREATE CUSTOMER PAYMENT + AUTO BANK TRANSACTION
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
      from_simple_cashbook, // ✅ new
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

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Validate bank if bank/cheque payment
    // ═══════════════════════════════════════════════════════════════════════
    let selectedBank = null;
    let finalBankName = bank_name;
    
    if ((payment_method === 'bank' || payment_method === 'cheque') && bank_id) {
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
    // STEP 2: Create customer ledger entry using the helper function
    // ═══════════════════════════════════════════════════════════════════════
    
    const methodLabels = {
      'cash': 'Cash Payment',
      'bank': 'Bank Transfer',
      'cheque': 'Cheque Payment',
      'slip': 'Pay Slip'
    };

    const methodLabel = methodLabels[payment_method] || payment_method;
    
    // Auto-generate description if not provided
    const autoDesc = [
      `${methodLabel} from ${customer.name}`,
      finalBankName ? `| Bank: ${finalBankName}` : null,
      cheque_number ? `| Chq#: ${cheque_number}` : null,
      reference_number ? `| Ref: ${reference_number}` : null,
    ].filter(Boolean).join(' ');

    const finalDescription = description?.trim() || autoDesc;

    // Create ledger entry using the helper (payment = DEBIT reduces balance)
    const ledgerEntry = await createLedgerEntry({
      customer_id: customerId,
      transaction_type: 'payment',
      reference_id: cheque_id || null,
      reference_number: reference_number || cheque_number || `PAY-${Date.now()}`,
      debit: paymentAmount,
      credit: 0,
      description: finalDescription,
      transaction_date: transaction_date ? new Date(transaction_date) : new Date(),
      created_by: req.user?.id,
      payment_method,
      bank_name: finalBankName,
      bank_id: bank_id || null,
      cheque_number: cheque_number || null,
      cheque_date: cheque_date ? new Date(cheque_date) : null,
      cheque_cleared: payment_method === 'cheque' ? false : null,
      transaction: dbTransaction,
    });

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Update bank balance for immediate payments (bank only)
    // For cheque, don't update bank balance until cleared
    // ═══════════════════════════════════════════════════════════════════════
    let bankTransaction = null;
    
    if (selectedBank && payment_method === 'bank') {
      const newBankBalance = parseFloat(selectedBank.balance) + paymentAmount;
      await selectedBank.update(
        { balance: newBankBalance.toFixed(2) },
        { transaction: dbTransaction }
      );

      // Create bank transaction record (INCOMING)
      bankTransaction = await BankTransaction.create({
        bank_id: bank_id,
        transaction_type: 'in',
        amount: paymentAmount.toFixed(2),
        description: `Payment received from ${customer.name}`,
        reference_number: reference_number || null,
        balance_after: newBankBalance.toFixed(2),
        created_by: req.user?.id,
        transaction_date: transaction_date ? new Date(transaction_date) : new Date()
      }, { transaction: dbTransaction });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Update cheque record with customer_id and ledger_id
    // ═══════════════════════════════════════════════════════════════════════
    if (cheque_id && payment_method === 'cheque') {
      await Cheque.update(
        {
          customer_id: customerId,
          customer_ledger_id: ledgerEntry.id,
          payee_payer_name: customer.name,
          description: description || `Payment received from customer: ${customer.name}`,
          amount: paymentAmount,
          cheque_number: cheque_number,
          cheque_date: cheque_date ? new Date(cheque_date) : null,
        },
        { where: { id: cheque_id }, transaction: dbTransaction }
      );
    }

    // if (payment_method === 'cash') {
    //   await createCashbookEntry({
    //     entry_date: transaction_date || new Date(),
    //     entry_type: 'cash_in',
    //     source_type: 'customer_payment',
    //     reference_id: ledgerEntry.id,
    //     reference_number: ledgerEntry.reference_number,
    //     description: `Cash received from ${customer.name}`,
    //     amount: paymentAmount,
    //     created_by: req.user?.id,
    //     transaction: dbTransaction,
    //   });
    //   // ✅ Sirf tab jab Simple Cashbook se aaya ho
    //   if (from_simple_cashbook) {
    //     await createSimpleCashbookEntry({
    //       entry_date: transaction_date || new Date(),
    //       entry_type: 'cash_in',
    //       source_type: 'customer_payment',
    //       reference_id: ledgerEntry.id,
    //       reference_number: ledgerEntry.reference_number,
    //       description: `${payment_method === 'cash' ? 'Cash' : payment_method === 'bank' ? 'Bank Transfer' : payment_method === 'cheque' ? 'Cheque' : 'Slip'} received from ${customer.name}${finalBankName ? ' | Bank: ' + finalBankName : ''}${cheque_number ? ' | Chq#: ' + cheque_number : ''}`,
    //       amount: paymentAmount,
    //       created_by: req.user?.id,
    //       transaction: dbTransaction,
    //     });
    //   }
    // }


    // ✅ Purana cash-only block hatao, ye naya lagao
      if (payment_method === 'cash') {
        await createCashbookEntry({
          entry_date: transaction_date || new Date(),
          entry_type: 'cash_in',
          source_type: 'customer_payment',
          reference_id: ledgerEntry.id,
          reference_number: ledgerEntry.reference_number,
          description: `Cash received from ${customer.name}`,
          amount: paymentAmount,
          created_by: req.user?.id,
          transaction: dbTransaction,
        });
      }

// ✅ Simple cashbook — ALL methods, sirf from_simple_cashbook check
if (from_simple_cashbook) {
  const methodDescMap = {
    cash: 'Cash',
    bank: 'Bank Transfer',
    cheque: 'Cheque',
    slip: 'Slip',
  };
  const methodLabel = methodDescMap[payment_method] || payment_method;

  const descParts = [
    `${methodLabel} received from ${customer.name}`,
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
    // STEP 5: Update customer balance (using the recalculated balance)
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

    // ═══════════════════════════════════════════════════════════════════════
    // SUCCESS RESPONSE
    // ═══════════════════════════════════════════════════════════════════════
    const responseData = {
      entry: ledgerEntry,
      ...(bankTransaction && { bankTransaction }),
      ...(cheque_id && { cheque_id })
    };

    return res.status(201).json({
      success: true,
      message: payment_method === 'cheque' 
        ? 'Cheque payment recorded. Bank balance will update when cheque clears.'
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
    let sale = null;
    if (entry.reference_id && entry.transaction_type === 'payment') {
      sale = await Sale.findByPk(entry.reference_id, { transaction: dbTransaction });
    }

    // STEP 1: Reverse bank transaction if bank payment
    if (entry.payment_method === 'bank' && entry.bank_id) {
      const bank = await Bank.findByPk(entry.bank_id, { transaction: dbTransaction });
      if (bank) {
        const newBankBalance = parseFloat(bank.balance) - paymentAmount;
        await bank.update(
          { balance: newBankBalance.toFixed(2) },
          { transaction: dbTransaction }
        );
        
        // Delete the associated bank transaction
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

    // STEP 2: Delete cheque record if cheque payment
    if (entry.cheque_number && entry.reference_id) {
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
    if (sale) {
      // Calculate new amount paid for the sale
      const currentAmountPaid = parseFloat(sale.amount_paid) || 0;
      const newAmountPaid = Math.max(currentAmountPaid - paymentAmount, 0);
      const grandTotal = parseFloat(sale.grand_total) || 0;
      
      // Determine new payment status
      let newPaymentStatus = sale.payment_status;
      if (newAmountPaid >= grandTotal) {
        newPaymentStatus = 'paid';
      } else if (newAmountPaid > 0) {
        newPaymentStatus = 'partial';
      } else {
        newPaymentStatus = 'unpaid';
      }
      
      // Update the sale
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
        new_amount_paid: parseFloat(sale.amount_paid) - paymentAmount,
        new_payment_status: sale.payment_status
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
// ✅ UPDATE CHEQUE CLEARED STATUS (when cheque is cashed)
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
      if (ledgerEntry.bank_id) {
        const bank = await Bank.findByPk(ledgerEntry.bank_id, { transaction: t });
        if (bank) {
          const newBankBalance = parseFloat(bank.balance) + paymentAmount;
          await bank.update(
            { balance: newBankBalance.toFixed(2) },
            { transaction: t }
          );

          // Create bank transaction record for cleared cheque
          await BankTransaction.create({
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
      
      // Update cheque record if exists
      if (ledgerEntry.reference_id) {
        await Cheque.update(
          {
            status: 'cleared',
            cleared_date: cheque_cleared_date || new Date()
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
          await bank.update(
            { balance: newBankBalance.toFixed(2) },
            { transaction: t }
          );

          // Create reversal bank transaction
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
      
      // Update cheque record if exists
      if (ledgerEntry.reference_id) {
        await Cheque.update(
          {
            status: 'pending',
            cleared_date: null
          },
          { where: { id: ledgerEntry.reference_id }, transaction: t }
        );
      }
    }

    // Update cheque cleared status in ledger
    await ledgerEntry.update({
      cheque_cleared: cheque_cleared,
      cheque_cleared_date: cheque_cleared ? (cheque_cleared_date || new Date()) : null,
    }, { transaction: t });

    // Recalculate all balances (important after status change)
    await recalculateBalances(ledgerEntry.customer_id, t);

    // Update customer balance
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