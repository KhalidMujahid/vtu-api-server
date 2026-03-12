const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const walletController = require('../controllers/walletController');
const { protect, restrictTo, requireTransactionPin } = require('../middlewares/auth');
const { hasWallet } = require('../middlewares/wallet');

/**
 * @swagger
 * /api/v1/agent/register:
 *   post:
 *     summary: Register as agent
 *     tags: [Agents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - phoneNumber
 *               - password
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *               phoneNumber:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Agent registered
 */
router.post('/register', agentController.register);

/**
 * @swagger
 * /api/v1/agent/login:
 *   post:
 *     summary: Agent login
 *     tags: [Agents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post('/login', agentController.login);

/**
 * @swagger
 * /api/v1/agent/dashboard:
 *   get:
 *     summary: Get agent dashboard
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard stats
 */
router.get('/dashboard', protect, restrictTo('agent'), agentController.getDashboardStats);

/**
 * @swagger
 * /api/v1/agent/commission:
 *   get:
 *     summary: Get agent commission
 *     tags: [Agents - Commission]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Commission balance
 */
router.get('/commission', protect, restrictTo('agent'), agentController.getAgentCommission);

/**
 * @swagger
 * /api/v1/agent/commission/withdraw:
 *   post:
 *     summary: Withdraw agent commission
 *     tags: [Agents - Commission]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Withdrawal processed
 */
router.post('/commission/withdraw', protect, restrictTo('agent'), agentController.withdrawCommission);

/**
 * @swagger
 * /api/v1/agent/wallet/balance:
 *   get:
 *     summary: Get agent wallet balance
 *     tags: [Agents - Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance
 */
router.get('/wallet/balance', protect, restrictTo('agent'), hasWallet, walletController.getWalletBalance);

/**
 * @swagger
 * /api/v1/agent/wallet/fund:
 *   post:
 *     summary: Fund agent wallet
 *     tags: [Agents - Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Wallet funded
 */
router.post('/wallet/fund', protect, restrictTo('agent'), hasWallet, walletController.fundWallet);

/**
 * @swagger
 * /api/v1/agent/wallet/transactions:
 *   get:
 *     summary: Get agent transactions
 *     tags: [Agents - Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaction history
 */
router.get('/wallet/transactions', protect, restrictTo('agent'), hasWallet, walletController.getTransactionHistory);

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