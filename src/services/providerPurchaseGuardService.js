const Settings = require('../models/Settings');
const User = require('../models/User');
const VtuProviderService = require('./vtuProviderService');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const { sendApiBalanceAlertEmail } = require('../utils/emailService');

class ProviderPurchaseGuardService {
  static lastAlertAtByProvider = new Map();
  static CLIENT_UNAVAILABLE_MESSAGE = 'Service is temporarily unavailable. Please try again shortly.';
  static CLIENT_LOW_BALANCE_MESSAGE = 'Service is temporarily unavailable at the moment. Please try again later.';

  static async getAdminAlertEmails() {
    const config = await Settings.findOne({ key: 'notification.apiBalanceAlertEmails' }).lean();
    if (Array.isArray(config?.value) && config.value.length) {
      return [...new Set(config.value.map(String).map(v => v.trim()).filter(Boolean))];
    }

    const admins = await User.find({
      role: { $in: ['superadmin', 'super_admin', 'admin'] },
      isActive: true,
    }).select('email').lean();

    return [...new Set(admins.map(a => a.email).filter(Boolean))];
  }

  static async sendInsufficientBalanceAlert({ providerName, balance, requiredAmount, context = {} }) {
    const providerKey = String(providerName || 'unknown').toLowerCase();
    const lastSentAt = this.lastAlertAtByProvider.get(providerKey);
    const fiveMinutes = 5 * 60 * 1000;
    if (lastSentAt && Date.now() - lastSentAt < fiveMinutes) {
      return;
    }

    const emails = await this.getAdminAlertEmails();
    if (!emails.length) return;

    await Promise.all(
      emails.map(email =>
        sendApiBalanceAlertEmail({
          email,
          providerName: `${providerName} (${context.serviceType || 'service purchase'})`,
          balance,
          threshold: requiredAmount,
          currency: context.currency || 'NGN',
        })
      )
    );

    this.lastAlertAtByProvider.set(providerKey, Date.now());
  }

  static async assertSufficientProviderBalance(providerId, requiredAmount, context = {}) {
    const amount = Number(requiredAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      throw new AppError('Invalid purchase amount for provider balance check', 400);
    }

    let balanceInfo;
    try {
      balanceInfo = await VtuProviderService.getProviderBalance(providerId);
    } catch (error) {
      logger.warn(`Provider balance check failed for ${providerId}: ${error.message}`);
      throw new AppError(this.CLIENT_UNAVAILABLE_MESSAGE, 503);
    }
    if (!balanceInfo?.available || balanceInfo.balance === null || balanceInfo.balance === undefined) {
      logger.warn(`Provider balance unavailable for ${providerId}`);
      throw new AppError(this.CLIENT_UNAVAILABLE_MESSAGE, 503);
    }

    const providerBalance = Number(balanceInfo.balance);
    if (Number.isNaN(providerBalance)) {
      logger.warn(`Invalid provider balance response from ${providerId}`);
      throw new AppError(this.CLIENT_UNAVAILABLE_MESSAGE, 503);
    }

    if (providerBalance < amount) {
      await this.sendInsufficientBalanceAlert({
        providerName: balanceInfo.providerName || providerId,
        balance: providerBalance,
        requiredAmount: amount,
        context,
      });

      throw new AppError(this.CLIENT_LOW_BALANCE_MESSAGE, 400);
    }

    return {
      providerId,
      providerName: balanceInfo.providerName || providerId,
      balance: providerBalance,
      requiredAmount: amount,
      currency: balanceInfo.currency || 'NGN',
    };
  }
}

module.exports = ProviderPurchaseGuardService;
