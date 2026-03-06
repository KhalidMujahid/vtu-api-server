const Notification = require('../models/Notification');
const logger = require('../utils/logger');

class NotificationService {

  static async create(data) {
    try {
      const notification = await Notification.create(data);
      return notification;
    } catch (error) {
      logger.error('Notification creation failed:', error);
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
    return this.create({
      user: userId,
      title: 'New Login',
      message: 'Your account was just accessed',
      type: 'login',
    });
  }
}

module.exports = NotificationService;