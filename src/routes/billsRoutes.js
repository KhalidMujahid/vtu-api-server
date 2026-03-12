const express = require('express');
const router = express.Router();
const billsController = require('../controllers/billsController');

const { protect, requireTransactionPin } = require('../middlewares/auth');

/**
 * @swagger
 * /api/v1/bills/webhook/nellobytes:
 *   post:
 *     summary: NelloBytes webhook
 *     tags: [Bills - Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/webhook/nellobytes', billsController.nelloBytesWebhook);

router.use(protect);

/**
 * @swagger
 * /api/v1/bills/electricity/verify:
 *   post:
 *     summary: Verify electricity customer
 *     tags: [Bills - Electricity]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - disco
 *               - meterNumber
 *             properties:
 *               disco:
 *                 type: string
 *               meterNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Customer verified
 */
router.post('/electricity/verify', billsController.verifyElectricityCustomer);

/**
 * @swagger
 * /api/v1/bills/electricity/purchase:
 *   post:
 *     summary: Purchase electricity
 *     tags: [Bills - Electricity]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - disco
 *               - meterNumber
 *               - amount
 *               - meterType
 *             properties:
 *               disco:
 *                 type: string
 *               meterNumber:
 *                 type: string
 *               amount:
 *                 type: number
 *               meterType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Electricity purchased
 */
router.post('/electricity/purchase', requireTransactionPin, billsController.purchaseElectricity);

/**
 * @swagger
 * /api/v1/bills/cable/plans:
 *   get:
 *     summary: Get cable TV plans
 *     tags: [Bills - Cable TV]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cable plans
 */
router.get('/cable/plans', billsController.getCablePlans);

/**
 * @swagger
 * /api/v1/bills/cable/purchase:
 *   post:
 *     summary: Purchase cable TV
 *     tags: [Bills - Cable TV]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cableProvider
 *               - smartCardNumber
 *               - planId
 *             properties:
 *               cableProvider:
 *                 type: string
 *               smartCardNumber:
 *                 type: string
 *               planId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cable TV purchased
 */
router.post('/cable/purchase', requireTransactionPin, billsController.purchaseCableTV);

/**
 * @swagger
 * /api/v1/bills/education/purchase:
 *   post:
 *     summary: Purchase education PIN
 *     tags: [Bills - Education]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - provider
 *               - planId
 *             properties:
 *               provider:
 *                 type: string
 *               planId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Education PIN purchased
 */
router.post('/education/purchase', requireTransactionPin, billsController.purchaseEducationPin);

module.exports = router;
