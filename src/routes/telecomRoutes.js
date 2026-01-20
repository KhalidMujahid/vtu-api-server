const express = require('express');
const router = express.Router();
const telecomController = require('../controllers/telecomController');

const { protect, requireTransactionPin } = require('../middlewares/auth');
router.use(protect);

router.get('/data/plans', telecomController.getDataPlans);
router.post('/data/purchase', requireTransactionPin, telecomController.purchaseData);

router.post('/airtime/purchase', requireTransactionPin, telecomController.purchaseAirtime);
router.post('/airtime/swap', requireTransactionPin, telecomController.airtimeSwap);

router.post('/recharge-pin/purchase', requireTransactionPin, telecomController.purchaseRechargePin);

module.exports = router;