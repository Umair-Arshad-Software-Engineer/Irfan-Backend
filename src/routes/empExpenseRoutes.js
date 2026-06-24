// routes/empExpenseRoutes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/empExpenseController');

router.get('/employee/:employeeId', ctrl.getExpensesByEmployee);
router.post('/',                    ctrl.createExpense);
router.put('/:id',                  ctrl.updateExpense);
router.delete('/:id',               ctrl.deleteExpense);

module.exports = router;