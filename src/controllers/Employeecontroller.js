// controllers/employeeController.js
const { Employee, AdvancePayment, EmployeeExpense } = require('../models');
const { Op } = require('sequelize');

// ── Helper: Get employee balance ─────────────────────────────────────────────
async function getEmployeeBalance(employee_id) {
  // Get all credit entries
  const advances = await AdvancePayment.findAll({
    where: { 
      employee_id, 
      entry_type: 'credit',
    },
  });
  
  const expenses = await EmployeeExpense.findAll({
    where: { 
      employee_id, 
      entry_type: 'credit',
    },
  });

  const totalCredit = advances.reduce((sum, a) => sum + parseFloat(a.amount), 0) +
                     expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  
  // Get all debit entries
  const debitAdvances = await AdvancePayment.findAll({
    where: { 
      employee_id, 
      entry_type: 'debit',
    },
  });
  
  const debitExpenses = await EmployeeExpense.findAll({
    where: { 
      employee_id, 
      entry_type: 'debit',
    },
  });

  const totalDebit = debitAdvances.reduce((sum, a) => sum + parseFloat(a.amount), 0) +
                    debitExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  return Math.round((totalCredit - totalDebit) * 100) / 100;
}

// ── GET all employees with balance ───────────────────────────────────────────
exports.getAllEmployees = async (req, res) => {
  try {
    const employees = await Employee.findAll({
      order: [['createdAt', 'DESC']],
    });

    // Get balance for each employee
    const employeesWithBalance = await Promise.all(
      employees.map(async (employee) => {
        const balance = await getEmployeeBalance(employee.id);
        return {
          ...employee.toJSON(),
          current_balance: balance
        };
      })
    );

    // Summary
    const totalEmployees = employeesWithBalance.length;
    const employeesWithDebt = employeesWithBalance.filter(e => e.current_balance > 0);
    const totalBalance = employeesWithBalance.reduce((sum, e) => sum + e.current_balance, 0);

    res.json({
      success: true,
      data: employeesWithBalance,
      count: totalEmployees,
      summary: {
        total_employees: totalEmployees,
        employees_with_debt: employeesWithDebt.length,
        total_outstanding_balance: Math.round(totalBalance * 100) / 100,
      }
    });
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET single employee with balance ─────────────────────────────────────────
exports.getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const balance = await getEmployeeBalance(employee.id);

    // Get recent transactions
    const advances = await AdvancePayment.findAll({
      where: { employee_id: employee.id },
      limit: 5,
      order: [['createdAt', 'DESC']],
    });

    const expenses = await EmployeeExpense.findAll({
      where: { employee_id: employee.id },
      limit: 5,
      order: [['createdAt', 'DESC']],
    });

    const recentTransactions = [...advances, ...expenses]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        ...employee.toJSON(),
        current_balance: balance,
        recent_transactions: recentTransactions
      }
    });
  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET employee balance summary ─────────────────────────────────────────────
