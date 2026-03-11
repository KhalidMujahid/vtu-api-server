const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const walletController = require('../controllers/walletController');
const { protect, restrictTo, requireTransactionPin } = require('../middlewares/auth');
const { hasWallet } = require('../middlewares/wallet');

router.post('/login', agentController.login);
router.post('/register', agentController.register);

router.get('/dashboard', protect, restrictTo('agent'), agentController.getDashboardStats);

// Wallet routes for agents (same as client wallet)
router.post('/wallet/create', protect, restrictTo('agent'), walletController.createWallet);
router.get('/wallet/status', protect, restrictTo('agent'), walletController.checkWalletStatus);
router.get('/wallet/balance', protect, restrictTo('agent'), hasWallet, walletController.getWalletBalance);
router.post('/wallet/fund', protect, restrictTo('agent'), hasWallet, walletController.fundWallet);
router.post('/wallet/transfer', protect, restrictTo('agent'), hasWallet, requireTransactionPin, walletController.transferToUser);
router.post('/wallet/withdraw', protect, restrictTo('agent'), hasWallet, requireTransactionPin, walletController.withdrawToBank);
router.get('/wallet/transactions', protect, restrictTo('agent'), hasWallet, walletController.getTransactionHistory);
router.get('/wallet/accounts', protect, restrictTo('agent'), hasWallet, walletController.getWalletAccounts);
router.post('/wallet/accounts/refresh', protect, restrictTo('agent'), hasWallet, walletController.refreshWalletAccounts);
router.post('/wallet/set-pin', protect, restrictTo('agent'), walletController.setTransactionPin);
router.post('/wallet/update-pin', protect, restrictTo('agent'), walletController.updateTransactionPin);

router.get('/services', protect, restrictTo('agent'), agentController.getServices);

// Commission Management for Agents
router.get('/commission', protect, restrictTo('agent'), agentController.getAgentCommission);
router.post('/commission/withdraw', protect, restrictTo('agent'), agentController.withdrawCommission);

router.get('/agents', protect, restrictTo('admin', 'super_admin'), agentController.getAgents);
router.post('/verify-customer', protect, restrictTo('agent'), agentController.verifyCustomer);
router.post('/purchase/airtime', protect, restrictTo('agent'), agentController.purchaseAirtime);
router.post('/purchase/data', protect, restrictTo('agent'), agentController.purchaseData);
router.post('/pay-bill', protect, restrictTo('agent'), agentController.payBill);

router.get('/profile', protect, restrictTo('agent'), (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      agent: req.user,
    },
  });
});

router.get('/agents', protect, restrictTo('admin', 'super_admin'), agentController.getAgents);
router.get('/agents/:id', protect, restrictTo('admin', 'super_admin'), agentController.getAgent);
router.post('/agents', protect, restrictTo('admin', 'super_admin'), agentController.createAgent);
router.put('/agents/:id', protect, restrictTo('admin', 'super_admin'), agentController.updateAgent);
router.post('/agents/:id/verify-documents', protect, restrictTo('admin', 'super_admin'), agentController.verifyAgentDocuments);
router.get('/agents/:id/performance', protect, restrictTo('admin', 'super_admin'), agentController.getAgentPerformance);
router.get('/agents/:id/commission-report', protect, restrictTo('admin', 'super_admin'), agentController.getAgentCommissionReport);
router.post('/agents/:id/withdraw-commission', protect, restrictTo('admin', 'super_admin'), agentController.processCommissionWithdrawal);

module.exports = router;