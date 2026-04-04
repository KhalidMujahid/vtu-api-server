const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const vtuConsoleController = require('../controllers/vtuConsoleController');
const { adminAuth, logAction, superAdminOnly, staffOnly } = require('../middlewares/admin');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

router.get('/check-auth', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(200).json({
        status: 'success',
        authenticated: false,
        message: 'No token provided. Please login.'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(200).json({
        status: 'success',
        authenticated: false,
        message: 'User not found.'
      });
    }
    
    if (!['admin', 'superadmin', 'staff', 'super_admin'].includes(user.role)) {
      return res.status(200).json({
        status: 'success',
        authenticated: false,
        message: 'Admin access required.'
      });
    }
    
    if (!user.isActive) {
      return res.status(200).json({
        status: 'success',
        authenticated: false,
        message: 'Admin account is deactivated.'
      });
    }
    
    return res.status(200).json({
      status: 'success',
      authenticated: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    return res.status(200).json({
      status: 'success',
      authenticated: false,
      message: 'Token expired or invalid. Please login again.'
    });
  }
});

router.use(adminAuth);

router.get('/dashboard', adminController.getDashboardStats);

router.get('/staff', superAdminOnly, adminController.getStaff);
router.post('/staff', superAdminOnly, adminController.addStaff);
router.put('/staff/:staffId/role', superAdminOnly, adminController.updateStaffRole);
router.delete('/staff/:staffId', superAdminOnly, adminController.removeStaff);
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUser);
router.get('/pending-agents', adminController.getPendingAgents);
router.put('/users/:id/assign-role', logAction('assign_role', 'user'), adminController.assignRole);
router.put('/users/:id/approve-agent', logAction('approve_agent', 'user'), adminController.approveAgent);
router.put('/users/:id/reject-agent', logAction('reject_agent', 'user'), adminController.rejectAgent);
router.put('/users/:id/lock', logAction('lock_account', 'user'), adminController.lockAccount);
router.put('/users/:id/unlock', logAction('unlock_account', 'user'), adminController.unlockAccount);
router.put('/users/:id/suspend', logAction('suspend', 'user'), adminController.suspendUser);
router.put('/users/:id/activate', logAction('activate', 'user'), adminController.activateUser);
router.put('/users/:id/reset-pin', logAction('update', 'user'), adminController.resetTransactionPin);

router.get('/wallets', adminController.getWallets);
router.get('/wallets/export', adminController.exportWallets);
router.get('/wallets/:userId', adminController.getUserWallet);
router.post('/wallets/:userId/credit', logAction('credit', 'wallet'), adminController.creditWallet);
router.post('/wallets/:userId/debit', logAction('debit', 'wallet'), adminController.debitWallet);
router.put('/wallets/:userId/lock', logAction('suspend', 'wallet'), adminController.lockWallet);
router.put('/wallets/:userId/unlock', logAction('activate', 'wallet'), adminController.unlockWallet);

router.get('/transactions', adminController.getTransactions);
router.get('/transactions/export', adminController.exportTransactions);
router.get('/transactions/:id', adminController.getTransaction);
router.post('/transactions/:id/refund', logAction('refund', 'transaction'), adminController.refundTransaction);
router.post('/transactions/retry-failed', logAction('update', 'transaction'), adminController.retryFailedTransactions);
router.get('/profile', adminController.getMyProfile);
router.put('/profile', adminController.updateMyProfile);
router.post('/change-password', adminController.changeMyPassword);
router.get('/settings/2fa', adminController.getTwoFactorSettings);
router.post('/settings/2fa/setup', adminController.setupTwoFactor);
router.post('/settings/2fa/verify', adminController.verifyTwoFactorSetup);
router.post('/settings/2fa/send-code', adminController.sendDisableTwoFactorCode);
router.post('/settings/2fa/disable', adminController.disableTwoFactor);

router.use(superAdminOnly);
router.get('/pricing', adminController.getPricing);
router.post('/pricing', logAction('create', 'pricing'), adminController.createPricing);
router.post('/pricing/bulk-update', logAction('update', 'pricing'), adminController.bulkUpdatePricing);
router.put('/pricing/:id', logAction('update', 'pricing'), adminController.updatePricing);
router.delete('/pricing/:id', logAction('delete', 'pricing'), adminController.deletePricing);

router.get('/providers', adminController.getProviders);
router.put('/providers/:name/status', logAction('update', 'provider'), adminController.updateProviderStatus);
router.post('/providers/check-balance-alerts', logAction('update', 'provider'), adminController.checkApiBalanceAlerts);

router.get('/logs', adminController.getAdminLogs);

router.get('/check-provider/:providerId', vtuConsoleController.getProvider);

router.post('/broadcast', adminAuth, adminController.broadcastNotification);
router.get('/settings', adminAuth, adminController.getSystemSettings);
router.put('/settings', adminAuth, adminController.updateSystemSettings);

router.post('/export', adminAuth, adminController.exportData);

module.exports = router;
