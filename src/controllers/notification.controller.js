const Notification = require("../models/Notification");
const User = require("../models/User");
const logger = require("../utils/logger");

exports.broadcastNotification = async (req, res, next) => {
  try {
    const { title, message, type = 'broadcast', targetUsers = 'all', userIds = [] } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and message are required'
      });
    }
    
    const query = { isActive: true };
    if (targetUsers === 'agents' || targetUsers === 'agents_only') {
      query.role = 'agent';
    }
    if (targetUsers === 'individual') {
      query._id = { $in: userIds };
    }

    const users = await User.find(query).select('_id');
    const recipientIds = users.map(u => u._id);
    
    if (recipientIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No active users found'
      });
    }
    
    
    const notifications = recipientIds.map(userId => ({
      user: userId,
      title,
      message,
      type,
      isBroadcast: true,
      isRead: false,
    }));
    
    
    const batchSize = 1000;
    for (let i = 0; i < notifications.length; i += batchSize) {
      const batch = notifications.slice(i, i + batchSize);
      await Notification.insertMany(batch);
    }
    
    logger.info(`Broadcast notification sent to ${recipientIds.length} users by admin: ${req.user?.id}`);
    
    res.status(200).json({
      status: 'success',
      message: `Broadcast notification sent to ${recipientIds.length} users`,
      data: {
        recipients: recipientIds.length,
        title,
        message,
        targetUsers,
      }
    });
    
  } catch (error) {
    logger.error('Broadcast notification error:', error);
    next(error);
  }
};


exports.sendNotificationToUser = async (req, res, next) => {
  try {
    const { userId, title, message, type = 'system' } = req.body;
    
    if (!userId || !title || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'userId, title and message are required'
      });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    const notification = await Notification.create({
      user: userId,
      title,
      message,
      type,
      isBroadcast: false,
    });
    
    logger.info(`Notification sent to user ${userId} by admin: ${req.user?.id}`);
    
    res.status(200).json({
      status: 'success',
      message: 'Notification sent successfully',
      data: notification
    });
    
  } catch (error) {
    logger.error('Send notification error:', error);
    next(error);
  }
};

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
