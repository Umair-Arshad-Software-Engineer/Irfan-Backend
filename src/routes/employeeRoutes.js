// routes/employeeRoutes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/employeeController');

router.get('/',     ctrl.getAllEmployees);
router.post('/',    ctrl.createEmployee);
router.get('/:id',  ctrl.getEmployeeById);
router.put('/:id',  ctrl.updateEmployee);
router.delete('/:id', ctrl.deleteEmployee);

module.exports = router;