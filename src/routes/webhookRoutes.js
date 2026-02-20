const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

router.post('/paystack', express.raw({ type: 'application/json' }), webhookController.paystackWebhook);
router.post('/monnify', express.raw({ type: 'application/json' }), webhookController.monnifyWebhook);
router.post('/flutterwave', express.raw({ type: 'application/json' }), webhookController.flutterwaveWebhook);

router.post('/provider/:providerName', express.json(), webhookController.providerCallback);

module.exports = router;