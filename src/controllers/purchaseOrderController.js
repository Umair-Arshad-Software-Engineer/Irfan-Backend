// backend/src/controllers/purchaseOrderController.js
const { Op } = require('sequelize');
const { 
  PurchaseOrder, 
  PurchaseOrderItem, 
  PurchaseReceipt,
  PurchaseReceiptItem,  // ← ADD THIS LINE
  Supplier, 
  Product, 
  Unit,
  sequelize 
} = require('../models');

// Generate PO number
const generatePONumber = async () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  
  const lastPO = await PurchaseOrder.findOne({
    where: {
      po_number: {
        [Op.like]: `PO-${year}${month}%`
      }
    },
    order: [['id', 'DESC']]
  });

  let sequence = '0001';
  if (lastPO) {
    const lastNumber = lastPO.po_number.split('-')[2];
    sequence = (parseInt(lastNumber) + 1).toString().padStart(4, '0');
  }

  return `PO-${year}${month}-${sequence}`;
};

// Get all purchase orders
exports.getAllPurchaseOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      supplier_id,
      from_date,
      to_date,
      search
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const whereClause = {};

    if (status) whereClause.status = status;
    if (supplier_id) whereClause.supplier_id = supplier_id;
    
    if (from_date || to_date) {
      whereClause.order_date = {};
      if (from_date) whereClause.order_date[Op.gte] = new Date(from_date);
      if (to_date) whereClause.order_date[Op.lte] = new Date(to_date);
    }

    if (search) {
      whereClause[Op.or] = [
        { po_number: { [Op.like]: `%${search}%` } },
        { '$supplier.name$': { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows: orders } = await PurchaseOrder.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Supplier,
          as: 'supplier',
          attributes: ['id', 'name', 'contact']
        },
        {
          model: PurchaseOrderItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'item_name', 'barcode'],
              include: [
                {
                  model: Unit,
                  as: 'unit',
                  attributes: ['id', 'name', 'symbol']
                }
              ]
            }
          ]
        }
      ],
      order: [['created_at', 'DESC']],
      limit: limitNum,
      offset: offset,
      distinct: true
    });

    res.json({
      success: true,
      data: orders,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get purchase order by ID
exports.getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await PurchaseOrder.findByPk(id, {
      include: [
        {
          model: Supplier,
          as: 'supplier',
          attributes: ['id', 'name', 'contact', 'address']
        },
        {
          model: PurchaseOrderItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              attributes: ['id', 'item_name', 'barcode', 'cost_price', 'sale_price'],
              include: [
                {
                  model: Unit,
                  as: 'unit',
                  attributes: ['id', 'name', 'symbol']
                }
              ]
            },
            {
              model: PurchaseReceiptItem,
              as: 'receiptItems',
              include: [
                {
                  model: PurchaseReceipt,
                  as: 'purchaseReceipt',
                  attributes: ['id', 'receipt_number', 'receipt_date', 'status']
                }
              ]
            }
          ]
        },
        {
          model: PurchaseReceipt,
          as: 'receipts',
          include: [
            {
              model: PurchaseReceiptItem,
              as: 'items',
              include: [
                {
                  model: Product,
                  as: 'product',
                  attributes: ['id', 'item_name']
                }
              ]
            }
          ]
        }
      ]
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Get purchase order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Create purchase order
exports.createPurchaseOrder = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      supplier_id,
      order_date,           // ← Add this to destructuring
      expected_delivery_date,
      items,
      notes,
      terms_conditions,
      payment_terms,
      tax_amount,
      discount_amount,
      shipping_cost
    } = req.body;

    // Validate required fields
    if (!supplier_id || !items || !items.length) {
      return res.status(400).json({
        success: false,
        message: 'Supplier and items are required'
      });
    }

    // ── Parse and validate order date ──────────────────────────────────────
    let parsedOrderDate;
    // ✅ نیا - UTC میں parse کریں تاکہ timezone shift نہ ہو
    if (order_date) {
      // "2025-01-15" format کو UTC midnight پر set کریں
      parsedOrderDate = new Date(order_date + 'T00:00:00.000Z');
      if (isNaN(parsedOrderDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid order date format.'
        });
      }
    } else {
      parsedOrderDate = new Date();
    }

    // ── Parse expected delivery date if provided ───────────────────────────
    let parsedExpectedDeliveryDate = null;
    if (expected_delivery_date) {
      parsedExpectedDeliveryDate = new Date(expected_delivery_date + 'T00:00:00.000Z');
      if (isNaN(parsedExpectedDeliveryDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid expected delivery date format.'
        });
      }
    }

    // Generate PO number
    const po_number = await generatePONumber();

    // Calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const qty = item.quantity_ordered;
      const cost = item.unit_cost;
      const discountPercent = item.discount_percent || 0;
      const taxPercent = item.tax_percent || 0;

      // Raw line amount
      const rawTotal = qty * cost;

      // Apply item-level discount
      const afterDiscount = rawTotal * (1 - discountPercent / 100);

      // Apply item-level tax
      const lineTotal = afterDiscount * (1 + taxPercent / 100);

      subtotal += lineTotal;

      orderItems.push({
        product_id: item.product_id,
        quantity_ordered: qty,
        unit_cost: cost,
        line_total: parseFloat(lineTotal.toFixed(2)),
        discount_percent: discountPercent,
        tax_percent: taxPercent,
        notes: item.notes
      });
    }

    const total_amount = parseFloat(
      (subtotal + (tax_amount || 0) + (shipping_cost || 0) - (discount_amount || 0)).toFixed(2)
    );

    // Create purchase order with the parsed order date
    const purchaseOrder = await PurchaseOrder.create({
      po_number,
      supplier_id,
      order_date: parsedOrderDate,  // ← Use the date from frontend
      expected_delivery_date: parsedExpectedDeliveryDate,
      status: 'draft',
      subtotal: parseFloat(subtotal.toFixed(2)),
      tax_amount: tax_amount || 0,
      discount_amount: discount_amount || 0,
      shipping_cost: shipping_cost || 0,
      total_amount,
      notes,
      terms_conditions,
      payment_terms,
      created_by: req.user?.id
    }, { transaction });

    // Create order items
    for (const item of orderItems) {
      await PurchaseOrderItem.create({
        ...item,
        purchase_order_id: purchaseOrder.id
      }, { transaction });
    }

    await transaction.commit();

    // Fetch the created order with relations
    const createdOrder = await PurchaseOrder.findByPk(purchaseOrder.id, {
      include: [
        {
          model: Supplier,
          as: 'supplier'
        },
        {
          model: PurchaseOrderItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              include: [{ model: Unit, as: 'unit' }]
            }
          ]
        }
      ]
    });

    res.status(201).json({
      success: true,
      message: 'Purchase order created successfully',
      data: createdOrder
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Create purchase order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Update purchase order status
exports.updatePurchaseOrderStatus = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { status } = req.body;

    const order = await PurchaseOrder.findByPk(id, {
      include: [{ model: PurchaseOrderItem, as: 'items' }]
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    // Validate status transition
    const validTransitions = {
      draft: ['ordered', 'cancelled'],
      ordered: ['partial', 'received', 'cancelled'],
      partial: ['received', 'cancelled'],
      received: [],
      cancelled: []
    };

    if (!validTransitions[order.status].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${order.status} to ${status}`
      });
    }

    await order.update({ status }, { transaction });

    // If status changed to ordered, update product costs? (optional)
    if (status === 'ordered') {
      // You might want to update product cost prices here
      // This depends on your business logic
    }

    await transaction.commit();

    res.json({
      success: true,
      message: `Purchase order status updated to ${status}`,
      data: order
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Update purchase order status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Delete purchase order (only draft)
exports.deletePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await PurchaseOrder.findByPk(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    // Allow delete for draft and cancelled only
    if (order.status !== 'draft' && order.status !== 'cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete a purchase order with status "${order.status}". Only draft or cancelled orders can be deleted.`
      });
    }

    await order.destroy();

    res.json({
      success: true,
      message: 'Purchase order deleted successfully'
    });
  } catch (error) {
    console.error('Delete purchase order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
