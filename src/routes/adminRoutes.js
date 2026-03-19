const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const vtuConsoleController = require('../controllers/vtuConsoleController');
const { adminAuth, logAction, superAdminOnly, staffOnly } = require('../middlewares/admin');

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

router.get('/check-provider/:providerId', vtuConsoleController.getProvider);

router.post('/broadcast', adminAuth, adminController.broadcastNotification);
router.get('/settings', adminController.getSystemSettings);
router.put('/settings', adminAuth, adminController.updateSystemSettings);
router.post('/export', adminAuth, adminController.exportData);

module.exports = router;