// backend/src/controllers/supplierReturnController.js
const { Op } = require('sequelize');
const {
  SupplierReturn,
  SupplierReturnItem,
  Supplier,
  Product,
  Unit,
  PurchaseOrder,
  SupplierLedger,
  sequelize
} = require('../models');
const { createLedgerEntry } = require('./supplierLedgerController');

// Generate return number
const generateReturnNumber = async () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  const lastReturn = await SupplierReturn.findOne({
    where: {
      return_number: { [Op.like]: `SRT-${year}${month}%` }
    },
    order: [['id', 'DESC']]
  });

  let sequence = '0001';
  if (lastReturn) {
    const lastNumber = lastReturn.return_number.split('-')[2];
    sequence = (parseInt(lastNumber) + 1).toString().padStart(4, '0');
  }

  return `SRT-${year}${month}-${sequence}`;
};

// ── Create supplier return ──────────────────────────────────────────────────
exports.createSupplierReturn = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      supplier_id,
      purchase_order_id,
      return_date,
      items,
      notes,
      reference,
      discount_amount = 0,
      tax_amount = 0
    } = req.body;

    // Validate
    if (!supplier_id || !items || !items.length) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Supplier and items are required'
      });
    }

    // Parse date
    let parsedReturnDate;
    if (return_date) {
      parsedReturnDate = new Date(return_date + 'T00:00:00.000Z');
      if (isNaN(parsedReturnDate.getTime())) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Invalid return date format'
        });
      }
    } else {
      parsedReturnDate = new Date();
    }

    // Generate return number
    const return_number = await generateReturnNumber();

    // ── Calculate totals — line_total = unit_cost × weight ─────────────
    let subtotal = 0;
    const returnItems = [];

    for (const item of items) {
      const qty = item.quantity || 0;
      const pcs = item.pcs || 0;
      const weight = parseFloat(item.weight) || 0;
      const cost = parseFloat(item.unit_cost) || 0;

      // ✅ FORMULA: price × weight
      const lineTotal = cost * weight;

      subtotal += lineTotal;

      returnItems.push({
        product_id: item.product_id,
        quantity: qty,
        pcs: pcs,
        weight: weight,
        unit_cost: cost,
        line_total: parseFloat(lineTotal.toFixed(2)),
        selected_lengths: null,
        total_pieces: pcs > 0 ? pcs : qty,
        notes: item.notes || null
      });
    }

    const total_amount = parseFloat(
      (subtotal + (tax_amount || 0) - (discount_amount || 0)).toFixed(2)
    );

    // Create return
    const supplierReturn = await SupplierReturn.create({
      return_number,
      supplier_id,
      purchase_order_id: purchase_order_id || null,
      return_date: parsedReturnDate,
      subtotal: parseFloat(subtotal.toFixed(2)),
      tax_amount: tax_amount || 0,
      discount_amount: discount_amount || 0,
      total_amount,
      status: 'completed',
      notes,
      reference,
      created_by: req.user?.id
    }, { transaction });

    // Create return items
    for (const item of returnItems) {
      await SupplierReturnItem.create({
        ...item,
        supplier_return_id: supplierReturn.id
      }, { transaction });
    }

    // ── Update product stock (REDUCE by pcs) ───────────────────────────
    for (const item of returnItems) {
      const product = await Product.findByPk(item.product_id, { transaction });
      if (product) {
        const deductQty = item.pcs > 0 ? item.pcs : item.quantity;
        await product.update({
          physical_qty: Math.max(0, product.physical_qty - deductQty),
          available_qty: Math.max(0, product.available_qty - deductQty)
        }, { transaction });
      }
    }

    // ── Create ledger entry (DEBIT — we owe less to supplier) ──────────
    await createLedgerEntry({
      supplier_id,
      reference_type: 'supplier_return',
      reference_id: supplierReturn.id,
      reference_number: return_number,
      debit: total_amount,
      credit: 0,
      description: `Goods returned to supplier — Return ${return_number}`,
      transaction_date: parsedReturnDate,
      created_by: req.user?.id,
      transaction
    });

    await transaction.commit();

    // Fetch complete return
    const createdReturn = await SupplierReturn.findByPk(supplierReturn.id, {
      include: [
        { model: Supplier, as: 'supplier', attributes: ['id', 'name', 'contact'] },
        {
          model: SupplierReturnItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'item_name', 'barcode'],
              include: [{ model: Unit, as: 'unit', attributes: ['id', 'name', 'symbol'] }]
            }
          ]
        }
      ]
    });

    res.status(201).json({
      success: true,
      message: 'Supplier return created successfully',
      data: createdReturn
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Create supplier return error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ── Get all supplier returns ────────────────────────────────────────────────
exports.getAllSupplierReturns = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      supplier_id,
      from_date,
      to_date,
      search
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const whereClause = {};

    if (supplier_id) whereClause.supplier_id = supplier_id;

    if (from_date || to_date) {
      whereClause.return_date = {};
      if (from_date) whereClause.return_date[Op.gte] = new Date(from_date);
      if (to_date) whereClause.return_date[Op.lte] = new Date(to_date + 'T23:59:59.999Z');
    }

    if (search) {
      whereClause[Op.or] = [
        { return_number: { [Op.like]: `%${search}%` } },
        { reference: { [Op.like]: `%${search}%` } },
        { '$supplier.name$': { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows: returns } = await SupplierReturn.findAndCountAll({
      where: whereClause,
      include: [
        { model: Supplier, as: 'supplier', attributes: ['id', 'name', 'contact'] },
        {
          model: SupplierReturnItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'item_name', 'barcode']
            }
          ]
        }
      ],
      order: [['return_date', 'DESC'], ['id', 'DESC']],
      limit: limitNum,
      offset,
      distinct: true
    });

    res.json({
      success: true,
      data: returns,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum)
      }
    });

  } catch (error) {
    console.error('Get supplier returns error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ── Get supplier return by ID ───────────────────────────────────────────────
exports.getSupplierReturnById = async (req, res) => {
  try {
    const { id } = req.params;

    const supplierReturn = await SupplierReturn.findByPk(id, {
      include: [
        { model: Supplier, as: 'supplier' },
        {
          model: SupplierReturnItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              include: [{ model: Unit, as: 'unit' }]
            }
          ]
        },
        { model: PurchaseOrder, as: 'purchaseOrder', attributes: ['id', 'po_number'] }
      ]
    });

    if (!supplierReturn) {
      return res.status(404).json({
        success: false,
        message: 'Supplier return not found'
      });
    }

    res.json({
      success: true,
      data: supplierReturn
    });

  } catch (error) {
    console.error('Get supplier return error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ── Delete supplier return ──────────────────────────────────────────────────
exports.deleteSupplierReturn = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;

    const supplierReturn = await SupplierReturn.findByPk(id, {
      include: [{ model: SupplierReturnItem, as: 'items' }]
    });

    if (!supplierReturn) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Supplier return not found'
      });
    }

    // ── Reverse stock updates (ADD BACK by pcs) ────────────────────────
    for (const item of supplierReturn.items) {
      const product = await Product.findByPk(item.product_id, { transaction });
      if (product) {
        const addBackQty = item.pcs > 0 ? item.pcs : item.quantity;
        await product.update({
          physical_qty: product.physical_qty + addBackQty,
          available_qty: product.available_qty + addBackQty
        }, { transaction });
      }
    }

    // ── Delete ledger entry ────────────────────────────────────────────
    const ledgerEntry = await SupplierLedger.findOne({
      where: {
        reference_type: 'supplier_return',
        reference_id: supplierReturn.id
      },
      transaction
    });

    if (ledgerEntry) {
      await ledgerEntry.destroy({ transaction });

      // Recalculate remaining ledger balances
      const remainingEntries = await SupplierLedger.findAll({
        where: { supplier_id: supplierReturn.supplier_id },
        order: [['transaction_date', 'ASC'], ['id', 'ASC']],
        transaction
      });

      let runningBalance = 0;
      for (const entry of remainingEntries) {
        runningBalance += parseFloat(entry.credit) - parseFloat(entry.debit);
        await entry.update({ balance: runningBalance.toFixed(2) }, { transaction });
      }
    }

    // ── Delete return items and return ─────────────────────────────────
    await SupplierReturnItem.destroy({
      where: { supplier_return_id: id },
      transaction
    });

    await supplierReturn.destroy({ transaction });

    await transaction.commit();

    res.json({
      success: true,
      message: 'Supplier return deleted successfully'
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Delete supplier return error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};