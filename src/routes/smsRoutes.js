const express = require('express');
const router = express.Router();
const smsController = require('../controllers/smsController');
const { protect, requireTransactionPin } = require('../middlewares/auth');


router.get('/balance', protect, smsController.getBulkSmsBalance);
router.post('/send', protect, requireTransactionPin, smsController.sendBulkSms);
router.post('/webhook/bulksmsnigeria', smsController.bulkSmsWebhook);
router.get('/webhook/bulksmsnigeria', smsController.bulkSmsWebhook);

module.exports = router;
