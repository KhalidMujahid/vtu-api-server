const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');

const { protect, requireTransactionPin } = require('../middlewares/auth');
router.use(protect);

router.get('/balance', walletController.getWalletBalance);
router.post('/fund', walletController.fundWallet);
router.post('/transfer', requireTransactionPin, walletController.transferToUser);
router.post('/withdraw', requireTransactionPin, walletController.withdrawToBank);
router.get('/transactions', walletController.getTransactionHistory);
router.post('/set-pin', walletController.setTransactionPin);

module.exports = router;