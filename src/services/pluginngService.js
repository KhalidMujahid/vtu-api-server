const axios = require('axios');
const logger = require('../utils/logger');

class PluginngService {
  static tokenCache = {
    value: null,
    expiresAt: 0,
  };

  static plansCache = {
    value: null,
    expiresAt: 0,
  };

  static networkAliases = {
    mtn: 'mtn',
    '01': 'mtn',
    '1': 'mtn',
    glo: 'glo',
    '02': 'glo',
    '2': 'glo',
    airtel: 'airtel',
    '04': 'airtel',
    '4': 'airtel',
    etisalat: '9mobile',
    '9mobile': '9mobile',
    m_9mobile: '9mobile',
    '03': '9mobile',
    '3': '9mobile',
  };

  static getConfig() {
    return {
      baseUrl: process.env.PLUGINNG_BASE_URL || 'https://pluginng.com',
      timeout: Number(process.env.PLUGINNG_TIMEOUT_MS || 45000),
      email: process.env.PLUGINNG_EMAIL || '',
      password: process.env.PLUGINNG_PASSWORD || '',
      token: process.env.PLUGINNG_TOKEN || '',
    };
  }

  static normalizeNetwork(network = '') {
    const key = String(network).trim().toLowerCase();
    return this.networkAliases[key] || key;
  }

