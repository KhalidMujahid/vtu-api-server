const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middlewares/auth');

/**
 * @swagger
 * /api/v1/payments/initialize:
 *   post:
 *     summary: Initialize payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - email
 *             properties:
 *               amount:
 *                 type: number
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment initialized
 */
router.post('/initialize', protect, paymentController.initializePaystackPayment);

/**
 * @swagger
 * /api/v1/payments/verify/{reference}:
 *   get:
 *     summary: Verify payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment verified
 */
router.get('/verify/:reference', protect, paymentController.verifyPaystackPayment);

/**
 * @swagger
 * /api/v1/payments/status/{reference}:
 *   get:
 *     summary: Get payment status
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment status
 */
router.get('/status/:reference', protect, paymentController.getPaymentStatus);

/**
 * @swagger
 * /api/v1/payments/webhook:
 *   post:
 *     summary: Paystack webhook
 *     tags: [Payments - Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/webhook', paymentController.paystackWebhook);

module.exports = router;
