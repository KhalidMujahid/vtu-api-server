const axios = require('axios');
const User = require('../models/User');
const logger = require('../utils/logger');

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

class ExpoPushService {
  static isEnabled() {
    return String(process.env.EXPO_PUSH_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  static normalizeTokens(tokens = []) {
    return [...new Set(
      tokens
        .flat()
        .map((token) => (typeof token === 'string' ? token.trim() : ''))
        .filter(Boolean)
    )];
  }

  static async getTokensForUsers(userIds = []) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return [];
    }

    const users = await User.find({ _id: { $in: userIds } }).select('expoPushTokens');
    return this.normalizeTokens(users.flatMap((user) => user.expoPushTokens || []));
  }

  static buildMessage(token, notification = {}) {
    const metadata = notification.metadata && typeof notification.metadata === 'object'
      ? notification.metadata
      : {};

    return {
      to: token,
      sound: 'default',
      title: notification.title || 'Notification',
      body: notification.message || notification.body || '',
      priority: 'high',
      channelId: 'default',
      data: {
        notificationId: notification._id?.toString?.() || notification.id || null,
        type: notification.type || 'system',
        reference: notification.reference || null,
        userId: notification.user?.toString?.() || notification.userId || null,
        metadata,
      },
    };
  }

  static async sendMessages(messages = []) {
    const validMessages = Array.isArray(messages) ? messages.filter(Boolean) : [];
    if (!validMessages.length || !this.isEnabled()) {
      return {
        sent: 0,
        skipped: true,
      };
    }

    const responses = [];
    for (let index = 0; index < validMessages.length; index += EXPO_BATCH_SIZE) {
      const batch = validMessages.slice(index, index + EXPO_BATCH_SIZE);
      const response = await axios.post(EXPO_PUSH_ENDPOINT, batch, {
        timeout: Number(process.env.EXPO_PUSH_TIMEOUT_MS || 15000),
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
      });
      responses.push(response.data);
    }

    return {
      sent: validMessages.length,
      responses,
    };
  }

  static async sendToTokens(tokens = [], notification = {}) {
    const normalizedTokens = this.normalizeTokens(tokens);
    if (!normalizedTokens.length) {
      return {
        sent: 0,
        skipped: true,
      };
    }

    const messages = normalizedTokens.map((token) => this.buildMessage(token, notification));
    try {
      return await this.sendMessages(messages);
    } catch (error) {
      logger.warn('Expo push delivery failed', {
        message: error.message,
      });
      return {
        sent: 0,
        error: error.message,
      };
    }
  }

  static async sendToUsers(userIds = [], notification = {}) {
    const tokens = await this.getTokensForUsers(userIds);
    return this.sendToTokens(tokens, notification);
  }
}

module.exports = ExpoPushService;
