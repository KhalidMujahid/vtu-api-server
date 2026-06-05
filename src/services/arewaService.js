const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

class ArewaService {
  static config = {
    baseUrl: process.env.AREWA_BASE_URL || 'https://arewaglobal.co',
    apiKey: process.env.AREWA_API_KEY || '',
    timeout: 45000,
  };

  static async request(path, payload = {}) {
    if (!this.config.apiKey) {
      throw new AppError('Arewa API key is not configured', 500);
    }

    try {
      const url = `${this.config.baseUrl}${path}`;
      const response = await axios.post(url, payload, {
        timeout: this.config.timeout,
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Arewa API error', {
        path,
        message: error.message,
        response: error.response?.data,
      });
      throw new AppError(
        `Arewa API error: ${error.response?.data?.msg || error.message}`,
        error.response?.status || 500
      );
    }
  }

  static async getUserDetails() {
    return this.request('/api/user/', {});
  }

  static extractBalance(payload) {
    const candidates = [
      payload?.balance,
      payload?.available_balance,
      payload?.availableBalance,
      payload?.wallet_balance,
      payload?.walletBalance,
      payload?.user_balance,
      payload?.userBalance,
      payload?.credit_balance,
      payload?.creditBalance,
      payload?.data?.balance,
      payload?.data?.available_balance,
      payload?.data?.availableBalance,
      payload?.data?.wallet_balance,
      payload?.data?.walletBalance,
      payload?.data?.user_balance,
      payload?.data?.userBalance,
      payload?.data?.credit_balance,
      payload?.data?.creditBalance,
    ];

    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === '') {
        continue;
      }

      const numericValue = Number(candidate);
      if (Number.isFinite(numericValue)) {
        return numericValue;
      }
    }

    return null;
  }

  static async getBalance() {
    const details = await this.getUserDetails();
    const balance = this.extractBalance(details);

    return {
      available: balance !== null,
      balance,
      currency: details?.currency || details?.data?.currency || 'NGN',
      raw: details,
      lastUpdated: new Date(),
    };
  }

  static async purchaseAlpha({ phone, planid }) {
    return this.request('/api/alpha/', { phone, planid: String(planid) });
  }

  static async purchaseKirani({ phone, planid }) {
    return this.request('/api/kirani/', { phone, planid: String(planid) });
  }
}

module.exports = ArewaService;
