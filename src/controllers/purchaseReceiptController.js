// backend/src/controllers/purchaseReceiptController.js

const { Op } = require('sequelize');
const {
  PurchaseReceipt,
  PurchaseReceiptItem,
  PurchaseOrder,
  PurchaseOrderItem,
  Product,
  SupplierLedger,  // ← Add this import
  sequelize,
} = require('../models');
const {
  createLedgerEntry,
  reverseLedgerEntry,
} = require('./supplierLedgerController');

// Generate receipt number
const generateReceiptNumber = async () => {
  const date = new Date();
  const year  = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  const lastReceipt = await PurchaseReceipt.findOne({
    where: { receipt_number: { [Op.like]: `RCP-${year}${month}%` } },
    order: [['id', 'DESC']],
  });

  let sequence = '0001';
  if (lastReceipt) {
    const lastNumber = lastReceipt.receipt_number.split('-')[2];
    sequence = (parseInt(lastNumber) + 1).toString().padStart(4, '0');
  }
  return `RCP-${year}${month}-${sequence}`;
};

// ── Create purchase receipt ───────────────────────────────────────────────────
exports.createPurchaseReceipt = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { purchase_order_id, receipt_date, items, notes } = req.body;

    // ── Validate required fields ─────────────────────────────────────────────
    if (!purchase_order_id || !items || !items.length) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order and items are required',
      });
    }

    // ── Parse and validate receipt date ──────────────────────────────────────
    let parsedReceiptDate;
    if (receipt_date) {
      parsedReceiptDate = new Date(receipt_date);
      if (isNaN(parsedReceiptDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid receipt date format. Please provide a valid date.',
        });
      }
    } else {
      parsedReceiptDate = new Date();
    }

    // ── Fetch purchase order with items ───────────────────────────────────────
    const purchaseOrder = await PurchaseOrder.findByPk(purchase_order_id, {
      include: [{ model: PurchaseOrderItem, as: 'items' }],
    });

    if (!purchaseOrder) {
      return res.status(404).json({ 
        success: false, 
        message: 'Purchase order not found' 
      });
    }
    
    if (purchaseOrder.status === 'received') {
      return res.status(400).json({ 
        success: false, 
        message: 'Purchase order already fully received' 
      });
    }

    // ── Generate receipt number ───────────────────────────────────────────────
    const receipt_number = await generateReceiptNumber();

    // ── Create purchase receipt ───────────────────────────────────────────────
    const receipt = await PurchaseReceipt.create(
      {
        receipt_number,
        purchase_order_id,
        receipt_date: parsedReceiptDate,
        status: 'completed',
        notes,
        created_by: req.user?.id,
      },
      { transaction }
    );

    let receiptTotal = 0;

    // ── Process each receipt item ─────────────────────────────────────────────
    for (const item of items) {
      // ── PO-linked item ────────────────────────────────────────────────────
      if (item.purchase_order_item_id != null) {
        const poItem = purchaseOrder.items.find(
          (i) => i.id === item.purchase_order_item_id
        );

        if (!poItem) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Invalid purchase order item ID: ${item.purchase_order_item_id}`,
          });
        }

        const newReceived = poItem.quantity_received + item.quantity_received;
        
        // Calculate line total
        const lineTotal = item.quantity_received * parseFloat(poItem.unit_cost);
        receiptTotal += lineTotal;

        // Create receipt item record
        await PurchaseReceiptItem.create(
          {
            purchase_receipt_id: receipt.id,
            purchase_order_item_id: poItem.id,
            product_id: poItem.product_id,
            quantity_received: item.quantity_received,
            unit_cost: poItem.unit_cost,
            batch_number: item.batch_number || null,
            expiry_date: item.expiry_date || null,
            notes: item.notes || null,
          },
          { transaction }
        );

        // Update PO item received quantity
        await poItem.update({ quantity_received: newReceived }, { transaction });

        // Update product stock
        const product = await Product.findByPk(poItem.product_id);
        if (product) {
          await product.update(
            {
              physical_qty: product.physical_qty + item.quantity_received,
              available_qty: product.available_qty + item.quantity_received,
            },
            { transaction }
          );
        }

      // ── Extra item (not in PO) ────────────────────────────────────────────
      } else {
        if (!item.product_id || !item.quantity_received) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: 'Extra items must have product_id and quantity_received',
          });
        }

        const unitCost = parseFloat(item.unit_cost || 0);
        const discountPercent = parseFloat(item.discount_percent || 0);
        
        // Calculate line total with discount
        const subtotal = item.quantity_received * unitCost;
        const afterDiscount = subtotal * (1 - discountPercent / 100);
        const lineTotal = afterDiscount; // No tax for extra items in this example
        receiptTotal += lineTotal;

        // Create receipt item record for extra item
        await PurchaseReceiptItem.create(
          {
            purchase_receipt_id: receipt.id,
            purchase_order_item_id: null,
            product_id: item.product_id,
            quantity_received: item.quantity_received,
            unit_cost: unitCost,
            batch_number: item.batch_number || null,
            expiry_date: item.expiry_date || null,
            notes: item.notes || null,
          },
          { transaction }
        );

        // Update product stock
        const product = await Product.findByPk(item.product_id);
        if (product) {
          await product.update(
            {
              physical_qty: product.physical_qty + item.quantity_received,
              available_qty: product.available_qty + item.quantity_received,
            },
            { transaction }
          );
        }
      }
    }

    // ── Update PO status based on receipt ─────────────────────────────────────
    const refreshedPO = await PurchaseOrder.findByPk(purchase_order_id, {
      include: [{ model: PurchaseOrderItem, as: 'items' }],
      transaction,
    });
    
    const poFullyReceived = refreshedPO.items.every(
      (i) => i.quantity_received >= i.quantity_ordered
    );
    
    await purchaseOrder.update(
      { 
        status: poFullyReceived ? 'received' : 'partial', 
        delivery_date: parsedReceiptDate // Use receipt date for delivery
      },
      { transaction }
    );

    // ── CREATE SUPPLIER LEDGER ENTRY WITH RECEIPT DATE ────────────────────────
    // Goods received = we owe supplier = CREDIT entry
    await createLedgerEntry({
      supplier_id: purchaseOrder.supplier_id,
      reference_type: 'purchase_receipt',
      reference_id: receipt.id,
      reference_number: receipt_number,
      debit: 0,
      credit: receiptTotal,
      description: `Goods received against PO ${purchaseOrder.po_number} — Receipt ${receipt_number}`,
      transaction_date: parsedReceiptDate, // Use the receipt date from frontend
      created_by: req.user?.id,
      transaction,
    });

    // ── Commit transaction ────────────────────────────────────────────────────
    await transaction.commit();

    // ── Fetch complete receipt for response ───────────────────────────────────
    const createdReceipt = await PurchaseReceipt.findByPk(receipt.id, {
      include: [
        { model: PurchaseOrder, as: 'purchaseOrder' },
        {
          model: PurchaseReceiptItem,
          as: 'items',
          include: [
            { 
              model: Product, 
              as: 'product', 
              attributes: ['id', 'item_name', 'barcode'] 
            }
          ],
        },
      ],
    });

    res.status(201).json({
      success: true,
      message: 'Purchase receipt created successfully',
      data: createdReceipt,
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Create purchase receipt error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
};

// ── Get receipts for a PO ─────────────────────────────────────────────────────
exports.getReceiptsByPurchaseOrder = async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;

    const receipts = await PurchaseReceipt.findAll({
      where: { purchase_order_id: purchaseOrderId },
      include: [
        {
          model: PurchaseReceiptItem,
          as: 'items',
          include: [{ model: Product, as: 'product', attributes: ['id', 'item_name', 'barcode'] }],
        },
      ],
      order: [['receipt_date', 'DESC']],
    });

    res.json({ success: true, data: receipts });
  } catch (error) {
    console.error('Get receipts error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── Delete purchase receipt — DELETE ledger entry instead of reversing ────────
exports.deletePurchaseReceipt = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;

    const receipt = await PurchaseReceipt.findByPk(id, {
      include: [
        { model: PurchaseReceiptItem, as: 'items' },
        { model: PurchaseOrder, as: 'purchaseOrder' }
      ],
    });

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Receipt not found' });
    }

    // ── Calculate receipt total before deletion ───────────────────────────────
    let receiptTotal = 0;
    for (const receiptItem of receipt.items) {
      if (receiptItem.purchase_order_item_id != null) {
        const poItem = await PurchaseOrderItem.findByPk(receiptItem.purchase_order_item_id);
        if (poItem) {
          receiptTotal += receiptItem.quantity_received * parseFloat(poItem.unit_cost);
        }
      } else {
        receiptTotal += receiptItem.quantity_received * parseFloat(receiptItem.unit_cost);
      }
    }

    // ── Reverse stock & PO item quantities ───────────────────────────────────
    for (const receiptItem of receipt.items) {
      const product = await Product.findByPk(receiptItem.product_id);
      if (product) {
        await product.update(
          {
            physical_qty:  Math.max(0, product.physical_qty  - receiptItem.quantity_received),
            available_qty: Math.max(0, product.available_qty - receiptItem.quantity_received),
          },
          { transaction }
        );
      }

      if (receiptItem.purchase_order_item_id != null) {
        const poItem = await PurchaseOrderItem.findByPk(receiptItem.purchase_order_item_id);
        if (poItem) {
          await poItem.update(
            { quantity_received: Math.max(0, poItem.quantity_received - receiptItem.quantity_received) },
            { transaction }
          );
        }
      }
    }

    // ── Recalculate PO status ─────────────────────────────────────────────────
    const purchaseOrder = await PurchaseOrder.findByPk(receipt.purchase_order_id, {
      include: [{ model: PurchaseOrderItem, as: 'items' }],
    });

    if (purchaseOrder) {
      const updatedItems = await PurchaseOrderItem.findAll({
        where: { purchase_order_id: purchaseOrder.id },
        transaction,
      });
      const totalOrdered  = updatedItems.reduce((s, i) => s + i.quantity_ordered,  0);
      const totalReceived = updatedItems.reduce((s, i) => s + i.quantity_received, 0);

      let newStatus;
      if (totalReceived === 0)             newStatus = 'ordered';
      else if (totalReceived < totalOrdered) newStatus = 'partial';
      else                                   newStatus = 'received';

      await purchaseOrder.update(
        { status: newStatus, delivery_date: totalReceived === 0 ? null : purchaseOrder.delivery_date },
        { transaction }
      );

      // ── DELETE SUPPLIER LEDGER ENTRY instead of reversing ───────────────────
      // Find and delete the ledger entry for this receipt
      const ledgerEntry = await SupplierLedger.findOne({
        where: {
          reference_type: 'purchase_receipt',
          reference_id: receipt.id,
        },
        transaction,
      });

      if (ledgerEntry) {
        // Delete the ledger entry
        await ledgerEntry.destroy({ transaction });
        
        // Recalculate all remaining ledger balances for this supplier
        const remainingEntries = await SupplierLedger.findAll({
          where: { supplier_id: purchaseOrder.supplier_id },
          order: [['transaction_date', 'ASC'], ['id', 'ASC']],
          transaction,
        });

        let runningBalance = 0;
        for (const remainingEntry of remainingEntries) {
          runningBalance += parseFloat(remainingEntry.credit) - parseFloat(remainingEntry.debit);
          await remainingEntry.update({ balance: runningBalance.toFixed(2) }, { transaction });
        }
      }
    }

    // ── Delete receipt items & receipt ────────────────────────────────────────
    await PurchaseReceiptItem.destroy({ where: { purchase_receipt_id: id }, transaction });
    await receipt.destroy({ transaction });

    await transaction.commit();

    res.json({ success: true, message: 'Receipt deleted, stock reversed, and ledger entry removed successfully' });
  } catch (error) {
    await transaction.rollback();
    console.error('Delete purchase receipt error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── Get single receipt by ID ──────────────────────────────────────────────────
exports.getPurchaseReceiptById = async (req, res) => {
  try {
    const { id } = req.params;

    const receipt = await PurchaseReceipt.findByPk(id, {
      include: [
        {
          model: PurchaseReceiptItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'item_name', 'barcode'],
            },
          ],
        },
      ],
    });

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Receipt not found' });
    }

    res.json({ success: true, data: receipt });
  } catch (error) {
    console.error('Get receipt by ID error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};