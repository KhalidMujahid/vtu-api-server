const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

class ZenditService {
  static config = {
    baseUrl: process.env.ZENDIT_BASE_URL || 'https://test-api.zendit.io/v1',
    apiKey: process.env.ZENDIT_API_KEY || '',
    timeout: 45000,
  };

  static async request(method, path, data = null, params = null) {
    if (!this.config.apiKey) {
      throw new AppError('Zendit API key is not configured', 500);
    }
    try {
      const response = await axios({
        method,
        url: `${this.config.baseUrl}${path}`,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        data: data || undefined,
        params,
        timeout: this.config.timeout,
      });
      return response.data;
    } catch (error) {
      const errMsg =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message;
      logger.error('Zendit API error', { path, message: errMsg, response: error.response?.data });
      throw new AppError(`Zendit error: ${errMsg}`, error.response?.status || 500);
    }
  }

  static async listVouchers({ limit = 50, offset = 0, brand, country } = {}) {
    const params = { _limit: limit, _offset: offset };
    if (brand) params.brand = brand;
    if (country) params.country = country;
    return this.request('GET', '/vouchers', null, params);
  }

  static async getVoucher(offerId) {
    return this.request('GET', `/vouchers/${offerId}`);
  }

 
  static async purchaseVoucher({ offerId, value, quantity = 1, fields = [] }) {
    const payload = { offerId, quantity: Number(quantity), fields };
    if (value !== undefined) payload.value = Number(value);
    return this.request('POST', '/vouchers/purchases', payload);
  }

  static async getPurchase(transactionId) {
    return this.request('GET', `/vouchers/purchases/${transactionId}`);
  }

  static async listPurchases({ limit = 20, offset = 0, status } = {}) {
    const params = { _limit: limit, _offset: offset };
    if (status) params.status = status;
    return this.request('GET', '/vouchers/purchases', null, params);
  }

  static async getBrands({ limit = 50, offset = 0 } = {}) {
    return this.request('GET', '/brands', null, { _limit: limit, _offset: offset });
  }
}

module.exports = ZenditService;
