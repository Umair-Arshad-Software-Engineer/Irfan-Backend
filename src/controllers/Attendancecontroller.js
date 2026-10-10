// controllers/attendanceController.js
const { Op } = require('sequelize');
const { Attendance, Employee } = require('../models');

// ── Helper: overtime only counts on Present / Half_Day, clamped 0–24 ─────────
function normaliseOvertime(status, value) {
  if (status !== 'Present' && status !== 'Half_Day') return 0;
  const h = parseFloat(value);
  if (isNaN(h) || h < 0) return 0;
  return Math.min(h, 24);
}

// ── GET attendance for an employee (optional month filter) ────────────────────
exports.getAttendanceByEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query;  // e.g. ?month=6&year=2026

    const where = { employee_id: employeeId };

    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate   = new Date(year, month, 0);           // last day of month
      where.date = {
        [Op.between]: [
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
        ],
      };
    }

    const records = await Attendance.findAll({
      where,
      order: [['date', 'ASC']],
    });

    res.json({ success: true, data: records, count: records.length });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── GET attendance for ALL employees on a specific date ───────────────────────
exports.getAttendanceByDate = async (req, res) => {
  try {
    const { date } = req.params;    // YYYY-MM-DD

    const records = await Attendance.findAll({
      where: { date },
      include: [{ model: Employee, as: 'employee', attributes: ['id', 'name', 'salary_type'] }],
      order: [[{ model: Employee, as: 'employee' }, 'name', 'ASC']],
    });

    res.json({ success: true, data: records, count: records.length });
  } catch (error) {
    console.error('Get attendance by date error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── MARK / UPDATE attendance for one employee on one date ─────────────────────
exports.markAttendance = async (req, res) => {
  try {
    const { employee_id, date, status, notes, overtime_hours } = req.body;

    if (!employee_id || !date || !status) {
      return res.status(400).json({ success: false, message: 'employee_id, date and status are required' });
    }

    const employee = await Employee.findByPk(employee_id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // upsert — create or update
    const [record, created] = await Attendance.upsert(
      {
        employee_id,
        date,
        status,
        notes,
        overtime_hours: normaliseOvertime(status, overtime_hours),
      },
      { returning: true }
    );

    res.status(created ? 201 : 200).json({
      success: true,
      message: created ? 'Attendance marked' : 'Attendance updated',
      data: record,
    });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── BULK mark attendance for multiple employees on one date ───────────────────
exports.bulkMarkAttendance = async (req, res) => {
  try {
    const { date, records } = req.body;
    // records: [{ employee_id, status, notes?, overtime_hours? }, ...]

    if (!date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'date and records[] are required' });
    }

    const results = [];
    for (const rec of records) {
      const [saved] = await Attendance.upsert({
        employee_id: rec.employee_id,
        date,
        status: rec.status,
        notes: rec.notes ?? null,
        overtime_hours: normaliseOvertime(rec.status, rec.overtime_hours),
      }, { returning: true });
      results.push(saved);
    }

    res.json({ success: true, message: `${results.length} records saved`, data: results });
  } catch (error) {
    console.error('Bulk attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ── DELETE attendance record ──────────────────────────────────────────────────
exports.deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await Attendance.findByPk(id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }
    await record.destroy();
    res.json({ success: true, message: 'Attendance deleted' });
  } catch (error) {
    console.error('Delete attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};