  static resolveNetworkFromTitle(title = '') {
    const normalized = String(title).trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.startsWith('mtn')) return 'mtn';
    if (normalized.startsWith('airtel')) return 'airtel';
    if (normalized.startsWith('glo')) return 'glo';
    if (normalized.startsWith('9mobile')) return '9mobile';
    return null;
  }

  static getStatusLabel(status) {
    const code = String(status ?? '').trim();
    const map = {
      '1': 'success',
      '0': 'pending',
      '4': 'failed',
      '2': 'reversed',
    };
    return map[code] || 'unknown';
  }

  static isSuccessfulStatus(status) {
    return String(status ?? '').trim() === '1';
  }

  static isPendingStatus(status) {
    return String(status ?? '').trim() === '0';
  }

  static isFailedStatus(status) {
    return ['2', '4'].includes(String(status ?? '').trim());
  }

  static extractToken(payload) {
    if (!payload) return null;

    const directCandidates = [
      payload.token,
      payload.access_token,
      payload.accessToken,
      payload.jwt,
    ];

    for (const candidate of directCandidates) {
      if (candidate && typeof candidate === 'string') {
        return candidate;
      }
    }

    const nested = payload.data || payload.user || payload.result || null;
    if (nested && typeof nested === 'object') {
      return this.extractToken(nested);
    }

    return null;
  }

  static extractBalanceValue(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const candidates = [
      payload.balance,
      payload.wallet_balance,
      payload.walletBalance,
      payload.available_balance,
      payload.amount,
      payload.current_balance,
    ];

    for (const value of candidates) {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }

    const nestedCandidates = [payload.data, payload.user, payload.account, payload.result];
    for (const nested of nestedCandidates) {
      const nestedBalance = this.extractBalanceValue(nested);
      if (nestedBalance !== null) {
        return nestedBalance;
      }
    }

    return null;
  }

  static async getAuthToken(forceRefresh = false) {
    const config = this.getConfig();
    const now = Date.now();

    if (config.token) {
      return config.token;
    }

    if (!forceRefresh && this.tokenCache.value && now < this.tokenCache.expiresAt) {
      return this.tokenCache.value;
    }

    if (!config.email || !config.password) {
      throw new Error('PLUGINNG credentials are not configured. Set PLUGINNG_EMAIL and PLUGINNG_PASSWORD.');
    }

    const loginUrl = `${config.baseUrl}/api/login`;
    const response = await axios.post(
      loginUrl,
      {
        email: config.email,
        password: config.password,
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: config.timeout,
      }
    );

    const token = this.extractToken(response.data);
    if (!token) {
      throw new Error('Pluginng login succeeded but no access token was returned.');
    }

    this.tokenCache = {
      value: token,
      expiresAt: now + (55 * 60 * 1000),
    };

    return token;
  }

  static async request(path, options = {}) {
    const {
      method = 'GET',
      params,
      data,
      useForm = false,
      skipAuth = false,
      retryOnAuthFailure = true,
    } = options;

    const config = this.getConfig();
    const headers = {
      Accept: 'application/json',
      ...(useForm ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { 'Content-Type': 'application/json' }),
    };

    if (!skipAuth) {
      const token = await this.getAuthToken();
      headers.Authorization = `Bearer ${token}`;
    }

    const body = useForm
      ? new URLSearchParams(
          Object.entries(data || {}).reduce((acc, [key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
              acc[key] = String(value);
            }
            return acc;
          }, {})
        )
      : data;

    try {
      const response = await axios({
        method,
        url: `${config.baseUrl}${path}`,
        params,
        data: body,
        headers,
        timeout: config.timeout,
      });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      if (!skipAuth && retryOnAuthFailure && status === 401) {
        await this.getAuthToken(true);
        return this.request(path, { ...options, retryOnAuthFailure: false });
      }
      logger.error('Pluginng API request failed:', {
        path,
        message: error.message,
        response: error.response?.data,
      });
      throw new Error(error.response?.data?.message || error.message || 'Pluginng API request failed');
    }
  }

  static async getPlans(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.plansCache.value && now < this.plansCache.expiresAt) {
      return this.plansCache.value;
    }

    const response = await this.request('/api/get/plans');
    const plans = Array.isArray(response?.data) ? response.data : [];

    this.plansCache = {
      value: plans,
      expiresAt: now + (5 * 60 * 1000),
    };

    return plans;
  }

  static async getDataPlans(network = null) {
    const plans = await this.getPlans();
    const normalizedNetwork = this.normalizeNetwork(network || '');
    const filtered = plans.filter((item) => {
      if (String(item?.status ?? '1') !== '1') return false;
      if (String(item?.category || '').toLowerCase() !== 'data') return false;
      if (!Array.isArray(item?.plan)) return false;
      if (!normalizedNetwork) return true;
      return this.resolveNetworkFromTitle(item.title) === normalizedNetwork;
    });

    return {
      success: true,
      data: filtered,
      raw: plans,
    };
  }

  static async resolveDataSubcategoryId(network, planId) {
    const normalizedNetwork = this.normalizeNetwork(network || '');
    const normalizedPlanId = String(planId || '').trim().toLowerCase();
    if (!normalizedNetwork || !normalizedPlanId) return null;

    const plans = await this.getPlans();
    const dataGroups = plans.filter((item) => (
      String(item?.status ?? '1') === '1'
      && String(item?.category || '').toLowerCase() === 'data'
      && Array.isArray(item?.plan)
      && this.resolveNetworkFromTitle(item?.title) === normalizedNetwork
    ));

    for (const group of dataGroups) {
      const hasPlan = group.plan.some((p) => String(p?.plan || '').trim().toLowerCase() === normalizedPlanId);
      if (hasPlan) {
        return String(group.subcategory_id);
      }
    }

    return null;
  }

  static async getAirtimeSubcategoryId(network) {
    const normalizedNetwork = this.normalizeNetwork(network);
    const plans = await this.getPlans();
    const aliases = {
      mtn: ['mtn'],
      airtel: ['airtel'],
      glo: ['glo'],
      '9mobile': ['9mobile', 'etisalat'],
    };
    const candidateTokens = aliases[normalizedNetwork] || [normalizedNetwork];

    const match = plans.find((item) => {
      if (String(item?.status ?? '1') !== '1') return false;
      if (String(item?.category || '').toLowerCase() !== 'airtime') return false;
      const title = String(item?.title || '').toLowerCase();
      return candidateTokens.some((token) => title.includes(token));
    });

    return match ? String(match.subcategory_id) : null;
  }

  static async getActivePlansByCategory(category) {
    const normalizedCategory = String(category || '').trim().toLowerCase();
    if (!normalizedCategory) return [];

    const plans = await this.getPlans();
    return plans.filter((item) => (
      String(item?.status ?? '1') === '1'
      && String(item?.category || '').trim().toLowerCase() === normalizedCategory
    ));
  }

  static async getCableProviders() {
    return this.getActivePlansByCategory('cable');
  }

  static async getElectricityProviders() {
    return this.getActivePlansByCategory('electricity');
  }

  static async getExamProviders() {
    return this.getActivePlansByCategory('exam');
  }

  static async fetchBouquet(plan) {
    if (!plan) {
      throw new Error('plan is required to fetch bouquet');
    }

    return this.request('/api/fetch/bouquet', {
      method: 'GET',
      params: { plan },
    });
  }

  static async verifyCard({ plan, cardno, type = null }) {
    if (!plan || !cardno) {
      throw new Error('plan and cardno are required for card verification.');
    }

    return this.request('/api/verify/card', {
      method: 'POST',
      useForm: true,
      data: {
        plan,
        cardno,
        ...(type ? { type } : {}),
      },
    });
  }

  static normalizePurchasePayload(payload = {}, fallbackReference = null) {
    const statusCode = payload?.data?.status ?? payload?.status ?? payload?.transaction?.status;
    const providerRef = payload?.data?.ref || payload?.ref || payload?.data?.id || payload?.id || null;
    const reference = payload?.data?.custom_reference || payload?.custom_reference || fallbackReference || providerRef;

    return {
      success: this.isSuccessfulStatus(statusCode) || this.isPendingStatus(statusCode),
      pending: this.isPendingStatus(statusCode),
      failed: this.isFailedStatus(statusCode),
      reversed: String(statusCode ?? '').trim() === '2',
      status: this.getStatusLabel(statusCode),
      statusCode: String(statusCode ?? ''),
      reference,
      orderId: providerRef || reference,
      note: payload?.data?.response || payload?.response || payload?.message || '',
      raw: payload,
    };
  }

  static async getWalletBalance() {
    const token = await this.getAuthToken();

    const payloads = [];
    try {
      const loginPayload = await this.request(
        '/api/login',
        {
          method: 'POST',
          data: {
            email: this.getConfig().email,
            password: this.getConfig().password,
          },
          skipAuth: true,
          retryOnAuthFailure: false,
        }
      );
      payloads.push(loginPayload);
    } catch (error) {
      logger.warn(`Pluginng balance check login refresh failed: ${error.message}`);
    }

    payloads.push({ token });
    const plansPayload = await this.request('/api/get/plans');
    payloads.push(plansPayload);

    for (const payload of payloads) {
      const balance = this.extractBalanceValue(payload);
      if (balance !== null) {
        return {
          success: true,
          balance,
          currency: 'NGN',
          raw: payload,
        };
      }
    }

    throw new Error('Pluginng wallet balance is not exposed by the available API responses.');
  }

  static async purchaseData({
    planId,
    phoneNumber,
    subcategoryId,
    customReference,
    ported = null,
  }) {
    if (!planId || !phoneNumber || !subcategoryId) {
      throw new Error('planId, phoneNumber, and subcategoryId are required for Pluginng data purchase.');
    }

    const payload = await this.request('/api/purchase/data', {
      method: 'POST',
      useForm: true,
      data: {
        plan_id: planId,
        phonenumber: phoneNumber,
        subcategory_id: subcategoryId,
        ...(ported ? { ported } : {}),
        ...(customReference ? { custom_reference: customReference } : {}),
      },
    });

    return this.normalizePurchasePayload(payload, customReference);
  }

  static async purchaseAirtime({
    amount,
    phoneNumber,
    subcategoryId,
    customReference,
    ported = null,
  }) {
    if (!amount || !phoneNumber || !subcategoryId) {
      throw new Error('amount, phoneNumber, and subcategoryId are required for Pluginng airtime purchase.');
    }

    const payload = await this.request('/api/purchase/airtime', {
      method: 'POST',
      useForm: true,
      data: {
        amount: Number(amount),
        phonenumber: phoneNumber,
        subcategory_id: subcategoryId,
        ...(ported ? { ported } : {}),
        ...(customReference ? { custom_reference: customReference } : {}),
      },
    });

    return this.normalizePurchasePayload(payload, customReference);
  }

  static async purchaseCable({
    plan,
    phoneNumber,
    amount,
    cardno,
    variationCode,
    customReference,
  }) {
    if (!plan || !phoneNumber || !amount || !cardno || !variationCode) {
      throw new Error('plan, phoneNumber, amount, cardno, and variationCode are required for Pluginng cable purchase.');
    }

    const payload = await this.request('/api/purchase/cable', {
      method: 'POST',
      useForm: true,
      data: {
        plan,
        phonenumber: phoneNumber,
        amount: Number(amount),
        cardno,
        variation_code: variationCode,
        ...(customReference ? { custom_reference: customReference } : {}),
      },
    });

    return this.normalizePurchasePayload(payload, customReference);
  }

  static async purchaseElectricity({
    plan,
    phoneNumber,
    amount,
    cardno,
    variationCode,
    serviceID,
    customReference,
  }) {
    if (!plan || !phoneNumber || !amount || !cardno || !variationCode || !serviceID) {
      throw new Error('plan, phoneNumber, amount, cardno, variationCode, and serviceID are required for Pluginng electricity purchase.');
    }

    const payload = await this.request('/api/purchase/electricity', {
      method: 'POST',
      useForm: true,
      data: {
        plan,
        phonenumber: phoneNumber,
        amount: Number(amount),
        cardno,
        variation_code: variationCode,
        serviceID,
        ...(customReference ? { custom_reference: customReference } : {}),
      },
    });

    return this.normalizePurchasePayload(payload, customReference);
  }

  static async purchaseExam({
    plan,
    phoneNumber,
    cardno,
    variationCode,
    customReference,
  }) {
    if (!plan || !phoneNumber || !cardno || !variationCode) {
      throw new Error('plan, phoneNumber, cardno, and variationCode are required for Pluginng exam purchase.');
    }

    const payload = await this.request('/api/purchase/exam', {
      method: 'POST',
      useForm: true,
      data: {
        plan,
        phonenumber: phoneNumber,
        cardno,
        variation_code: variationCode,
        ...(customReference ? { custom_reference: customReference } : {}),
      },
    });

    return this.normalizePurchasePayload(payload, customReference);
  }

  static async queryTransaction(customReference) {
    if (!customReference) {
      throw new Error('customReference is required to query Pluginng transaction.');
    }

    const payload = await this.request(`/api/requery/${encodeURIComponent(customReference)}`);
    const statusCode = payload?.data?.status ?? payload?.status;

    return {
      success: this.isSuccessfulStatus(statusCode),
      pending: this.isPendingStatus(statusCode),
      failed: this.isFailedStatus(statusCode),
      status: this.getStatusLabel(statusCode),
      statusCode: String(statusCode ?? ''),
      reference: payload?.data?.custom_reference || customReference,
      orderId: payload?.data?.ref || null,
      note: payload?.data?.response || payload?.data?.description || payload?.message || '',
      raw: payload,
    };
  }

  static extractCallbackItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.transactions)) return payload.transactions;
    if (payload.data && typeof payload.data === 'object') return [payload.data];
    if (payload.transaction && typeof payload.transaction === 'object') return [payload.transaction];
    return [payload];
  }

  static verifyCallbackBatch(payload) {
    const items = this.extractCallbackItems(payload);
    if (!items.length) return [];

    return items.map((data) => {
      const statusCode = data.status ?? data?.data?.status;
      return {
        reference: data.custom_reference || data?.data?.custom_reference || null,
        orderId: data.ref || data?.data?.ref || null,
        statusCode: String(statusCode ?? ''),
        status: this.getStatusLabel(statusCode),
        message: data.response || data.description || data?.data?.response || data?.message || '',
        raw: data,
      };
    });
  }

  static verifyCallback(payload) {
    const [firstResult] = this.verifyCallbackBatch(payload);
    return firstResult || null;
  }
}

module.exports = PluginngService;
