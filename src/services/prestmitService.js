const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

// Prestmit — Nigeria-native gift card API (primary provider)
// Docs: https://documentation.prestmit.io  |  Sandbox: https://sandbox.prestmit.io
// Apply for credentials: partners@prestmit.io
// Base URL pattern confirmed: https://dev-api.prestmit.io/partners/v1 (sandbox)
//                             https://api.prestmit.io/partners/v1  (production)
// NOTE: Verify exact request/response field names once credentials are obtained.
class PrestmitService {
  static config = {
    baseUrl: process.env.PRESTMIT_BASE_URL || 'https://dev-api.prestmit.io/partners/v1',
    apiKey: process.env.PRESTMIT_API_KEY || '',
    timeout: 45000,
  };

  static async request(method, path, data = null, params = null) {
    if (!this.config.apiKey) {
      throw new AppError('Prestmit API key is not configured', 500);
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
      logger.error('Prestmit API error', { path, message: errMsg, response: error.response?.data });
      throw new AppError(`Prestmit error: ${errMsg}`, error.response?.status || 500);
    }
  }

  // Get platform wallet balance
  static async getBalance() {
    return this.request('GET', '/wallet/fiat/details');
  }

  // List gift card categories
  static async getCategories() {
    return this.request('GET', '/giftcards/categories');
  }

  // List gift card products with optional filters
  static async getProducts({ page = 1, limit = 50, category, country } = {}) {
    const params = { page, limit };
    if (category) params.category = category;
    if (country) params.country = country;
    return this.request('GET', '/giftcards/products', null, params);
  }

  // Get single product details
  static async getProduct(productId) {
    return this.request('GET', `/giftcards/products/${productId}`);
  }

  // Buy a gift card
  // value: amount in USD (or product currency)
  // quantity: number of cards
  static async buyGiftCard({ productId, value, quantity = 1, recipientEmail }) {
    const payload = { productId, value: Number(value), quantity: Number(quantity) };
    if (recipientEmail) payload.recipientEmail = recipientEmail;
    return this.request('POST', '/giftcards/buy', payload);
  }

  // Get a single order
  static async getOrder(orderId) {
    return this.request('GET', `/giftcards/orders/${orderId}`);
  }

  // List orders with optional status filter
  static async listOrders({ page = 1, limit = 20, status } = {}) {
    const params = { page, limit };
    if (status) params.status = status;
    return this.request('GET', '/giftcards/orders', null, params);
  }
}

module.exports = PrestmitService;
