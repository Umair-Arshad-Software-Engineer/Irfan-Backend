// controllers/productController.js
const { Op } = require('sequelize');
const {
  Product,
  Supplier,
  Category,
  Subcategory,
  Unit,
  Customer,
  CustomerPrice,
  Sale,
  SaleItem,
  PurchaseReceipt,
  PurchaseReceiptItem,
  PurchaseOrder,
} = require('../models');


exports.getProductHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, type } = req.query;

    const pageNum  = parseInt(page);
    const limitNum = parseInt(limit);
    const offset   = (pageNum - 1) * limitNum;

    const product = await Product.findByPk(id, {
      attributes: ['id', 'item_name'],
    });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const results = { sale_history: [], purchase_history: [] };

    // ── Sale history ──────────────────────────────────────────────────────────
    if (!type || type === 'sale') {
      const { count: saleCount, rows: saleItems } = await SaleItem.findAndCountAll({
        where: { product_id: id },
        include: [
          {
            model: Sale,
            as: 'sale',
            attributes: [
              'id', 'invoice_number', 'sale_type', 'sale_date',
              'grand_total', 'payment_status', 'payment_method',
            ],
            include: [
              {
                model: Customer,
                as: 'customer',
                attributes: ['id', 'name', 'contact'],
              },
            ],
          },
        ],
        attributes: ['id', 'quantity', 'unit_price', 'total_price'],
        order: [[{ model: Sale, as: 'sale' }, 'sale_date', 'DESC']],
        limit:  type === 'sale' ? limitNum : undefined,
        offset: type === 'sale' ? offset   : undefined,
        distinct: true,
      });

      results.sale_history = saleItems.map((si) => ({
        id:             si.sale.id,
        invoice_number: si.sale.invoice_number,
        sale_type:      si.sale.sale_type,
        date:           si.sale.sale_date,
        customer:       si.sale.customer,
        quantity:       si.quantity,
        unit_price:     si.unit_price,
        total_price:    si.total_price,
        payment_status: si.sale.payment_status,
        payment_method: si.sale.payment_method,
        grand_total:    si.sale.grand_total,
      }));
      results.sale_count = saleCount;
    }

    // ── Purchase (receipt) history ────────────────────────────────────────────
    if (!type || type === 'purchase') {
      const { count: purchaseCount, rows: receiptItems } = await PurchaseReceiptItem.findAndCountAll({
        where: { product_id: id },
        include: [
          {
            model: PurchaseReceipt,
            as: 'purchaseReceipt',
            attributes: ['id', 'receipt_number', 'receipt_date', 'status', 'notes'],
            include: [
              {
                model: PurchaseOrder,
                as: 'purchaseOrder',
                attributes: ['id', 'po_number', 'supplier_id'],
                include: [
                  {
                    model: Supplier,
                    as: 'supplier',
                    attributes: ['id', 'name', 'contact'],
                  },
                ],
              },
            ],
          },
        ],
        attributes: ['id', 'quantity_received', 'unit_cost', 'batch_number', 'expiry_date'],
        order: [[{ model: PurchaseReceipt, as: 'purchaseReceipt' }, 'receipt_date', 'DESC']],
        limit:  type === 'purchase' ? limitNum : undefined,
        offset: type === 'purchase' ? offset   : undefined,
        distinct: true,
      });

      results.purchase_history = receiptItems.map((ri) => ({
        id:                ri.purchaseReceipt.id,
        receipt_number:    ri.purchaseReceipt.receipt_number,
        po_number:         ri.purchaseReceipt.purchaseOrder?.po_number,
        date:              ri.purchaseReceipt.receipt_date,
        supplier:          ri.purchaseReceipt.purchaseOrder?.supplier,
        quantity_received: ri.quantity_received,
        unit_cost:         ri.unit_cost,
        total_cost:        ri.quantity_received * parseFloat(ri.unit_cost),
        batch_number:      ri.batch_number,
        expiry_date:       ri.expiry_date,
        status:            ri.purchaseReceipt.status,
      }));
      results.purchase_count = purchaseCount;
    }

    res.json({
      success: true,
      data: results,
      product: { id: product.id, name: product.item_name },
    });
  } catch (error) {
    console.error('Get product history error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get all products with pagination and filters
exports.getAllProducts = async (req, res) => {
  try {
    const {
      search,
      page = 1,
      limit = 20,
      supplier_id,
      category_id,
      subcategory_id,
      unit_id,
      low_stock,
      active,
      has_multiple_lengths,
      is_bom, // NEW: Filter by BOM type
      sort_by = 'item_name',
      sort_order = 'ASC'
    } = req.query;

    const pageNum  = parseInt(page);
    const limitNum = parseInt(limit);
    const offset   = (pageNum - 1) * limitNum;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { item_name:   { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
        { barcode:     { [Op.like]: `%${search}%` } },
      ];
    }

    if (supplier_id)           whereClause.supplier_id          = supplier_id;
    if (category_id)           whereClause.category_id          = category_id;
    if (subcategory_id)        whereClause.subcategory_id       = subcategory_id;
    if (unit_id)               whereClause.unit_id              = unit_id;
    if (active !== undefined)  whereClause.is_active            = active === 'true';
    if (has_multiple_lengths !== undefined)
                               whereClause.has_multiple_lengths = has_multiple_lengths === 'true';
    if (is_bom !== undefined)  whereClause.is_bom               = is_bom === 'true'; // NEW

    const { count, rows: products } = await Product.findAndCountAll({
      where: whereClause,
      include: [
        { model: Supplier,    as: 'supplier',    attributes: ['id', 'name', 'contact'] },
        { model: Category,    as: 'category',    attributes: ['id', 'name'] },
        { model: Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
        { model: Unit,        as: 'unit',        attributes: ['id', 'name', 'symbol'] },
        {
          model: CustomerPrice,
          as: 'customerPrices',
          include: [{ model: Customer, as: 'customer', attributes: ['id', 'name', 'customer_type'] }],
          required: false,
        },
      ],
      attributes: [
        'id', 'item_name', 'description', 'cost_price', 'sale_price',
        'barcode', 'min_stock', 'physical_qty', 'available_qty',
        'length_combinations', 'has_multiple_lengths',
        'is_active', 'created_at', 'updated_at',
        'is_bom', 'bom_components', 'bom_total_cost', // NEW BOM fields
      ],
      order: [[sort_by, sort_order]],
      limit: limitNum,
      offset,
      distinct: true,
    });

    const totalValue = products.reduce((sum, p) =>
      sum + (parseFloat(p.cost_price) * p.physical_qty), 0);

    res.json({
      success: true,
      data: products,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum),
      },
      summary: {
        total_products:   count,
        total_value:      totalValue,
        low_stock_count:  products.filter(p => p.physical_qty <= p.min_stock).length,
        bom_count:        products.filter(p => p.is_bom).length, // NEW
      },
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get product by ID
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByPk(id, {
      include: [
        { model: Supplier,    as: 'supplier',    attributes: ['id', 'name', 'contact'] },
        { model: Category,    as: 'category',    attributes: ['id', 'name'] },
        { model: Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
        { model: Unit,        as: 'unit',        attributes: ['id', 'name', 'symbol', 'conversion_factor'] },
        {
          model: CustomerPrice,
          as: 'customerPrices',
          include: [{ model: Customer, as: 'customer', attributes: ['id', 'name', 'customer_type'] }],
        },
      ],
      attributes: [
        'id', 'item_name', 'description', 'cost_price', 'sale_price',
        'supplier_id', 'category_id', 'subcategory_id', 'unit_id',
        'barcode', 'min_stock', 'physical_qty', 'available_qty',
        'length_combinations', 'has_multiple_lengths',
        'is_active', 'created_at', 'updated_at',
        'is_bom', 'bom_components', 'bom_total_cost', // NEW BOM fields
      ],
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get product by barcode
exports.getProductByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;

    const product = await Product.findOne({
      where: { barcode },
      include: [
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] },
        { model: Category, as: 'category', attributes: ['id', 'name'] },
        { model: Unit,     as: 'unit',     attributes: ['id', 'name', 'symbol'] },
      ],
      attributes: [
        'id', 'item_name', 'cost_price', 'sale_price', 'physical_qty',
        'is_bom', 'bom_components', 'bom_total_cost', // NEW BOM fields
      ],
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found with this barcode' });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Get product by barcode error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── Shared helper: normalise & validate length_combinations ──────────────────
function normaliseLengths(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { lengthCombinations: null, hasMultipleLengths: false };
  }
  const lengthCombinations = raw.map((item, i) => ({
    id:            item.id           ?? String(Date.now() + i),
    length:        item.length       ?? '',
    lengthDecimal: item.lengthDecimal ?? '',
  }));
  return { lengthCombinations, hasMultipleLengths: true };
}

// ── Shared helper: normalise & validate BOM components ───────────────────────
function normaliseBomComponents(rawComponents, productId = null) {
  if (!Array.isArray(rawComponents) || rawComponents.length === 0) {
    return null;
  }
  
  // Validate that components don't reference themselves
  const validatedComponents = rawComponents
    .filter(comp => !productId || (comp.productId !== productId && comp.product_id !== productId))
    .map((comp, i) => {
      // Handle both camelCase (frontend) and snake_case (backend) formats
      const product_id = comp.productId || comp.product_id;
      const product_name = comp.productName || comp.product_name;
      const quantity = parseFloat(comp.quantity) || 0;
      const unit = comp.unit || 'Pcs';
      const cost_per_unit = parseFloat(comp.costPerUnit || comp.cost_per_unit) || 0;
      const total_cost = parseFloat(comp.totalCost || comp.total_cost) || (cost_per_unit * quantity);
      const notes = comp.notes || null;
      
      // Allow negative quantities (for byproducts/wastage), but ensure product exists
      // Only filter out if quantity is zero or product_id/name missing
      if (!product_id || !product_name || quantity === 0) {
        console.warn('Invalid BOM component:', comp);
        return null;
      }
      
      return {
        id: comp.id || String(Date.now() + i),
        product_id: product_id,
        product_name: product_name,
        quantity: quantity,  // Keep negative values for byproducts
        unit: unit,
        cost_per_unit: cost_per_unit,
        total_cost: total_cost,
        notes: notes,
      };
    })
    .filter(comp => comp !== null); // Remove invalid components
  
  return validatedComponents.length > 0 ? validatedComponents : null;
}

function calculateBomTotalCost(components) {
  if (!components || !Array.isArray(components)) return null;
  // Sum all costs, including negative ones (which reduce total cost)
  return components.reduce((sum, comp) => sum + (comp.total_cost || 0), 0);
}

function calculateBomTotalCost(components) {
  if (!components || !Array.isArray(components)) return null;
  return components.reduce((sum, comp) => sum + (comp.total_cost || 0), 0);
}

// Create new product
exports.createProduct = async (req, res) => {
  try {
    const {
      item_name, description, cost_price, sale_price,
      supplier_id, category_id, subcategory_id, unit_id,
      barcode, min_stock, physical_qty,
      length_combinations,
      is_bom, bom_components, // NEW BOM fields
    } = req.body;

    // Debug logging
    console.log('Creating product with BOM data:', {
      is_bom,
      bom_components_received: bom_components,
      bom_components_type: typeof bom_components,
      bom_components_length: Array.isArray(bom_components) ? bom_components.length : 'not array'
    });

    if (!item_name || !category_id || !unit_id) {
      return res.status(400).json({
        success: false,
        message: 'Item name, category, and unit are required',
      });
    }

    if (barcode) {
      const existing = await Product.findOne({ where: { barcode } });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Product with this barcode already exists',
        });
      }
    }

    if (!await Category.findByPk(category_id))
      return res.status(404).json({ success: false, message: 'Category not found' });
    if (!await Unit.findByPk(unit_id))
      return res.status(404).json({ success: false, message: 'Unit not found' });
    if (supplier_id && !await Supplier.findByPk(supplier_id))
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    if (subcategory_id && !await Subcategory.findByPk(subcategory_id))
      return res.status(404).json({ success: false, message: 'Subcategory not found' });

    const { lengthCombinations, hasMultipleLengths } = normaliseLengths(length_combinations);
    
    // Process BOM components
    let bomComponents = null;
    let bomTotalCost = null;
    if (is_bom && bom_components && Array.isArray(bom_components) && bom_components.length > 0) {
      console.log('Processing BOM components:', bom_components);
      bomComponents = normaliseBomComponents(bom_components);
      console.log('Normalized BOM components:', bomComponents);
      
      if (bomComponents && bomComponents.length > 0) {
        bomTotalCost = calculateBomTotalCost(bomComponents);
        console.log('BOM total cost:', bomTotalCost);
        
        // Validate all component products exist
        for (const comp of bomComponents) {
          const componentProduct = await Product.findByPk(comp.product_id);
          if (!componentProduct) {
            return res.status(404).json({
              success: false,
              message: `Component product not found: ${comp.product_name}`,
            });
          }
        }
      }
    }

    const productData = {
      item_name,
      description,
      cost_price:           cost_price    || 0,
      sale_price:           sale_price    || 0,
      supplier_id,
      category_id,
      subcategory_id,
      unit_id,
      barcode,
      min_stock:            min_stock     || 0,
      physical_qty:         physical_qty  || 0,
      available_qty:        physical_qty  || 0,
      length_combinations:  lengthCombinations,
      has_multiple_lengths: hasMultipleLengths,
      is_active: true,
      is_bom:               is_bom || false,
      bom_components:       bomComponents,
      bom_total_cost:       bomTotalCost,
    };

    console.log('Final product data to save:', {
      ...productData,
      bom_components_length: productData.bom_components?.length,
      bom_total_cost: productData.bom_total_cost
    });

    const product = await Product.create(productData);

    const created = await Product.findByPk(product.id, {
      include: [
        { model: Supplier,    as: 'supplier',    attributes: ['id', 'name'] },
        { model: Category,    as: 'category',    attributes: ['id', 'name'] },
        { model: Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
        { model: Unit,        as: 'unit',        attributes: ['id', 'name', 'symbol'] },
      ],
    });

    res.status(201).json({
      success: true,
      message: is_bom ? 'BOM product created successfully' : 'Product created successfully',
      data: created,
    });
  } catch (error) {
    console.error('Create product error:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors.map(e => e.message),
      });
    }
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Update product
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      item_name, description, cost_price, sale_price,
      supplier_id, category_id, subcategory_id, unit_id,
      barcode, min_stock, physical_qty, is_active,
      length_combinations,
      is_bom, bom_components, // NEW BOM fields
    } = req.body;

    console.log('Updating product with BOM data:', {
      id,
      is_bom,
      bom_components_received: bom_components,
      bom_components_length: Array.isArray(bom_components) ? bom_components.length : 'not array'
    });

    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (barcode && barcode !== product.barcode) {
      const existing = await Product.findOne({ where: { barcode, id: { [Op.ne]: id } } });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Product with this barcode already exists',
        });
      }
    }

    if (category_id   && category_id   !== product.category_id   && !await Category.findByPk(category_id))
      return res.status(404).json({ success: false, message: 'Category not found' });
    if (unit_id       && unit_id       !== product.unit_id       && !await Unit.findByPk(unit_id))
      return res.status(404).json({ success: false, message: 'Unit not found' });
    if (supplier_id   && supplier_id   !== product.supplier_id   && !await Supplier.findByPk(supplier_id))
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    if (subcategory_id && subcategory_id !== product.subcategory_id && !await Subcategory.findByPk(subcategory_id))
      return res.status(404).json({ success: false, message: 'Subcategory not found' });

    // Resolve length_combinations: use incoming value if provided, keep existing otherwise
    let lengthCombinations  = product.length_combinations;
    let hasMultipleLengths  = product.has_multiple_lengths;
    if (length_combinations !== undefined) {
      ({ lengthCombinations, hasMultipleLengths } = normaliseLengths(length_combinations));
    }

    // Process BOM components
    let bomComponents = product.bom_components;
    let bomTotalCost = product.bom_total_cost;
    
    if (is_bom !== undefined || bom_components !== undefined) {
      const newIsBom = is_bom !== undefined ? is_bom : product.is_bom;
      const newComponents = bom_components !== undefined ? bom_components : product.bom_components;
      
      if (newIsBom && newComponents && Array.isArray(newComponents) && newComponents.length > 0) {
        bomComponents = normaliseBomComponents(newComponents, parseInt(id));
        console.log('Normalized BOM components for update:', bomComponents);
        
        if (bomComponents && bomComponents.length > 0) {
          bomTotalCost = calculateBomTotalCost(bomComponents);
          
          // Validate all component products exist
          for (const comp of bomComponents) {
            const componentProduct = await Product.findByPk(comp.product_id);
            if (!componentProduct) {
              return res.status(404).json({
                success: false,
                message: `Component product not found: ${comp.product_name}`,
              });
            }
          }
        } else {
          bomComponents = null;
          bomTotalCost = null;
        }
      } else {
        bomComponents = null;
        bomTotalCost = null;
      }
    }

    await product.update({
      item_name:            item_name            ?? product.item_name,
      description:          description          !== undefined ? description          : product.description,
      cost_price:           cost_price           !== undefined ? cost_price           : product.cost_price,
      sale_price:           sale_price           !== undefined ? sale_price           : product.sale_price,
      supplier_id:          supplier_id          !== undefined ? supplier_id          : product.supplier_id,
      category_id:          category_id          ?? product.category_id,
      subcategory_id:       subcategory_id       !== undefined ? subcategory_id       : product.subcategory_id,
      unit_id:              unit_id              ?? product.unit_id,
      barcode:              barcode              !== undefined ? barcode              : product.barcode,
      min_stock:            min_stock            !== undefined ? min_stock            : product.min_stock,
      physical_qty:         physical_qty         !== undefined ? physical_qty         : product.physical_qty,
      available_qty:        physical_qty         !== undefined ? physical_qty         : product.available_qty,
      length_combinations:  lengthCombinations,
      has_multiple_lengths: hasMultipleLengths,
      is_active:            is_active            !== undefined ? is_active            : product.is_active,
      is_bom:               is_bom               !== undefined ? is_bom               : product.is_bom,
      bom_components:       bomComponents,
      bom_total_cost:       bomTotalCost,
    });

    const updated = await Product.findByPk(id, {
      include: [
        { model: Supplier,    as: 'supplier',    attributes: ['id', 'name'] },
        { model: Category,    as: 'category',    attributes: ['id', 'name'] },
        { model: Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
        { model: Unit,        as: 'unit',        attributes: ['id', 'name', 'symbol'] },
      ],
    });

    res.json({ success: true, message: 'Product updated successfully', data: updated });
  } catch (error) {
    console.error('Update product error:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors.map(e => e.message),
      });
    }
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Delete product
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByPk(id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // Check if product is used as a component in any BOM
    const bomProducts = await Product.findAll({
      where: {
        is_bom: true,
        bom_components: { [Op.ne]: null }
      }
    });
    
    const isUsedInBom = bomProducts.some(bom => {
      if (!bom.bom_components) return false;
      return bom.bom_components.some(comp => comp.product_id === parseInt(id));
    });
    
    if (isUsedInBom) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete product as it is used as a component in one or more BOM products',
      });
    }

    const customerPricesCount = await CustomerPrice.count({ where: { product_id: id } });
    if (customerPricesCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete product with customer-specific prices. Delete customer prices first.',
      });
    }

    await product.destroy();
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Toggle product status
exports.toggleProductStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByPk(id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    await product.update({ is_active: !product.is_active });

    res.json({
      success: true,
      message: `Product ${product.is_active ? 'activated' : 'deactivated'} successfully`,
      data: { id: product.id, item_name: product.item_name, is_active: product.is_active },
    });
  } catch (error) {
    console.error('Toggle product status error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Update product quantity
exports.updateProductQuantity = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, operation } = req.body;

    if (quantity === undefined || !operation) {
      return res.status(400).json({ success: false, message: 'Quantity and operation are required' });
    }

    const product = await Product.findByPk(id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    let newQuantity;
    switch (operation) {
      case 'add':
        newQuantity = product.physical_qty + parseInt(quantity);
        break;
      case 'subtract':
        newQuantity = product.physical_qty - parseInt(quantity);
        if (newQuantity < 0)
          return res.status(400).json({ success: false, message: 'Insufficient quantity' });
        break;
      case 'set':
        newQuantity = parseInt(quantity);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid operation. Use add, subtract, or set',
        });
    }

    await product.update({ physical_qty: newQuantity, available_qty: newQuantity });

    res.json({
      success: true,
      message: 'Product quantity updated successfully',
      data: {
        id:           product.id,
        item_name:    product.item_name,
        old_quantity: product.physical_qty,
        new_quantity: newQuantity,
        is_low_stock: newQuantity <= product.min_stock,
      },
    });
  } catch (error) {
    console.error('Update product quantity error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get low stock products
exports.getLowStockProducts = async (req, res) => {
  try {
    const { Op, literal } = require('sequelize');
    const products = await Product.findAll({
      where: { is_active: true, physical_qty: { [Op.lte]: literal('min_stock') } },
      include: [
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] },
        { model: Unit,     as: 'unit',     attributes: ['id', 'name', 'symbol'] },
      ],
      attributes: [
        'id', 'item_name', 'physical_qty', 'min_stock',
        'cost_price', 'sale_price',
        'length_combinations', 'has_multiple_lengths',
        'is_bom', 'bom_components', 'bom_total_cost', // NEW BOM fields
      ],
      order: [['physical_qty', 'ASC']],
    });

    res.json({ success: true, data: products, count: products.length });
  } catch (error) {
    console.error('Get low stock products error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get products by supplier
exports.getProductsBySupplier = async (req, res) => {
  try {
    const { supplierId } = req.params;

    const products = await Product.findAll({
      where: { supplier_id: supplierId, is_active: true },
      include: [
        { model: Category, as: 'category', attributes: ['id', 'name'] },
        { model: Unit,     as: 'unit',     attributes: ['id', 'name', 'symbol'] },
      ],
      attributes: [
        'id', 'item_name', 'cost_price', 'sale_price', 'physical_qty',
        'length_combinations', 'has_multiple_lengths',
        'is_bom', 'bom_components', 'bom_total_cost', // NEW BOM fields
      ],
      order: [['item_name', 'ASC']],
    });

    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Get products by supplier error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// NEW: Get BOM structure for a product (with nested components)
exports.getBomStructure = async (req, res) => {
  try {
    const { id } = req.params;
    
    const product = await Product.findByPk(id, {
      where: { is_bom: true },
      attributes: ['id', 'item_name', 'description', 'bom_components', 'bom_total_cost', 'cost_price', 'sale_price'],
    });
    
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'BOM product not found' 
      });
    }
    
    // Fetch full details for each component
    let componentsWithDetails = [];
    if (product.bom_components && product.bom_components.length > 0) {
      const componentIds = product.bom_components.map(c => c.product_id);
      const componentProducts = await Product.findAll({
        where: { id: componentIds },
        attributes: ['id', 'item_name', 'cost_price', 'sale_price', 'unit_id', 'physical_qty'],
        include: [{ model: Unit, as: 'unit', attributes: ['id', 'name', 'symbol'] }],
      });
      
      componentsWithDetails = product.bom_components.map(comp => {
        const productDetail = componentProducts.find(p => p.id === comp.product_id);
        return {
          ...comp,
          product_details: productDetail || null,
        };
      });
    }
    
    res.json({
      success: true,
      data: {
        product: {
          id: product.id,
          name: product.item_name,
          description: product.description,
          total_cost: product.bom_total_cost,
          selling_price: product.sale_price,
        },
        components: componentsWithDetails,
        component_count: componentsWithDetails.length,
      },
    });
  } catch (error) {
    console.error('Get BOM structure error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// NEW: Calculate manufacturing cost for a BOM product
exports.calculateBomCost = async (req, res) => {
  try {
    const { id } = req.params;
    
    const product = await Product.findByPk(id, {
      where: { is_bom: true },
      attributes: ['id', 'item_name', 'bom_components'],
    });
    
    if (!product || !product.bom_components) {
      return res.status(404).json({ 
        success: false, 
        message: 'BOM product not found or has no components' 
      });
    }
    
    // Calculate current cost based on latest component prices
    let totalCost = 0;
    const componentCosts = [];
    
    for (const comp of product.bom_components) {
      const componentProduct = await Product.findByPk(comp.product_id, {
        attributes: ['id', 'item_name', 'cost_price'],
      });
      
      if (componentProduct) {
        const currentCost = componentProduct.cost_price * comp.quantity;
        totalCost += currentCost;
        componentCosts.push({
          component_id: comp.product_id,
          component_name: comp.product_name,
          quantity: comp.quantity,
          previous_cost_per_unit: comp.cost_per_unit,
          current_cost_per_unit: componentProduct.cost_price,
          previous_total: comp.total_cost,
          current_total: currentCost,
          difference: currentCost - comp.total_cost,
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        product_id: product.id,
        product_name: product.item_name,
        previous_total_cost: product.bom_total_cost,
        current_total_cost: totalCost,
        cost_difference: totalCost - (product.bom_total_cost || 0),
        components: componentCosts,
        recommendation: totalCost > (product.bom_total_cost || 0) 
          ? 'Consider reviewing selling price as manufacturing cost has increased'
          : 'Manufacturing cost has decreased, you may consider lowering selling price',
      },
    });
  } catch (error) {
    console.error('Calculate BOM cost error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// NEW: Get all BOM products
exports.getAllBomProducts = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const whereClause = { is_bom: true };
    
    if (search) {
      whereClause[Op.or] = [
        { item_name: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }
    
    const { count, rows: products } = await Product.findAndCountAll({
      where: whereClause,
      attributes: [
        'id', 'item_name', 'description', 'cost_price', 'sale_price',
        'bom_components', 'bom_total_cost', 'physical_qty', 'min_stock',
      ],
      include: [
        { model: Category, as: 'category', attributes: ['id', 'name'] },
        { model: Unit, as: 'unit', attributes: ['id', 'name', 'symbol'] },
      ],
      limit: limitNum,
      offset,
      order: [['created_at', 'DESC']],
    });
    
    res.json({
      success: true,
      data: products,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum),
      },
    });
  } catch (error) {
    console.error('Get all BOM products error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.buildBomProduct = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { quantity, build_date, notes } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ success: false, message: 'Valid quantity is required' });
    }

    const bomProduct = await Product.findByPk(id, { transaction: t });
    if (!bomProduct || !bomProduct.is_bom) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'BOM product not found' });
    }
    if (!bomProduct.bom_components || bomProduct.bom_components.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'BOM has no components' });
    }

    const usedComponents = [];

    // Deduct each component's stock
    for (const comp of bomProduct.bom_components) {
      const needed = comp.quantity * quantity;
      const componentProduct = await Product.findByPk(comp.product_id, { transaction: t });

      if (!componentProduct) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: `Component not found: ${comp.product_name}`,
        });
      }
      if (componentProduct.physical_qty < needed) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${comp.product_name}. Available: ${componentProduct.physical_qty}, Needed: ${needed}`,
          component: comp.product_name,
          available: componentProduct.physical_qty,
          needed,
        });
      }

      await componentProduct.update({
        physical_qty: componentProduct.physical_qty - needed,
        available_qty: componentProduct.available_qty - needed,
      }, { transaction: t });

      usedComponents.push({
        product_id:      comp.product_id,
        product_name:    comp.product_name,
        quantity_used:   needed,
        unit:            comp.unit,
        cost_per_unit:   componentProduct.cost_price,
        total_cost:      componentProduct.cost_price * needed,
      });
    }

    // Increment BOM product stock
    await bomProduct.update({
      physical_qty:  bomProduct.physical_qty  + quantity,
      available_qty: bomProduct.available_qty + quantity,
    }, { transaction: t });

    // Save build transaction in a new table (or you can use JSON in Product notes)
    // If you have a BuildTransaction model, use that. Otherwise create it:
    const buildRecord = await BuildTransaction.create({
      product_id:      bomProduct.id,
      product_name:    bomProduct.item_name,
      quantity_built:  quantity,
      bom_sale_rate:   bomProduct.sale_price,
      build_amount:    bomProduct.sale_price * quantity,
      bom_total_cost:  bomProduct.bom_total_cost,
      build_date:      build_date ? new Date(build_date) : new Date(),
      notes:           notes || null,
      components_used: usedComponents,
    }, { transaction: t });

    await t.commit();

    res.json({
      success: true,
      message: `Successfully built ${quantity} × ${bomProduct.item_name}`,
      data: {
        build_transaction: buildRecord,
        new_stock: bomProduct.physical_qty + quantity,
      },
    });
  } catch (error) {
    await t.rollback();
    console.error('Build BOM error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.getBuildTransactions = async (req, res) => {
  try {
    const { search, from_date, to_date, page = 1, limit = 30 } = req.query;
    const where = { is_deleted: false };
    if (search) where.product_name = { [Op.like]: `%${search}%` };
    if (from_date && to_date) where.build_date = { [Op.between]: [from_date, to_date] };

    const { count, rows } = await BuildTransaction.findAndCountAll({
      where,
      order: [['build_date', 'DESC'], ['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    res.json({
      success: true,
      data: rows,
      pagination: { total: count, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteBuildTransaction = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const tx = await BuildTransaction.findByPk(req.params.txId, { transaction: t });
    if (!tx) { await t.rollback(); return res.status(404).json({ success: false, message: 'Not found' }); }

    // Revert stock
    const bomProduct = await Product.findByPk(tx.product_id, { transaction: t });
    if (bomProduct) {
      await bomProduct.update({
        physical_qty:  bomProduct.physical_qty  - tx.quantity_built,
        available_qty: bomProduct.available_qty - tx.quantity_built,
      }, { transaction: t });
    }
    for (const comp of (tx.components_used || [])) {
      const p = await Product.findByPk(comp.product_id, { transaction: t });
      if (p) await p.update({
        physical_qty:  p.physical_qty  + comp.quantity_used,
        available_qty: p.available_qty + comp.quantity_used,
      }, { transaction: t });
    }

    await tx.update({ is_deleted: true }, { transaction: t });
    await t.commit();
    res.json({ success: true, message: 'Build transaction deleted and stock reverted' });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ success: false, message: error.message });
  }
};