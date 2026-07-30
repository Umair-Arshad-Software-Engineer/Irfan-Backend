// routes/salaryRoutes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/salaryController');

router.get('/calculate',              ctrl.calculateSalary);       // ?employee_id&from_date&to_date
router.get('/',                       ctrl.getAllSalaryPayments);
router.get('/history/:employeeId',    ctrl.getSalaryHistory);       // ← fixed: was /employee/:employeeId
router.post('/save',                  ctrl.saveSalaryPayment);      // ← fixed: was /
router.delete('/delete/:id',          ctrl.deleteSalaryPayment);    // ← fixed: was /:id

module.exports = router;