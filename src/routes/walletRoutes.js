const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { protect, requireTransactionPin } = require('../middlewares/auth');
const { hasWallet } = require('../middlewares/wallet');

router.use(protect);

router.post('/create', walletController.createWallet);
router.get('/status', walletController.checkWalletStatus);

router.get('/balance', hasWallet, walletController.getWalletBalance);
router.post('/fund', hasWallet, walletController.fundWallet);
router.post('/transfer', hasWallet, requireTransactionPin, walletController.transferToUser);
router.post('/withdraw', hasWallet, requireTransactionPin, walletController.withdrawToBank);
router.get('/transactions', hasWallet, walletController.getTransactionHistory);
router.get('/accounts', hasWallet, walletController.getWalletAccounts);
router.post('/accounts/refresh', hasWallet, walletController.refreshWalletAccounts);
router.post('/set-pin', walletController.setTransactionPin); 

module.exports = router;