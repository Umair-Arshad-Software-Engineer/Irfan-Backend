const express = require('express');
const router = express.Router();
const unitController = require('../controllers/unitController');

// Unit routes
router.get('/', unitController.getAllUnits);
router.get('/base', unitController.getBaseUnits);
router.get('/type/:type', unitController.getUnitsByType);
router.post('/', unitController.createUnit);
router.put('/:id', unitController.updateUnit);
router.delete('/:id', unitController.deleteUnit);
router.post('/convert', unitController.convertUnits);
router.post('/seed-defaults', unitController.seedDefaultUnits);

module.exports = router;