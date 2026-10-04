// backend/src/controllers/customerController.js
const { Op } = require('sequelize');
const sequelize = require('../config/db'); // ✅ FIX: was missing → "sequelize is not defined" in recalculateAllBalances
const { Customer, CustomerLedger, Sale, Cheque } = require('../models');

// ─────────────────────────────────────────────
//  GET ALL CUSTOMERS  (paginated + search)
//  Also returns each customer's last payment
//  (amount, method, bank_name, date).
// ─────────────────────────────────────────────
exports.getAllCustomers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20, active, customer_type } = req.query;
    const pageNum  = parseInt(page);
    const limitNum = parseInt(limit);
    const offset   = (pageNum - 1) * limitNum;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { name:    { [Op.like]: `%${search}%` } },
        { contact: { [Op.like]: `%${search}%` } },
        { address: { [Op.like]: `%${search}%` } },
        { email:   { [Op.like]: `%${search}%` } },
      ];
    }

    if (active !== undefined) whereClause.is_active     = active === 'true';
    if (customer_type)         whereClause.customer_type = customer_type;

    const { count, rows: customers } = await Customer.findAndCountAll({
      where: whereClause,
      attributes: [
        'id', 'name', 'contact', 'address', 'email',
        'customer_type', 'balance', 'discount_percent',
        'is_active', 'createdAt', 'updatedAt',
      ],
      order: [['name', 'ASC']],
      limit: limitNum,
      offset,
      distinct: true,
    });

    const customersWithUpdatedBalances = await Promise.all(
      customers.map(async (customer) => {
        // Get all ledger entries for this customer (excluding uncleared cheques)
        const entries = await CustomerLedger.findAll({
          where: {
            customer_id: customer.id,
            [Op.or]: [
              { payment_method: { [Op.ne]: 'cheque' } },
              { payment_method: 'cheque', cheque_cleared: true },
              { payment_method: null },
            ]
          },
          attributes: ['debit', 'credit'],
        });

        // Balance = credit - debit (credit = sales, debit = payments)
        const totalCredit = entries.reduce((sum, e) => sum + parseFloat(e.credit), 0);
        const totalDebit = entries.reduce((sum, e) => sum + parseFloat(e.debit), 0);
        const calculatedBalance = totalCredit - totalDebit;

        if (Math.abs(calculatedBalance - parseFloat(customer.balance)) > 0.01) {
          await customer.update({ balance: calculatedBalance });
        }

        // Most recent payment entry for this customer
        const lastPaymentEntry = await CustomerLedger.findOne({
          where: {
            customer_id: customer.id,
            transaction_type: 'payment',
          },
          order: [['date', 'DESC'], ['id', 'DESC']],
          attributes: [
            'id', 'debit', 'date', 'payment_method',
            'bank_name', 'cheque_number', 'reference_number', 'description',
          ],
        });

        const lastPayment = lastPaymentEntry
          ? {
              id: lastPaymentEntry.id,
              amount: parseFloat(lastPaymentEntry.debit),
              date: lastPaymentEntry.date,
              method: lastPaymentEntry.payment_method,
              bank_name: lastPaymentEntry.bank_name,
              cheque_number: lastPaymentEntry.cheque_number,
              reference_number: lastPaymentEntry.reference_number,
              description: lastPaymentEntry.description,
            }
          : null;

        return {
          ...customer.toJSON(),
          balance: parseFloat(calculatedBalance.toFixed(2)),
          last_payment: lastPayment,
        };
      })
    );

    res.json({
      success: true,
      data: customersWithUpdatedBalances,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum),
      },
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  GET ACTIVE CUSTOMERS  (for dropdowns)
// ─────────────────────────────────────────────
exports.getActiveCustomers = async (req, res) => {
  try {
    const customers = await Customer.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'contact', 'email', 'discount_percent'],
      order: [['name', 'ASC']],
    });

    res.json({ success: true, data: customers });
  } catch (error) {
    console.error('Get active customers error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  GET CUSTOMER BY ID
// ─────────────────────────────────────────────
exports.getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findByPk(id, {
      attributes: [
        'id', 'name', 'contact', 'address', 'email',
        'customer_type', 'balance', 'discount_percent',
        'is_active', 'createdAt', 'updatedAt',
      ],
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  CREATE CUSTOMER
// ─────────────────────────────────────────────
exports.createCustomer = async (req, res) => {
  try {
    const { name, contact, address, email, customer_type, balance, discount_percent } = req.body;

    if (!name || !contact) {
      return res.status(400).json({ success: false, message: 'Customer name and contact are required' });
    }

    const existingCustomer = await Customer.findOne({ where: { contact } });
    if (existingCustomer) {
      return res.status(400).json({ success: false, message: 'Customer with this contact already exists' });
    }

    const parsedDiscount = parseFloat(discount_percent) || 0;
    if (parsedDiscount < 0 || parsedDiscount > 100) {
      return res.status(400).json({ success: false, message: 'Discount percent must be between 0 and 100' });
    }

    const customer = await Customer.create({
      name,
      contact,
      address:          address  === '' ? null : address  || null,
      email:            email    === '' ? null : email    || null,
      customer_type:    customer_type || 'regular',
      balance:          balance  || 0.00,
      discount_percent: parsedDiscount,
      is_active: true,
    });

    res.status(201).json({ success: true, message: 'Customer created successfully', data: customer });
  } catch (error) {
    console.error('Create customer error:', error);

    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors.map((e) => e.message),
      });
    }

    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  UPDATE CUSTOMER
// ─────────────────────────────────────────────
exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, contact, address, email, customer_type, balance, is_active, discount_percent } = req.body;

    const customer = await Customer.findByPk(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (contact && contact !== customer.contact) {
      const existing = await Customer.findOne({
        where: { contact, id: { [Op.ne]: id } },
      });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Customer with this contact already exists' });
      }
    }

    let parsedDiscount = customer.discount_percent;
    if (discount_percent !== undefined) {
      parsedDiscount = parseFloat(discount_percent) || 0;
      if (parsedDiscount < 0 || parsedDiscount > 100) {
        return res.status(400).json({ success: false, message: 'Discount percent must be between 0 and 100' });
      }
    }

    await customer.update({
      name:             name             || customer.name,
      contact:          contact          || customer.contact,
      address:          address !== undefined ? (address === '' ? null : address) : customer.address,
      email:            email   !== undefined ? (email   === '' ? null : email)   : customer.email,
      customer_type:    customer_type    || customer.customer_type,
      balance:          balance !== undefined ? balance : customer.balance,
      is_active:        is_active !== undefined ? is_active : customer.is_active,
      discount_percent: parsedDiscount,
    });

    const updatedCustomer = await Customer.findByPk(id, {
      attributes: [
        'id', 'name', 'contact', 'address', 'email',
        'customer_type', 'balance', 'discount_percent',
        'is_active', 'createdAt', 'updatedAt',
      ],
    });

    res.json({ success: true, message: 'Customer updated successfully', data: updatedCustomer });
  } catch (error) {
    console.error('Update customer error:', error);

    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors.map((e) => e.message),
      });
    }

    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  DELETE CUSTOMER
