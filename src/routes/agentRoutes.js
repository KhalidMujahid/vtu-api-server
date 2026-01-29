const express = require('express');
const router = express.Router();
const AgentController = require('../controllers/AgentController');
const { auth, isAgent, isAdmin } = require('../middlewares/auth');

router.post('/login', AgentController.login);
router.post('/register', AgentController.register);

router.use(auth, isAgent);

router.get('/dashboard', AgentController.getDashboardStats);

router.get('/services', AgentController.getServices);
router.post('/verify-customer', AgentController.verifyCustomer);

router.post('/purchase/airtime', AgentController.purchaseAirtime);
router.post('/purchase/data', AgentController.purchaseData);
router.post('/pay-bill', AgentController.payBill);

router.get('/profile', (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      agent: req.user,
    },
  });
});

router.use(auth, isAdmin);

router.get('/agents', AgentController.getAgents);
router.get('/agents/:id', AgentController.getAgent);
router.post('/agents', AgentController.createAgent);
router.put('/agents/:id', AgentController.updateAgent);

router.post('/agents/:id/verify-documents', AgentController.verifyAgentDocuments);

router.get('/agents/:id/performance', AgentController.getAgentPerformance);
router.get('/agents/:id/commission-report', AgentController.getAgentCommissionReport);

router.post('/agents/:id/withdraw-commission', AgentController.processCommissionWithdrawal);

module.exports = router;