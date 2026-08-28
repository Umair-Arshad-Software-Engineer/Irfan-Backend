const { Op, fn, col } = require('sequelize');
const sequelize = require('../config/db');
const { Sale, SaleItem, Customer, Product, Unit, Category, CustomerLedger, Bank, BankTransaction, Cheque, SimpleCashbook } = require('../models');
const { createCashbookEntry } = require('./cashbookController');
const { createSimpleCashbookEntry } = require('./simpleCashbookController');

// ─────────────────────────────────────────────
//  HELPER: generate invoice number
// ─────────────────────────────────────────────
async function generateInvoiceNumber(type) {
  const prefix = type === 'invoice' ? 'INV' : 'POS';
  const today = new Date();
  const datePart = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  const last = await Sale.findOne({
    where: { invoice_number: { [Op.like]: `${prefix}-${datePart}-%` } },
    order: [['id', 'DESC']],
  });

  let seq = 1;
  if (last) {
    const parts = last.invoice_number.split('-');
    seq = parseInt(parts[parts.length - 1]) + 1;
  }

  return `${prefix}-${datePart}-${String(seq).padStart(4, '0')}`;
}

async function getCustomerBalance(customerId, transaction) {
  const lastEntry = await CustomerLedger.findOne({
    where: { customer_id: customerId },
    order: [['id', 'DESC']],
    transaction,
  });
  return lastEntry ? parseFloat(lastEntry.balance) : 0;
}

async function createLedgerEntry({
  customerId, date, transactionType, referenceId,
  referenceNumber, description, debit = 0, credit = 0, transaction,
  paymentMethod, bankName, bankId, chequeNumber, chequeDate,  // ADD THESE
}) {
  const currentBalance = await getCustomerBalance(customerId, transaction);
  const newBalance = currentBalance + credit - debit;

  return await CustomerLedger.create({
    customer_id: customerId,
    date: date || new Date(),
    transaction_type: transactionType,
    reference_id: referenceId,
    reference_number: referenceNumber,
    description,
    debit,
    credit,
    balance: newBalance,
    payment_method: paymentMethod || null,      // ADD
    bank_name: bankName || null,                // ADD
    bank_id: bankId || null,                    // ADD
    cheque_number: chequeNumber || null,         // ADD
    cheque_date: chequeDate || null,            // ADD
  }, { transaction });
}

function parseLengthFields(item) {
  let selectedLengths = null;
  let lengthQuantities = null;
  let selectedLengthsDisplay = null;
  let totalPieces = null;

  if (!Array.isArray(item.selected_lengths) || item.selected_lengths.length === 0) {
    return { selectedLengths, lengthQuantities, selectedLengthsDisplay, totalPieces };
  }

  selectedLengths = item.selected_lengths.map(String);

  if (item.length_quantities && typeof item.length_quantities === 'object') {
    lengthQuantities = {};
    let pieces = 0;

    for (const len of selectedLengths) {
      const rawQty = item.length_quantities[len];
      const parsedQty = rawQty != null ? (parseFloat(rawQty) || 1) : 1;
      lengthQuantities[len] = parsedQty;
      pieces += parsedQty;
    }

    totalPieces = Math.round(pieces);
    selectedLengthsDisplay = selectedLengths
      .map(len => `${len} (${Math.round(lengthQuantities[len])})`)
      .join(', ');

  } else {
    lengthQuantities = {};
    selectedLengths.forEach(len => { lengthQuantities[len] = 1; });
    totalPieces = selectedLengths.length;
    selectedLengthsDisplay = selectedLengths.map(len => `${len} (1)`).join(', ');
  }

  return { selectedLengths, lengthQuantities, selectedLengthsDisplay, totalPieces };
}

function normalizePaymentMethod(method) {
  const map = {
    'bank': 'bank',
    'bank_transfer': 'bank_transfer',
    'cheque': 'cheque',
    'slip': 'slip',
    'cash': 'cash',
    'card': 'card',
    'credit': 'credit',
  };
  return map[method] || 'cash';
}

