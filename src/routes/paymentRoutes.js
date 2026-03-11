<<<<<<< HEAD
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middlewares/auth');

router.post('/initialize', protect, paymentController.initializePaystackPayment);
router.get('/verify/:reference', protect, paymentController.verifyPaystackPayment);
router.get('/status/:reference', protect, paymentController.getPaymentStatus);

router.post('/webhook', paymentController.paystackWebhook);

=======
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middlewares/auth');

router.post('/initialize', protect, paymentController.initializePaystackPayment);
router.get('/verify/:reference', protect, paymentController.verifyPaystackPayment);
router.get('/status/:reference', protect, paymentController.getPaymentStatus);

router.post('/webhook', paymentController.paystackWebhook);

>>>>>>> 8afeb82 (another commit)
module.exports = router;