exports.getEmployeeBalanceSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // Get all advances
    const advances = await AdvancePayment.findAll({
      where: { employee_id: id },
      order: [['date', 'ASC']]
    });

    // Get all expenses
    const expenses = await EmployeeExpense.findAll({
      where: { employee_id: id },
      order: [['date', 'ASC']]
    });

    // Calculate detailed summary
    const creditAdvances = advances.filter(a => a.entry_type === 'credit');
    const debitAdvances = advances.filter(a => a.entry_type === 'debit');
    const creditExpenses = expenses.filter(e => e.entry_type === 'credit');
    const debitExpenses = expenses.filter(e => e.entry_type === 'debit');

    const totalAdvanceCredit = creditAdvances.reduce((sum, a) => sum + parseFloat(a.amount), 0);
    const totalAdvanceDebit = debitAdvances.reduce((sum, a) => sum + parseFloat(a.amount), 0);
    const totalExpenseCredit = creditExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const totalExpenseDebit = debitExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

    const totalCredit = totalAdvanceCredit + totalExpenseCredit;
    const totalDebit = totalAdvanceDebit + totalExpenseDebit;
    const currentBalance = totalCredit - totalDebit;

    // Count entries by recovery status
    const recoveredAdvances = advances.filter(a => a.salary_payment_id !== null);
    const pendingAdvances = advances.filter(a => a.salary_payment_id === null && a.entry_type === 'credit');
    const recoveredExpenses = expenses.filter(e => e.salary_payment_id !== null);
    const pendingExpenses = expenses.filter(e => e.salary_payment_id === null && e.entry_type === 'credit');

    res.json({
      success: true,
      data: {
        employee: {
          id: employee.id,
          name: employee.name,
          salary_type: employee.salary_type,
          salary: employee.salary,
        },
        summary: {
          total_advances: {
            credit: Math.round(totalAdvanceCredit * 100) / 100,
            debit: Math.round(totalAdvanceDebit * 100) / 100,
            net: Math.round((totalAdvanceCredit - totalAdvanceDebit) * 100) / 100,
          },
          total_expenses: {
            credit: Math.round(totalExpenseCredit * 100) / 100,
            debit: Math.round(totalExpenseDebit * 100) / 100,
            net: Math.round((totalExpenseCredit - totalExpenseDebit) * 100) / 100,
          },
          overall: {
            total_credit: Math.round(totalCredit * 100) / 100,
            total_debit: Math.round(totalDebit * 100) / 100,
            current_balance: Math.round(currentBalance * 100) / 100,
          },
          pending_recovery: {
            advances: pendingAdvances.length,
            advance_amount: Math.round(pendingAdvances.reduce((sum, a) => sum + parseFloat(a.amount), 0) * 100) / 100,
            expenses: pendingExpenses.length,
            expense_amount: Math.round(pendingExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0) * 100) / 100,
          },
          recovered: {
            advances: recoveredAdvances.length,
            expenses: recoveredExpenses.length,
          }
        },
        recent_advances: advances.slice(0, 5),
        recent_expenses: expenses.slice(0, 5),
      }
    });
  } catch (error) {
    console.error('Get balance summary error:', error);
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
      salary: parseFloat(salary), 
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
      data: {
        ...employee.toJSON(),
        current_balance: 0
      },
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

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (father_name !== undefined) updates.father_name = father_name;
    if (phone !== undefined) updates.phone = phone;
    if (address !== undefined) updates.address = address;
    if (salary !== undefined) updates.salary = parseFloat(salary);
    if (salary_type !== undefined) updates.salary_type = salary_type;
    if (is_active !== undefined) updates.is_active = is_active;
    if (join_date !== undefined) updates.join_date = join_date;
    if (overtime_rate !== undefined) updates.overtime_rate = overtime_rate;
    if (standard_working_hours !== undefined) updates.standard_working_hours = standard_working_hours;

    // Handle salary_type-dependent fields
    if (salary_type === 'Contract') {
      updates.contract_unit = contract_unit ?? employee.contract_unit;
      updates.unit_price = unit_price ?? employee.unit_price;
    } else if (salary_type !== undefined) {
      updates.contract_unit = null;
      updates.unit_price = null;
    } else {
      if (contract_unit !== undefined) updates.contract_unit = contract_unit;
      if (unit_price !== undefined) updates.unit_price = unit_price;
    }

    await employee.update(updates);

    const balance = await getEmployeeBalance(employee.id);

    res.json({
      success: true,
      message: 'Employee updated successfully',
      data: {
        ...employee.toJSON(),
        current_balance: balance
      },
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

    // Check if employee has any outstanding balance
    const balance = await getEmployeeBalance(id);
    if (balance > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete employee with outstanding balance of ${balance}. Please recover all advances and expenses first.`
      });
    }

    // Check if employee has any salary payments
    const { SalaryPayment } = require('../models');
    const salaryPayments = await SalaryPayment.count({
      where: { employee_id: id }
    });

    if (salaryPayments > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete employee with existing salary payments. Archive the employee instead.'
      });
    }

    await employee.destroy();

    res.json({
      success: true,
      message: 'Employee deleted successfully'
    });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};