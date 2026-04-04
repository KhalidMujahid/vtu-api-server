const express = require('express');
const router = express.Router();
const billsController = require('../controllers/billsController');
const { protect, requireTransactionPin } = require('../middlewares/auth');

router.post('/webhook/nellobytes', billsController.nelloBytesWebhook);
router.get('/webhook/nellobytes', billsController.nelloBytesWebhook);

router.use(protect);
router.get('/electricity/discos', billsController.getElectricityDiscos);
router.get('/electricity/plans', billsController.getElectricityDiscos);
router.post('/electricity/verify', billsController.verifyElectricityCustomer);
router.post('/electricity/purchase', requireTransactionPin, billsController.purchaseElectricity);
router.post('/electricity/query', billsController.queryElectricityTransaction);
router.post('/electricity/cancel', billsController.cancelElectricityTransaction);
router.get('/cable/plans', billsController.getCablePlans);
router.post('/cable/purchase', requireTransactionPin, billsController.purchaseCableTV);
router.post('/cable/query', billsController.queryCableTransaction);
router.post('/cable/cancel', billsController.cancelCableTransaction);
router.post('/education/purchase', requireTransactionPin, billsController.purchaseEducationPin);
router.post('/education/verify', billsController.verifyEducationProfile);
router.post('/education/query', billsController.queryEducationTransaction);
router.post('/education/cancel', billsController.cancelEducationTransaction);

module.exports = router;
