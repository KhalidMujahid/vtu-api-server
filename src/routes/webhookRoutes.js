const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const telecomController = require('../controllers/telecomController');

router.post('/smeplug', webhookController.smePlugWebhook);
router.get('/smeplug', webhookController.smePlugWebhook);
router.post('/pluginng', telecomController.pluginngWebhook);
router.get('/pluginng', telecomController.pluginngWebhook);
router.post('/budpay', webhookController.budpayWebhook);
router.post('/paystack', express.raw({ type: 'application/json' }), webhookController.paystackWebhook);
router.post('/monnify', express.raw({ type: 'application/json' }), webhookController.monnifyWebhook);
router.post('/flutterwave', express.raw({ type: 'application/json' }), webhookController.flutterwaveWebhook);
router.post('/provider/:providerName', express.json(), webhookController.providerCallback);

module.exports = router;
