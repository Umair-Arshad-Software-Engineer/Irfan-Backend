// routes/advanceRoutes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/advanceController');

router.get('/employee/:employeeId', ctrl.getAdvancesByEmployee);
router.post('/',                    ctrl.createAdvance);
router.put('/:id',                  ctrl.updateAdvance);
router.delete('/:id',               ctrl.deleteAdvance);

module.exports = router;


// ─────────────────────────────────────────────────────────────────────────────
// Save as routes/empExpenseRoutes.js separately — shown here for reference:
// ─────────────────────────────────────────────────────────────────────────────