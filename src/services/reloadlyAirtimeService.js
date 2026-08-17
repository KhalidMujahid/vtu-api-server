const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

class ReloadlyAirtimeService {
  static tokenCache = {
    accessToken: null,
    expiresAt: 0,
  };

  static get config() {
    const sandbox = String(process.env.RELOADLY_AIRTIME_SANDBOX || 'true').toLowerCase() === 'true';
    return {
      authBaseUrl: 'https://auth.reloadly.com',
      apiBaseUrl: sandbox
        ? 'https://topups-sandbox.reloadly.com'
        : 'https://topups.reloadly.com',
      audience: sandbox
        ? 'https://topups-sandbox.reloadly.com'
        : 'https://topups.reloadly.com',
      clientId: process.env.RELOADLY_CLIENT_ID || '',
      clientSecret: process.env.RELOADLY_CLIENT_SECRET || '',
      timeout: Number(process.env.RELOADLY_TIMEOUT_MS || 45000),
    };
  }

  static async getAccessToken() {
    const cfg = this.config;
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new AppError('Reloadly credentials are not configured', 500);
    }

    const now = Date.now();
    if (this.tokenCache.accessToken && this.tokenCache.expiresAt - 60000 > now) {
      return this.tokenCache.accessToken;
    }

    try {
      const formBody = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'client_credentials',
        audience: cfg.audience,
      });

      const response = await axios.post(
        `${cfg.authBaseUrl}/oauth/token`,
        formBody,
        { timeout: cfg.timeout, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const token = response.data?.access_token;
      const expiresIn = Number(response.data?.expires_in || 0);
      if (!token) throw new AppError('Reloadly airtime token missing access_token', 502);

      this.tokenCache.accessToken = token;
      this.tokenCache.expiresAt = now + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3600 * 1000);
      return token;
    } catch (error) {
      logger.error('Reloadly airtime token error', { message: error.message, response: error.response?.data });
      throw new AppError(
        `Reloadly auth failed: ${error.response?.data?.message || error.message}`,
        error.response?.status || 500
      );
    }
  }

  static async request(method, path, data = null, params = null) {
    const cfg = this.config;
    const token = await this.getAccessToken();
    try {
      const response = await axios({
        method,
        url: `${cfg.apiBaseUrl}${path}`,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/com.reloadly.topups-v1+json',
        },
        data: data || undefined,
        params,
        timeout: cfg.timeout,
      });
      return response.data;
    } catch (error) {
      const errMsg = error.response?.data?.message || error.response?.data?.error_description || error.message;
      logger.error('Reloadly airtime API error', { path, message: errMsg, response: error.response?.data });
      throw new AppError(`Reloadly airtime error: ${errMsg}`, error.response?.status || 500);
    }
  }

  static async getCountries() {
    return this.request('GET', '/countries');
  }

  static async getOperators(countryCode, { page = 1, size = 100, includeBundles = true } = {}) {
    return this.request('GET', `/operators/countries/${countryCode.toUpperCase()}`, null, {
      page,
      size,
      AddBundles: parseBoolean(includeBundles, true),
    });
  }

  static async getOperator(operatorId) {
    return this.request('GET', `/operators/${operatorId}`);
  }

  static async sendTopup({ operatorId, amount, useLocalAmount = false, recipientCountryCode, recipientNumber, customIdentifier, senderCountryCode, senderNumber }) {
    const body = {
      operatorId: Number(operatorId),
      amount: Number(amount),
      useLocalAmount: parseBoolean(useLocalAmount, false),
      recipientPhone: {
        countryCode: String(recipientCountryCode).toUpperCase(),
        number: String(recipientNumber),
      },
      customIdentifier: customIdentifier || `INTL-${Date.now()}`,
    };
    if (senderCountryCode && senderNumber) {
      body.senderPhone = {
        countryCode: String(senderCountryCode).toUpperCase(),
        number: String(senderNumber),
      };
    }
    return this.request('POST', '/topups', body);
  }

  static async getTransactions({ page = 0, size = 20, startDate, endDate } = {}) {
    const params = { page, size };
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    return this.request('GET', '/reports/transactions', null, params);
  }

  static async getTransactionByReference(customIdentifier) {
    const result = await this.request('GET', '/reports/transactions', null, { customIdentifier, size: 1 });
    const items = result?.content || (Array.isArray(result) ? result : []);
    return items[0] || null;
  }

  static async getBalance() {
    return this.request('GET', '/accounts/balance');
  }
}

module.exports = ReloadlyAirtimeService;
