const Settings = require('../models/Settings');
const VtuProviderService = require('./vtuProviderService');
const logger = require('../utils/logger');
const { sendApiBalanceAlertEmail, sendWhatsAppAlert } = require('../utils/emailService');

class ApiBalanceAlertService {
  static async getAlertSettings() {
    const settingsDocs = await Settings.find({
      key: {
        $in: [
          'notification.apiBalanceThreshold',
          'notification.apiBalanceAlertsEnabled',
          'notification.apiBalanceAlertEmails',
          'notification.apiBalanceAlertWhatsApp',
          'notification.apiBalanceAlertCooldownMinutes',
        ],
      },
    }).lean();

    const values = {};
    settingsDocs.forEach(doc => {
      values[doc.key] = doc.value;
    });

    return {
      threshold: Number(values['notification.apiBalanceThreshold'] ?? 1000),
      enabled: Boolean(values['notification.apiBalanceAlertsEnabled'] ?? true),
      emails: Array.isArray(values['notification.apiBalanceAlertEmails'])
        ? values['notification.apiBalanceAlertEmails']
        : [],
      whatsapp: Array.isArray(values['notification.apiBalanceAlertWhatsApp'])
        ? values['notification.apiBalanceAlertWhatsApp']
        : [],
      cooldownMinutes: Number(values['notification.apiBalanceAlertCooldownMinutes'] ?? 30),
    };
  }

  static async shouldSendAlert(providerId, cooldownMinutes) {
    const key = `notification.lastApiBalanceAlert.${providerId}`;
    const last = await Settings.findOne({ key }).lean();
    if (!last?.value) return true;

    const lastSent = new Date(last.value);
    if (Number.isNaN(lastSent.getTime())) return true;

    return (Date.now() - lastSent.getTime()) >= cooldownMinutes * 60 * 1000;
  }

  static async markAlertSent(providerId) {
    const key = `notification.lastApiBalanceAlert.${providerId}`;
    await Settings.findOneAndUpdate(
      { key },
      {
        key,
        category: 'notification',
        value: new Date().toISOString(),
      },
      { upsert: true, new: true }
    );
  }

  static async checkAndSendAlerts(triggeredBy = null) {
    const settings = await this.getAlertSettings();
    if (!settings.enabled) {
      return { checked: 0, alertsSent: 0, lowBalances: [] };
    }

    const balances = await VtuProviderService.getAllProviderBalances();
    const lowBalances = balances.filter(item => item.available && Number(item.balance || 0) < settings.threshold);

    let alertsSent = 0;
    for (const provider of lowBalances) {
      const providerId = provider.providerId || provider.providerName;
      const allowed = await this.shouldSendAlert(providerId, settings.cooldownMinutes);
      if (!allowed) continue;

      const message = `Low API balance: ${provider.providerName} is ${provider.balance} ${provider.currency || 'NGN'} (threshold ${settings.threshold}).`;

      await Promise.all([
        ...settings.emails.map(email =>
          sendApiBalanceAlertEmail({
            email,
            providerName: provider.providerName,
            balance: provider.balance,
            threshold: settings.threshold,
            currency: provider.currency || 'NGN',
          })
        ),
        ...settings.whatsapp.map(phone =>
          sendWhatsAppAlert({
            phone,
            message,
            metadata: { providerId, triggeredBy },
          })
        ),
      ]);

      alertsSent += 1;
      await this.markAlertSent(providerId);
    }

    logger.info(`API balance alert check completed: ${lowBalances.length} low, ${alertsSent} sent`);

    return {
      checked: balances.length,
      alertsSent,
      threshold: settings.threshold,
      lowBalances,
    };
  }
}

module.exports = ApiBalanceAlertService;
