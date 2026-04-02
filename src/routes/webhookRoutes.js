const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const telecomController = require('../controllers/telecomController');

router.post('/smeplug', webhookController.smePlugWebhook);
router.get('/smeplug', webhookController.smePlugWebhook);
router.post('/pluginng', telecomController.pluginngWebhook);
router.get('/pluginng', telecomController.pluginngWebhook);

/**
 * @swagger
 * /api/v1/webhooks/webhook/budpay:
 *   post:
 *     summary: Budpay webhook
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/budpay', webhookController.budpayWebhook);

/**
 * @swagger
 * /api/v1/webhooks/paystack:
 *   post:
 *     summary: Paystack webhook
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/paystack', express.raw({ type: 'application/json' }), webhookController.paystackWebhook);

/**
 * @swagger
 * /api/v1/webhooks/monnify:
 *   post:
 *     summary: Monnify webhook
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/monnify', express.raw({ type: 'application/json' }), webhookController.monnifyWebhook);

/**
 * @swagger
 * /api/v1/webhooks/flutterwave:
 *   post:
 *     summary: Flutterwave webhook
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/flutterwave', express.raw({ type: 'application/json' }), webhookController.flutterwaveWebhook);

/**
 * @swagger
 * /api/v1/webhooks/provider/{providerName}:
 *   post:
 *     summary: Generic provider callback
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: providerName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Callback processed
 */
router.post('/provider/:providerName', express.json(), webhookController.providerCallback);

module.exports = router;
