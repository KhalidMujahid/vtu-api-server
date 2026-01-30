const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const { protect, restrictTo } = require('../middlewares/auth');

router.post('/login', agentController.login);
router.post('/register', agentController.register);

router.get('/dashboard', protect, restrictTo('agent'), agentController.getDashboardStats);
router.get('/services', protect, restrictTo('agent'), agentController.getServices);
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