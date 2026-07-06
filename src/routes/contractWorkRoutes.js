// routes/contractWorkRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/contractWorkController');

router.get('/employee/:employeeId', ctrl.getEmployeeContractWork);
router.get('/all', ctrl.getAllContractWork);
router.get('/summary/:employeeId', ctrl.getContractWorkSummary);
router.post('/', ctrl.createContractWorkEntry);
router.put('/:id', ctrl.updateContractWorkEntry);
router.delete('/:id', ctrl.deleteContractWorkEntry);

module.exports = router;