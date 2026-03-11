const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { protect } = require('../middlewares/auth');

router.use(protect);

router.get('/', notificationController.getNotifications);

router.get('/unread-count', notificationController.getUnreadCount);

router.put('/:id/read', notificationController.markAsRead);

router.put('/mark-all-read', notificationController.markAllAsRead);

router.delete('/:id', notificationController.deleteNotification);

router.delete('/', notificationController.deleteAllNotifications);

module.exports = router;
