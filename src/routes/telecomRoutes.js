const express = require('express');
const router = express.Router();
const telecomController = require('../controllers/telecomController');
const webhookController = require('../controllers/webhookController');

const { protect, requireTransactionPin } = require('../middlewares/auth');
router.post('/webhook/smedata', telecomController.smedataWebhook);
router.post('/webhook/nellobytes', telecomController.nelloBytesWebhook);
router.get('/webhook/nellobytes', telecomController.nelloBytesWebhook);
router.post('/webhook/smeplug', webhookController.smePlugWebhook);
router.get('/webhook/smeplug', webhookController.smePlugWebhook);
router.post('/webhook/pluginng', telecomController.pluginngWebhook);
router.get('/webhook/pluginng', telecomController.pluginngWebhook);
router.post('/webhook/airtimenigeria', telecomController.airtimeNigeriaWebhook);
router.get('/webhook/airtimenigeria', telecomController.airtimeNigeriaWebhook);
router.get('/smeplug/networks', protect, telecomController.getSmePlugNetworks);
router.get('/smeplug/balance', protect, telecomController.getSmePlugBalance);
router.post('/smeplug/data/purchase', protect, requireTransactionPin, telecomController.purchaseSmePlugData);
router.post('/smeplug/airtime/purchase', protect, requireTransactionPin, telecomController.purchaseSmePlugAirtime);
router.get('/nellobyte/callback', telecomController.airtimeCallback);

router.use(protect);













router.get('/data/plans', telecomController.getDataPlans);



















































router.get('/data', telecomController.getDataPlans);
router.post('/data', protect, requireTransactionPin, telecomController.purchaseData);



























router.post('/data/purchase', protect, requireTransactionPin, telecomController.purchaseData);






























router.post('/airtime/purchase', protect, requireTransactionPin, telecomController.purchaseAirtime);
router.post('/airtime/query', protect, telecomController.queryAirtimeTransaction);
router.post('/airtime/cancel', protect, telecomController.cancelAirtimeTransaction);




































router.post('/airtime', protect, requireTransactionPin, telecomController.purchaseAirtime);











router.get('/airtime/webhook', telecomController.airtimeWebhook);
router.post('/airtime/webhook', telecomController.airtimeWebhook);













router.get('/epin/plans', telecomController.getEPINPlans);
router.get('/recharge-pin/plans', telecomController.getEPINPlans);



























router.post('/epin/purchase', requireTransactionPin, telecomController.purchaseRechargePin);
router.post('/recharge-pin/purchase', requireTransactionPin, telecomController.purchaseRechargePin);













router.get('/provider', protect, telecomController.getCurrentProvider);













router.get('/airtimenigeria/plans', protect, telecomController.getAirtimeNigeriaDataPlans);
router.get('/pluginng/plans', protect, telecomController.getPluginngDataPlans);













router.post('/airtimenigeria/data/purchase', protect, requireTransactionPin, telecomController.purchaseAirtimeNigeriaData);













router.post('/airtimenigeria/airtime/purchase', protect, requireTransactionPin, telecomController.purchaseAirtimeNigeriaAirtime);













router.get('/airtimenigeria/balance', protect, telecomController.getAirtimeNigeriaBalance);

module.exports = router;
