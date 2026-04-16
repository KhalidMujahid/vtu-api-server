const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

class ReloadlyGiftCardService {
  static tokenCache = {
    accessToken: null,
    expiresAt: 0,
  };

  static config = {
    authBaseUrl: process.env.RELOADLY_AUTH_BASE_URL || 'https://auth.reloadly.com',
    apiBaseUrl:
      process.env.RELOADLY_GIFTCARD_BASE_URL ||
      (String(process.env.RELOADLY_GIFTCARD_SANDBOX || '').toLowerCase() === 'true'
        ? 'https://giftcards-sandbox.reloadly.com'
        : 'https://giftcards.reloadly.com'),
    audience:
      process.env.RELOADLY_GIFTCARD_AUDIENCE ||
      (String(process.env.RELOADLY_GIFTCARD_SANDBOX || '').toLowerCase() === 'true'
        ? 'https://giftcards-sandbox.reloadly.com'
        : 'https://giftcards.reloadly.com'),
    clientId: process.env.RELOADLY_CLIENT_ID || '',
    clientSecret: process.env.RELOADLY_CLIENT_SECRET || '',
    timeout: Number(process.env.RELOADLY_TIMEOUT_MS || 45000),
  };

  static assertConfig() {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new AppError('Reloadly credentials are not configured', 500);
    }
  }

  static async getAccessToken() {
    this.assertConfig();
    const now = Date.now();
    if (
      this.tokenCache.accessToken &&
      this.tokenCache.expiresAt &&
      this.tokenCache.expiresAt - 60000 > now
    ) {
      return this.tokenCache.accessToken;
    }

    try {
      const response = await axios.post(
        `${this.config.authBaseUrl}/oauth/token`,
        {
          audience: this.config.audience,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: 'client_credentials',
        },
        {
          timeout: this.config.timeout,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const accessToken = response.data?.access_token;
      const expiresIn = Number(response.data?.expires_in || 0);
      if (!accessToken) {
        throw new AppError('Reloadly token response missing access_token', 502);
      }

      this.tokenCache.accessToken = accessToken;
      this.tokenCache.expiresAt = now + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3600 * 1000);
      return accessToken;
    } catch (error) {
      logger.error('Reloadly token error', {
        message: error.message,
        response: error.response?.data,
      });
      throw new AppError(
        `Reloadly auth failed: ${error.response?.data?.message || error.message}`,
        error.response?.status || 500
      );
    }
  }

  static async request(method, path, { params = {}, data = null, headers = {} } = {}) {
    const token = await this.getAccessToken();
    try {
      const response = await axios({
        method,
        url: `${this.config.apiBaseUrl}${path}`,
        params,
        data,
        timeout: this.config.timeout,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...headers,
        },
      });
      return response.data;
    } catch (error) {
      logger.error('Reloadly API error', {
        method,
        path,
        message: error.message,
        response: error.response?.data,
      });
      throw new AppError(
        `Reloadly API failed: ${error.response?.data?.message || error.message}`,
        error.response?.status || 500
      );
    }
  }

  static getBalance() {
    return this.request('GET', '/accounts/balance');
  }

  static getCategories() {
    return this.request('GET', '/product-categories');
  }

  static getCountries() {
    return this.request('GET', '/countries');
  }

  static getCountryByCode(countryCode) {
    return this.request('GET', `/countries/${String(countryCode || '').toUpperCase()}`);
  }

  static getProducts(params = {}) {
    return this.request('GET', '/products', { params });
  }

  static getProductById(productId) {
    return this.request('GET', `/products/${productId}`);
  }

  static getProductsByCountry(countryCode) {
    return this.request('GET', `/countries/${String(countryCode || '').toUpperCase()}/products`);
  }

  static getRedeemInstructions() {
    return this.request('GET', '/redeem-instructions');
  }

  static getProductRedeemInstructions(productId) {
    return this.request('GET', `/products/${productId}/redeem-instructions`);
  }

  static getFxRate({ currencyCode, amount }) {
    return this.request('GET', '/fx-rate', { params: { currencyCode, amount } });
  }

  static getDiscounts(params = {}) {
    return this.request('GET', '/discounts', { params });
  }

  static getProductDiscount(productId) {
    return this.request('GET', `/products/${productId}/discounts`);
  }

  static getTransactions(params = {}) {
    return this.request('GET', '/reports/transactions', { params });
  }

  static getTransactionById(transactionId) {
    return this.request('GET', `/reports/transactions/${transactionId}`);
  }

  static orderGiftCard(payload = {}) {
    return this.request('POST', '/orders', { data: payload });
  }

  static getRedeemCode(transactionId, version = 'v2') {
    const value = String(version || 'v2').toLowerCase() === 'v1'
      ? 'application/com.reloadly.giftcards-v1+json'
      : 'application/com.reloadly.giftcards-v2+json';
    return this.request('GET', `/orders/transactions/${transactionId}/cards`, {
      headers: { Accept: value },
    });
  }

  static extractSenderAmountFromProduct(product = {}, unitPrice = 0) {
    const unit = Number(unitPrice);
    if (!Number.isFinite(unit) || unit <= 0) return null;

    const mappings = Array.isArray(product.fixedRecipientToSenderDenominationsMap)
      ? product.fixedRecipientToSenderDenominationsMap
      : [];

    for (const mapItem of mappings) {
      if (!mapItem || typeof mapItem !== 'object') continue;
      for (const [recipient, sender] of Object.entries(mapItem)) {
        const recipientValue = Number(recipient);
        if (Number.isFinite(recipientValue) && Math.abs(recipientValue - unit) < 0.00001) {
          const senderValue = Number(sender);
          if (Number.isFinite(senderValue)) return senderValue;
        }
      }
    }

    const fixedRecipient = Array.isArray(product.fixedRecipientDenominations)
      ? product.fixedRecipientDenominations
      : [];
    const fixedSender = Array.isArray(product.fixedSenderDenominations)
      ? product.fixedSenderDenominations
      : [];

    if (fixedRecipient.length && fixedSender.length) {
      const index = fixedRecipient.findIndex((value) => Math.abs(Number(value) - unit) < 0.00001);
      if (index >= 0 && Number.isFinite(Number(fixedSender[index]))) {
        return Number(fixedSender[index]);
      }
    }

    const rate = Number(product.recipientCurrencyToSenderCurrencyExchangeRate);
    if (Number.isFinite(rate) && rate > 0) {
      return unit * rate;
    }

    return null;
  }
}

module.exports = ReloadlyGiftCardService;
