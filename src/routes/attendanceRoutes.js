// routes/attendanceRoutes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/attendanceController');

router.get('/date/:date',               ctrl.getAttendanceByDate);         // all employees on a date
router.get('/employee/:employeeId',     ctrl.getAttendanceByEmployee);     // employee attendance (?month&year)
router.post('/',                        ctrl.markAttendance);              // single mark
router.post('/bulk',                    ctrl.bulkMarkAttendance);          // bulk mark
router.delete('/:id',                   ctrl.deleteAttendance);

module.exports = router;