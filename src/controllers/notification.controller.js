const Notification = require("../models/Notification");

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