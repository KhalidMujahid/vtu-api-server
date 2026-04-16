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

  static async purchaseAlpha({ phone, planid }) {
    return this.request('/api/alpha/', { phone, planid: String(planid) });
  }

  static async purchaseKirani({ phone, planid }) {
    return this.request('/api/kirani/', { phone, planid: String(planid) });
  }
}

module.exports = ArewaService;
