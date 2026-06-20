const Notification = require('../models/Notification');
const User = require('../models/User');
const ExpoPushService = require('./expoPushService');
const logger = require('../utils/logger');

class NotificationService {

  static async create(data) {
    try {
      const { skipPush = false, ...payload } = data || {};
      const notification = await Notification.create(payload);

      if (!skipPush && notification?.user) {
        try {
          const user = await User.findById(notification.user).select('expoPushTokens');
          await ExpoPushService.sendToTokens(user?.expoPushTokens || [], notification);
        } catch (pushError) {
          logger.warn('Expo push notification failed:', {
            message: pushError.message,
            notificationId: notification?._id?.toString?.(),
          });
        }
      }

      return notification;
    } catch (error) {
      logger.error('Notification creation failed:', error);
      return null;
    }
  }

  static async walletCredit(userId, amount, reference) {
    return this.create({
      user: userId,
      title: 'Wallet Funded',
      message: `Your wallet has been credited with ₦${amount}`,
      type: 'wallet_credit',
      reference,
    });
  }

  static async walletDebit(userId, amount, reference) {
    return this.create({
      user: userId,
      title: 'Wallet Debited',
      message: `₦${amount} was deducted from your wallet`,
      type: 'wallet_debit',
      reference,
    });
  }

  static async airtimePurchase(userId, network, amount, phone) {
    return this.create({
      user: userId,
      title: 'Airtime Purchase',
      message: `${network} airtime ₦${amount} sent to ${phone}`,
      type: 'airtime',
    });
  }

  static async dataPurchase(userId, network, size, phone) {
    return this.create({
      user: userId,
      title: 'Data Purchase',
      message: `${network} ${size} purchased for ${phone}`,
      type: 'data',
    });
  }

  static async login(userId) {
    const latestBroadcast = await Notification
      .findOne({ user: userId, isBroadcast: true })
      .sort({ createdAt: -1 })
      .select('title message');

    return this.create({
      user: userId,
      title: latestBroadcast?.title || 'New Login',
      message: latestBroadcast?.message || 'Your account was just accessed',
      type: 'login',
    });
  }
}

module.exports = NotificationService;
