const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { adminAuth, logAction, superAdminOnly, staffOnly } = require('../middlewares/admin');

router.use(adminAuth);

router.get('/dashboard', adminController.getDashboardStats);

router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUser);
router.put('/users/:id/suspend', logAction('suspend', 'user'), adminController.suspendUser);
router.put('/users/:id/activate', logAction('activate', 'user'), adminController.activateUser);
router.put('/users/:id/reset-pin', logAction('update', 'user'), adminController.resetTransactionPin);

router.get('/wallets', adminController.getWallets);
router.get('/wallets/:userId', adminController.getUserWallet);
router.post('/wallets/:userId/credit', logAction('credit', 'wallet'), adminController.creditWallet);
router.post('/wallets/:userId/debit', logAction('debit', 'wallet'), adminController.debitWallet);
router.put('/wallets/:userId/lock', logAction('suspend', 'wallet'), adminController.lockWallet);
router.put('/wallets/:userId/unlock', logAction('activate', 'wallet'), adminController.unlockWallet);

router.get('/transactions', adminController.getTransactions);
router.get('/transactions/:id', adminController.getTransaction);
router.post('/transactions/:id/refund', logAction('refund', 'transaction'), adminController.refundTransaction);
router.post('/transactions/retry-failed', logAction('update', 'transaction'), adminController.retryFailedTransactions);

router.use(superAdminOnly);
router.get('/pricing', adminController.getPricing);
router.post('/pricing', logAction('create', 'pricing'), adminController.createPricing);
router.put('/pricing/:id', logAction('update', 'pricing'), adminController.updatePricing);
router.delete('/pricing/:id', logAction('delete', 'pricing'), adminController.deletePricing);

router.get('/providers', adminController.getProviders);
router.put('/providers/:name/status', logAction('update', 'provider'), adminController.updateProviderStatus);

router.get('/logs', adminController.getAdminLogs);

module.exports = router;