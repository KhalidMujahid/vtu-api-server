const express = require('express');
const router = express.Router();
const telecomController = require('../controllers/telecomController');

const { protect, requireTransactionPin } = require('../middlewares/auth');

/**
 * @swagger
 * /api/v1/telecom/webhook/smedata:
 *   post:
 *     summary: SMEDATA webhook
 *     tags: [Telecom - Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/webhook/smedata', telecomController.smedataWebhook);

/**
 * @swagger
 * /api/v1/telecom/webhook/nellobytes:
 *   post:
 *     summary: NelloBytes webhook
 *     tags: [Telecom - Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/webhook/nellobytes', telecomController.nelloBytesWebhook);

/**
 * @swagger
 * /api/v1/telecom/webhook/airtimenigeria:
 *   post:
 *     summary: AirtimeNigeria webhook
 *     tags: [Telecom - Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/webhook/airtimenigeria', telecomController.airtimeNigeriaWebhook);

/**
 * @swagger
 * /api/v1/telecom/smeplug/networks:
 *   get:
 *     summary: Get SMEPlug networks
 *     tags: [Telecom - SMEPlug]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available networks
 */
router.get('/smeplug/networks', protect, telecomController.getSmePlugNetworks);

/**
 * @swagger
 * /api/v1/telecom/smeplug/balance:
 *   get:
 *     summary: Get SMEPlug wallet balance
 *     tags: [Telecom - SMEPlug]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance
 */
router.get('/smeplug/balance', protect, telecomController.getSmePlugBalance);

/**
 * @swagger
 * /api/v1/telecom/smeplug/data/purchase:
 *   post:
 *     summary: Purchase data via SMEPlug
 *     tags: [Telecom - SMEPlug]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Data purchased
 */
router.post('/smeplug/data/purchase', protect, requireTransactionPin, telecomController.purchaseSmePlugData);

/**
 * @swagger
 * /api/v1/telecom/smeplug/airtime/purchase:
 *   post:
 *     summary: Purchase airtime via SMEPlug
 *     tags: [Telecom - SMEPlug]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Airtime purchased
 */
router.post('/smeplug/airtime/purchase', protect, requireTransactionPin, telecomController.purchaseSmePlugAirtime);

/**
 * @swagger
 * /api/v1/telecom/webhook/smeplug:
 *   post:
 *     summary: SMEPlug webhook
 *     tags: [Telecom - Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/webhook/smeplug', telecomController.smePlugWebhook);

/**
 * @swagger
 * /api/v1/telecom/nellobyte/callback:
 *   get:
 *     summary: NelloBytes callback
 *     tags: [Telecom - Webhooks]
 *     responses:
 *       200:
 *         description: Callback processed
 */
router.get('/nellobyte/callback', telecomController.airtimeCallback);

router.use(protect);

/**
 * @swagger
 * /api/v1/telecom/data/plans:
 *   get:
 *     summary: Get data plans
 *     tags: [Telecom - Data]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Data plans
 */
router.get('/data/plans', telecomController.getDataPlans);

/**
 * @swagger
 * /api/v1/telecom/data:
 *   get:
 *     summary: Get data plans from active provider (unified endpoint)
 *     tags: [Telecom - Data]
 *     parameters:
 *       - in: query
 *         name: network
 *         schema:
 *           type: string
 *           enum: [mtn, glo, airtel, 9mobile]
 *     responses:
 *       200:
 *         description: Data plans fetched successfully
 *   post:
 *     summary: Purchase data from active provider (unified endpoint)
 *     tags: [Telecom - Data]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - network
 *               - dataPlan
 *               - transactionPin
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Recipient phone number
 *               network:
 *                 type: string
 *                 enum: [mtn, glo, airtel, 9mobile]
 *               dataPlan:
 *                 type: string
 *                 description: Plan code or amount
 *               transactionPin:
 *                 type: string
 *               amount:
 *                 type: number
 *                 description: Optional - selling price
 *     responses:
 *       200:
 *         description: Data purchase successful
 */
router.get('/data', telecomController.getDataPlans);
router.post('/data', protect, requireTransactionPin, telecomController.purchaseData);

