const axios = require('axios');
const logger = require('../utils/logger');

class BulkSmsNigeriaService {
  static getConfig() {
    return {
      baseUrl: process.env.BULKSMS_NIGERIA_BASE_URL || 'https://www.bulksmsnigeria.com/api/v3',
      apiToken: process.env.BULKSMS_NIGERIA_API_TOKEN || process.env.BULKSMS_NIGERIA_BEARER_TOKEN || '',
      defaultSenderId: process.env.BULKSMS_NIGERIA_SENDER_ID || '',
      timeout: Number(process.env.BULKSMS_NIGERIA_TIMEOUT_MS || 45000),
    };
  }

  static getHeaders() {
    const config = this.getConfig();
    return {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  static normalizePhoneNumber(phone) {
    const digits = String(phone || '').replace(/\D/g, '');

    if (digits.startsWith('234') && digits.length === 13) {
      return digits;
    }

    if (digits.startsWith('0') && digits.length === 11) {
      return `234${digits.slice(1)}`;
    }

    return digits;
  }

  static normalizeRecipients(to) {
    const recipients = Array.isArray(to) ? to : String(to || '').split(',');
    const normalized = recipients
      .map((item) => this.normalizePhoneNumber(item))
      .filter(Boolean);

    return {
      recipients: normalized,
      to: normalized.join(','),
    };
  }

  static mapProviderError(error) {
    const payload = error.response?.data || {};
    const providerCode = payload?.code || payload?.error?.code || null;
    const message =
      payload?.error?.message ||
      payload?.message ||
      error.message ||
      'Bulk SMS request failed';

    const statusCode = error.response?.status || 500;

    const result = new Error(message);
    result.providerCode = providerCode;
    result.statusCode = statusCode;
    result.providerPayload = payload;
    return result;
  }

  static async sendSms({
    from,
    to,
    body,
    gateway = null,
    appendSender = 'hosted',
    callbackUrl = null,
    customerReference = null,
  }) {
    const { recipients, to: normalizedTo } = this.normalizeRecipients(to);

    const payload = {
      from: from || this.getConfig().defaultSenderId,
      to: normalizedTo,
      body,
      append_sender: appendSender || 'hosted',
    };

    if (gateway) payload.gateway = gateway;
    if (callbackUrl) payload.callback_url = callbackUrl;
    if (customerReference) payload.customer_reference = customerReference;

    try {
      const response = await axios.post(
        `${this.getConfig().baseUrl}/sms`,
        payload,
        {
          headers: this.getHeaders(),
          timeout: this.getConfig().timeout,
        }
      );

      return {
        success: response.data?.status === 'success',
        message: response.data?.message,
        code: response.data?.code,
        data: response.data?.data || {},
        recipients,
        raw: response.data,
      };
    } catch (error) {
      logger.error('BulkSmsNigeria sendSms error:', error.response?.data || error.message);
      throw this.mapProviderError(error);
    }
  }

  static async getBalance() {
    try {
      const response = await axios.get(
        `${this.getConfig().baseUrl}/sms/balance`,
        {
          headers: this.getHeaders(),
          timeout: this.getConfig().timeout,
        }
      );

      return {
        success: response.data?.status === 'success',
        message: response.data?.message,
        code: response.data?.code,
        data: response.data?.data || {},
        raw: response.data,
      };
    } catch (error) {
      logger.error('BulkSmsNigeria getBalance error:', error.response?.data || error.message);
      throw this.mapProviderError(error);
    }
  }
}

module.exports = BulkSmsNigeriaService;
