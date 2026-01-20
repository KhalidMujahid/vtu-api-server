const express = require('express');
const router = express.Router();
const billsController = require('../controllers/billsController');

const { protect, requireTransactionPin } = require('../middlewares/auth');
router.use(protect);

router.post('/electricity/verify', billsController.verifyElectricityCustomer);
router.post('/electricity/purchase', requireTransactionPin, billsController.purchaseElectricity);

router.get('/cable/plans', billsController.getCablePlans);
router.post('/cable/purchase', requireTransactionPin, billsController.purchaseCableTV);

router.post('/education/purchase', requireTransactionPin, billsController.purchaseEducationPin);

module.exports = router;