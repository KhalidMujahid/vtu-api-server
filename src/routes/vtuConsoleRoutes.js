const express = require('express');
const router = express.Router();
const vtuConsoleController = require('../controllers/vtuConsoleController');
const { protect, requireTransactionPin } = require('../middlewares/auth');
const { adminAuth } = require('../middlewares/admin');

/**
 * @swagger
 * /api/v1/console/providers:
 *   get:
 *     summary: Get all VTU providers with status
 *     tags: [VTU Console - Providers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all providers
 */
router.get('/providers', adminAuth, vtuConsoleController.getAllProviders);

/**
 * @swagger
 * /api/v1/console/providers/config:
 *   get:
 *     summary: Get provider configuration (public info)
 *     tags: [VTU Console - Providers]
 *     responses:
 *       200:
 *         description: Provider configuration
 */
router.get('/providers/config', vtuConsoleController.getProviderConfig);

/**
 * @swagger
 * /api/v1/console/config:
 *   post:
 *     summary: Save service provider configuration
 *     tags: [VTU Console - Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               data:
 *                 type: string
 *                 description: Provider for data services
 *               airtime:
 *                 type: string
 *                 description: Provider for airtime
 *               airtimepin:
 *                 type: string
 *                 description: Provider for airtime PIN
 *               education:
 *                 type: string
 *                 description: Provider for education PIN
 *               electricity:
 *                 type: string
 *                 description: Provider for electricity
 *               cable:
 *                 type: string
 *                 description: Provider for cable TV
 *               airtime2cash:
 *                 type: string
 *                 description: Provider for airtime2cash
 *     responses:
 *       200:
 *         description: Configuration saved
 */
router.post('/config', adminAuth, vtuConsoleController.saveServiceConfig);

/**
 * @swagger
 * /api/v1/console/providers/:providerId:
 *   get:
 *     summary: Get provider details by ID
 *     tags: [VTU Console - Providers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         description: Provider ID
 *     responses:
 *       200:
 *         description: Provider details
 */
router.get('/providers/:providerId', adminAuth, vtuConsoleController.getProvider);

/**
 * @swagger
 * /api/v1/console/providers/:providerId/stats:
 *   get:
 *     summary: Get provider statistics
 *     tags: [VTU Console - Providers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *     responses:
 *       200:
 *         description: Provider statistics
 */
router.get('/providers/:providerId/stats', adminAuth, vtuConsoleController.getProviderStats);

/**
 * @swagger
 * /api/v1/console/providers/:providerId/balance:
 *   get:
 *     summary: Get provider balance
 *     tags: [VTU Console - Providers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *     responses:
 *       200:
 *         description: Provider balance
 */
router.get('/providers/:providerId/balance', adminAuth, vtuConsoleController.getProviderBalance);

/**
 * @swagger
 * /api/v1/console/switch:
 *   post:
 *     summary: Switch primary VTU provider
 *     tags: [VTU Console - Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - providerId
 *             properties:
 *               providerId:
 *                 type: string
 *                 enum: [clubkonnect, airtimenigeria, smeplug]
 *     responses:
 *       200:
 *         description: Provider switched successfully
 */
router.post('/switch', adminAuth, vtuConsoleController.switchProvider);

/**
 * @swagger
 * /api/v1/console/health:
 *   post:
 *     summary: Run health check on all providers
 *     tags: [VTU Console - Health]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Health check results
 */
router.post('/health', adminAuth, vtuConsoleController.runHealthCheck);

/**
 * @swagger
 * /api/v1/console/providers/:providerId/health:
 *   post:
 *     summary: Run health check on a specific provider
 *     tags: [VTU Console - Health]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *     responses:
 *       200:
 *         description: Health check result
 */
router.post('/providers/:providerId/health', adminAuth, vtuConsoleController.runProviderHealthCheck);

/**
 * @swagger
 * /api/v1/console/balances:
 *   get:
 *     summary: Get all provider balances
 *     tags: [VTU Console - Providers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All provider balances
 */
router.get('/balances', adminAuth, vtuConsoleController.getProviderBalances);

/**
 * @swagger
 * /api/v1/console/logs:
 *   get:
 *     summary: Get API logs
 *     tags: [VTU Console - Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: provider
 *         description: Filter by provider
 *       - in: query
 *         name: limit
 *         description: Number of logs to return
 *     responses:
 *       200:
 *         description: API logs
 */
router.get('/logs', adminAuth, vtuConsoleController.getApiLogs);

/**
 * @swagger
 * /api/v1/console/providers/:providerId/status:
 *   put:
 *     summary: Update provider status
 *     tags: [VTU Console - Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, inactive, maintenance, degraded]
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Provider status updated
 */
router.put('/providers/:providerId/status', adminAuth, vtuConsoleController.updateProviderStatus);

/**
 * @swagger
 * /api/v1/console/init:
 *   post:
 *     summary: Initialize providers in database
 *     tags: [VTU Console - Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Providers initialized
 */
router.post('/init', adminAuth, vtuConsoleController.initializeProviders);

/**
 * @swagger
 * /api/v1/console/bill-payment/providers:
 *   get:
 *     summary: Get bill payment provider configuration
 *     tags: [VTU Console - Bill Payment]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bill payment providers
 */
router.get('/bill-payment/providers', adminAuth, vtuConsoleController.getBillPaymentProviders);

/**
 * @swagger
 * /api/v1/console/bill-payment/switch:
 *   post:
 *     summary: Switch provider for bill payment service
 *     tags: [VTU Console - Bill Payment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serviceType
 *               - providerId
 *             properties:
 *               serviceType:
 *                 type: string
 *                 enum: [electricity, cable_tv]
 *               providerId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Provider switched
 */
router.post('/bill-payment/switch', adminAuth, vtuConsoleController.switchBillPaymentProvider);

module.exports = router;
