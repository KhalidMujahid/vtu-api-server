const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

// Zendit — Global gift card reseller API (backup provider, 16k+ products)
// Docs: https://developers.zendit.io  |  Sandbox: https://test-api.zendit.io/v1
// Sandbox tokens start with: sand_
// Production base URL: https://api.zendit.io/v1
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

  // List available voucher/gift card products
  static async listVouchers({ limit = 50, offset = 0, brand, country } = {}) {
    const params = { _limit: limit, _offset: offset };
    if (brand) params.brand = brand;
    if (country) params.country = country;
    return this.request('GET', '/vouchers', null, params);
  }

  // Get a single voucher/product details
  static async getVoucher(offerId) {
    return this.request('GET', `/vouchers/${offerId}`);
  }

  // Purchase a voucher (gift card)
  // offerId: product ID from listVouchers
  // value: required for RANGE-type offers; omit for FIXED
  // fields: array of { key, value } for recipient info (e.g. email)
  static async purchaseVoucher({ offerId, value, quantity = 1, fields = [] }) {
    const payload = { offerId, quantity: Number(quantity), fields };
    if (value !== undefined) payload.value = Number(value);
    return this.request('POST', '/vouchers/purchases', payload);
  }

  // Get single purchase / transaction
  static async getPurchase(transactionId) {
    return this.request('GET', `/vouchers/purchases/${transactionId}`);
  }

  // List purchases with optional status filter
  static async listPurchases({ limit = 20, offset = 0, status } = {}) {
    const params = { _limit: limit, _offset: offset };
    if (status) params.status = status;
    return this.request('GET', '/vouchers/purchases', null, params);
  }

  // List brands
  static async getBrands({ limit = 50, offset = 0 } = {}) {
    return this.request('GET', '/brands', null, { _limit: limit, _offset: offset });
  }
}

module.exports = ZenditService;
