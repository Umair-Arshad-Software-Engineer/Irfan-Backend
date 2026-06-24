// routes/categoryRoutes.js
const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const subcategoryController = require('../controllers/subcategoryController');

// Category routes
router.get('/', categoryController.getAllCategories);
router.post('/', categoryController.createCategory);
router.get('/:id', categoryController.getCategoryById);
router.put('/:id', categoryController.updateCategory);
router.delete('/:id', categoryController.deleteCategory);

// Subcategory routes under categories
router.get('/:categoryId/subcategories', subcategoryController.getSubcategoriesByCategory);
router.post('/:categoryId/subcategories', subcategoryController.createSubcategory);

module.exports = router;