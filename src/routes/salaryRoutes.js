// routes/salaryRoutes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/salaryController');

router.get('/calculate',                    ctrl.calculateSalary);       // ?employee_id&from_date&to_date
router.get('/',                             ctrl.getAllSalaryPayments);
router.get('/employee/:employeeId',         ctrl.getSalaryHistory);
router.post('/',                            ctrl.saveSalaryPayment);
router.delete('/:id',                       ctrl.deleteSalaryPayment);

module.exports = router;