const { Op } = require('sequelize');
const { Cheque, Bank, BankTransaction, User, Supplier, SupplierLedger, Customer, CustomerLedger, Sale, sequelize } = require('../models');
const { recalculateBalances, createLedgerEntry } = require('./supplierLedgerController');

// ═══════════════════════════════════════════════════════════════════════════
// ✅ CREATE CHEQUE
// ═══════════════════════════════════════════════════════════════════════════
exports.createCheque = async (req, res) => {
  const t = await Cheque.sequelize.transaction();
  try {
    const {
      bank_id,
      cheque_number,
      cheque_type,
      amount,
      payee_payer_name,
      description,
      issue_date,
      due_date
    } = req.body;
    const userId = req.user?.id;

    if (!bank_id || !cheque_number || !cheque_type || !amount || !payee_payer_name || !issue_date) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: 'bank_id, cheque_number, cheque_type, amount, payee_payer_name, issue_date are required'
      });
    }

    if (!['issued', 'received'].includes(cheque_type)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'cheque_type must be "issued" or "received"' });
    }

    const bank = await Bank.findByPk(bank_id, { transaction: t });
    if (!bank) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Bank not found' });
    }

    // Check for duplicate cheque number within same bank
    const existing = await Cheque.findOne({
      where: { bank_id, cheque_number, cheque_type },
      transaction: t
    });
    if (existing) {
      await t.rollback();
      return res.status(409).json({
        success: false,
        message: `Cheque #${cheque_number} already exists for this bank`
      });
    }

    const cheque = await Cheque.create({
      bank_id,
      cheque_number: cheque_number.trim(),
      cheque_type,
      status: 'pending',
      amount: parseFloat(amount).toFixed(2),
      payee_payer_name: payee_payer_name.trim(),
      description: description ? description.trim() : null,
      issue_date,
      due_date: due_date || null,
      created_by: userId
    }, { transaction: t });

    await t.commit();

    const chequeWithBank = await Cheque.findByPk(cheque.id, {
      include: [{ model: Bank, as: 'bank', attributes: ['id', 'name', 'balance'] }]
    });

    return res.status(201).json({
      success: true,
      message: `Cheque #${cheque_number} created successfully`,
      data: chequeWithBank
    });

  } catch (error) {
    await t.rollback();
    console.error('createCheque error:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ success: false, message: error.errors.map(e => e.message).join(', ') });
    }
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ GET ALL CHEQUES (filterable)
// ═══════════════════════════════════════════════════════════════════════════
exports.getAllCheques = async (req, res) => {
  try {
    const {
      bank_id,
      cheque_type,
      status,
      from_date,
      to_date,
      page = 1,
      limit = 50,
      search
    } = req.query;

    const where = {};
    if (bank_id)     where.bank_id     = parseInt(bank_id);
    if (cheque_type) where.cheque_type = cheque_type;
    if (status)      where.status      = status;

    if (from_date || to_date) {
      where.issue_date = {};
      if (from_date) where.issue_date[Op.gte] = from_date;
      if (to_date)   where.issue_date[Op.lte] = to_date;
    }

    if (search) {
      where[Op.or] = [
        { cheque_number:    { [Op.like]: `%${search}%` } },
        { payee_payer_name: { [Op.like]: `%${search}%` } },
        { description:      { [Op.like]: `%${search}%` } }
      ];
    }

    const pageNum   = parseInt(page);
    const limitNum  = parseInt(limit);
    const offset    = (pageNum - 1) * limitNum;

    const { count, rows } = await Cheque.findAndCountAll({
      where,
      include: [
        { model: Bank, as: 'bank', attributes: ['id', 'name', 'icon_path'] },
        { model: User, as: 'creator', attributes: ['id', 'name'], required: false }
      ],
      order: [['issue_date', 'DESC'], ['id', 'DESC']],
      limit: limitNum,
      offset
    });

    const pendingIssued   = rows.filter(c => c.cheque_type === 'issued'   && c.status === 'pending').reduce((s, c) => s + parseFloat(c.amount), 0);
    const pendingReceived = rows.filter(c => c.cheque_type === 'received' && c.status === 'pending').reduce((s, c) => s + parseFloat(c.amount), 0);

    return res.json({
      success: true,
      data: {
        cheques: rows,
        summary: {
          total: count,
          pending_issued_amount:   pendingIssued.toFixed(2),
          pending_received_amount: pendingReceived.toFixed(2)
        },
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(count / limitNum)
        }
      }
    });

  } catch (error) {
    console.error('getAllCheques error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ GET SINGLE CHEQUE
// ═══════════════════════════════════════════════════════════════════════════
exports.getCheque = async (req, res) => {
  try {
    const cheque = await Cheque.findByPk(req.params.id, {
      include: [
        { model: Bank, as: 'bank', attributes: ['id', 'name', 'icon_path', 'balance'] },
        { model: User, as: 'creator', attributes: ['id', 'name'], required: false },
        { model: BankTransaction, as: 'clearedTransaction', required: false },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'], required: false },
        { model: Customer, as: 'customer', attributes: ['id', 'name'], required: false }
      ]
    });
    if (!cheque) return res.status(404).json({ success: false, message: 'Cheque not found' });
    return res.json({ success: true, data: cheque });
  } catch (error) {
    console.error('getCheque error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ UPDATE CHEQUE DETAILS (only while pending)
// ═══════════════════════════════════════════════════════════════════════════
exports.updateCheque = async (req, res) => {
  try {
    const cheque = await Cheque.findByPk(req.params.id);
    if (!cheque) return res.status(404).json({ success: false, message: 'Cheque not found' });

    if (cheque.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot edit a cheque with status "${cheque.status}". Only pending cheques can be edited.`
      });
    }

    const { cheque_number, amount, payee_payer_name, description, issue_date, due_date } = req.body;

    await cheque.update({
      cheque_number:    cheque_number    ? cheque_number.trim()    : cheque.cheque_number,
      amount:           amount           ? parseFloat(amount).toFixed(2) : cheque.amount,
      payee_payer_name: payee_payer_name ? payee_payer_name.trim() : cheque.payee_payer_name,
      description:      description      !== undefined ? description : cheque.description,
      issue_date:       issue_date       || cheque.issue_date,
      due_date:         due_date         !== undefined ? due_date : cheque.due_date
    });

    return res.json({ success: true, message: 'Cheque updated', data: cheque });
  } catch (error) {
    console.error('updateCheque error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ CLEAR CHEQUE  →  adjusts bank balance + creates BankTransaction
// ═══════════════════════════════════════════════════════════════════════════
exports.clearCheque = async (req, res) => {
  const t = await Cheque.sequelize.transaction();
  try {
    const cheque = await Cheque.findByPk(req.params.id, { transaction: t });
    
    if (!cheque) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Cheque not found' });
    }
    
    if (cheque.status !== 'pending') {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Cheque is already "${cheque.status}". Only pending cheques can be cleared.`
      });
    }

    const bank = await Bank.findByPk(cheque.bank_id, { transaction: t });
    if (!bank) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Bank not found' });
    }
    
    const currentBalance = parseFloat(bank.balance);
    const chequeAmount = parseFloat(cheque.amount);
    const userId = req.user?.id;
    const { cleared_date } = req.body;

    const txnType = cheque.cheque_type === 'issued' ? 'out' : 'in';
    const newBalance = txnType === 'out'
      ? currentBalance - chequeAmount
      : currentBalance + chequeAmount;

    if (txnType === 'out' && newBalance < 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: Rs ${currentBalance.toFixed(2)}, Cheque: Rs ${chequeAmount.toFixed(2)}`
      });
    }

    await bank.update({ balance: newBalance.toFixed(2) }, { transaction: t });

    const txnDescription = cheque.cheque_type === 'issued'
      ? `Cheque cleared - #${cheque.cheque_number} to ${cheque.payee_payer_name}`
      : `Cheque cleared - #${cheque.cheque_number} from ${cheque.payee_payer_name}`;

    const bankTxn = await BankTransaction.create({
      bank_id: cheque.bank_id,
      transaction_type: txnType,
      amount: chequeAmount.toFixed(2),
      description: txnDescription,
      reference_number: cheque.cheque_number,
      balance_after: newBalance.toFixed(2),
      created_by: userId,
      transaction_date: cleared_date ? new Date(cleared_date) : new Date()
    }, { transaction: t });

    let updatedLedgerEntry = null;
    
    if (cheque.supplier_id && cheque.cheque_type === 'issued') {
      const paymentEntry = await SupplierLedger.findOne({
        where: {
          supplier_id: cheque.supplier_id,
          cheque_number: cheque.cheque_number,
          reference_type: 'payment'
        },
        transaction: t
      });
      
      if (paymentEntry) {
        await paymentEntry.update({
          cheque_cleared: true,
          cheque_cleared_date: cleared_date ? new Date(cleared_date) : new Date()
        }, { transaction: t });
        updatedLedgerEntry = paymentEntry;
      }
    }

    await cheque.update({
      status: 'cleared',
      cleared_date: cleared_date || new Date().toISOString().split('T')[0],
      bank_transaction_id: bankTxn.id
    }, { transaction: t });

    await t.commit();

    return res.json({
      success: true,
      message: `Cheque #${cheque.cheque_number} cleared. Bank balance updated.`,
      data: {
        cheque,
        bank_transaction: bankTxn,
        bank: { id: bank.id, name: bank.name, balance: newBalance.toFixed(2) },
        supplier_ledger_updated: updatedLedgerEntry ? true : false
      }
    });

  } catch (error) {
    await t.rollback();
    console.error('clearCheque error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ BOUNCE CHEQUE  →  reverses ledger entries but no bank balance change
// ═══════════════════════════════════════════════════════════════════════════
exports.bounceCheque = async (req, res) => {
  const t = await Cheque.sequelize.transaction();
  try {
    const cheque = await Cheque.findByPk(req.params.id, { transaction: t });
    if (!cheque) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Cheque not found' });
    }

    if (cheque.status !== 'pending') {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot bounce a cheque with status "${cheque.status}"`
      });
    }

    const { bounce_reason } = req.body;
    
    // Reverse supplier payment if cheque is issued to supplier
    if (cheque.supplier_id && cheque.cheque_type === 'issued') {
      const paymentEntry = await SupplierLedger.findOne({
        where: {
          supplier_id: cheque.supplier_id,
          cheque_number: cheque.cheque_number,
          reference_type: 'payment'
        },
        transaction: t
      });
      
      if (paymentEntry && !paymentEntry.cheque_cleared) {
        await SupplierLedger.create({
          supplier_id: cheque.supplier_id,
          reference_type: 'reversal',
          reference_id: paymentEntry.id,
          reference_number: `BOUNCE-${cheque.cheque_number}`,
          debit: 0,
          credit: parseFloat(paymentEntry.debit),
          balance: '0.00',
          description: `Cheque #${cheque.cheque_number} bounced - ${bounce_reason || 'Dishonoured by bank'}`,
          transaction_date: new Date(),
          created_by: req.user?.id,
        }, { transaction: t });
        
        await paymentEntry.destroy({ transaction: t });
        await recalculateBalances(cheque.supplier_id, t);
      }
    }
    
    // Reverse customer payment if cheque is received from customer
    if (cheque.customer_id && cheque.cheque_type === 'received') {
      const paymentEntry = await CustomerLedger.findOne({
        where: {
          customer_id: cheque.customer_id,
          cheque_number: cheque.cheque_number,
          transaction_type: 'payment'
        },
        transaction: t
      });
      
      if (paymentEntry) {
        await CustomerLedger.create({
          customer_id: cheque.customer_id,
          date: new Date().toISOString().split('T')[0],
          transaction_type: 'reversal',
          reference_id: paymentEntry.id,
          reference_number: `BOUNCE-${cheque.cheque_number}`,
          description: `Cheque #${cheque.cheque_number} bounced - ${bounce_reason || 'Dishonoured by bank'}`,
          debit: 0,
          credit: parseFloat(paymentEntry.debit),
          balance: 0,
          payment_method: paymentEntry.payment_method,
          bank_name: paymentEntry.bank_name,
          bank_id: paymentEntry.bank_id,
          cheque_number: cheque.cheque_number,
          cheque_date: cheque.issue_date,
          cheque_cleared: false
        }, { transaction: t });
        
        await paymentEntry.destroy({ transaction: t });
        await recalculateCustomerBalance(cheque.customer_id, t);
      }
      
      // Update sale if linked
      if (cheque.sale_id) {
        const sale = await Sale.findByPk(cheque.sale_id, { transaction: t });
        if (sale) {
          const chequeAmount = parseFloat(cheque.amount);
          const newPaidAmount = parseFloat(sale.amount_paid) - chequeAmount;
          const newPaymentStatus = newPaidAmount <= 0 ? 'unpaid' : 
                                   newPaidAmount >= parseFloat(sale.grand_total) ? 'paid' : 'partial';
          
          await sale.update({
            amount_paid: Math.max(0, newPaidAmount),
            payment_status: newPaymentStatus,
            notes: sale.notes ? `${sale.notes}\nCheque #${cheque.cheque_number} bounced on ${new Date().toISOString().split('T')[0]}` : `Cheque #${cheque.cheque_number} bounced`
          }, { transaction: t });
        }
      }
    }
    
    await cheque.update({
      status: 'bounced',
      bounce_reason: bounce_reason ? bounce_reason.trim() : 'Dishonoured by bank'
    }, { transaction: t });
    
    await t.commit();

    return res.json({
      success: true,
      message: `Cheque #${cheque.cheque_number} marked as bounced`,
      data: cheque
    });

  } catch (error) {
    await t.rollback();
    console.error('bounceCheque error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ CANCEL CHEQUE  →  void it, no bank effect
// ═══════════════════════════════════════════════════════════════════════════
exports.cancelCheque = async (req, res) => {
  const t = await Cheque.sequelize.transaction();
  try {
    const cheque = await Cheque.findByPk(req.params.id, { transaction: t });
    if (!cheque) return res.status(404).json({ success: false, message: 'Cheque not found' });

    if (!['pending'].includes(cheque.status)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a cheque with status "${cheque.status}"`
      });
    }

    await cheque.update({ status: 'cancelled' }, { transaction: t });
    await t.commit();
    
    return res.json({ success: true, message: `Cheque #${cheque.cheque_number} cancelled`, data: cheque });

  } catch (error) {
    await t.rollback();
    console.error('cancelCheque error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ DELETE CHEQUE (pending / cancelled only) - REVERSES ALL EFFECTS
// ═══════════════════════════════════════════════════════════════════════════
exports.deleteCheque = async (req, res) => {
  const t = await Cheque.sequelize.transaction();
  try {
    const cheque = await Cheque.findByPk(req.params.id, { 
      transaction: t,
      include: [
        { model: BankTransaction, as: 'clearedTransaction', required: false }
      ]
    });
    
    if (!cheque) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Cheque not found' });
    }

    if (!['pending', 'cancelled'].includes(cheque.status)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot delete a ${cheque.status} cheque. Only pending or cancelled cheques can be deleted.`
      });
    }

    let reversalTransaction = null;

    // STEP 1: Reverse bank transaction if cheque is linked to one
    if (cheque.bank_transaction_id) {
      const bankTxn = await BankTransaction.findByPk(cheque.bank_transaction_id, { transaction: t });
      
      if (bankTxn) {
        const bank = await Bank.findByPk(cheque.bank_id, { transaction: t });
        
        if (bank) {
          const currentBalance = parseFloat(bank.balance);
          const chequeAmount = parseFloat(cheque.amount);
          
          const reversedBalance = cheque.cheque_type === 'issued'
            ? currentBalance + chequeAmount
            : currentBalance - chequeAmount;
          
          await bank.update({ balance: reversedBalance.toFixed(2) }, { transaction: t });
          
          // Create reversal transaction with better tracking
          reversalTransaction = await BankTransaction.create({
            bank_id: cheque.bank_id,
            transaction_type: cheque.cheque_type === 'issued' ? 'in' : 'out',
            amount: chequeAmount.toFixed(2),
            description: `REVERSAL: Cheque #${cheque.cheque_number} deleted - ${cheque.payee_payer_name}`,
            reference_number: `REV-${cheque.cheque_number}`,
            balance_after: reversedBalance.toFixed(2),
            created_by: req.user?.id,
            transaction_date: new Date(),
            reversal_of_transaction_id: bankTxn.id  // Add this field to your model
          }, { transaction: t });
          
          // Mark the original transaction as reversed (add this field to your model)
          await bankTxn.update({ 
            reversed_by_transaction_id: reversalTransaction.id,
            is_reversed: true  // Add this field to your model
          }, { transaction: t });
        }
      }
    }
    
    // STEP 2: Update Supplier Ledger if cheque is linked to supplier
    if (cheque.supplier_id && cheque.cheque_type === 'issued') {
      const paymentEntry = await SupplierLedger.findOne({
        where: {
          supplier_id: cheque.supplier_id,
          cheque_number: cheque.cheque_number,
          reference_type: 'payment'
        },
        transaction: t
      });
      
      if (paymentEntry) {
        await SupplierLedger.create({
          supplier_id: cheque.supplier_id,
          reference_type: 'reversal',
          reference_id: paymentEntry.id,
          reference_number: `REV-${cheque.cheque_number}`,
          debit: 0,
          credit: parseFloat(paymentEntry.debit),
          balance: '0.00',
          description: `Reversal of cheque #${cheque.cheque_number} - Payment reversed due to cheque deletion`,
          transaction_date: new Date(),
          created_by: req.user?.id,
        }, { transaction: t });
        
        await paymentEntry.destroy({ transaction: t });
        await recalculateBalances(cheque.supplier_id, t);
      }
    }
    
    // STEP 3: Update Customer Ledger if cheque is linked to customer payment
    if (cheque.customer_id && cheque.cheque_type === 'received') {
      const paymentEntry = await CustomerLedger.findOne({
        where: {
          customer_id: cheque.customer_id,
          cheque_number: cheque.cheque_number,
          transaction_type: 'payment'
        },
        transaction: t
      });
      
      if (paymentEntry) {
        await CustomerLedger.create({
          customer_id: cheque.customer_id,
          date: new Date().toISOString().split('T')[0],
          transaction_type: 'reversal',
          reference_id: paymentEntry.id,
          reference_number: `REV-${cheque.cheque_number}`,
          description: `Reversal of cheque #${cheque.cheque_number} - Payment reversed due to cheque deletion`,
          debit: 0,
          credit: parseFloat(paymentEntry.debit),
          balance: 0,
          payment_method: paymentEntry.payment_method,
          bank_name: paymentEntry.bank_name,
          bank_id: paymentEntry.bank_id,
          cheque_number: cheque.cheque_number,
          cheque_date: cheque.issue_date,
          cheque_cleared: false
        }, { transaction: t });
        
        await paymentEntry.destroy({ transaction: t });
        await recalculateCustomerBalance(cheque.customer_id, t);
      }
    }
    
    // STEP 4: Update Sale if cheque is linked to a sale
    if (cheque.sale_id) {
      const sale = await Sale.findByPk(cheque.sale_id, { transaction: t });
      
      if (sale) {
        const chequeAmount = parseFloat(cheque.amount);
        const newPaidAmount = parseFloat(sale.amount_paid) - chequeAmount;
        const newPaymentStatus = newPaidAmount <= 0 ? 'unpaid' : 
                                 newPaidAmount >= parseFloat(sale.grand_total) ? 'paid' : 'partial';
        
        await sale.update({
          amount_paid: Math.max(0, newPaidAmount),
          payment_status: newPaymentStatus,
          notes: sale.notes ? `${sale.notes}\nCheque #${cheque.cheque_number} deleted on ${new Date().toISOString().split('T')[0]}` : `Cheque #${cheque.cheque_number} deleted`
        }, { transaction: t });
      }
    }
    
    // STEP 5: Delete the cheque
    await cheque.destroy({ transaction: t });
    
    await t.commit();
    
    return res.json({ 
      success: true, 
      message: 'Cheque deleted and all related transactions reversed successfully',
      data: reversalTransaction ? { reversal_transaction: reversalTransaction } : null
    });

  } catch (error) {
    await t.rollback();
    console.error('Delete cheque error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ REVERT TO PENDING  →  reverses cleared status and bank effects
// ═══════════════════════════════════════════════════════════════════════════
exports.revertToPending = async (req, res) => {
  const t = await Cheque.sequelize.transaction();
  try {
    const cheque = await Cheque.findByPk(req.params.id, { 
      transaction: t,
      include: [
        { model: Bank, as: 'bank', required: false },
        { model: BankTransaction, as: 'clearedTransaction', required: false }
      ]
    });

    if (!cheque) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Cheque not found' });
    }

    if (cheque.status === 'pending') {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: 'Cheque is already pending'
      });
    }

    let reversalTransaction = null;

    // STEP 1: If cheque was cleared, reverse the bank balance and create reversal transaction
    if (cheque.status === 'cleared' && cheque.bank_transaction_id) {
      const bankTxn = await BankTransaction.findByPk(cheque.bank_transaction_id, { transaction: t });
      
      if (bankTxn) {
        const bank = await Bank.findByPk(cheque.bank_id, { transaction: t });
        
        if (bank) {
          const currentBalance = parseFloat(bank.balance);
          const chequeAmount = parseFloat(cheque.amount);
          
          // Reverse the original transaction
          const reversedBalance = cheque.cheque_type === 'issued'
            ? currentBalance + chequeAmount  // Add back the debit
            : currentBalance - chequeAmount;  // Reverse the credit
          
          await bank.update({ balance: reversedBalance.toFixed(2) }, { transaction: t });
          
          // Create reversal transaction
          reversalTransaction = await BankTransaction.create({
            bank_id: cheque.bank_id,
            transaction_type: cheque.cheque_type === 'issued' ? 'in' : 'out',
            amount: chequeAmount.toFixed(2),
            description: `REVERSAL: Cheque #${cheque.cheque_number} reverted to pending - ${cheque.payee_payer_name}`,
            reference_number: `REV-${cheque.cheque_number}`,
            balance_after: reversedBalance.toFixed(2),
            created_by: req.user?.id,
            transaction_date: new Date(),
            reversal_of_transaction_id: bankTxn.id
          }, { transaction: t });
          
          // Mark original as reversed
          await bankTxn.update({ 
            reversed_by_transaction_id: reversalTransaction.id,
            is_reversed: true
          }, { transaction: t });
        }
      }
    }

    // STEP 2: If cheque was bounced, restore supplier/customer ledger entries
    if (cheque.status === 'bounced' && cheque.supplier_id && cheque.cheque_type === 'issued') {
      const reversalEntries = await SupplierLedger.findAll({
        where: {
          supplier_id: cheque.supplier_id,
          reference_number: { [Op.like]: `BOUNCE-${cheque.cheque_number}%` }
        },
        transaction: t
      });
      
      for (const entry of reversalEntries) {
        await entry.destroy({ transaction: t });
      }
      
      await recalculateBalances(cheque.supplier_id, t);
    }

    if (cheque.status === 'bounced' && cheque.customer_id && cheque.cheque_type === 'received') {
      const reversalEntries = await CustomerLedger.findAll({
        where: {
          customer_id: cheque.customer_id,
          reference_number: { [Op.like]: `BOUNCE-${cheque.cheque_number}%` }
        },
        transaction: t
      });
      
      for (const entry of reversalEntries) {
        await entry.destroy({ transaction: t });
      }
      
      await recalculateCustomerBalance(cheque.customer_id, t);
    }

    // STEP 3: Update cheque status back to pending
    await cheque.update({
      status: 'pending',
      cleared_date: null,
      bounce_reason: null,
      bank_transaction_id: null
    }, { transaction: t });

    await t.commit();

    return res.json({
      success: true,
      message: `Cheque #${cheque.cheque_number} reverted to pending`,
      data: {
        cheque,
        reversal_transaction: reversalTransaction
      }
    });

  } catch (error) {
    await t.rollback();
    console.error('revertToPending error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ HELPER FUNCTION: Recalculate Customer Balance
// ═══════════════════════════════════════════════════════════════════════════
async function recalculateCustomerBalance(customerId, transaction) {
  try {
    const entries = await CustomerLedger.findAll({
      where: { customer_id: customerId },
      order: [['date', 'ASC'], ['id', 'ASC']],
      transaction
    });
    
    let runningBalance = 0;
    
    for (const entry of entries) {
      runningBalance = runningBalance + (parseFloat(entry.debit) || 0) - (parseFloat(entry.credit) || 0);
      await entry.update({ balance: runningBalance }, { transaction });
    }
    
    await Customer.update(
      { balance: runningBalance },
      { where: { id: customerId }, transaction }
    );
    
    return runningBalance;
  } catch (error) {
    console.error('recalculateCustomerBalance error:', error);
    throw error;
  }
}

module.exports = exports;