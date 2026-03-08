const express = require('express');
const router = express.Router();
const telecomController = require('../controllers/telecomController');

const { protect, requireTransactionPin } = require('../middlewares/auth');
router.post('/webhook/smedata', telecomController.smedataWebhook);
router.get('/nellobyte/callback', telecomController.airtimeCallback);

router.use(protect);

router.get('/data/plans', telecomController.getDataPlans);
router.get('/airtime/webhook', telecomController.airtimeWebhook);
router.post('/data/purchase', requireTransactionPin, telecomController.purchaseData);

router.post('/airtime/purchase', requireTransactionPin, telecomController.purchaseAirtime);
// router.post('/airtime/swap', requireTransactionPin, telecomController.airtimeSwap);

router.post('/recharge-pin/purchase', requireTransactionPin, telecomController.purchaseRechargePin);


module.exports = router;