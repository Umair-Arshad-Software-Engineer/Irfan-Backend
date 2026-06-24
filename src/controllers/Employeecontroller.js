// controllers/employeeController.js
const { Employee, Attendance } = require('../models');

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
    const { name, father_name, phone, address, salary, salary_type } = req.body;

    if (!name || !father_name || !phone || salary == null || !salary_type) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const employee = await Employee.create({
      name, father_name, phone, address, salary, salary_type,
    });

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
    const { name, father_name, phone, address, salary, salary_type, is_active } = req.body;

    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    await employee.update({ name, father_name, phone, address, salary, salary_type, is_active });

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