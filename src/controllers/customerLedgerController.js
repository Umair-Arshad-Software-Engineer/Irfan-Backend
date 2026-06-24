// backend/src/controllers/customerLedgerController.js
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { CustomerLedger, Customer } = require('../models');

// ─────────────────────────────────────────────
//  LEDGER CONVENTION:
//    credit = sale amount  → increases balance (customer owes more)
//    debit  = payment      → decreases balance (customer pays off)
//    balance formula: currentBalance + credit - debit
// ─────────────────────────────────────────────

// ── Helper: recalculate ALL balances for a customer in correct order ─────────
const recalculateBalances = async (customer_id, transaction) => {
  const allEntries = await CustomerLedger.findAll({
    where: { customer_id },
    order: [['date', 'ASC'], ['id', 'ASC']],
    transaction,
  });

  let runningBalance = 0;
  for (const entry of allEntries) {
    runningBalance += parseFloat(entry.credit) - parseFloat(entry.debit);
    await entry.update({ balance: runningBalance.toFixed(2) }, { transaction });
  }
  
  return runningBalance;
};

// ── Helper: create entry then recalculate all balances ──────────────────────
const createLedgerEntry = async ({
  customer_id,
  transaction_type,
  reference_id,
  reference_number,
  debit = 0,
  credit = 0,
  description,
  transaction_date,
  created_by,
  payment_method,
  bank_name,
  bank_id,
  cheque_number,
  cheque_date,
  cheque_cleared = false,
  cheque_cleared_date = null,
  transaction,
}) => {
  // Insert with a temporary balance of 0 — recalculate will fix it
  const entry = await CustomerLedger.create(
    {
      customer_id,
      transaction_type,
      reference_id,
      reference_number,
      debit: parseFloat(debit).toFixed(2),
      credit: parseFloat(credit).toFixed(2),
      balance: '0.00',
      description,
      date: transaction_date || new Date(),
      payment_method,
      bank_name,
      bank_id,
      cheque_number,
      cheque_date,
      cheque_cleared,
      cheque_cleared_date,
    },
    { transaction }
  );

  // Recalculate all balances in correct date+id order
  await recalculateBalances(customer_id, transaction);

  // Return the entry with its updated balance
  await entry.reload({ transaction });
  return entry;
};