// ─────────────────────────────────────────────
exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findByPk(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const [ledgerCount, saleCount, chequeCount] = await Promise.all([
      CustomerLedger.count({ where: { customer_id: id } }),
      Sale.count({ where: { customer_id: id } }),
      Cheque.count({ where: { customer_id: id } }),
    ]);

    if (ledgerCount > 0 || saleCount > 0 || chequeCount > 0) {
      return res.status(400).json({
        success: false,
        message:
          'This customer has existing transactions (ledger entries, sales, or cheques) and cannot be deleted. ' +
          'Please deactivate the customer instead to preserve their history.',
        data: {
          ledger_entries: ledgerCount,
          sales: saleCount,
          cheques: chequeCount,
        },
      });
    }

    await customer.destroy();
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Delete customer error:', error);

    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({
        success: false,
        message:
          'This customer is linked to other records and cannot be deleted. ' +
          'Please deactivate the customer instead.',
      });
    }

    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  TOGGLE STATUS
// ─────────────────────────────────────────────
exports.toggleCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findByPk(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    await customer.update({ is_active: !customer.is_active });

    res.json({
      success: true,
      message: `Customer ${customer.is_active ? 'activated' : 'deactivated'} successfully`,
      data: { id: customer.id, name: customer.name, is_active: customer.is_active },
    });
  } catch (error) {
    console.error('Toggle customer status error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  UPDATE BALANCE
// ─────────────────────────────────────────────
exports.updateCustomerBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, operation } = req.body;

    if (!amount || !operation || !['add', 'subtract'].includes(operation)) {
      return res.status(400).json({
        success: false,
        message: 'Amount and valid operation (add/subtract) are required',
      });
    }

    const customer = await Customer.findByPk(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const newBalance = operation === 'add'
      ? parseFloat(customer.balance) + parseFloat(amount)
      : parseFloat(customer.balance) - parseFloat(amount);

    await customer.update({ balance: newBalance });

    res.json({
      success: true,
      message: 'Customer balance updated successfully',
      data: { id: customer.id, name: customer.name, old_balance: customer.balance, new_balance: newBalance },
    });
  } catch (error) {
    console.error('Update customer balance error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.recalculateAllBalances = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const customers = await Customer.findAll({ transaction: t });

    let updatedCount = 0;

    for (const customer of customers) {
      const entries = await CustomerLedger.findAll({
        where: {
          customer_id: customer.id,
          [Op.or]: [
            { payment_method: { [Op.ne]: 'cheque' } },
            { payment_method: 'cheque', cheque_cleared: true },
            { payment_method: null },
          ]
        },
        attributes: ['debit', 'credit'],
        transaction: t,
      });

      const totalCredit = entries.reduce((sum, e) => sum + parseFloat(e.credit), 0);
      const totalDebit = entries.reduce((sum, e) => sum + parseFloat(e.debit), 0);
      const calculatedBalance = parseFloat((totalCredit - totalDebit).toFixed(2));

      if (Math.abs(calculatedBalance - parseFloat(customer.balance)) > 0.01) {
        await customer.update({ balance: calculatedBalance }, { transaction: t });
        updatedCount++;
      }
    }

    await t.commit();

    res.json({
      success: true,
      message: `Recalculated balances for ${updatedCount} customers`,
      data: { updated_count: updatedCount },
    });
  } catch (error) {
    await t.rollback();
    console.error('Recalculate balances error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};