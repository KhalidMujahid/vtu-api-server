const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const walletController = require('../controllers/walletController');
const { protect, restrictTo, requireTransactionPin } = require('../middlewares/auth');
const { hasWallet } = require('../middlewares/wallet');

router.post('/register', agentController.register);
router.post('/login', agentController.login);
router.get('/dashboard', protect, restrictTo('agent'), agentController.getDashboardStats);
router.get('/commission', protect, restrictTo('agent'), agentController.getAgentCommission);
router.post('/commission/withdraw', protect, restrictTo('agent'), agentController.withdrawCommission);
router.get('/wallet/balance', protect, restrictTo('agent'), hasWallet, walletController.getWalletBalance);
router.post('/wallet/fund', protect, restrictTo('agent'), hasWallet, walletController.fundWallet);
router.get('/wallet/transactions', protect, restrictTo('agent'), hasWallet, walletController.getTransactionHistory);

router.get('/services', protect, restrictTo('agent'), agentController.getServices);


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