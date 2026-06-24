// src/controllers/bankTransactionController.js
const { Op } = require('sequelize');
const { Bank, BankTransaction, User } = require('../models');
const sequelize = require('sequelize');

// ═══════════════════════════════════════════════════════════════════════════
// ✅ ADD TRANSACTION TO BANK (deposit or withdraw)
// ═══════════════════════════════════════════════════════════════════════════
exports.addTransaction = async (req, res) => {
  const transaction = await Bank.sequelize.transaction();
  
  try {
    const { bank_id } = req.params;
    const { transaction_type, amount, description, reference_number, transaction_date } = req.body;
    const userId = req.user?.id;

    // ── Validate required fields ──
    if (!transaction_type || !amount || !description) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Transaction type, amount, and description are required'
      });
    }

    // ── Validate transaction type ──
    if (!['in', 'out'].includes(transaction_type)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Transaction type must be "in" or "out"'
      });
    }

    // ── Get bank ──
    const bank = await Bank.findByPk(bank_id, { transaction });
    if (!bank) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    // ── Validate sufficient balance for withdrawal ──
    const currentBalance = parseFloat(bank.balance);
    const transactionAmount = parseFloat(amount);

    if (transaction_type === 'out' && currentBalance < transactionAmount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: Rs ${currentBalance.toFixed(2)}, Required: Rs ${transactionAmount.toFixed(2)}`
      });
    }

    // ── Calculate new balance ──
    const newBalance = transaction_type === 'in' 
      ? currentBalance + transactionAmount
      : currentBalance - transactionAmount;

    // ── Update bank balance ──
    await bank.update({ balance: newBalance.toFixed(2) }, { transaction });

    // ── Create transaction record ──
    const bankTransaction = await BankTransaction.create({
      bank_id: parseInt(bank_id),
      transaction_type,
      amount: transactionAmount.toFixed(2),
      description: description.trim(),
      reference_number: reference_number ? reference_number.trim() : null,
      balance_after: newBalance.toFixed(2),
      created_by: userId,
      transaction_date: transaction_date ? new Date(transaction_date) : new Date()
    }, { transaction });

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: `Money ${transaction_type === 'in' ? 'added to' : 'withdrawn from'} bank successfully`,
      data: {
        transaction: bankTransaction,
        bank: {
          id: bank.id,
          name: bank.name,
          balance: newBalance.toFixed(2)
        }
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Add transaction error:', error);
    
    if (error.name === 'SequelizeValidationError') {
      const messages = error.errors.map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// ✅ RECORD BANK PAYMENT OUT (for supplier payments)
// ═══════════════════════════════════════════════════════════════════════════
exports.recordBankPaymentOut = async (req, res) => {
  const transaction = await Bank.sequelize.transaction();
  
  try {
    const { bank_id, amount, description, reference_number, transaction_date } = req.body;
    const userId = req.user?.id;

    // ── Validate required fields ──
    if (!bank_id || !amount || !description) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Bank ID, amount, and description are required'
      });
    }

    // ── Get bank ──
    const bank = await Bank.findByPk(bank_id, { transaction });
    if (!bank) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    // ── Check sufficient balance ──
    const currentBalance = parseFloat(bank.balance);
    const paymentAmount = parseFloat(amount);

    if (currentBalance < paymentAmount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance in ${bank.name}. Available: Rs ${currentBalance.toFixed(2)}`
      });
    }

    // ── Calculate new balance ──
    const newBalance = currentBalance - paymentAmount;

    // ── Update bank balance ──
    await bank.update({ balance: newBalance.toFixed(2) }, { transaction });

    // ── Create withdrawal transaction ──
    const bankTransaction = await BankTransaction.create({
      bank_id: parseInt(bank_id),
      transaction_type: 'out',
      amount: paymentAmount.toFixed(2),
      description: description.trim(),
      reference_number: reference_number ? reference_number.trim() : null,
      balance_after: newBalance.toFixed(2),
      created_by: userId,
      transaction_date: transaction_date ? new Date(transaction_date) : new Date()
    }, { transaction });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: 'Bank payment recorded successfully',
      data: {
        transaction: bankTransaction,
        bank: {
          id: bank.id,
          name: bank.name,
          balance: newBalance.toFixed(2)
        }
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Record bank payment out error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// ✅ GET ALL TRANSACTIONS FOR A BANK
// ═══════════════════════════════════════════════════════════════════════════
exports.getBankTransactions = async (req, res) => {
  try {
    const { bank_id } = req.params;
    const { page = 1, limit = 50, type, from_date, to_date } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // ── Check if bank exists ──
    const bank = await Bank.findByPk(bank_id);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    // ── Build where clause ──
    const whereClause = { bank_id: parseInt(bank_id) };

    if (type && ['in', 'out'].includes(type)) {
      whereClause.transaction_type = type;
    }

    if (from_date || to_date) {
      whereClause.transaction_date = {};
      if (from_date) {
        whereClause.transaction_date[Op.gte] = new Date(from_date);
      }
      if (to_date) {
        whereClause.transaction_date[Op.lte] = new Date(to_date + 'T23:59:59');
      }
    }

    const { count, rows: transactions } = await BankTransaction.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name'],
          required: false
        }
      ],
      order: [['transaction_date', 'DESC']],
      limit: limitNum,
      offset: offset
    });

    return res.json({
      success: true,
      data: {
        bank: {
          id: bank.id,
          name: bank.name,
          balance: bank.balance,
          icon_path: bank.icon_path
        },
        transactions,
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(count / limitNum)
        }
      }
    });

  } catch (error) {
    console.error('Get bank transactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// ✅ GET TRANSACTION SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
exports.getTransactionSummary = async (req, res) => {
  try {
    const { bank_id } = req.params;
    const { period = 'month' } = req.query; // day, month, year

    let groupFormat;
    let dateRange;

    switch (period) {
      case 'day':
        groupFormat = '%Y-%m-%d';
        dateRange = {
          [Op.gte]: new Date(new Date().setDate(new Date().getDate() - 30))
        };
        break;
      case 'year':
        groupFormat = '%Y';
        dateRange = {
          [Op.gte]: new Date(new Date().setFullYear(new Date().getFullYear() - 5))
        };
        break;
      default: // month
        groupFormat = '%Y-%m';
        dateRange = {
          [Op.gte]: new Date(new Date().setMonth(new Date().getMonth() - 12))
        };
    }

    const summary = await BankTransaction.findAll({
      where: {
        bank_id: parseInt(bank_id),
        transaction_date: dateRange
      },
      attributes: [
        [sequelize.fn('DATE_FORMAT', sequelize.col('transaction_date'), groupFormat), 'period'],
        [sequelize.fn('SUM', sequelize.literal(`CASE WHEN transaction_type = 'in' THEN amount ELSE 0 END`)), 'total_in'],
        [sequelize.fn('SUM', sequelize.literal(`CASE WHEN transaction_type = 'out' THEN amount ELSE 0 END`)), 'total_out'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'transaction_count']
      ],
      group: [sequelize.fn('DATE_FORMAT', sequelize.col('transaction_date'), groupFormat)],
      order: [[sequelize.fn('DATE_FORMAT', sequelize.col('transaction_date'), groupFormat), 'ASC']]
    });

    return res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('Get transaction summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// ✅ DELETE TRANSACTION (reverse it)
// ═══════════════════════════════════════════════════════════════════════════
exports.deleteTransaction = async (req, res) => {
  const transaction = await Bank.sequelize.transaction();
  
  try {
    const { bank_id, transaction_id } = req.params;

    // ── Get the transaction ──
    const bankTransaction = await BankTransaction.findByPk(transaction_id, { transaction });
    if (!bankTransaction) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // ── Verify transaction belongs to bank ──
    if (bankTransaction.bank_id !== parseInt(bank_id)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Transaction does not belong to this bank'
      });
    }

    // ── Get bank ──
    const bank = await Bank.findByPk(bank_id, { transaction });
    if (!bank) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    // ── Reverse the transaction effect ──
    const currentBalance = parseFloat(bank.balance);
    const txnAmount = parseFloat(bankTransaction.amount);
    
    const reversedBalance = bankTransaction.transaction_type === 'in'
      ? currentBalance - txnAmount
      : currentBalance + txnAmount;

    await bank.update({ balance: reversedBalance.toFixed(2) }, { transaction });

    // ── Delete the transaction ──
    await bankTransaction.destroy({ transaction });

    await transaction.commit();

    return res.json({
      success: true,
      message: 'Transaction deleted and balance reversed successfully',
      data: {
        bank: {
          id: bank.id,
          name: bank.name,
          balance: reversedBalance.toFixed(2)
        }
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Delete transaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};