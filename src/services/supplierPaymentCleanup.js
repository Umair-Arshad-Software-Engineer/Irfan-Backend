// backend/src/services/supplierPaymentCleanup.js
'use strict';

// One place that hard-deletes a supplier payment and everything it created,
// then recalculates the supplier ledger. NO reversal rows are written.
//
// Used by:
//   - DELETE /expense-sessions/:sessionId/entries/:entryId   (dailyExpenseController)
//   - DELETE /suppliers/:supplierId/payments/:paymentId       (supplierPaymentController)
//
// What a supplier payment can leave behind:
//   - the SupplierLedger row itself
//   - a Cheque row               (cheque payments)
//   - a BankTransaction 'out' row + reduced bank balance (bank / cheque payments)
//   - a Cashbook / SimpleCashbook row (cash payments; source_type 'supplier_payment',
//                                      reference_id = ledger id)

const { Op } = require('sequelize');
const models = require('../models');
const { SupplierLedger, Supplier, Bank, BankTransaction, Cheque } = models;
const { recalculateBalances } = require('../controllers/supplierLedgerController');

// Recalculate every running balance for the supplier and store the closing
// balance on the supplier row. Returns the closing balance.
async function recalcSupplier(supplierId, transaction) {
  await recalculateBalances(supplierId, transaction);

  const last = await SupplierLedger.findOne({
    where: { supplier_id: supplierId },
    order: [['transaction_date', 'DESC'], ['id', 'DESC']],
    transaction,
  });
  const closing = last ? parseFloat(last.balance) : 0;

  // Same as the existing supplierPaymentController did. If the suppliers
  // table has no `balance` column, Sequelize simply ignores this field.
  await Supplier.update(
    { balance: closing.toFixed(2) },
    { where: { id: supplierId }, transaction }
  );
  return closing;
}

// Find the BankTransaction that a payment created.
async function findPaymentBankTransaction(ledgerEntry, cheque, transaction) {
  // 1) Cheque payments made from the cash desk store the link on the cheque.
  if (cheque && cheque.bank_transaction_id) {
    const linked = await BankTransaction.findByPk(cheque.bank_transaction_id, { transaction });
    if (linked) return linked;
  }

  // 2) Otherwise match on bank + amount + exact timestamp + reference.
  //    Both create paths write the bank transaction with the same date
  //    value as the ledger row.
  const amount = parseFloat(ledgerEntry.debit).toFixed(2);
  const refs = [ledgerEntry.cheque_number, ledgerEntry.reference_number].filter(Boolean);

  const base = {
    bank_id: ledgerEntry.bank_id,
    transaction_type: 'out',
    amount,
  };

  const exact = await BankTransaction.findOne({
    where: {
      ...base,
      transaction_date: ledgerEntry.transaction_date,
      ...(refs.length
        ? { reference_number: { [Op.in]: refs } }
        : { reference_number: { [Op.is]: null } }),
    },
    order: [['id', 'DESC']],
    transaction,
  });
  if (exact) return exact;

  // 3) Cash-desk cheques are dated on the cheque date, not the ledger date.
  if (ledgerEntry.cheque_number) {
    return BankTransaction.findOne({
      where: { ...base, reference_number: ledgerEntry.cheque_number },
      order: [['id', 'DESC']],
      transaction,
    });
  }
  return null;
}

/**
 * Hard-delete a supplier payment ledger row and everything linked to it,
 * then recalculate the supplier's running balances.
 *
 * Does NOT touch the DailyExpense row — the caller handles that so it can
 * also recalculate the expense session.
 *
 * @returns {Promise<{ supplierId: number, closingBalance: number }>}
 */
async function deleteSupplierPaymentCascade(ledgerEntry, transaction) {
  const supplierId = ledgerEntry.supplier_id;
  const amount = parseFloat(ledgerEntry.debit) || 0;
  const method = ledgerEntry.payment_method;

  // ── Linked cheque ──────────────────────────────────────────────────────
  let cheque = null;
  if (method === 'cheque' || ledgerEntry.cheque_number) {
    cheque = await Cheque.findOne({
      where: {
        [Op.or]: [
          { supplier_ledger_id: ledgerEntry.id },
          ...(ledgerEntry.reference_id ? [{ id: ledgerEntry.reference_id }] : []),
        ],
      },
      transaction,
    });
  }

  // ── Bank: give the money back and delete the original 'out' row ────────
  if ((method === 'bank' || method === 'cheque') && ledgerEntry.bank_id && amount > 0) {
    const bank = await Bank.findByPk(ledgerEntry.bank_id, { transaction });
    if (bank) {
      const bankTxn = await findPaymentBankTransaction(ledgerEntry, cheque, transaction);
      await bank.update(
        { balance: (parseFloat(bank.balance) + amount).toFixed(2) },
        { transaction }
      );
      if (bankTxn) await bankTxn.destroy({ transaction });
    }
  }

  // ── Cheque row ─────────────────────────────────────────────────────────
  if (cheque) await cheque.destroy({ transaction });

  // ── Cashbook rows (cash payments) ──────────────────────────────────────
  for (const model of [models.SimpleCashbook, models.Cashbook]) {
    if (!model) continue;
    await model.destroy({
      where: { source_type: 'supplier_payment', reference_id: ledgerEntry.id },
      transaction,
    });
  }

  // ── The ledger row itself, then recalc ─────────────────────────────────
  await ledgerEntry.destroy({ transaction });
  const closingBalance = await recalcSupplier(supplierId, transaction);

  return { supplierId, closingBalance };
}

module.exports = { deleteSupplierPaymentCascade, recalcSupplier };