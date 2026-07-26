// controllers/employeeController.js
const { Employee } = require('../models');

// ── GET all employees ─────────────────────────────────────────────────────────
exports.getAllEmployees = async (req, res) => {
  try {
    const employees = await Employee.findAll({
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: employees, count: employees.length });
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET single employee ───────────────────────────────────────────────────────
exports.getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    res.json({ success: true, data: employee });
  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── CREATE employee ───────────────────────────────────────────────────────────
exports.createEmployee = async (req, res) => {
  try {
    const { 
      name, father_name, phone, address, salary, salary_type, 
      join_date, contract_unit, unit_price, overtime_rate, 
      standard_working_hours 
    } = req.body;

    if (!name || !father_name || !phone || salary == null || !salary_type) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const employeeData = {
      name, 
      father_name, 
      phone, 
      address, 
      salary, 
      salary_type,
      join_date: join_date || new Date().toISOString().split('T')[0],
      contract_unit: contract_unit || null,
      unit_price: unit_price || null,
      overtime_rate: overtime_rate || null,
      standard_working_hours: standard_working_hours || 8,
    };

    const employee = await Employee.create(employeeData);

    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      data: employee,
    });
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── UPDATE employee ───────────────────────────────────────────────────────────
exports.updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const {
      name, father_name, phone, address, salary, salary_type,
      is_active, join_date, contract_unit, unit_price,
      overtime_rate, standard_working_hours
    } = req.body;

    // Only include fields that were actually sent in the request
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (father_name !== undefined) updates.father_name = father_name;
    if (phone !== undefined) updates.phone = phone;
    if (address !== undefined) updates.address = address;
    if (salary !== undefined) updates.salary = salary;
    if (salary_type !== undefined) updates.salary_type = salary_type;
    if (is_active !== undefined) updates.is_active = is_active;
    if (join_date !== undefined) updates.join_date = join_date;
    if (overtime_rate !== undefined) updates.overtime_rate = overtime_rate;
    if (standard_working_hours !== undefined) updates.standard_working_hours = standard_working_hours;

    // Handle salary_type-dependent fields explicitly, mirroring createEmployee's logic
    if (salary_type === 'Contract') {
      updates.contract_unit = contract_unit ?? employee.contract_unit;
      updates.unit_price = unit_price ?? employee.unit_price;
    } else if (salary_type !== undefined) {
      // Switching away from Contract (or staying non-contract): clear contract-only fields
      updates.contract_unit = null;
      updates.unit_price = null;
    } else {
      // salary_type not sent at all — leave contract fields untouched unless explicitly provided
      if (contract_unit !== undefined) updates.contract_unit = contract_unit;
      if (unit_price !== undefined) updates.unit_price = unit_price;
    }

    await employee.update(updates);

    res.json({
      success: true,
      message: 'Employee updated successfully',
      data: employee,
    });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── DELETE employee ───────────────────────────────────────────────────────────
exports.deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    await employee.destroy();
    res.json({ success: true, message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};