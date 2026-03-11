const express = require('express');
const router = express.Router();
const telecomController = require('../controllers/telecomController');

const { protect, requireTransactionPin } = require('../middlewares/auth');

router.post('/webhook/smedata', telecomController.smedataWebhook);
router.post('/webhook/nellobytes', telecomController.nelloBytesWebhook);
router.get('/nellobyte/callback', telecomController.airtimeCallback);

router.use(protect);

router.get('/data/plans', telecomController.getDataPlans);
router.post('/data/purchase', requireTransactionPin, telecomController.purchaseData);

router.post('/airtime/purchase', requireTransactionPin, telecomController.purchaseAirtime);
router.get('/airtime/webhook', telecomController.airtimeWebhook);

router.get('/epin/plans', telecomController.getEPINPlans);
router.post('/epin/purchase', requireTransactionPin, telecomController.purchaseRechargePin);

module.exports = router;