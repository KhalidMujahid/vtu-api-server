const express = require('express');
const router = express.Router();
const smsController = require('../controllers/smsController');
const { protect, requireTransactionPin } = require('../middlewares/auth');

/**
 * @swagger
 * /api/v1/sms/balance:
 *   get:
 *     summary: Get BulkSMS Nigeria wallet balance
 *     tags: [SMS]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: SMS wallet balance
 */
router.get('/balance', protect, smsController.getBulkSmsBalance);

/**
 * @swagger
 * /api/v1/sms/send:
 *   post:
 *     summary: Send bulk SMS
 *     tags: [SMS]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - from
 *               - to
 *               - body
 *               - transactionPin
 *             properties:
 *               from:
 *                 type: string
 *               to:
 *                 type: string
 *               body:
 *                 type: string
 *               gateway:
 *                 type: string
 *               appendSender:
 *                 type: string
 *               callbackUrl:
 *                 type: string
 *               customerReference:
 *                 type: string
 *               transactionPin:
 *                 type: string
 *     responses:
 *       200:
 *         description: SMS sent successfully
 */
router.post('/send', protect, requireTransactionPin, smsController.sendBulkSms);

/**
 * @swagger
 * /api/v1/sms/webhook/bulksmsnigeria:
 *   post:
 *     summary: BulkSMS Nigeria callback endpoint
 *     tags: [SMS]
 *     responses:
 *       200:
 *         description: Callback processed
 */
router.post('/webhook/bulksmsnigeria', smsController.bulkSmsWebhook);
router.get('/webhook/bulksmsnigeria', smsController.bulkSmsWebhook);

module.exports = router;
