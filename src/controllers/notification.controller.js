const Notification = require("../models/Notification");
const User = require("../models/User");

exports.getNotifications = async (req, res, next) => {
    try {
  
      const notifications = await Notification
        .find({ user: req.user.id })
        .sort({ createdAt: -1 })
        .limit(50);
  
      res.status(200).json({
        status: 'success',
        results: notifications.length,
        data: notifications,
      });
  
    } catch (error) {
      next(error);
    }
};

exports.getUnreadCount = async (req, res, next) => {
    try {
      const count = await Notification.countDocuments({
        user: req.user.id,
        isRead: false
      });

      res.status(200).json({
        status: 'success',
        data: { unreadCount: count },
      });

    } catch (error) {
      next(error);
    }
};

exports.markAsRead = async (req, res, next) => {
    try {
  
      const notification = await Notification.findByIdAndUpdate(
        req.params.id,
        { isRead: true },
        { new: true }
      );
  
      res.status(200).json({
        status: 'success',
        data: notification,
      });
  
    } catch (error) {
      next(error);
    }
};

exports.markAllAsRead = async (req, res, next) => {
    try {
      await Notification.updateMany(
        { user: req.user.id, isRead: false },
        { isRead: true }
      );

      res.status(200).json({
        status: 'success',
        message: 'All notifications marked as read',
      });

    } catch (error) {
      next(error);
    }
};

exports.deleteNotification = async (req, res, next) => {
    try {
      const notification = await Notification.findOneAndDelete({
        _id: req.params.id,
        user: req.user.id
      });

      if (!notification) {
        return res.status(404).json({
          status: 'error',
          message: 'Notification not found',
        });
      }

      res.status(200).json({
        status: 'success',
        message: 'Notification deleted',
      });

    } catch (error) {
      next(error);
    }
};

exports.deleteAllNotifications = async (req, res, next) => {
    try {
      await Notification.deleteMany({ user: req.user.id });

      res.status(200).json({
        status: 'success',
        message: 'All notifications deleted',
      });

    } catch (error) {
      next(error);
    }
};