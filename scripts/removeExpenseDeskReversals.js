// backend/scripts/removeExpenseDeskReversals.js
//
// One-time cleanup for supplier ledgers.
//
// The old DELETE /expense-sessions/:sessionId/entries/:entryId did TWO things
// for a supplier payment: it deleted the original payment row AND added a
// "reversal" credit row. Each of those alone undoes the payment, so together
// they undid it twice — the supplier's balance went up by the payment amount
// one extra time for every deletion.
//
// This script deletes those leftover reversal rows and recalculates the
// running balances of every supplier it touched.
//
//   Preview (changes nothing):   node scripts/removeExpenseDeskReversals.js
//   Apply:                       node scripts/removeExpenseDeskReversals.js --apply
//
// Take a database backup before running with --apply.

'use strict';

const { Op } = require('sequelize');
const { SupplierLedger, Supplier, sequelize } = require('../src/models');
const { recalcSupplier } = require('../src/services/supplierPaymentCleanup');

const APPLY = process.argv.includes('--apply');

(async () => {
  const rows = await SupplierLedger.findAll({
    where: {
      reference_type: 'reversal',
      description: { [Op.like]: 'Reversal of expense-desk payment:%' },
    },
    order: [['supplier_id', 'ASC'], ['id', 'ASC']],
  });

  if (rows.length === 0) {
    console.log('No expense-desk reversal rows found. Nothing to do.');
    await sequelize.close();
    return;
  }

  const bySupplier = new Map();
  for (const r of rows) {
    if (!bySupplier.has(r.supplier_id)) bySupplier.set(r.supplier_id, []);
    bySupplier.get(r.supplier_id).push(r);
  }

  console.log(`Found ${rows.length} reversal row(s) across ${bySupplier.size} supplier(s):\n`);
  for (const [supplierId, list] of bySupplier) {
    const supplier = await Supplier.findByPk(supplierId);
    const total = list.reduce((s, r) => s + parseFloat(r.credit || 0), 0);
    console.log(`  Supplier #${supplierId} ${supplier ? supplier.name : '(deleted)'} — ${list.length} row(s), Rs ${total.toFixed(2)}`);
    for (const r of list) {
      console.log(`     id ${r.id}  credit Rs ${parseFloat(r.credit).toFixed(2)}  ${r.transaction_date?.toISOString?.() ?? r.transaction_date}`);
    }
  }

  if (!APPLY) {
    console.log('\nPreview only. Run again with --apply to delete these rows and recalculate balances.');
    await sequelize.close();
    return;
  }

  const t = await sequelize.transaction();
  try {
    await SupplierLedger.destroy({
      where: { id: { [Op.in]: rows.map((r) => r.id) } },
      transaction: t,
    });
    for (const supplierId of bySupplier.keys()) {
      const closing = await recalcSupplier(supplierId, t);
      console.log(`  Supplier #${supplierId}: balance recalculated → Rs ${closing.toFixed(2)}`);
    }
    await t.commit();
    console.log(`\nDone. Deleted ${rows.length} reversal row(s).`);
  } catch (err) {
    await t.rollback();
    console.error('Cleanup failed, nothing was changed:', err);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();