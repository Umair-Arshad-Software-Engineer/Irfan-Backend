// backend/src/controllers/supplierLedgerController.js
const { Op } = require('sequelize');
const { SupplierLedger, Supplier, sequelize } = require('../models');

// ── Helper: recalculate ALL balances for a supplier in correct order ─────────
const recalculateBalances = async (supplier_id, transaction) => {
  const allEntries = await SupplierLedger.findAll({
    where: { supplier_id },
    order: [['transaction_date', 'ASC'], ['id', 'ASC']],
    transaction,
  });

  let runningBalance = 0;
  for (const entry of allEntries) {
    runningBalance += parseFloat(entry.credit) - parseFloat(entry.debit);
    await entry.update({ balance: runningBalance.toFixed(2) }, { transaction });
  }
};

// ── Helper: create entry then recalculate all balances ──────────────────────
const createLedgerEntry = async ({
  supplier_id,
  reference_type,
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
  const entry = await SupplierLedger.create(
    {
      supplier_id,
      reference_type,
      reference_id,
      reference_number,
      debit: parseFloat(debit).toFixed(2),
      credit: parseFloat(credit).toFixed(2),
      balance: '0.00',
      description,
      transaction_date: transaction_date || new Date(),
      created_by,
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

  await recalculateBalances(supplier_id, transaction);

  await entry.reload({ transaction });
  return entry;
};

// ── Reverse a ledger entry ──────────────────────────────────────────────────
const reverseLedgerEntry = async ({
  supplier_id,
  reference_type,
  reference_id,
  description,
  created_by,
  transaction,
}) => {
  const original = await SupplierLedger.findOne({
    where: { supplier_id, reference_type, reference_id },
    transaction,
  });

  if (!original) return null;

  const reversal = await createLedgerEntry({
    supplier_id,
    reference_type,
    reference_id: null,
    reference_number: `REV-${original.reference_number || original.id}`,
    debit: original.credit,
    credit: original.debit,
    description: description || `Reversal of ${original.description}`,
    transaction_date: new Date(),
    created_by,
    transaction,
  });

  return reversal;
};

// ── Shared "uncleared cheque" filter ────────────────────────────────────────
// A row is INCLUDED when its payment is real money movement:
//   - not a cheque at all, OR
//   - a cheque that is cleared, OR
//   - a legacy row (NULL payment_method, or cheque with NULL cheque_cleared)
const unclearedChequeExclusionClause = {
  [Op.or]: [
    { payment_method: { [Op.ne]: 'cheque' } },
    { payment_method: { [Op.is]: null } },
    {
      payment_method: 'cheque',
      [Op.or]: [
        { cheque_cleared: true },
        { cheque_cleared: { [Op.is]: null } },
      ],
    },
  ],
};

// ── GET: supplier ledger with filters & pagination ──────────────────────────
exports.getSupplierLedger = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const {
      page = 1,
      limit = 50,
      from_date,
      to_date,
      reference_type,
      show_uncleared_cheques = 'false',
      sort_by = 'transaction_date',
      sort_order = 'asc',
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const supplier = await Supplier.findByPk(supplierId);
    if (!supplier)
      return res.status(404).json({ success: false, message: 'Supplier not found' });

    const whereClause = { supplier_id: supplierId };

    if (from_date || to_date) {
      whereClause.transaction_date = {};
      if (from_date) whereClause.transaction_date[Op.gte] = new Date(from_date + 'T00:00:00.000Z');
      if (to_date) whereClause.transaction_date[Op.lte] = new Date(to_date + 'T23:59:59.999Z');
    }

    if (reference_type) whereClause.reference_type = reference_type;

    // Only show cleared cheques by default
    if (show_uncleared_cheques !== 'true') {
      whereClause[Op.and] = [unclearedChequeExclusionClause];
    }

    const allowedSortFields = ['transaction_date', 'id', 'created_at'];
    const safeSortBy = allowedSortFields.includes(sort_by) ? sort_by : 'transaction_date';

    let safeSortOrder = 'ASC';
    if (sort_order && typeof sort_order === 'string') {
      safeSortOrder = sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    }

    const { count, rows: entries } = await SupplierLedger.findAndCountAll({
      where: whereClause,
      order: [[safeSortBy, safeSortOrder], ['id', safeSortOrder]],
      limit: limitNum,
      offset,
    });

    // Summary — use the SAME filter as the main list so totals stay accurate
    let allEntries;
    if (show_uncleared_cheques !== 'true') {
      allEntries = await SupplierLedger.findAll({
        where: {
          supplier_id: supplierId,
          [Op.and]: [unclearedChequeExclusionClause],
        },
        attributes: ['debit', 'credit'],
      });
    } else {
      allEntries = await SupplierLedger.findAll({
        where: { supplier_id: supplierId },
        attributes: ['debit', 'credit'],
      });
    }

    const totalDebit = allEntries.reduce((s, e) => s + parseFloat(e.debit), 0);
    const totalCredit = allEntries.reduce((s, e) => s + parseFloat(e.credit), 0);
    const closingBalance = totalCredit - totalDebit;

    res.json({
      success: true,
      data: {
        supplier,
        entries,
        summary: {
          total_debit: parseFloat(totalDebit.toFixed(2)),
          total_credit: parseFloat(totalCredit.toFixed(2)),
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
    console.error('Get supplier ledger error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET: all suppliers with their outstanding balance ───────────────────────
exports.getAllSupplierBalances = async (req, res) => {
  try {
    const suppliers = await Supplier.findAll({ where: { is_active: true } });

    const result = await Promise.all(
      suppliers.map(async (supplier) => {
        const entries = await SupplierLedger.findAll({
          where: {
            supplier_id: supplier.id,
            [Op.and]: [unclearedChequeExclusionClause],
          },
          attributes: ['debit', 'credit'],
        });

        const totalDebit = entries.reduce((s, e) => s + parseFloat(e.debit), 0);
        const totalCredit = entries.reduce((s, e) => s + parseFloat(e.credit), 0);
        return {
          ...supplier.toJSON(),
          total_debit: parseFloat(totalDebit.toFixed(2)),
          total_credit: parseFloat(totalCredit.toFixed(2)),
          balance: parseFloat((totalCredit - totalDebit).toFixed(2)),
        };
      })
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get supplier balances error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── POST: manual ledger entry ──────────────────────────────────────────────
exports.createManualEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { supplierId } = req.params;
    const { debit, credit, description, transaction_date, reference_number } = req.body;

    const entry = await createLedgerEntry({
      supplier_id: supplierId,
      reference_type: 'manual',
      reference_number,
      debit: debit || 0,
      credit: credit || 0,
      description,
      transaction_date,
      created_by: req.user?.id,
      transaction: t,
    });

    await t.commit();
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── PUT: Update cheque cleared status ──────────────────────────────────────
exports.updateChequeClearedStatus = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { ledgerEntryId } = req.params;
    const { cheque_cleared, cheque_cleared_date } = req.body;

    const ledgerEntry = await SupplierLedger.findByPk(ledgerEntryId, { transaction: t });

    if (!ledgerEntry) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Ledger entry not found' });
    }

    if (ledgerEntry.payment_method !== 'cheque') {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'This entry is not a cheque payment' });
    }

    await ledgerEntry.update({
      cheque_cleared: cheque_cleared,
      cheque_cleared_date: cheque_cleared ? (cheque_cleared_date || new Date()) : null,
    }, { transaction: t });

    await recalculateBalances(ledgerEntry.supplier_id, t);

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

module.exports.createLedgerEntry = createLedgerEntry;
module.exports.reverseLedgerEntry = reverseLedgerEntry;
module.exports.recalculateBalances = recalculateBalances;