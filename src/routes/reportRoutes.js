const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { protect, restrictTo } = require('../middlewares/auth');

router.use(protect);

// User's own report - accessible by any authenticated user
router.get('/my-report', reportController.getMyReport);

router.get('/dashboard', reportController.getDashboardSummary);

router.get('/transactions', restrictTo('admin', 'super_admin', 'staff'), reportController.getTransactionReport);

router.get('/financial', restrictTo('admin', 'super_admin'), reportController.getFinancialReport);

router.get('/users', restrictTo('admin', 'super_admin', 'staff'), reportController.getUserReport);

router.get('/agents', restrictTo('admin', 'super_admin'), reportController.getAgentReport);

router.get('/services', restrictTo('admin', 'super_admin', 'staff'), reportController.getServiceReport);

module.exports = router;
