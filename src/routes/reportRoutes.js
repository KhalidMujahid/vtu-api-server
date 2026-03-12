const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { protect, restrictTo } = require('../middlewares/auth');

router.use(protect);

/**
 * @swagger
 * /api/v1/reports/my-report:
 *   get:
 *     summary: Get my report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User report
 */
router.get('/my-report', reportController.getMyReport);

/**
 * @swagger
 * /api/v1/reports/dashboard:
 *   get:
 *     summary: Get dashboard summary
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard summary
 */
router.get('/dashboard', reportController.getDashboardSummary);

/**
 * @swagger
 * /api/v1/reports/transactions:
 *   get:
 *     summary: Get transaction report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaction report
 */
router.get('/transactions', restrictTo('admin', 'super_admin', 'staff'), reportController.getTransactionReport);

/**
 * @swagger
 * /api/v1/reports/financial:
 *   get:
 *     summary: Get financial report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Financial report
 */
router.get('/financial', restrictTo('admin', 'super_admin'), reportController.getFinancialReport);

/**
 * @swagger
 * /api/v1/reports/users:
 *   get:
 *     summary: Get user report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User report
 */
router.get('/users', restrictTo('admin', 'super_admin', 'staff'), reportController.getUserReport);

/**
 * @swagger
 * /api/v1/reports/agents:
 *   get:
 *     summary: Get agent report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Agent report
 */
router.get('/agents', restrictTo('admin', 'super_admin'), reportController.getAgentReport);

/**
 * @swagger
 * /api/v1/reports/services:
 *   get:
 *     summary: Get service report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Service report
 */
router.get('/services', restrictTo('admin', 'super_admin', 'staff'), reportController.getServiceReport);

module.exports = router;
