// src/routes/cheque_routes.js
const express = require('express');
const router  = express.Router();
const chequeController = require('../controllers/chequeController');

// ── Cheque CRUD ───────────────────────────────────────────────────────────
router.post('/',      chequeController.createCheque);   // POST   /cheques
router.get('/',       chequeController.getAllCheques);   // GET    /cheques
router.get('/:id',    chequeController.getCheque);       // GET    /cheques/:id
router.put('/:id',    chequeController.updateCheque);    // PUT    /cheques/:id  (pending only)
router.delete('/:id', chequeController.deleteCheque);    // DELETE /cheques/:id  (ANY status — reverses if cleared)

// ── Cheque Status Actions ─────────────────────────────────────────────────
router.patch('/:id/clear',   chequeController.clearCheque);    // PATCH /cheques/:id/clear   (any → cleared)
router.patch('/:id/bounce',  chequeController.bounceCheque);   // PATCH /cheques/:id/bounce  (any → bounced, reverses bank if cleared)
router.patch('/:id/cancel',  chequeController.cancelCheque);   // PATCH /cheques/:id/cancel  (any → cancelled, reverses bank if cleared)
router.patch('/:id/revert',  chequeController.revertToPending); // PATCH /cheques/:id/revert  (any → pending, reverses bank if cleared)

module.exports = router;