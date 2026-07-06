// controllers/contractWorkController.js
const { Op } = require('sequelize');
const { ContractWorkEntry, Employee } = require('../models');

// ── GET all contract work entries for an employee ──────────────────────────
exports.getEmployeeContractWork = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'employeeId is required' });
    }

    const where = { employee_id: employeeId };
    
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      where.date = { [Op.between]: [startDate, endDate] };
    }

    const entries = await ContractWorkEntry.findAll({
      where,
      order: [['date', 'DESC']],
    });

    // Calculate summary
    const totalQuantity = entries.reduce((sum, e) => sum + parseFloat(e.quantity), 0);
    const totalEarnings = entries.reduce((sum, e) => sum + parseFloat(e.total_amount), 0);

    res.json({
      success: true,
      data: entries,
      summary: {
        entries: entries.length,
        total_quantity: totalQuantity,
        total_earnings: totalEarnings,
      },
    });
  } catch (error) {
    console.error('Get contract work error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET all contract work entries (for reporting) ──────────────────────────
exports.getAllContractWork = async (req, res) => {
  try {
    const { month, year } = req.query;

    const where = {};
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      where.date = { [Op.between]: [startDate, endDate] };
    }

    const entries = await ContractWorkEntry.findAll({
      include: [{ model: Employee, as: 'employee', attributes: ['id', 'name'] }],
      order: [['date', 'DESC']],
    });

    res.json({
      success: true,
      data: entries,
      count: entries.length,
    });
  } catch (error) {
    console.error('Get all contract work error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── CREATE contract work entry ─────────────────────────────────────────────
exports.createContractWorkEntry = async (req, res) => {
  try {
    const { 
      employee_id, date, quantity, unit, unit_price, 
      total_amount, description 
    } = req.body;

    if (!employee_id || !date || quantity == null || !unit || unit_price == null) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: employee_id, date, quantity, unit, unit_price' 
      });
    }

    const employee = await Employee.findByPk(employee_id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const entry = await ContractWorkEntry.create({
      employee_id,
      employee_name: employee.name,
      date,
      quantity,
      unit,
      unit_price,
      total_amount: total_amount || (quantity * unit_price),
      description: description || null,
    });

    res.status(201).json({
      success: true,
      message: 'Contract work entry created successfully',
      data: entry,
    });
  } catch (error) {
    console.error('Create contract work error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── UPDATE contract work entry ─────────────────────────────────────────────
exports.updateContractWorkEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      date, quantity, unit, unit_price, 
      total_amount, description 
    } = req.body;

    const entry = await ContractWorkEntry.findByPk(id);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }

    await entry.update({
      date: date || entry.date,
      quantity: quantity || entry.quantity,
      unit: unit || entry.unit,
      unit_price: unit_price || entry.unit_price,
      total_amount: total_amount || (quantity && unit_price ? quantity * unit_price : entry.total_amount),
      description: description !== undefined ? description : entry.description,
    });

    res.json({
      success: true,
      message: 'Contract work entry updated successfully',
      data: entry,
    });
  } catch (error) {
    console.error('Update contract work error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── DELETE contract work entry ─────────────────────────────────────────────
exports.deleteContractWorkEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await ContractWorkEntry.findByPk(id);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }

    await entry.destroy();

    res.json({
      success: true,
      message: 'Contract work entry deleted successfully',
    });
  } catch (error) {
    console.error('Delete contract work error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET contract work summary for an employee ──────────────────────────────
exports.getContractWorkSummary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'employeeId is required' });
    }

    const where = { employee_id: employeeId };
    
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      where.date = { [Op.between]: [startDate, endDate] };
    }

    const entries = await ContractWorkEntry.findAll({ where });

    const totalQuantity = entries.reduce((sum, e) => sum + parseFloat(e.quantity), 0);
    const totalEarnings = entries.reduce((sum, e) => sum + parseFloat(e.total_amount), 0);

    res.json({
      success: true,
      summary: {
        entries: entries.length,
        total_quantity: totalQuantity,
        total_earnings: totalEarnings,
      },
    });
  } catch (error) {
    console.error('Get contract work summary error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};