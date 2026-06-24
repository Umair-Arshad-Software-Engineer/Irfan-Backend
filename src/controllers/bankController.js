// src/controllers/bankController.js
const { Op } = require('sequelize');
const { Bank, BankTransaction } = require('../models');

// Get all banks with pagination and search
exports.getAllBanks = async (req, res) => {
  try {
    const { search, page = 1, limit = 50, active } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { account_number: { [Op.like]: `%${search}%` } },
        { iban: { [Op.like]: `%${search}%` } }
      ];
    }

    if (active !== undefined) {
      whereClause.is_active = active === 'true';
    }

    const { count, rows: banks } = await Bank.findAndCountAll({
      where: whereClause,
      attributes: ['id', 'name', 'icon_path', 'balance', 'is_active', 'account_number', 
                   'branch_code', 'swift_code', 'iban', 'createdAt', 'updatedAt'],
      order: [['name', 'ASC']],
      limit: limitNum,
      offset: offset
    });

    res.json({
      success: true,
      data: banks,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    console.error('Get banks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get active banks (for dropdowns)
exports.getActiveBanks = async (req, res) => {
  try {
    const banks = await Bank.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'icon_path', 'balance', 'account_number'],
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      data: banks
    });
  } catch (error) {
    console.error('Get active banks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get single bank by ID
exports.getBankById = async (req, res) => {
  try {
    const { id } = req.params;

    const bank = await Bank.findByPk(id, {
      attributes: ['id', 'name', 'icon_path', 'balance', 'is_active', 'account_number', 
                   'branch_code', 'swift_code', 'iban', 'opening_balance', 'notes', 
                   'createdAt', 'updatedAt']
    });

    if (!bank) {
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    res.json({
      success: true,
      data: bank
    });
  } catch (error) {
    console.error('Get bank error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Create new bank
exports.createBank = async (req, res) => {
  const transaction = await Bank.sequelize.transaction();
  
  try {
    const { 
      name, 
      icon_path, 
      account_number, 
      branch_code, 
      swift_code, 
      iban, 
      opening_balance,
      notes 
    } = req.body;
    
    const userId = req.user?.id;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Bank name is required'
      });
    }

    // Check if bank already exists
    const existingBank = await Bank.findOne({
      where: { name },
      transaction
    });

    if (existingBank) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Bank with this name already exists'
      });
    }

    const openingBalanceAmount = parseFloat(opening_balance || 0);
    
    const bank = await Bank.create({
      name,
      icon_path: icon_path || 'asset/bank_icons/default.png',
      account_number: account_number || null,
      branch_code: branch_code || null,
      swift_code: swift_code || null,
      iban: iban || null,
      opening_balance: openingBalanceAmount,
      balance: openingBalanceAmount,
      notes: notes || null,
      is_active: true,
      created_by: userId
    }, { transaction });

    // Create initial transaction record for opening balance if positive
    if (openingBalanceAmount > 0) {
      await BankTransaction.create({
        bank_id: bank.id,
        transaction_type: 'in',
        amount: openingBalanceAmount,
        description: 'Opening balance',
        reference_number: 'OPENING',
        balance_after: openingBalanceAmount,
        created_by: userId,
        transaction_date: new Date()
      }, { transaction });
    }

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: 'Bank created successfully',
      data: bank
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Create bank error:', error);
    
    if (error.name === 'SequelizeValidationError') {
      const messages = error.errors.map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Update bank
exports.updateBank = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      icon_path, 
      account_number, 
      branch_code, 
      swift_code, 
      iban, 
      is_active,
      notes 
    } = req.body;

    const bank = await Bank.findByPk(id);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    // Check if new name already exists (excluding current bank)
    if (name && name !== bank.name) {
      const existingBank = await Bank.findOne({
        where: {
          name,
          id: { [Op.ne]: id }
        }
      });

      if (existingBank) {
        return res.status(400).json({
          success: false,
          message: 'Bank with this name already exists'
        });
      }
    }

    await bank.update({
      name: name || bank.name,
      icon_path: icon_path || bank.icon_path,
      account_number: account_number !== undefined ? account_number : bank.account_number,
      branch_code: branch_code !== undefined ? branch_code : bank.branch_code,
      swift_code: swift_code !== undefined ? swift_code : bank.swift_code,
      iban: iban !== undefined ? iban : bank.iban,
      is_active: is_active !== undefined ? is_active : bank.is_active,
      notes: notes !== undefined ? notes : bank.notes
    });

    const updatedBank = await Bank.findByPk(id, {
      attributes: ['id', 'name', 'icon_path', 'balance', 'is_active', 'account_number', 
                   'branch_code', 'swift_code', 'iban', 'notes', 'createdAt', 'updatedAt']
    });

    res.json({
      success: true,
      message: 'Bank updated successfully',
      data: updatedBank
    });
  } catch (error) {
    console.error('Update bank error:', error);
    
    if (error.name === 'SequelizeValidationError') {
      const messages = error.errors.map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Delete bank
exports.deleteBank = async (req, res) => {
  try {
    const { id } = req.params;

    const bank = await Bank.findByPk(id);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    // Check if bank has balance
    if (parseFloat(bank.balance) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete bank with positive balance. Please withdraw all funds first.'
      });
    }

    await bank.destroy();

    res.json({
      success: true,
      message: 'Bank deleted successfully'
    });
  } catch (error) {
    console.error('Delete bank error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Toggle bank status
exports.toggleBankStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const bank = await Bank.findByPk(id);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    await bank.update({
      is_active: !bank.is_active
    });

    res.json({
      success: true,
      message: `Bank ${bank.is_active ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: bank.id,
        name: bank.name,
        is_active: bank.is_active
      }
    });
  } catch (error) {
    console.error('Toggle bank status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get bank summary (total balance across all banks)
exports.getBankSummary = async (req, res) => {
  try {
    const banks = await Bank.findAll({
      attributes: ['id', 'name', 'balance', 'icon_path'],
      where: { is_active: true }
    });

    const totalBalance = banks.reduce((sum, bank) => sum + parseFloat(bank.balance), 0);
    const activeBanks = banks.filter(b => parseFloat(b.balance) > 0).length;

    res.json({
      success: true,
      data: {
        total_balance: totalBalance,
        total_banks: banks.length,
        active_banks: activeBanks,
        banks: banks
      }
    });
  } catch (error) {
    console.error('Get bank summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Initialize default banks from pakistani banks list
exports.initializeDefaultBanks = async (req, res) => {
  try {
    const defaultBanks = [
      { name: 'Allied Bank', icon_path: 'asset/bank_icons/allied_bank.png' },
      { name: 'Habib Bank Limited (HBL)', icon_path: 'asset/bank_icons/hbl.png' },
      { name: 'United Bank Limited (UBL)', icon_path: 'asset/bank_icons/ubl.png' },
      { name: 'MCB Bank', icon_path: 'asset/bank_icons/mcb.png' },
      { name: 'Bank Alfalah', icon_path: 'asset/bank_icons/bank_alfalah.png' },
      { name: 'Meezan Bank', icon_path: 'asset/bank_icons/meezan_bank.png' },
      { name: 'National Bank of Pakistan (NBP)', icon_path: 'asset/bank_icons/nbp.png' },
      { name: 'Askari Bank', icon_path: 'asset/bank_icons/askari_bank.png' },
      { name: 'Faysal Bank', icon_path: 'asset/bank_icons/faysal_bank.png' },
      { name: 'Standard Chartered Bank', icon_path: 'asset/bank_icons/standard_chartered.png' },
      { name: 'Bank Of Punjab', icon_path: 'asset/bank_icons/bop.png' },
      { name: 'Bank Al-Habib Limited (BAHL)', icon_path: 'asset/bank_icons/bahl.png' },
      { name: 'JazzCash', icon_path: 'asset/bank_icons/jazzcash.png' },
      { name: 'EasyPaisa', icon_path: 'asset/bank_icons/easypaisa.png' },
      { name: 'NayaPay', icon_path: 'asset/bank_icons/nayapay.jpeg' },
      { name: 'SadaPay', icon_path: 'asset/bank_icons/sadapay.jpeg' },
      { name: 'Khaibar Bank', icon_path: 'asset/bank_icons/khaibar.jpg' },
      { name: 'JS Bank', icon_path: 'asset/bank_icons/js.png' },
      { name: 'Habib MetroPolitan', icon_path: 'asset/bank_icons/hbmp.png' },
      { name: 'Silk Bank', icon_path: 'asset/bank_icons/silk.jpeg' },
      { name: 'Soneri Bank', icon_path: 'asset/bank_icons/soneri.jpg' },
      { name: 'Bank Islami', icon_path: 'asset/bank_icons/bank_islamic.jpg' },
      { name: 'Al Barka', icon_path: 'asset/bank_icons/al_barka.png' },
      { name: 'Dubai Islamic', icon_path: 'asset/bank_icons/dubai_islamic.jpg' }
    ];

    let created = 0;
    let skipped = 0;

    for (const bankData of defaultBanks) {
      const existing = await Bank.findOne({ where: { name: bankData.name } });
      if (!existing) {
        await Bank.create({
          ...bankData,
          balance: 0,
          opening_balance: 0,
          is_active: true,
          created_by: req.user?.id
        });
        created++;
      } else {
        skipped++;
      }
    }

    res.json({
      success: true,
      message: `Default banks initialized: ${created} created, ${skipped} already exist`,
      data: { created, skipped }
    });
  } catch (error) {
    console.error('Initialize banks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Transfer between banks
exports.transferBetweenBanks = async (req, res) => {
  const transaction = await Bank.sequelize.transaction();
  
  try {
    const { from_bank_id, to_bank_id, amount, description, reference_number } = req.body;
    const userId = req.user?.id;

    // Validate required fields
    if (!from_bank_id || !to_bank_id || !amount || !description) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    if (from_bank_id === to_bank_id) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer to the same bank'
      });
    }

    const fromBank = await Bank.findByPk(from_bank_id, { transaction });
    const toBank = await Bank.findByPk(to_bank_id, { transaction });

    if (!fromBank || !toBank) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    if (parseFloat(fromBank.balance) < amount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance in source bank'
      });
    }

    // Update balances
    const newFromBalance = parseFloat(fromBank.balance) - amount;
    const newToBalance = parseFloat(toBank.balance) + amount;

    await fromBank.update({ balance: newFromBalance }, { transaction });
    await toBank.update({ balance: newToBalance }, { transaction });

    // Create withdrawal transaction
    await BankTransaction.create({
      bank_id: from_bank_id,
      transaction_type: 'out',
      amount: amount,
      description: `Transfer to ${toBank.name}: ${description}`,
      reference_number: reference_number || null,
      balance_after: newFromBalance,
      created_by: userId,
      transaction_date: new Date()
    }, { transaction });

    // Create deposit transaction
    await BankTransaction.create({
      bank_id: to_bank_id,
      transaction_type: 'in',
      amount: amount,
      description: `Transfer from ${fromBank.name}: ${description}`,
      reference_number: reference_number || null,
      balance_after: newToBalance,
      created_by: userId,
      transaction_date: new Date()
    }, { transaction });

    await transaction.commit();

    res.json({
      success: true,
      message: 'Transfer completed successfully',
      data: {
        from_bank: {
          id: fromBank.id,
          name: fromBank.name,
          balance: newFromBalance
        },
        to_bank: {
          id: toBank.id,
          name: toBank.name,
          balance: newToBalance
        },
        amount: amount
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Transfer error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};