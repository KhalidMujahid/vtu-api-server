const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { protect } = require('../middlewares/auth');
const { adminAuth } = require('../middlewares/admin');

router.use(protect);

router.get('/', notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.put('/:id/read', notificationController.markAsRead);
router.put('/mark-all-read', notificationController.markAllAsRead);
router.delete('/:id', notificationController.deleteNotification);
router.post('/admin/broadcast', adminAuth, notificationController.broadcastNotification);
router.post('/admin/send', adminAuth, notificationController.sendNotificationToUser);
router.delete('/', notificationController.deleteAllNotifications);

module.exports = router;
