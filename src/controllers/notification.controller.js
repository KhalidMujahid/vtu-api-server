const Notification = require("../models/Notification");
const User = require("../models/User");
const NotificationService = require('../services/NotificationService');
const ExpoPushService = require('../services/expoPushService');
const logger = require("../utils/logger");

const normalizeBannerFields = (payload = {}) => {
  const banner =
    payload.bannerImageUrl ||
    payload.bannerImage ||
    payload.imageUrl ||
    payload.image ||
    '';

  return {
    bannerImageUrl: banner,
    bannerImage: banner,
    imageUrl: banner,
    image: banner,
  };
};

const shapeNotificationForClient = (doc) => {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const meta = plain.metadata || {};

  const banner =
    plain.bannerImageUrl ||
    plain.bannerImage ||
    plain.imageUrl ||
    plain.image ||
    meta.bannerImageUrl ||
    meta.bannerImage ||
    meta.imageUrl ||
    meta.image ||
    '';

  return {
    ...plain,
    bannerImageUrl: banner,
    bannerImage: banner,
    imageUrl: banner,
    image: banner,
  };
};

exports.broadcastNotification = async (req, res, next) => {
  try {
    const {
      title,
      message,
      type = 'broadcast',
      targetUsers = 'all',
      userIds = [],
      sendEmail = false,
      sendSMS = false,
    } = req.body;
    const bannerFields = normalizeBannerFields(req.body);
    
    if (!title || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and message are required'
      });
    }
    
    const query = { isActive: true };
    const resolvedUserIds = Array.isArray(userIds)
      ? userIds
      : Array.isArray(targetUsers)
        ? targetUsers
        : [];

    if (targetUsers === 'all' || targetUsers === 'active') {
      query.isActive = true;
    } else if (targetUsers === 'agents' || targetUsers === 'agents_only') {
      query.role = 'agent';
    } else if (
      targetUsers === 'individual' ||
      Array.isArray(targetUsers) ||
      resolvedUserIds.length > 0
    ) {
      query._id = { $in: resolvedUserIds };
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
      metadata: {
        ...bannerFields,
        sendEmail: Boolean(sendEmail),
        sendSMS: Boolean(sendSMS),
      },
      ...bannerFields,
    }));
    
    
    const batchSize = 1000;
    for (let i = 0; i < notifications.length; i += batchSize) {
      const batch = notifications.slice(i, i + batchSize);
      await Notification.insertMany(batch);
    }

    await ExpoPushService.sendToUsers(recipientIds, {
      title,
      message,
      type,
      metadata: {
        ...bannerFields,
        sendEmail: Boolean(sendEmail),
        sendSMS: Boolean(sendSMS),
        isBroadcast: true,
      },
    });
    
    logger.info(`Broadcast notification sent to ${recipientIds.length} users by admin: ${req.admin?._id}`);
    
    res.status(200).json({
      status: 'success',
      message: `Broadcast notification sent to ${recipientIds.length} users`,
      data: {
        recipients: recipientIds.length,
        title,
        message,
        targetUsers,
        sendEmail: Boolean(sendEmail),
        sendSMS: Boolean(sendSMS),
        ...bannerFields,
      }
    });
    
  } catch (error) {
    logger.error('Broadcast notification error:', error);
    next(error);
  }
};


exports.sendNotificationToUser = async (req, res, next) => {
  try {
    const { title, message, type = 'system' } = req.body;
    const userId = req.params.userId || req.body.userId;
    const bannerFields = normalizeBannerFields(req.body);
    
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
    
    const notification = await NotificationService.create({
      user: userId,
      title,
      message,
      type,
      isBroadcast: false,
      metadata: {
        ...bannerFields,
      },
      ...bannerFields,
    });
    
    const actorId = req.admin?._id || req.user?.id || 'system';
    logger.info(`Notification sent to user ${userId} by admin: ${actorId}`);
    
    res.status(200).json({
      status: 'success',
      message: 'Notification sent successfully',
      data: shapeNotificationForClient(notification)
    });
    
  } catch (error) {
    logger.error('Send notification error:', error);
    next(error);
  }
};

exports.registerPushToken = async (req, res, next) => {
  try {
    const expoPushToken = String(req.body.expoPushToken || '').trim();

    if (!expoPushToken) {
      return res.status(400).json({
        status: 'error',
        message: 'expoPushToken is required',
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $addToSet: { expoPushTokens: expoPushToken } },
      { new: true }
    ).select('expoPushTokens');

    if (!updatedUser) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Push token saved successfully',
      data: {
        expoPushTokens: updatedUser.expoPushTokens || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.removePushToken = async (req, res, next) => {
  try {
    const expoPushToken = String(req.body.expoPushToken || '').trim();

    if (!expoPushToken) {
      return res.status(400).json({
        status: 'error',
        message: 'expoPushToken is required',
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { expoPushTokens: expoPushToken } },
      { new: true }
    ).select('expoPushTokens');

    if (!updatedUser) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Push token removed successfully',
      data: {
        expoPushTokens: updatedUser.expoPushTokens || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getSentNotificationHistory = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const {
      type,
      userId,
      isBroadcast,
      startDate,
      endDate,
      search,
    } = req.query;

    const query = {};

    if (type) {
      query.type = String(type).trim().toLowerCase();
    }

    if (userId) {
      query.user = userId;
    }

    if (typeof isBroadcast !== 'undefined') {
      query.isBroadcast = String(isBroadcast).toLowerCase() === 'true';
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (search) {
      const keyword = String(search).trim();
      if (keyword) {
        query.$or = [
          { title: { $regex: keyword, $options: 'i' } },
          { message: { $regex: keyword, $options: 'i' } },
        ];
      }
    }

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'firstName lastName email phoneNumber role'),
      Notification.countDocuments(query),
    ]);

    res.status(200).json({
      status: 'success',
      results: notifications.length,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: notifications.map(shapeNotificationForClient),
    });
  } catch (error) {
    logger.error('Get sent notification history error:', error);
    next(error);
  }
};

exports.getNotifications = async (req, res, next) => {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const skip = (page - 1) * limit;

      const query = { user: req.user.id };
      if (String(req.query.unreadOnly).toLowerCase() === 'true') {
        query.isRead = false;
      }
      if (req.query.type) {
        query.type = String(req.query.type).trim().toLowerCase();
      }

      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Notification.countDocuments(query),
        Notification.countDocuments({ user: req.user.id, isRead: false }),
      ]);
  
      res.status(200).json({
        status: 'success',
        results: notifications.length,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        meta: {
          unreadCount,
        },
        data: notifications.map(shapeNotificationForClient),
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
  
      const notification = await Notification.findOneAndUpdate(
        {
          _id: req.params.id,
          user: req.user.id,
        },
        {
          isRead: true,
          readAt: new Date(),
        },
        { new: true }
      );

      if (!notification) {
        return res.status(404).json({
          status: 'error',
          message: 'Notification not found',
        });
      }

      res.status(200).json({
        status: 'success',
        data: shapeNotificationForClient(notification),
      });

    } catch (error) {
      next(error);
    }
};

exports.markAllAsRead = async (req, res, next) => {
    try {
      await Notification.updateMany(
        { user: req.user.id, isRead: false },
        { isRead: true, readAt: new Date() }
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
