const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

router.post('/paystack', webhookController.paystackWebhook);
router.post('/monnify', webhookController.monnifyWebhook);
router.post('/flutterwave', webhookController.flutterwaveWebhook);

router.post('/provider/:providerName', webhookController.providerCallback);

module.exports = router;