// ─────────────────────────────────────────────
//  GET LEDGER ENTRIES FOR A CUSTOMER
// ─────────────────────────────────────────────
exports.getCustomerLedger = async (req, res) => {
  try {
    const { customerId } = req.params;
    const {
      page = 1,
      limit = 50,
      from_date,
      to_date,
      transaction_type,
      show_uncleared_cheques = 'false',
      sort_by = 'date',
      sort_order = 'asc',
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const customer = await Customer.findByPk(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Build where clause for filtered view
    const filteredWhere = { customer_id: customerId };
    
    if (from_date || to_date) {
      filteredWhere.date = {};
      if (from_date) filteredWhere.date[Op.gte] = from_date;
      if (to_date) filteredWhere.date[Op.lte] = to_date;
    }
    
    if (transaction_type) filteredWhere.transaction_type = transaction_type;

    // For cheque payments, optionally show uncleared cheques
    if (show_uncleared_cheques !== 'true') {
      filteredWhere[Op.or] = [
        { payment_method: { [Op.ne]: 'cheque' } },
        { payment_method: 'cheque', cheque_cleared: true },
        { payment_method: null },
      ];
    }

    // Sort order
    const allowedSortFields = ['date', 'id', 'created_at'];
    const safeSortBy = allowedSortFields.includes(sort_by) ? sort_by : 'date';
    let safeSortOrder = 'ASC';
    if (sort_order && typeof sort_order === 'string') {
      safeSortOrder = sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    }

    const ORDER = [[safeSortBy, safeSortOrder], ['id', safeSortOrder]];

    // Opening balance calculation
    let openingBalance = 0;
    if (from_date) {
      const openingWhere = { customer_id: customerId, date: { [Op.lt]: from_date } };
      if (show_uncleared_cheques !== 'true') {
        openingWhere[Op.or] = [
          { payment_method: { [Op.ne]: 'cheque' } },
          { payment_method: 'cheque', cheque_cleared: true },
          { payment_method: null },
        ];
      }
      
      const beforeEntries = await CustomerLedger.findAll({
        where: openingWhere,
        attributes: ['debit', 'credit'],
        raw: true,
      });
      openingBalance = beforeEntries.reduce(
        (sum, e) => sum + parseFloat(e.credit) - parseFloat(e.debit), 0
      );
    }

    // Fetch matching entries with pagination
    const { count, rows: entries } = await CustomerLedger.findAndCountAll({
      where: filteredWhere,
      order: ORDER,
      limit: limitNum,
      offset,
    });

    // Calculate running balances for paginated entries
    let runningBalance = openingBalance;
    const entriesWithBalance = entries.map((entry) => {
      runningBalance += parseFloat(entry.credit) - parseFloat(entry.debit);
      return {
        ...entry.toJSON(),
        balance: parseFloat(runningBalance.toFixed(2)),
      };
    });

    // Summary calculation
    let summaryWhere = { customer_id: customerId };
    if (show_uncleared_cheques !== 'true') {
      summaryWhere[Op.or] = [
        { payment_method: { [Op.ne]: 'cheque' } },
        { payment_method: 'cheque', cheque_cleared: true },
        { payment_method: null },
      ];
    }
    
    const allEntriesForSummary = await CustomerLedger.findAll({
      where: summaryWhere,
      attributes: ['debit', 'credit'],
    });
    
    const totalDebit = allEntriesForSummary.reduce((s, e) => s + parseFloat(e.debit), 0);
    const totalCredit = allEntriesForSummary.reduce((s, e) => s + parseFloat(e.credit), 0);
    const closingBalance = totalCredit - totalDebit;

    res.json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          contact: customer.contact,
          current_balance: parseFloat(customer.balance),
        },
        entries: entriesWithBalance,
        summary: {
          total_debit: parseFloat(totalDebit.toFixed(2)),
          total_credit: parseFloat(totalCredit.toFixed(2)),
          opening_balance: parseFloat(openingBalance.toFixed(2)),
          closing_balance: parseFloat(closingBalance.toFixed(2)),
        },
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(count / limitNum),
        },
        filters: {
          show_uncleared_cheques: show_uncleared_cheques === 'true',
        },
      },
    });
  } catch (error) {
    console.error('Get customer ledger error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  GET ALL CUSTOMERS LEDGER SUMMARY
// ─────────────────────────────────────────────
exports.getAllCustomersLedgerSummary = async (req, res) => {
  try {
    const customers = await Customer.findAll({
      where: { is_active: true },
    });

    const result = await Promise.all(
      customers.map(async (customer) => {
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
        
        const totalDebit = entries.reduce((s, e) => s + parseFloat(e.debit), 0);
        const totalCredit = entries.reduce((s, e) => s + parseFloat(e.credit), 0);
        
        return {
          ...customer.toJSON(),
          total_payments: parseFloat(totalDebit.toFixed(2)),
          total_purchases: parseFloat(totalCredit.toFixed(2)),
          outstanding_balance: parseFloat((totalCredit - totalDebit).toFixed(2)),
        };
      })
    );

    const totalOutstanding = result.reduce((sum, c) => sum + c.outstanding_balance, 0);

    res.json({
      success: true,
      data: {
        customers: result,
        summary: {
          total_customers: result.length,
          total_outstanding: parseFloat(totalOutstanding.toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error('Get all customers ledger summary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  ADD MANUAL LEDGER ADJUSTMENT
// ─────────────────────────────────────────────
exports.addAdjustment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { customerId } = req.params;
    const {
      date,
      description,
      debit = 0,
      credit = 0,
      reference_number,
      payment_method,
      bank_name,
      bank_id,
      cheque_number,
      cheque_date,
    } = req.body;

    if (!description) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Description is required' });
    }

    if (debit <= 0 && credit <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Either debit or credit amount must be greater than 0' });
    }

    const customer = await Customer.findByPk(customerId, { transaction: t });
    if (!customer) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Determine transaction type
    let transactionType = 'adjustment';
    if (payment_method) {
      transactionType = 'payment';
    }

    // Create adjustment entry with payment details if provided
    const entry = await createLedgerEntry({
      customer_id: customerId,
      transaction_type: transactionType,
      reference_number: reference_number || `ADJ-${Date.now()}`,
      debit: parseFloat(debit),
      credit: parseFloat(credit),
      description,
      transaction_date: date || new Date(),
      created_by: req.user?.id,
      payment_method,
      bank_name,
      bank_id,
      cheque_number,
      cheque_date,
      cheque_cleared: payment_method === 'cheque' ? false : null,
      transaction: t,
    });

    // Update customer balance
    const finalBalance = await CustomerLedger.findOne({
      where: { customer_id: customerId },
      order: [['date', 'DESC'], ['id', 'DESC']],
      transaction: t,
    });

    await Customer.update(
      { balance: finalBalance.balance },
      { where: { id: customerId }, transaction: t }
    );

    await t.commit();

    res.status(201).json({
      success: true,
      message: 'Adjustment added successfully',
      data: entry,
    });
  } catch (error) {
    await t.rollback();
    console.error('Add adjustment error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ─────────────────────────────────────────────
//  EXPORT HELPERS FOR OTHER CONTROLLERS
// ─────────────────────────────────────────────
module.exports.createLedgerEntry = createLedgerEntry;
module.exports.recalculateBalances = recalculateBalances;
module.exports.getCustomerLedger = exports.getCustomerLedger;
module.exports.getAllCustomersLedgerSummary = exports.getAllCustomersLedgerSummary;
module.exports.addAdjustment = exports.addAdjustment;
module.exports.getCustomerPayments = exports.getCustomerPayments;