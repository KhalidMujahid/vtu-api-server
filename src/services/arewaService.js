const axios = require('axios');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

const SMILE_BUNDLES = [
  { bundleTypeCode: '11', planName: 'SmileVoice ONLY 65', price: 900, validity: '30 days' },
  { bundleTypeCode: '12', planName: 'SmileVoice ONLY 135', price: 1850, validity: '30 days' },
  { bundleTypeCode: '13', planName: 'SmileVoice ONLY 430', price: 5700, validity: '30 days' },
  { bundleTypeCode: '14', planName: 'SmileVoice ONLY 450', price: 7200, validity: '60 days' },
  { bundleTypeCode: '15', planName: 'SmileVoice ONLY 500', price: 9000, validity: '90 days' },
  { bundleTypeCode: '16', planName: '1GB flexidaily', price: 450, validity: '1 day' },
  { bundleTypeCode: '17', planName: '2.5GB FlexiDaily', price: 750, validity: '2 days' },
  { bundleTypeCode: '18', planName: '1GB flexiweekly', price: 750, validity: '7 days' },
  { bundleTypeCode: '19', planName: 'SmileVoice ONLY 150', price: 2700, validity: '60 days' },
  { bundleTypeCode: '20', planName: 'SmileVoice ONLY 175', price: 3600, validity: '90 days' },
  { bundleTypeCode: '21', planName: '2GB FlexiWeekly', price: 1550, validity: '7 days' },
  { bundleTypeCode: '25', planName: '1.5GB Bigga', price: 1550, validity: '30 days' },
  { bundleTypeCode: '26', planName: '2GB Bigga', price: 1800, validity: '30 days' },
  { bundleTypeCode: '27', planName: '3GB Bigga', price: 2300, validity: '30 days' },
  { bundleTypeCode: '28', planName: '5GB Bigga', price: 3100, validity: '30 days' },
  { bundleTypeCode: '29', planName: '6.5GB Bigga', price: 3800, validity: '30 days' },
  { bundleTypeCode: '30', planName: '10GB Bigga', price: 4600, validity: '30 days' },
  { bundleTypeCode: '31', planName: '15GB 365', price: 14000, validity: '360 days' },
  { bundleTypeCode: '32', planName: 'Smile MAXI Data Flux', price: 61500, validity: '30 days' },
  { bundleTypeCode: '33', planName: '35GB 365', price: 29000, validity: '360 days' },
  { bundleTypeCode: '34', planName: '90GB Jumbo', price: 31000, validity: '60 days' },
  { bundleTypeCode: '35', planName: '160GB Jumbo', price: 53000, validity: '90 days' },
  { bundleTypeCode: '36', planName: 'Smile Maxi Office', price: 45000, validity: '30 days' },
  { bundleTypeCode: '37', planName: '20GB Bigger', price: 8000, validity: '30 days' },
  { bundleTypeCode: '38', planName: '25GB Bigger', price: 9500, validity: '30 days' },
  { bundleTypeCode: '39', planName: '30GB Bigger', price: 12500, validity: '30 days' },
  { bundleTypeCode: '40', planName: '40GB Bigger', price: 15500, validity: '30 days' },
  { bundleTypeCode: '41', planName: '60GB Bigger', price: 21000, validity: '30 days' },
  { bundleTypeCode: '42', planName: '75GB Bigger', price: 23000, validity: '30 days' },
  { bundleTypeCode: '43', planName: 'Smile Maxi Lite', price: 15000, validity: '30 days' },
  { bundleTypeCode: '44', planName: 'Smile MAXI Essentials', price: 27700, validity: '30 days' },
  { bundleTypeCode: '45', planName: '2GB midnight', price: 1100, validity: '7 days' },
  { bundleTypeCode: '46', planName: '3GB midnight', price: 1650, validity: '7 days' },
  { bundleTypeCode: '47', planName: '3GB weekend only', price: 1650, validity: '1 weekend' },
  { bundleTypeCode: '48', planName: 'Smile Maxi Home', price: 38500, validity: '30 days' },
];

class ArewaService {
  static config = {
    baseUrl: String(process.env.AREWA_BASE_URL || 'https://arewaglobal.co').trim(),
    apiKey: String(process.env.AREWA_API_KEY || '').trim(),
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
    const accountId = details?.id || details?.data?.id || null;
    const phoneNumber = details?.phoneno || details?.phoneNumber || details?.data?.phoneno || details?.data?.phoneNumber || null;

    return {
      providerId: 'arewa',
      providerName: 'Arewa',
      available: balance !== null,
      balance,
      currency: details?.currency || details?.data?.currency || 'NGN',
      accountId,
      phoneNumber,
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

  static normalizePhoneNumber(phoneNumber) {
    const digits = String(phoneNumber || '').replace(/\D/g, '');
    if (!digits) {
      return null;
    }

    if (digits.startsWith('234') && digits.length >= 13) {
      return digits;
    }

    if (digits.startsWith('0') && digits.length === 11) {
      return `234${digits.slice(1)}`;
    }

    if (digits.length === 10) {
      return `234${digits}`;
    }

    return digits;
  }

  static getSmileBundles() {
    return SMILE_BUNDLES.map((bundle) => ({
      id: bundle.bundleTypeCode,
      planId: bundle.bundleTypeCode,
      bundleTypeCode: bundle.bundleTypeCode,
      planName: bundle.planName,
      price: bundle.price,
      validity: bundle.validity,
      currency: 'NGN',
    }));
  }

  static async getSmilePackages() {
    return {
      success: true,
      packages: this.getSmileBundles(),
      response: {
        status: 'success',
        service: 'Smile Bundle',
        source: 'local-docs',
      },
    };
  }

  static async verifySmileAccount({ phoneNumber }) {
    const normalizedPhoneNumber = this.normalizePhoneNumber(phoneNumber);
    return {
      valid: Boolean(normalizedPhoneNumber && normalizedPhoneNumber.startsWith('234')),
      customerName: null,
      verificationMethod: 'format-validation',
      phoneNumber: normalizedPhoneNumber,
      response: {
        status: normalizedPhoneNumber ? 'success' : 'error',
        message: normalizedPhoneNumber
          ? 'Smile account format looks valid'
          : 'Invalid Smile account number',
      },
    };
  }

  static async purchaseSmileData({ phoneNumber, bundleTypeCode, actype = 'AccountNumber' }) {
    const normalizedPhoneNumber = this.normalizePhoneNumber(phoneNumber);
    if (!normalizedPhoneNumber) {
      throw new AppError('Invalid Smile phone number', 400);
    }

    const bundle = SMILE_BUNDLES.find(
      (item) => String(item.bundleTypeCode) === String(bundleTypeCode)
    );

    if (!bundle) {
      throw new AppError('Selected Smile bundle was not found', 404);
    }

    const response = await this.request('/api/smile-data/', {
      PhoneNumber: normalizedPhoneNumber,
      BundleTypeCode: String(bundleTypeCode),
      actype,
    });

    return {
      success: String(response?.status || '').toLowerCase() === 'success',
      service: response?.service || 'Smile Bundle',
      msg: response?.msg || response?.message || null,
      bundle,
      response,
    };
  }
}

module.exports = ArewaService;
