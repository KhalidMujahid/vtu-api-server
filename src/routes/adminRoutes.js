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

/**
 * @swagger
 * /api/v1/admin/dashboard:
 *   get:
 *     summary: Get admin dashboard stats
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics
 */
router.get('/dashboard', adminController.getDashboardStats);

/**
 * @swagger
 * /api/v1/admin/staff:
 *   get:
 *     summary: Get all staff members
 *     tags: [Admin - Staff]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [superadmin, admin, support]
 *     responses:
 *       200:
 *         description: Staff list with role counts
 *   post:
 *     summary: Add a new staff member
 *     tags: [Admin - Staff]
 *     security:
 *       - bearerAuth: []
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
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [superadmin, admin, support]
 *                 default: support
 *     responses:
 *       201:
 *         description: Staff member created
 */
router.get('/staff', superAdminOnly, adminController.getStaff);
router.post('/staff', superAdminOnly, adminController.addStaff);

/**
 * @swagger
 * /api/v1/admin/staff/{staffId}/role:
 *   put:
 *     summary: Update staff member role
 *     tags: [Admin - Staff]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: staffId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [superadmin, admin, support]
 *     responses:
 *       200:
 *         description: Staff role updated
 */
router.put('/staff/:staffId/role', superAdminOnly, adminController.updateStaffRole);

/**
 * @swagger
 * /api/v1/admin/staff/{staffId}:
 *   delete:
 *     summary: Remove a staff member
 *     tags: [Admin - Staff]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: staffId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Staff member removed
 */
router.delete('/staff/:staffId', superAdminOnly, adminController.removeStaff);

/**
 * @swagger
 * /api/v1/admin/users:
 *   get:
 *     summary: Get all users
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Users list
 */
router.get('/users', adminController.getUsers);

/**
 * @swagger
 * /api/v1/admin/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User details
 */
router.get('/users/:id', adminController.getUser);

/**
 * @swagger
 * /api/v1/admin/pending-agents:
 *   get:
 *     summary: Get pending agent approvals
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending agents list
 */
router.get('/pending-agents', adminController.getPendingAgents);

/**
 * @swagger
 * /api/v1/admin/users/{id}/assign-role:
 *   put:
 *     summary: Assign role to user
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               roles:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Role assigned
 */
router.put('/users/:id/assign-role', logAction('assign_role', 'user'), adminController.assignRole);

/**
 * @swagger
 * /api/v1/admin/users/{id}/approve-agent:
 *   put:
 *     summary: Approve agent
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Agent approved
 */
router.put('/users/:id/approve-agent', logAction('approve_agent', 'user'), adminController.approveAgent);

/**
 * @swagger
 * /api/v1/admin/users/{id}/reject-agent:
 *   put:
 *     summary: Reject agent
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Agent rejected
 */
router.put('/users/:id/reject-agent', logAction('reject_agent', 'user'), adminController.rejectAgent);

/**
 * @swagger
 * /api/v1/admin/users/{id}/lock:
 *   put:
 *     summary: Lock user account
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account locked
 */
router.put('/users/:id/lock', logAction('lock_account', 'user'), adminController.lockAccount);

/**
 * @swagger
 * /api/v1/admin/users/{id}/unlock:
 *   put:
 *     summary: Unlock user account
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account unlocked
 */
router.put('/users/:id/unlock', logAction('unlock_account', 'user'), adminController.unlockAccount);

/**
 * @swagger
 * /api/v1/admin/users/{id}/suspend:
 *   put:
 *     summary: Suspend user
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User suspended
 */
router.put('/users/:id/suspend', logAction('suspend', 'user'), adminController.suspendUser);

/**
 * @swagger
 * /api/v1/admin/users/{id}/activate:
 *   put:
 *     summary: Activate user
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User activated
 */
router.put('/users/:id/activate', logAction('activate', 'user'), adminController.activateUser);

/**
 * @swagger
 * /api/v1/admin/users/{id}/reset-pin:
 *   put:
 *     summary: Reset user transaction PIN
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: PIN reset
 */
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

/**
 * @swagger
 * /api/v1/admin/settings:
 *   get:
 *     summary: Get system settings
 *     tags: [Admin - Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     settings:
 *                       type: object
 *                       properties:
 *                         general:
 *                           type: object
 *                         fees:
 *                           type: object
 *                         limits:
 *                           type: object
 *                         security:
 *                           type: object
 *                         kyc:
 *                           type: object
 */
router.get('/settings', adminAuth, adminController.getSystemSettings);

/**
 * @swagger
 * /api/v1/admin/settings:
 *   put:
 *     summary: Update system settings
 *     tags: [Admin - Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - settings
 *             properties:
 *               settings:
 *                 type: object
 *                 properties:
 *                   general:
 *                     type: object
 *                     properties:
 *                       platformName:
 *                         type: string
 *                       currency:
 *                         type: string
 *                       timezone:
 *                         type: string
 *                       maintenanceMode:
 *                         type: boolean
 *                   fees:
 *                     type: object
 *                     properties:
 *                       walletTransferFee:
 *                         type: number
 *                       walletTransferMinFee:
 *                         type: number
 *                       withdrawalFee:
 *                         type: number
 *                       withdrawalMinFee:
 *                         type: number
 *                   limits:
 *                     type: object
 *                     properties:
 *                       maxWalletBalance:
 *                         type: number
 *                       minTransactionAmount:
 *                         type: number
 *                       maxTransactionAmount:
 *                         type: number
 *                       dailyTransactionLimit:
 *                         type: number
 *                   security:
 *                     type: object
 *                     properties:
 *                       loginAttempts:
 *                         type: number
 *                       lockDuration:
 *                         type: number
 *                       sessionTimeout:
 *                         type: number
 *                       requireTransactionPin:
 *                         type: boolean
 *                   kyc:
 *                     type: object
 *                     properties:
 *                       basicLimit:
 *                         type: number
 *                       advancedLimit:
 *                         type: number
 *                       verifiedLimit:
 *                         type: number
 *     responses:
 *       200:
 *         description: System settings updated successfully
 */
router.put('/settings', adminAuth, adminController.updateSystemSettings);

router.post('/export', adminAuth, adminController.exportData);

module.exports = router;