exports.getAllSales = async (req, res) => {
  try {
    const {
      page = 1, limit = 20, search, sale_type, sale_category, payment_status,
      payment_method, customer_id, date_from, date_to,
      sort_by = 'created_at', sort_order = 'DESC',
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    const whereClause = {};

    let includeCustomer = false;
    if (search) includeCustomer = true;
    if (sale_type) whereClause.sale_type = sale_type;
    if (sale_category) whereClause.sale_category = sale_category;
    if (payment_status) whereClause.payment_status = payment_status;
    if (payment_method) whereClause.payment_method = payment_method;
    if (customer_id) { whereClause.customer_id = customer_id; includeCustomer = true; }
    if (date_from || date_to) {
      whereClause.sale_date = {};
      if (date_from) whereClause.sale_date[Op.gte] = date_from;
      if (date_to) whereClause.sale_date[Op.lte] = date_to;
    }

    const include = [
      {
        model: Customer, as: 'customer',
        attributes: ['id', 'name', 'contact', 'customer_type', 'balance'],
        required: includeCustomer ? true : false,
        ...(search ? { where: { name: { [Op.like]: `%${search}%` } } } : {})
      },
      // In getAllSales, change the SaleItem include attributes:
      {
        model: SaleItem, as: 'items',
        attributes: [
          'id', 'product_id',              // ← ADD product_id HERE
          'product_name', 'quantity', 'unit_price', 'total_price',
          'selected_lengths', 'length_quantities', 'selected_lengths_display',
          'total_pieces', 'weight', 'used_customer_price', 'description'
        ],
        include: [
          { model: Product, as: 'product', attributes: ['id', 'item_name', 'barcode'], required: false },
        ],
      },
    ];

    const mainWhereClause = { ...whereClause };
    if (search && !includeCustomer) {
      mainWhereClause.invoice_number = { [Op.like]: `%${search}%` };
    }

    const { count, rows: sales } = await Sale.findAndCountAll({
      where: mainWhereClause, include,
      order: [[sort_by, sort_order]],
      limit: limitNum, offset, distinct: true, subQuery: false,
    });

    // ─────────────────────────────────────────────
    //  Compute previous_balance for each sale
    // ─────────────────────────────────────────────
    const salesWithBalance = await Promise.all(sales.map(async (sale) => {
      const saleJson = sale.toJSON();

      // if (!sale.customer_id) {
      //   saleJson.previous_balance = 0;
      //   saleJson.customer_balance = 0;
      //   saleJson.payment_details = null;
      //   return saleJson;
      // }
      if (!sale.customer_id) {
        saleJson.previous_balance = 0;
        saleJson.customer_balance = 0;
        const method = (sale.payment_method || 'cash').toLowerCase();
        const paid = parseFloat(sale.amount_paid) || 0;
        saleJson.payment_details = paid > 0
          ? [{
              method,
              amount: paid,
              date: sale.sale_date,
              description: `Payment for ${sale.invoice_number}`,
              reference_number: sale.reference || sale.invoice_number,
              bank_name: null,
              cheque_number: null,
            }]
          : [];
        return saleJson;
      }

      // ── Previous balance calculation ──
      // Sale ke time do ledger entries bunti hain:
      //   1) sale credit entry = (grand_total - paid)
      //   2) payment debit entry = paid
      // Net change = (grand_total - paid) - paid = grand_total - (2 × paid)
      // Isliye previous_balance nikalne ke liye paid ko wapis add karna zaroori hai,
      // warna paid amount do baar deduct ho jata tha.
      const customerBalanceNow = parseFloat(sale.customer?.balance ?? 0);
      const paidAmount = parseFloat(sale.amount_paid) || 0;
      const previousBalance = customerBalanceNow - parseFloat(sale.grand_total) + (paidAmount * 2);

      saleJson.previous_balance = parseFloat(previousBalance.toFixed(2));
      saleJson.customer_balance = customerBalanceNow;


      // const saleEntry = await CustomerLedger.findOne({
      //   where: {
      //     customer_id: sale.customer_id,
      //     reference_id: sale.id,
      //     transaction_type: 'sale',
      //   },
      //   order: [['id', 'ASC']],
      // });

      // let previousBalance = 0;
      // if (saleEntry) {
      //   previousBalance =
      //     parseFloat(saleEntry.balance) -
      //     parseFloat(saleEntry.credit) +
      //     parseFloat(saleEntry.debit);
      // } else {
      //   const remaining = parseFloat(sale.grand_total) - parseFloat(sale.amount_paid);
      //   previousBalance = Math.max(
      //     parseFloat(sale.customer?.balance ?? 0) - remaining,
      //     0
      //   );
      // }

      // saleJson.previous_balance = parseFloat(previousBalance.toFixed(2));
      // saleJson.customer_balance = parseFloat(sale.customer?.balance ?? 0);

    
      const paymentEntries = await CustomerLedger.findAll({
        where: {
          customer_id: sale.customer_id,
          reference_id: sale.id,
          transaction_type: 'payment',
          [Op.or]: [
            { payment_method: { [Op.ne]: 'cheque' } },
            { payment_method: 'cheque', cheque_cleared: true },
          ],
        },
        order: [['id', 'ASC']],
      });
      // if (paymentEntries.length > 0) {
      //   const paymentDetails = {};
      //   for (const entry of paymentEntries) {
      //     const method = (entry.payment_method || 'cash').toLowerCase();
      //     const amount = parseFloat(entry.debit) || 0;
      //     if (amount > 0) {
      //       paymentDetails[method] = (paymentDetails[method] || 0) + amount;
      //     }
      //   }
      //   saleJson.payment_details = paymentDetails;
      // } else {
      //   // Fallback: single method
      //   const method = (sale.payment_method || 'cash').toLowerCase();
      //   const paid = parseFloat(sale.amount_paid) || 0;
      //   saleJson.payment_details = paid > 0 ? { [method]: paid } : null;
      // }
      if (paymentEntries.length > 0) {
        const paymentDetails = [];
        for (const entry of paymentEntries) {
          const amount = parseFloat(entry.debit) || 0;
          if (amount > 0) {
            paymentDetails.push({
              method: (entry.payment_method || 'cash').toLowerCase(),
              amount: amount,
              date: entry.date,
              description: entry.description || null,
              reference_number: entry.reference_number || null,
              bank_name: entry.bank_name || null,
              cheque_number: entry.cheque_number || null,
            });
          }
        }
        saleJson.payment_details = paymentDetails;
      } else {
        // Fallback: single method, no ledger entries yet
        const method = (sale.payment_method || 'cash').toLowerCase();
        const paid = parseFloat(sale.amount_paid) || 0;
        saleJson.payment_details = paid > 0
          ? [{
              method,
              amount: paid,
              date: sale.sale_date,
              description: `Initial payment for ${sale.invoice_number}`,
              reference_number: sale.reference || sale.invoice_number,
              bank_name: null,
              cheque_number: null,
            }]
          : [];
      }

      return saleJson;
    }));

    // ─────────────────────────────────────────────
    //  Summary
    // ─────────────────────────────────────────────
    let summaryQuery = {
      where: { ...whereClause },
      attributes: [
        [fn('SUM', col('Sale.grand_total')), 'total_revenue'],
        [fn('SUM', col('Sale.discount_amount')), 'total_discount'],
        [fn('COUNT', col('Sale.id')), 'total_transactions'],
      ],
      raw: true,
    };

    if (search) {
      summaryQuery.include = [
        { model: Customer, as: 'customer', required: true, where: { name: { [Op.like]: `%${search}%` } }, attributes: [] }
      ];
      summaryQuery.where = {
        ...whereClause,
        [Op.or]: [
          { invoice_number: { [Op.like]: `%${search}%` } },
          { '$customer.name$': { [Op.like]: `%${search}%` } }
        ]
      };
    }

    const totals = await Sale.findOne(summaryQuery);

    res.json({
      success: true,
      data: salesWithBalance,
      pagination: { total: count, page: pageNum, limit: limitNum, pages: Math.ceil(count / limitNum) },
      summary: {
        total_revenue: parseFloat(totals?.total_revenue) || 0,
        total_discount: parseFloat(totals?.total_discount) || 0,
        total_transactions: parseInt(totals?.total_transactions) || 0,
      },
    });
  } catch (error) {
    console.error('Get all sales error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;

    const sale = await Sale.findByPk(id, {
      include: [
        { 
          model: Customer, as: 'customer', 
          attributes: ['id', 'name', 'contact', 'address', 'email', 'customer_type'] 
        },
        {
          model: SaleItem, as: 'items',
          include: [
            {
              model: Product, as: 'product',
              attributes: ['id', 'item_name', 'barcode', 'sale_price', 'cost_price',
                           'length_combinations', 'has_multiple_lengths'],
              include: [{ model: Unit, as: 'unit', attributes: ['id', 'name', 'symbol'] }],
            },
          ],
        },
      ],
    });

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    const saleJson = sale.toJSON();

    // Build payment_details from ledger entries
    if (sale.customer_id) {
      // ✅ FIX: same cheque-clearing filter as getAllSales — hide
      // uncleared cheque payments from the visible payment methods list.
      const paymentEntries = await CustomerLedger.findAll({
        where: {
          customer_id: sale.customer_id,
          reference_id: sale.id,
          transaction_type: 'payment',
          [Op.or]: [
            { payment_method: { [Op.ne]: 'cheque' } },
            { payment_method: 'cheque', cheque_cleared: true },
          ],
        },
        order: [['id', 'ASC']],
      });

      if (paymentEntries.length > 0) {
        const paymentDetails = [];
        for (const entry of paymentEntries) {
          const amount = parseFloat(entry.debit) || 0;
          if (amount > 0) {
            paymentDetails.push({
              method: (entry.payment_method || 'cash').toLowerCase(),
              amount: amount,
              date: entry.date,
              description: entry.description || null,
              reference_number: entry.reference_number || null,
              bank_name: entry.bank_name || null,
              cheque_number: entry.cheque_number || null,
            });
          }
        }
        saleJson.payment_details = paymentDetails;
      } else {
        const method = (sale.payment_method || 'cash').toLowerCase();
        const paid = parseFloat(sale.amount_paid) || 0;
        saleJson.payment_details = paid > 0
          ? [{
              method,
              amount: paid,
              date: sale.sale_date,
              description: `Initial payment for ${sale.invoice_number}`,
              reference_number: sale.reference || sale.invoice_number,
              bank_name: null,
              cheque_number: null,
            }]
          : [];
      }
    } else {
      const method = (sale.payment_method || 'cash').toLowerCase();
      const paid = parseFloat(sale.amount_paid) || 0;
      saleJson.payment_details = paid > 0
        ? [{
            method,
            amount: paid,
            date: sale.sale_date,
            description: `Payment for ${sale.invoice_number}`,
            reference_number: sale.reference || sale.invoice_number,
            bank_name: null,
            cheque_number: null,
          }]
        : [];
    }

    res.json({ success: true, data: saleJson });
  } catch (error) {
    console.error('Get sale by id error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.createSale = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      sale_type = 'pos',
      sale_category = 'filled',
      customer_id,
      sale_date,
      due_date,
      items,
      discount_type = 'fixed',
      discount_value = 0,
      payment_method: rawPaymentMethod = 'cash',
      payment_status,
      amount_paid = 0,
      notes,
      credit_details,
      reference,
    } = req.body;

    const payment_method = normalizePaymentMethod(rawPaymentMethod);
    const isSarya = sale_category === 'sarya';

    console.log('Creating sale:', { sale_type, sale_category, isSarya, itemsCount: items?.length });

    if (!items || !Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Sale must have at least one item' });
    }

    if (sale_type === 'invoice' && !customer_id) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Invoice requires a customer' });
    }

    if (customer_id) {
      const customer = await Customer.findByPk(customer_id, { transaction: t });
      if (!customer) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Customer not found' });
      }
    }

    let subtotal = 0;
    const itemSnapshots = [];

    for (const item of items) {
      if (!item.product_id) {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'Each item must have a product_id' });
      }

      const product = await Product.findByPk(item.product_id, { transaction: t });
      if (!product) {
        await t.rollback();
        return res.status(404).json({ success: false, message: `Product id ${item.product_id} not found` });
      }

      let quantity = 0;
      let weight = null;
      let totalPrice = 0;
      const unitPrice = parseFloat(item.unit_price ?? product.sale_price);

      if (isSarya) {
        weight = item.weight != null ? parseFloat(item.weight) : null;
        if (!weight || weight <= 0) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: `SARYA mode requires a valid weight > 0 for each item (product_id: ${item.product_id})`,
          });
        }
        quantity = 0;
        totalPrice = weight * unitPrice;
      } else {
        quantity = item.quantity ? parseInt(item.quantity) : 0;
        if (!quantity || quantity < 1) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: `Each item must have quantity >= 1 (product_id: ${item.product_id})`,
          });
        }
        totalPrice = unitPrice * quantity;

        if (product.available_qty < quantity) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for "${product.item_name}". Available: ${product.available_qty}`,
          });
        }
      }

      subtotal += totalPrice;

      const { selectedLengths, lengthQuantities, selectedLengthsDisplay, totalPieces } = parseLengthFields(item);

      // ✅ DESCRIPTION FIELD
      const description = item.description?.trim() || null;

      itemSnapshots.push({
        product_id: product.id,
        product_name: product.item_name,
        description: description,
        barcode: product.barcode,
        unit_price: unitPrice,
        quantity: quantity,
        total_price: totalPrice,
        selected_lengths: selectedLengths,
        length_quantities: lengthQuantities,
        selected_lengths_display: selectedLengthsDisplay,
        total_pieces: totalPieces,
        weight: weight,
        used_customer_price: item.used_customer_price === true,
        _available_qty: product.available_qty,
        _isSarya: isSarya,
      });
    }

    let discountAmount = 0;
    const discountVal = parseFloat(discount_value) || 0;

    if (discount_type === 'percent') {
      discountAmount = subtotal * (discountVal / 100);
    } else {
      discountAmount = discountVal;
    }
    discountAmount = Math.min(discountAmount, subtotal);

    // ✅ FIX: mazdooriAmount ab grandTotal se PEHLE nikalte hain,
    // taake grandTotal (jo ledger, paid, changeAmount sab jagah use hota hai)
    // hamesha mazdoori included ho — koi mismatch na ho.
    const mazdooriAmount = parseFloat(req.body.mazdoori_amount) || 0;
    const grandTotal = subtotal - discountAmount + mazdooriAmount; // ✅ mazdoori yahin add

    const isCredit = payment_method === 'credit';
    const paid = isCredit ? 0 : (parseFloat(amount_paid) || (sale_type === 'pos' ? grandTotal : 0));
    const changeAmount = Math.max(paid - grandTotal, 0);

    let resolvedPaymentStatus = payment_status;
    if (!resolvedPaymentStatus) {
      if (isCredit) {
        resolvedPaymentStatus = 'unpaid';
      } else if (sale_type === 'pos') {
        resolvedPaymentStatus = 'paid';
      } else {
        resolvedPaymentStatus = paid >= grandTotal ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
      }
    }

    const invoiceNumber = await generateInvoiceNumber(sale_type);

    let finalNotes = notes || '';
    if (isCredit && credit_details) {
      const creditNotes = [];
      if (credit_details.notes) creditNotes.push(`Credit Note: ${credit_details.notes}`);
      if (credit_details.due_date) {
        const dueDate = new Date(credit_details.due_date);
        creditNotes.push(`Due Date: ${dueDate.toISOString().split('T')[0]}`);
      }
      if (creditNotes.length > 0) {
        finalNotes = finalNotes ? `${finalNotes}\n${creditNotes.join('\n')}` : creditNotes.join('\n');
      }
    }

    const sale = await Sale.create(
      {
        invoice_number: invoiceNumber,
        sale_type,
        sale_category,
        customer_id: customer_id || null,
        sale_date: sale_date || new Date(),
        due_date: isCredit && credit_details?.due_date ? credit_details.due_date : due_date || null,
        subtotal,
        discount_type,
        discount_value: discountVal,
        discount_amount: discountAmount,
        tax_amount: 0,
        mazdoori_amount: mazdooriAmount,
        grand_total: grandTotal, // ✅ ab yahan sirf ek jagah se aa raha hai, double-add nahi
        amount_paid: paid,
        change_amount: changeAmount,
        payment_method,
        payment_status: resolvedPaymentStatus,
        notes: finalNotes || null,
        reference: reference || null,
      },
      { transaction: t }
    );

    const saleItems = itemSnapshots.map(({ _available_qty, _isSarya, ...snap }) => ({
      ...snap,
      sale_id: sale.id,
    }));
    await SaleItem.bulkCreate(saleItems, { transaction: t });

    // Deduct stock only for FILLED mode (quantity > 0)
    for (const snap of itemSnapshots) {
      if (!snap._isSarya && snap.quantity > 0) {
        await Product.decrement(
          { physical_qty: snap.quantity, available_qty: snap.quantity },
          { where: { id: snap.product_id }, transaction: t }
        );
      }
    }

    if (customer_id) {
      // ✅ ab grandTotal mein mazdoori pehle se shamil hai, is liye
      // ledger ka credit amount automatically sahi (mazdoori included) hoga
      const saleAmount = isCredit ? grandTotal : (grandTotal - paid);

      if (saleAmount > 0) {
        await createLedgerEntry({
          customerId: customer_id,
          date: sale_date || new Date(),
          transactionType: 'sale',
          referenceId: sale.id,
          referenceNumber: reference || invoiceNumber,
          description: `Sale ${invoiceNumber} - ${sale_type === 'invoice' ? 'Invoice' : 'POS'}${isCredit ? ' (Credit)' : ''}${isSarya ? ' [SARYA]' : ''}`,
          debit: 0,
          credit: saleAmount,
          transaction: t,
        });
      }

      if (paid > 0) {
        await createLedgerEntry({
          customerId: customer_id,
          date: sale_date || new Date(),
          transactionType: 'payment',
          referenceId: sale.id,
          referenceNumber: reference || invoiceNumber,
          description: `Payment received for ${invoiceNumber} (${payment_method})`,
          debit: paid,
          credit: 0,
          transaction: t,
        });
      }

      const finalBalance = await getCustomerBalance(customer_id, t);
      await Customer.update({ balance: finalBalance }, { where: { id: customer_id }, transaction: t });
    }

    await t.commit();

    const created = await Sale.findByPk(sale.id, {
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'contact', 'balance'] },
        {
          model: SaleItem, as: 'items',
          include: [
            {
              model: Product, as: 'product',
              attributes: ['id', 'item_name', 'barcode'],
              include: [{ model: Unit, as: 'unit', attributes: ['id', 'name', 'symbol'] }],
            },
          ],
        },
      ],
    });

    console.log('Sale created successfully:', {
      invoiceNumber,
      itemsCount: saleItems.length,
      saryaItems: saleItems.filter(i => i.weight > 0 && i.quantity === 0).length,
      filledItems: saleItems.filter(i => i.quantity > 0).length,
      mazdooriAmount,
      grandTotal,
    });

    const message = isCredit
      ? `${sale_type === 'invoice' ? 'Credit invoice' : 'Credit sale'} created successfully`
      : `${sale_type === 'invoice' ? 'Invoice' : 'Sale'} created successfully`;

    res.status(201).json({ success: true, message, data: created });
  } catch (error) {
    await t.rollback();
    console.error('Create sale error:', error);

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

exports.updateSale = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const {
      sale_category,
      customer_id,
      sale_date,
      due_date,
      items,
      discount_type,
      discount_value,
      payment_method: rawPaymentMethod,
      payment_status,
      amount_paid,
      notes,
      reference,
    } = req.body;

    const sale = await Sale.findByPk(id, {
      include: [{ model: SaleItem, as: 'items' }],
      transaction: t,
    });

    if (!sale) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    if (sale.payment_status === 'paid') {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Cannot edit a fully paid sale' });
    }

    const payment_method = rawPaymentMethod
      ? normalizePaymentMethod(rawPaymentMethod)
      : sale.payment_method;

    const isSarya = (sale_category ?? sale.sale_category) === 'sarya';
    const oldCustomerId = sale.customer_id;
    const newCustomerId = customer_id !== undefined ? customer_id : sale.customer_id;

    // ─────────────────────────────────────────────
    //  STEP 1: Remove old ledger entries for this sale
    //  ✅ FIX: instead of inserting an "adjustment" row that reverses the old
    //  sale/payment entries (which left both the old rows AND a reversal row
    //  visible in the ledger), we now DELETE the old sale/payment rows
    //  outright and recalculate the running balance. This keeps the ledger
    //  showing a single clean sale entry + payment entry per sale, exactly
    //  like a freshly created sale — no extra adjustment noise.
    // ─────────────────────────────────────────────
    if (oldCustomerId) {
      await CustomerLedger.destroy({
        where: {
          customer_id: oldCustomerId,
          reference_id: sale.id,
          transaction_type: { [Op.in]: ['sale', 'payment'] },
        },
        transaction: t,
      });

      // Recalculate old customer's balance from whatever ledger rows remain
      const oldRemainingEntries = await CustomerLedger.findAll({
        where: { customer_id: oldCustomerId },
        order: [['date', 'ASC'], ['id', 'ASC']],
        transaction: t,
      });

      let oldRunningBalance = 0;
      for (const entry of oldRemainingEntries) {
        oldRunningBalance += parseFloat(entry.credit) - parseFloat(entry.debit);
        await entry.update({ balance: oldRunningBalance.toFixed(2) }, { transaction: t });
      }

      await Customer.update(
        { balance: oldRunningBalance.toFixed(2) },
        { where: { id: oldCustomerId }, transaction: t }
      );
    }

    // ─────────────────────────────────────────────
    //  STEP 2: Handle items replacement if provided
    // ─────────────────────────────────────────────
    let subtotal = parseFloat(sale.subtotal);
    let newDiscountType = discount_type ?? sale.discount_type;
    let newDiscountValue = discount_value != null
      ? parseFloat(discount_value)
      : parseFloat(sale.discount_value);

    if (items && Array.isArray(items) && items.length > 0) {
      // Restore old stock (FILLED only)
      if (sale.sale_category !== 'sarya') {
        for (const oldItem of sale.items) {
          if (oldItem.quantity > 0) {
            await Product.increment(
              { physical_qty: oldItem.quantity, available_qty: oldItem.quantity },
              { where: { id: oldItem.product_id }, transaction: t }
            );
          }
        }
      }

      // Delete old items
      await SaleItem.destroy({ where: { sale_id: id }, transaction: t });

      // Create new items
      subtotal = 0;
      const newSnapshots = [];

      for (const item of items) {
        if (!item.product_id) {
          await t.rollback();
          return res.status(400).json({ success: false, message: 'Each item must have a product_id' });
        }

        const product = await Product.findByPk(item.product_id, { transaction: t });
        if (!product) {
          await t.rollback();
          return res.status(404).json({
            success: false,
            message: `Product id ${item.product_id} not found`,
          });
        }

        const unitPrice = parseFloat(item.unit_price ?? product.sale_price);
        let quantity = 0;
        let weight = null;
        let totalPrice = 0;

        if (isSarya) {
          weight = item.weight != null ? parseFloat(item.weight) : null;
          if (!weight || weight <= 0) {
            await t.rollback();
            return res.status(400).json({
              success: false,
              message: `SARYA mode requires weight > 0 for product_id: ${item.product_id}`,
            });
          }
          quantity = 0;
          totalPrice = weight * unitPrice;
        } else {
          quantity = item.quantity ? parseInt(item.quantity) : 0;
          if (!quantity || quantity < 1) {
            await t.rollback();
            return res.status(400).json({
              success: false,
              message: `Each item must have quantity >= 1 for product_id: ${item.product_id}`,
            });
          }
          if (product.available_qty < quantity) {
            await t.rollback();
            return res.status(400).json({
              success: false,
              message: `Insufficient stock for "${product.item_name}". Available: ${product.available_qty}`,
            });
          }
          totalPrice = unitPrice * quantity;
        }

        subtotal += totalPrice;

        const {
          selectedLengths,
          lengthQuantities,
          selectedLengthsDisplay,
          totalPieces,
        } = parseLengthFields(item);

        const description = item.description?.trim() || null;

        newSnapshots.push({
          sale_id: parseInt(id),
          product_id: product.id,
          product_name: product.item_name,
          description: description,
          barcode: product.barcode,
          unit_price: unitPrice,
          quantity,
          total_price: totalPrice,
          selected_lengths: selectedLengths,
          length_quantities: lengthQuantities,
          selected_lengths_display: selectedLengthsDisplay,
          total_pieces: totalPieces,
          weight,
          used_customer_price: item.used_customer_price === true,
          _isSarya: isSarya,
          _qty: quantity,
          _productId: product.id,
        });
      }

      await SaleItem.bulkCreate(
        newSnapshots.map(({ _isSarya, _qty, _productId, ...snap }) => snap),
        { transaction: t }
      );

      // Deduct new stock (FILLED only)
      for (const snap of newSnapshots) {
        if (!snap._isSarya && snap._qty > 0) {
          await Product.decrement(
            { physical_qty: snap._qty, available_qty: snap._qty },
            { where: { id: snap._productId }, transaction: t }
          );
        }
      }
    }

    // ─────────────────────────────────────────────
    //  STEP 3: Recalculate totals
    // ─────────────────────────────────────────────
    let discountAmount = 0;
    if (newDiscountType === 'percent') {
      discountAmount = subtotal * (newDiscountValue / 100);
    } else {
      discountAmount = newDiscountValue;
    }
    discountAmount = Math.min(discountAmount, subtotal);

    const mazdooriAmount = req.body.mazdoori_amount != null
      ? parseFloat(req.body.mazdoori_amount)
      : parseFloat(sale.mazdoori_amount || 0);

    const grandTotal = subtotal - discountAmount + mazdooriAmount; // mazdoori included

    const newAmountPaid = amount_paid != null
      ? parseFloat(amount_paid)
      : parseFloat(sale.amount_paid);

    const newStatus =
      payment_status ??
      (newAmountPaid >= grandTotal
        ? 'paid'
        : newAmountPaid > 0
        ? 'partial'
        : 'unpaid');

    const isCredit = payment_method === 'credit';

    // ─────────────────────────────────────────────
    //  STEP 4: Update sale record
    // ─────────────────────────────────────────────
    await sale.update(
      {
        sale_category: sale_category ?? sale.sale_category,
        customer_id: newCustomerId,
        sale_date: sale_date ?? sale.sale_date,
        due_date: due_date !== undefined ? due_date : sale.due_date,
        subtotal,
        discount_type: newDiscountType,
        discount_value: newDiscountValue,
        discount_amount: discountAmount,
        mazdoori_amount: mazdooriAmount,
        grand_total: grandTotal,
        amount_paid: newAmountPaid,
        change_amount: Math.max(newAmountPaid - grandTotal, 0),
        payment_method,
        payment_status: newStatus,
        notes: notes !== undefined ? notes : sale.notes,
        reference: reference !== undefined ? reference : sale.reference,
      },
      { transaction: t }
    );

    // ─────────────────────────────────────────────
    //  STEP 5: Create fresh ledger entries for new customer
    //  ✅ These are now the ONLY ledger rows for this sale — clean replacement,
    //  no adjustment/reversal rows left behind from Step 1.
    // ─────────────────────────────────────────────
    if (newCustomerId) {
      const unpaidAmount = isCredit ? grandTotal : (grandTotal - newAmountPaid);
      const saleAmountForLedger = isCredit ? grandTotal : unpaidAmount;

      // Sale credit entry (customer owes this amount)
      if (saleAmountForLedger > 0) {
        await createLedgerEntry({
          customerId: newCustomerId,
          date: sale_date || sale.sale_date,
          transactionType: 'sale',
          referenceId: sale.id,
          referenceNumber: sale.reference || sale.invoice_number,
          description: `Sale ${sale.invoice_number} - ${sale.sale_type === 'invoice' ? 'Invoice' : 'POS'}${isCredit ? ' (Credit)' : ''}${isSarya ? ' [SARYA]' : ''}`,
          debit: 0,
          credit: saleAmountForLedger,
          transaction: t,
        });
      }

      // Payment debit entry (if paid amount > 0)
      if (newAmountPaid > 0 && !isCredit) {
        await createLedgerEntry({
          customerId: newCustomerId,
          date: sale_date || sale.sale_date,
          transactionType: 'payment',
          referenceId: sale.id,
          referenceNumber: sale.reference || sale.invoice_number,
          description: `Payment for ${sale.invoice_number} (${payment_method})`,
          debit: newAmountPaid,
          credit: 0,
          transaction: t,
        });
      }

      // Update new customer balance
      const newFinalBalance = await getCustomerBalance(newCustomerId, t);
      await Customer.update(
        { balance: newFinalBalance },
        { where: { id: newCustomerId }, transaction: t }
      );
    }

    await t.commit();

    // ─────────────────────────────────────────────
    //  Return updated sale with relations
    // ─────────────────────────────────────────────
    const updated = await Sale.findByPk(id, {
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'name', 'contact'],
        },
        {
          model: SaleItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'item_name', 'barcode'],
              include: [
                { model: Unit, as: 'unit', attributes: ['id', 'name', 'symbol'] },
              ],
            },
          ],
        },
      ],
    });

    res.json({ success: true, message: 'Sale updated successfully', data: updated });
  } catch (error) {
    await t.rollback();
    console.error('Update sale error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.deleteSale = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    const sale = await Sale.findByPk(id, {
      include: [
        { model: SaleItem, as: 'items' },
        { model: Customer, as: 'customer' }
      ],
      transaction: t, // ✅ FIX: this findByPk was missing the transaction before
    });

    if (!sale) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    const isSarya = sale.sale_category === 'sarya';

    // Restore stock for FILLED mode only
    if (!isSarya) {
      for (const item of sale.items) {
        await Product.increment(
          { physical_qty: item.quantity, available_qty: item.quantity },
          { where: { id: item.product_id }, transaction: t }
        );
      }
    }

    // ─────────────────────────────────────────────
    //  Handle customer ledger entries — DELETE all entries tied to this sale
    // ─────────────────────────────────────────────
    if (sale.customer_id) {
      // ✅ FIX: match by reference_id ONLY. reference_number is unreliable here —
      // it can be the user-provided `reference`, the invoice_number, or (for
      // reversal/adjustment entries created during an edit) may not match the
      // invoice_number at all. reference_id is always sale.id, so it is the
      // only safe way to find every ledger row that belongs to this sale
      // (sale entry, payment entries, and any adjustment/reversal entries
      // created by a prior edit).
      const ledgerEntries = await CustomerLedger.findAll({
        where: {
          customer_id: sale.customer_id,
          reference_id: sale.id,
        },
        transaction: t,
      });

      if (ledgerEntries.length > 0) {
        await CustomerLedger.destroy({
          where: {
            customer_id: sale.customer_id,
            reference_id: sale.id,
          },
          transaction: t,
        });
      }

      // Recalculate customer balance from remaining ledger entries
      // (must be ordered by date/id the same way createLedgerEntry expects,
      // so the running balance stays consistent)
      const remainingEntries = await CustomerLedger.findAll({
        where: { customer_id: sale.customer_id },
        order: [['date', 'ASC'], ['id', 'ASC']],
        transaction: t,
      });

      let newBalance = 0;
      for (const entry of remainingEntries) {
        newBalance = newBalance + parseFloat(entry.credit) - parseFloat(entry.debit);
        await entry.update({ balance: newBalance.toFixed(2) }, { transaction: t });
      }

      // Update customer with new balance
      await Customer.update(
        { balance: newBalance.toFixed(2) },
        { where: { id: sale.customer_id }, transaction: t }
      );
    }

    // ─────────────────────────────────────────────
    //  Delete cashbook entries tied to this sale
    // ─────────────────────────────────────────────
    const cashbookEntries = await SimpleCashbook.findAll({
      where: {
        source_type: 'customer_payment',
        reference_id: sale.id,
      },
      transaction: t,
    });

    if (cashbookEntries.length > 0) {
      await SimpleCashbook.destroy({
        where: {
          source_type: 'customer_payment',
          reference_id: sale.id,
        },
        transaction: t,
      });
    }

    // ─────────────────────────────────────────────
    //  Delete cheque records tied to this sale
    // ─────────────────────────────────────────────
    const chequeEntries = await Cheque.findAll({
      where: {
        sale_id: sale.id,
      },
      transaction: t,
    });

    if (chequeEntries.length > 0) {
      await Cheque.destroy({
        where: {
          sale_id: sale.id,
        },
        transaction: t,
      });
    }

    // ─────────────────────────────────────────────
    //  Delete bank transactions tied to this sale
    //  (kept matching on invoice_number since bank transactions for a sale's
    //  direct payment recording use sale.reference || sale.invoice_number —
    //  matching both keeps old data compatible)
    // ─────────────────────────────────────────────
    const bankTxWhere = {
      [Op.or]: [
        { reference_number: sale.invoice_number },
        ...(sale.reference ? [{ reference_number: sale.reference }] : []),
      ],
    };

    const bankTransactions = await BankTransaction.findAll({
      where: bankTxWhere,
      transaction: t,
    });

    if (bankTransactions.length > 0) {
      // Reverse bank balances before deleting transactions
      for (const bankTx of bankTransactions) {
        if (bankTx.transaction_type === 'in') {
          // Decrease bank balance since we're removing this incoming transaction
          const bank = await Bank.findByPk(bankTx.bank_id, { transaction: t });
          if (bank) {
            const newBankBalance = parseFloat(bank.balance) - parseFloat(bankTx.amount);
            await bank.update({ balance: newBankBalance.toFixed(2) }, { transaction: t });
          }
        }
      }

      await BankTransaction.destroy({
        where: bankTxWhere,
        transaction: t,
      });
    }

    // Delete sale items and sale
    await SaleItem.destroy({ where: { sale_id: id }, transaction: t });
    await sale.destroy({ transaction: t });

    await t.commit();

    res.json({
      success: true,
      message: 'Sale voided successfully with all related records deleted'
    });
  } catch (error) {
    await t.rollback();
    console.error('Delete sale error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.getDailySummary = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const sales = await Sale.findAll({
      where: { sale_date: targetDate, payment_status: { [Op.ne]: 'draft' } },
      attributes: [
        'sale_type', 'sale_category', 'payment_method', 'payment_status',
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col('grand_total')), 'total'],
        [fn('SUM', col('discount_amount')), 'discount'],
      ],
      group: ['sale_type', 'sale_category', 'payment_method', 'payment_status'],
      raw: true,
    });

    const overall = await Sale.findOne({
      where: { sale_date: targetDate, payment_status: { [Op.ne]: 'draft' } },
      attributes: [
        [fn('COUNT', col('id')), 'total_transactions'],
        [fn('SUM', col('grand_total')), 'total_revenue'],
        [fn('SUM', col('discount_amount')), 'total_discount'],
        [fn('SUM', col('amount_paid')), 'total_collected'],
      ],
      raw: true,
    });

    const creditSalesTotal = await Sale.sum('grand_total', {
      where: { sale_date: targetDate, payment_method: 'credit', payment_status: { [Op.ne]: 'draft' } },
    });

    res.json({
      success: true,
      data: {
        date: targetDate,
        breakdown: sales,
        summary: {
          total_transactions: parseInt(overall.total_transactions) || 0,
          total_revenue: parseFloat(overall.total_revenue) || 0,
          total_discount: parseFloat(overall.total_discount) || 0,
          total_collected: parseFloat(overall.total_collected) || 0,
          total_credit: parseFloat(creditSalesTotal) || 0,
        },
      },
    });
  } catch (error) {
    console.error('Daily summary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.recordPayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { 
      amount, 
      payment_method: rawPaymentMethod, 
      payment_date, 
      notes,  // ← This is the correct variable name from the request body
      cheque_number, 
      bank_name,
      bank_id,
      cheque_date,
      cheque_id,
      slip_number,
      slip_date,
      from_simple_cashbook,
    } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }

    const payment_method = normalizePaymentMethod(rawPaymentMethod);
    const paymentAmount = parseFloat(amount);

    const sale = await Sale.findByPk(id, {
      include: [{ model: Customer, as: 'customer' }],
      transaction: t
    });

    if (!sale) { 
      await t.rollback(); 
      return res.status(404).json({ success: false, message: 'Sale not found' }); 
    }
    if (sale.payment_status === 'paid') { 
      await t.rollback(); 
      return res.status(400).json({ success: false, message: 'Sale is already fully paid' }); 
    }

    // Calculate outstanding and overpayment
    const outstandingBalance = parseFloat(sale.grand_total) - parseFloat(sale.amount_paid);
    let amountToApply = paymentAmount;
    let overpaymentAmount = 0;
    
    if (paymentAmount > outstandingBalance) {
      amountToApply = outstandingBalance;
      overpaymentAmount = paymentAmount - outstandingBalance;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Validate bank for bank/cheque/slip payments
    // ═══════════════════════════════════════════════════════════════════════
    let selectedBank = null;
    if ((payment_method === 'bank' || payment_method === 'cheque' || payment_method === 'slip') && bank_id) {
      selectedBank = await Bank.findByPk(bank_id, { transaction: t });
      
      if (!selectedBank) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: 'Selected bank not found'
        });
      }
    }

    const customerName = sale.customer?.name || 'کسٹمر';

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Create Cheque Record (if payment method is cheque)
    // ═══════════════════════════════════════════════════════════════════════
    let chequeId = null;
    if (payment_method === 'cheque') {
      if (!cheque_number) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Cheque number is required for cheque payment'
        });
      }

      const chequeDescription = notes 
        ? `${notes} (چیک نمبر: ${cheque_number})` 
        : `چیک نمبر: ${cheque_number}`;

      const cheque = await Cheque.create({
        bank_id: bank_id,
        cheque_number: cheque_number,
        cheque_type: 'received',
        amount: paymentAmount,
        payee_payer_name: customerName,
        description: chequeDescription,
        issue_date: payment_date ? new Date(payment_date) : new Date(),
        due_date: cheque_date ? new Date(cheque_date) : null,
        status: 'pending',
        created_by: req.user?.id,
      }, { transaction: t });

      chequeId = cheque.id;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Record Bank Transaction (if bank OR slip payment)
    // ═══════════════════════════════════════════════════════════════════════
    let bankTransaction = null;
    if (selectedBank && (payment_method === 'bank' || payment_method === 'slip')) {
      const currentBalance = parseFloat(selectedBank.balance);
      const newBalance = currentBalance + paymentAmount;

      await selectedBank.update(
        { balance: newBalance.toFixed(2) },
        { transaction: t }
      );

      let bankDescription = notes || '';

      bankTransaction = await BankTransaction.create({
        bank_id: bank_id,
        transaction_type: 'in',
        amount: paymentAmount.toFixed(2),
        description: bankDescription,
        reference_number: (payment_method === 'slip' && slip_number)
          ? slip_number
          : (sale.reference || sale.invoice_number),
        balance_after: newBalance.toFixed(2),
        created_by: req.user?.id,
        transaction_date: payment_date ? new Date(payment_date) : new Date()
      }, { transaction: t });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Update sale payment info
    // ═══════════════════════════════════════════════════════════════════════
    let newPaid = parseFloat(sale.amount_paid);
    let newStatus = sale.payment_status;

    if (payment_method !== 'cheque') {
      newPaid = Math.min(
        parseFloat(sale.amount_paid) + paymentAmount,
        parseFloat(sale.grand_total)
      );
      newStatus = newPaid >= parseFloat(sale.grand_total) ? 'paid' : 'partial';
    }

    // ✅ FIXED: Use `notes` instead of `paymentNotes`
    await sale.update({
      amount_paid: newPaid,
      payment_status: newStatus,
      payment_method: payment_method || sale.payment_method,
      notes: notes ? (sale.notes ? `${sale.notes}\n${notes}` : notes) : sale.notes,
    }, { transaction: t });

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Update cheque with sale_id reference
    // ═══════════════════════════════════════════════════════════════════════
    if (chequeId) {
      await Cheque.update(
        {
          sale_id: sale.id,
          customer_id: sale.customer_id,
        },
        { where: { id: chequeId }, transaction: t }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Create customer ledger entry for FULL payment amount
    // ═══════════════════════════════════════════════════════════════════════
    if (sale.customer_id) {
      let ledgerDescription = notes || '';
      if (payment_method === 'cheque' && cheque_number) {
        ledgerDescription = notes 
          ? `${notes} (چیک نمبر: ${cheque_number})` 
          : `چیک نمبر: ${cheque_number}`;
      }

      await createLedgerEntry({
        customerId: sale.customer_id,
        date: payment_date || new Date(),
        transactionType: 'payment',
        referenceId: sale.id,
        referenceNumber: sale.reference || sale.invoice_number,
        description: ledgerDescription,
        debit: paymentAmount,
        credit: 0,
        transaction: t,
        paymentMethod: payment_method,
        bankName: selectedBank?.name || bank_name || null,
        bankId: bank_id || null,
        chequeNumber: cheque_number || null,
        chequeDate: cheque_date ? new Date(cheque_date) : null,
      });

      const finalBalance = await getCustomerBalance(sale.customer_id, t);
      await Customer.update({ balance: finalBalance }, { where: { id: sale.customer_id }, transaction: t });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: Cashbook entries
    // ═══════════════════════════════════════════════════════════════════════
    let legacyCashbookEntryId = null;

    if (payment_method === 'cash' && sale.customer_id) {
      const legacyEntry = await createCashbookEntry({
        entry_date: payment_date || new Date(),
        entry_type: 'cash_in',
        source_type: 'customer_payment',
        reference_id: sale.id,
        reference_number: sale.reference || sale.invoice_number,
        description: notes,
        amount: paymentAmount,
        created_by: req.user?.id,
        transaction: t,
      });
      legacyCashbookEntryId = legacyEntry?.id || null;
    }

    // Simple cashbook
    if (from_simple_cashbook) {
      await createSimpleCashbookEntry({
        entry_date: payment_date || new Date(),
        entry_type: 'cash_in',
        source_type: 'customer_payment',
        reference_id: sale.id,
        reference_number: (payment_method === 'slip' && slip_number)
          ? slip_number
          : (sale.reference || sale.invoice_number),
        description: notes,
        amount: paymentAmount,
        bank_transaction_id: bankTransaction?.id || null,
        cheque_id: chequeId || null,
        legacy_cashbook_id: legacyCashbookEntryId,
        created_by: req.user?.id,
        transaction: t,
      });
    }

    await t.commit();

    const updated = await Sale.findByPk(id, {
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'name', 'balance'] }],
    });

    let successMessage = 'ادائیگی کامیابی سے ریکارڈ ہوگئی';
    
    if (overpaymentAmount > 0) {
      successMessage = `ادائیگی ${paymentAmount} ریکارڈ ہوگئی۔ (${amountToApply} لاگو ہوا، ${overpaymentAmount} زیادہ ادائیگی)`;
    } else if (payment_method === 'cheque' && cheque_number) {
      successMessage = `چیک #${cheque_number} ریکارڈ ہوگیا۔ حیثیت: زیر التواء (کلئرنگ کا انتظار)`;
    } else if (payment_method === 'bank' && selectedBank) {
      successMessage = `${selectedBank.name} میں بینک ٹرانسفر ریکارڈ ہوگیا۔ ${selectedBank.name} کا بیلنس Rs ${paymentAmount.toFixed(2)} بڑھ گیا`;
    } else if (payment_method === 'cash') {
      successMessage = `نقد ادائیگی Rs ${paymentAmount.toFixed(2)} کامیابی سے ریکارڈ ہوگئی`;
    } else if (payment_method === 'slip' && selectedBank) {
      successMessage = `سلیپ کے ذریعے ${selectedBank.name} میں Rs ${paymentAmount.toFixed(2)} جمع ہوگئی`;
    } else if (payment_method === 'slip') {
      successMessage = `سلیپ کے ذریعے ادائیگی Rs ${paymentAmount.toFixed(2)} کامیابی سے ریکارڈ ہوگئی`;
    }

    res.json({ 
      success: true, 
      message: successMessage,
      data: {
        sale: updated,
        cheque_id: chequeId,
        bank_transaction: bankTransaction,
        overpayment: overpaymentAmount,
        applied_amount: Math.min(paymentAmount, outstandingBalance)
      }
    });
  } catch (error) {
    await t.rollback();
    console.error('Record payment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'سرور کی خرابی', 
      error: error.message 
    });
  }
};


exports.getCreditSalesSummary = async (req, res) => {
  try {
    const { customer_id } = req.query;
    const whereClause = { payment_method: 'credit', payment_status: { [Op.ne]: 'paid' } };
    if (customer_id) whereClause.customer_id = customer_id;

    const creditSales = await Sale.findAll({
      where: whereClause,
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'name', 'contact'] }],
      order: [['due_date', 'ASC']],
    });

    const totalOutstanding = creditSales.reduce((sum, sale) => sum + (sale.grand_total - sale.amount_paid), 0);
    const overdueSales = creditSales.filter(sale =>
      sale.due_date && new Date(sale.due_date) < new Date() && sale.payment_status !== 'paid'
    );

    res.json({
      success: true,
      data: {
        credit_sales: creditSales,
        summary: {
          total_outstanding: totalOutstanding,
          total_credit_sales: creditSales.length,
          overdue_count: overdueSales.length,
          overdue_amount: overdueSales.reduce((sum, sale) => sum + (sale.grand_total - sale.amount_paid), 0),
        },
      },
    });
  } catch (error) {
    console.error('Get credit sales summary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};