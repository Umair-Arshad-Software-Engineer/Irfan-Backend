// src/controllers/bankTransferController.js
// Handles inter-bank transfers with full audit trail via BankTransfer model.
// Drop-in replacement / extension for the transfer logic in bankController.js

const { Op } = require('sequelize');
const { Bank, BankTransaction, BankTransfer, User } = require('../models');

// ═══════════════════════════════════════════════════════════════════════════
// ✅ TRANSFER BETWEEN BANKS
// ═══════════════════════════════════════════════════════════════════════════
exports.transferBetweenBanks = async (req, res) => {
  const t = await Bank.sequelize.transaction();
  try {
    const {
      from_bank_id,
      to_bank_id,
      amount,
      description,
      reference_number,
      transfer_date
    } = req.body;
    const userId = req.user?.id;

    // ── Validate ──
    if (!from_bank_id || !to_bank_id || !amount || !description) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: 'from_bank_id, to_bank_id, amount, and description are required'
      });
    }

    if (parseInt(from_bank_id) === parseInt(to_bank_id)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer to the same bank'
      });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // ── Fetch both banks ──
    const fromBank = await Bank.findByPk(from_bank_id, { transaction: t });
    const toBank   = await Bank.findByPk(to_bank_id,   { transaction: t });

    if (!fromBank) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Source bank not found' });
    }
    if (!toBank) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Destination bank not found' });
    }

    // ── Check sufficient balance ──
    const fromBalance = parseFloat(fromBank.balance);
    if (fromBalance < transferAmount) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance in ${fromBank.name}. Available: Rs ${fromBalance.toFixed(2)}, Required: Rs ${transferAmount.toFixed(2)}`
      });
    }

    const txnDate        = transfer_date ? new Date(transfer_date) : new Date();
    const newFromBalance = fromBalance - transferAmount;
    const newToBalance   = parseFloat(toBank.balance) + transferAmount;

    // ── Update bank balances ──
    await fromBank.update({ balance: newFromBalance.toFixed(2) }, { transaction: t });
    await toBank.update(  { balance: newToBalance.toFixed(2)   }, { transaction: t });

    // ── Create debit transaction (from bank) ──
    const debitTxn = await BankTransaction.create({
      bank_id:          fromBank.id,
      transaction_type: 'out',
      amount:           transferAmount.toFixed(2),
      description:      `Bank transfer to ${toBank.name}${description ? ' - ' + description : ''}`,
      reference_number: reference_number || null,
      balance_after:    newFromBalance.toFixed(2),
      created_by:       userId,
      transaction_date: txnDate
    }, { transaction: t });

    // ── Create credit transaction (to bank) ──
    const creditTxn = await BankTransaction.create({
      bank_id:          toBank.id,
      transaction_type: 'in',
      amount:           transferAmount.toFixed(2),
      description:      `Bank transfer from ${fromBank.name}${description ? ' - ' + description : ''}`,
      reference_number: reference_number || null,
      balance_after:    newToBalance.toFixed(2),
      created_by:       userId,
      transaction_date: txnDate
    }, { transaction: t });

    // ── Create transfer audit record ──
    const transfer = await BankTransfer.create({
      from_bank_id:         fromBank.id,
      to_bank_id:           toBank.id,
      amount:               transferAmount.toFixed(2),
      description:          description.trim(),
      reference_number:     reference_number ? reference_number.trim() : null,
      transfer_date:        txnDate,
      debit_transaction_id: debitTxn.id,
      credit_transaction_id: creditTxn.id,
      created_by:           userId
    }, { transaction: t });

    await t.commit();

    return res.status(201).json({
      success: true,
      message: `Rs ${transferAmount.toFixed(2)} transferred from ${fromBank.name} to ${toBank.name}`,
      data: {
        transfer_id: transfer.id,
        from_bank: { id: fromBank.id, name: fromBank.name, new_balance: newFromBalance.toFixed(2) },
        to_bank:   { id: toBank.id,   name: toBank.name,   new_balance: newToBalance.toFixed(2) },
        debit_transaction_id:  debitTxn.id,
        credit_transaction_id: creditTxn.id
      }
    });

  } catch (error) {
    await t.rollback();
    console.error('transferBetweenBanks error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ GET ALL TRANSFERS (filterable)
// ═══════════════════════════════════════════════════════════════════════════
exports.getAllTransfers = async (req, res) => {
  try {
    const {
      bank_id,        // filter by either from or to
      from_date,
      to_date,
      page  = 1,
      limit = 50
    } = req.query;

    const where = {};

    if (bank_id) {
      where[Op.or] = [
        { from_bank_id: parseInt(bank_id) },
        { to_bank_id:   parseInt(bank_id) }
      ];
    }

    if (from_date || to_date) {
      where.transfer_date = {};
      if (from_date) where.transfer_date[Op.gte] = new Date(from_date);
      if (to_date)   where.transfer_date[Op.lte] = new Date(to_date + 'T23:59:59');
    }

    const pageNum  = parseInt(page);
    const limitNum = parseInt(limit);

    const { count, rows } = await BankTransfer.findAndCountAll({
      where,
      include: [
        { model: Bank, as: 'fromBank', attributes: ['id', 'name', 'icon_path'] },
        { model: Bank, as: 'toBank',   attributes: ['id', 'name', 'icon_path'] },
        { model: User, as: 'creator',  attributes: ['id', 'name'], required: false }
      ],
      order: [['transfer_date', 'DESC'], ['id', 'DESC']],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum
    });

    const totalAmount = rows.reduce((s, r) => s + parseFloat(r.amount), 0);

    return res.json({
      success: true,
      data: {
        transfers: rows,
        summary: {
          total_transfers: count,
          total_amount: totalAmount.toFixed(2)
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
    console.error('getAllTransfers error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ REVERSE / DELETE A TRANSFER  (rolls back both transactions + balances)
// ═══════════════════════════════════════════════════════════════════════════
exports.reverseTransfer = async (req, res) => {
  const t = await Bank.sequelize.transaction();
  try {
    const { id } = req.params;

    const transfer = await BankTransfer.findByPk(id, {
      include: [
        { model: Bank, as: 'fromBank' },
        { model: Bank, as: 'toBank'   }
      ],
      transaction: t
    });

    if (!transfer) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Transfer not found' });
    }

    const amount     = parseFloat(transfer.amount);
    const fromBank   = transfer.fromBank;
    const toBank     = transfer.toBank;

    // Ensure the to-bank has enough to reverse
    if (parseFloat(toBank.balance) < amount) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot reverse: ${toBank.name} has insufficient balance (Rs ${parseFloat(toBank.balance).toFixed(2)})`
      });
    }

    // Reverse balances
    await fromBank.update({ balance: (parseFloat(fromBank.balance) + amount).toFixed(2) }, { transaction: t });
    await toBank.update(  { balance: (parseFloat(toBank.balance)   - amount).toFixed(2) }, { transaction: t });

    // Delete the two linked bank transactions
    if (transfer.debit_transaction_id) {
      await BankTransaction.destroy({ where: { id: transfer.debit_transaction_id  }, transaction: t });
    }
    if (transfer.credit_transaction_id) {
      await BankTransaction.destroy({ where: { id: transfer.credit_transaction_id }, transaction: t });
    }

    await transfer.destroy({ transaction: t });
    await t.commit();

    return res.json({
      success: true,
      message: 'Transfer reversed and bank balances restored',
      data: {
        from_bank: { id: fromBank.id, name: fromBank.name, balance: (parseFloat(fromBank.balance) + amount).toFixed(2) },
        to_bank:   { id: toBank.id,   name: toBank.name,   balance: (parseFloat(toBank.balance) - amount).toFixed(2) }
      }
    });

  } catch (error) {
    await t.rollback();
    console.error('reverseTransfer error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};