/**
 * @swagger
 * /api/v1/telecom/data/purchase:
 *   post:
 *     summary: Purchase data
 *     tags: [Telecom - Data]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - planId
 *             properties:
 *               phoneNumber:
 *                 type: string
 *               planId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Data purchased
 */
router.post('/data/purchase', protect, requireTransactionPin, telecomController.purchaseData);

/**
 * @swagger
 * /api/v1/telecom/airtime/purchase:
 *   post:
 *     summary: Purchase airtime
 *     tags: [Telecom - Airtime]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - amount
 *               - network
 *             properties:
 *               phoneNumber:
 *                 type: string
 *               amount:
 *                 type: number
 *               network:
 *                 type: string
 *     responses:
 *       200:
 *         description: Airtime purchased
 */
router.post('/airtime/purchase', protect, requireTransactionPin, telecomController.purchaseAirtime);

/**
 * @swagger
 * /api/v1/telecom/airtime:
 *   post:
 *     summary: Purchase airtime from active provider (unified endpoint)
 *     tags: [Telecom - Airtime]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - network
 *               - amount
 *               - transactionPin
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Recipient phone number
 *               network:
 *                 type: string
 *                 enum: [mtn, glo, airtel, 9mobile]
 *               amount:
 *                 type: number
 *                 description: Amount to recharge
 *               transactionPin:
 *                 type: string
 *     responses:
 *       200:
 *         description: Airtime purchase successful
 */
router.post('/airtime', protect, requireTransactionPin, telecomController.purchaseAirtime);

/**
 * @swagger
 * /api/v1/telecom/airtime/webhook:
 *   get:
 *     summary: Airtime webhook
 *     tags: [Telecom - Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.get('/airtime/webhook', telecomController.airtimeWebhook);

/**
 * @swagger
 * /api/v1/telecom/epin/plans:
 *   get:
 *     summary: Get E-PIN plans
 *     tags: [Telecom - E-PIN]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: E-PIN plans
 */
router.get('/epin/plans', telecomController.getEPINPlans);

/**
 * @swagger
 * /api/v1/telecom/epin/purchase:
 *   post:
 *     summary: Purchase E-PIN
 *     tags: [Telecom - E-PIN]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planId
 *               - quantity
 *             properties:
 *               planId:
 *                 type: string
 *               quantity:
 *                 type: number
 *     responses:
 *       200:
 *         description: E-PIN purchased
 */
router.post('/epin/purchase', requireTransactionPin, telecomController.purchaseRechargePin);

/**
 * @swagger
 * /api/v1/telecom/provider:
 *   get:
 *     summary: Get current VTU provider
 *     tags: [Telecom - Provider]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current provider info
 */
router.get('/provider', protect, telecomController.getCurrentProvider);

/**
 * @swagger
 * /api/v1/telecom/airtimenigeria/plans:
 *   get:
 *     summary: Get AirtimeNigeria data plans
 *     tags: [Telecom - AirtimeNigeria]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Data plans from AirtimeNigeria
 */
router.get('/airtimenigeria/plans', protect, telecomController.getAirtimeNigeriaDataPlans);

/**
 * @swagger
 * /api/v1/telecom/airtimenigeria/data/purchase:
 *   post:
 *     summary: Purchase data via AirtimeNigeria
 *     tags: [Telecom - AirtimeNigeria]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Data purchased
 */
router.post('/airtimenigeria/data/purchase', protect, requireTransactionPin, telecomController.purchaseAirtimeNigeriaData);

/**
 * @swagger
 * /api/v1/telecom/airtimenigeria/airtime/purchase:
 *   post:
 *     summary: Purchase airtime via AirtimeNigeria
 *     tags: [Telecom - AirtimeNigeria]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Airtime purchased
 */
router.post('/airtimenigeria/airtime/purchase', protect, requireTransactionPin, telecomController.purchaseAirtimeNigeriaAirtime);

/**
 * @swagger
 * /api/v1/telecom/airtimenigeria/balance:
 *   get:
 *     summary: Get AirtimeNigeria wallet balance
 *     tags: [Telecom - AirtimeNigeria]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance
 */
router.get('/airtimenigeria/balance', protect, telecomController.getAirtimeNigeriaBalance);

module.exports = router;
