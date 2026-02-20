const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middlewares/auth');

router.post('/initialize', protect, paymentController.initializePaystackPayment);
router.get('/verify/:reference', protect, paymentController.verifyPaystackPayment);
router.get('/status/:reference', protect, paymentController.getPaymentStatus);

module.exports = router;