const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { protect, requireTransactionPin } = require('../middlewares/auth');
const { hasWallet } = require('../middlewares/wallet');

router.use(protect);

/**
 * @swagger
 * /api/v1/wallet/create:
 *   post:
 *     summary: Create wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Wallet created
 */
router.post('/create', walletController.createWallet);

/**
 * @swagger
 * /api/v1/wallet/status:
 *   get:
 *     summary: Check wallet status
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet status
 */
router.get('/status', walletController.checkWalletStatus);

/**
 * @swagger
 * /api/v1/wallet/balance:
 *   get:
 *     summary: Get wallet balance
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance
 */
router.get('/balance', hasWallet, walletController.getWalletBalance);

/**
 * @swagger
 * /api/v1/wallet/fund:
 *   post:
 *     summary: Fund wallet
 *     tags: [Wallet]
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
router.post('/fund', hasWallet, walletController.fundWallet);

/**
 * @swagger
 * /api/v1/wallet/transfer:
 *   post:
 *     summary: Transfer to user
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 object
 *             required:
 *               *             type: - recipientPhone
 *               - amount
 *               - transactionPin
 *             properties:
 *               recipientPhone:
 *                 type: string
 *               amount:
 *                 type: number
 *               transactionPin:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transfer successful
 */
router.post('/transfer', hasWallet, requireTransactionPin, walletController.transferToUser);

/**
 * @swagger
 * /api/v1/wallet/withdraw:
 *   post:
 *     summary: Withdraw to bank
 *     tags: [Wallet]
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
 *               - bankCode
 *               - accountNumber
 *               - transactionPin
 *             properties:
 *               amount:
 *                 type: number
 *               bankCode:
 *                 type: string
 *               accountNumber:
 *                 type: string
 *               transactionPin:
 *                 type: string
 *     responses:
 *       200:
 *         description: Withdrawal initiated
 */
router.post('/withdraw', hasWallet, requireTransactionPin, walletController.withdrawToBank);

/**
 * @swagger
 * /api/v1/wallet/transactions:
 *   get:
 *     summary: Get transaction history
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transactions list
 */
router.get('/transactions', hasWallet, walletController.getTransactionHistory);

/**
 * @swagger
 * /api/v1/wallet/accounts:
 *   get:
 *     summary: Get virtual accounts
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Virtual accounts
 */
router.get('/accounts', hasWallet, walletController.getWalletAccounts);

/**
 * @swagger
 * /api/v1/wallet/accounts/refresh:
 *   post:
 *     summary: Refresh virtual accounts
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Accounts refreshed
 */
router.post('/accounts/refresh', hasWallet, walletController.refreshWalletAccounts);

/**
 * @swagger
 * /api/v1/wallet/set-pin:
 *   post:
 *     summary: Set transaction PIN
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionPin
 *             properties:
 *               transactionPin:
 *                 type: string
 *     responses:
 *       200:
 *         description: PIN set
 */
router.post('/set-pin', walletController.setTransactionPin);

/**
 * @swagger
 * /api/v1/wallet/update-pin:
 *   post:
 *     summary: Update transaction PIN
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPin
 *               - newPin
 *             properties:
 *               currentPin:
 *                 type: string
 *               newPin:
 *                 type: string
 *     responses:
 *       200:
 *         description: PIN updated
 */
router.post('/update-pin', walletController.updateTransactionPin);

module.exports = router;
