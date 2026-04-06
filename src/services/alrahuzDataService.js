const axios = require('axios');
const logger = require('../utils/logger');

class AlrahuzDataService {
  static networkMap = {
    mtn: 1,
    glo: 2,
    '9mobile': 3,
    airtel: 4,
    '01': 1,
    '1': 1,
    '02': 2,
    '2': 2,
    '03': 3,
    '3': 3,
    '04': 4,
    '4': 4,
    etisalat: 3,
    m_9mobile: 3,
  };

  static normalizeNetwork(network = '') {
    const key = String(network || '').trim().toLowerCase();
    return this.networkMap[key] ? Object.keys(this.networkMap).find((k) => this.networkMap[k] === this.networkMap[key] && ['mtn', 'glo', 'airtel', '9mobile'].includes(k)) || key : key;
  }

  static getNetworkId(network = '') {
    const key = String(network || '').trim().toLowerCase();
    return this.networkMap[key] || null;
  }

  static getConfig() {
    return {
      baseUrl: process.env.ALRAHUZDATA_BASE_URL || 'https://alrahuzdata.com.ng',
      token: process.env.ALRAHUZDATA_TOKEN || process.env.ALRAHUZDATA_API_TOKEN || '',
      timeout: Number(process.env.ALRAHUZDATA_TIMEOUT_MS || 45000),
    };
  }

  static getHeaders() {
    const config = this.getConfig();
    if (!config.token) {
      throw new Error('ALRAHUZDATA token is not configured. Set ALRAHUZDATA_TOKEN in environment.');
    }

    return {
      Authorization: `Token ${config.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  static async request(path, options = {}) {
    const { method = 'GET', params, data } = options;
    const config = this.getConfig();

    try {
      const response = await axios({
        method,
        url: `${config.baseUrl}${path}`,
        headers: this.getHeaders(),
        params,
        data,
        timeout: config.timeout,
      });
      return response.data;
    } catch (error) {
      logger.error('AlrahuzData API request failed:', {
        path,
        message: error.message,
        response: error.response?.data,
      });
      throw new Error(error.response?.data?.message || error.message || 'AlrahuzData API request failed');
    }
  }

  static extractBalance(payload) {
    if (payload == null) return null;

    if (typeof payload === 'number') return payload;

    if (typeof payload === 'string') {
      const numeric = Number(String(payload).replace(/,/g, '').trim());
      return Number.isNaN(numeric) ? null : numeric;
    }

    if (typeof payload !== 'object') return null;

    const candidates = [
      payload.balance,
      payload.wallet_balance,
      payload.walletBalance,
      payload.available_balance,
      payload.user_balance,
      payload.amount,
    ];

    for (const candidate of candidates) {
      const found = this.extractBalance(candidate);
      if (found !== null) return found;
    }

    const nestedKeys = ['data', 'user', 'result', 'account'];
    for (const key of nestedKeys) {
      const found = this.extractBalance(payload[key]);
      if (found !== null) return found;
    }

    return null;
  }

  static async getUserDetails() {
    return this.request('/api/user/');
  }

  static async getWalletBalance() {
    const userDetails = await this.getUserDetails();
    const balance = this.extractBalance(userDetails);

    if (balance === null) {
      throw new Error('Unable to extract balance from AlrahuzData user endpoint response.');
    }

    return {
      success: true,
      balance,
      currency: 'NGN',
      raw: userDetails,
    };
  }

  static normalizeDataPlansByNetwork(raw = {}, network = null) {
    const payload = raw?.Dataplans || raw?.data?.Dataplans || raw?.data || raw?.plans || raw;
    const targetNetwork = network ? this.normalizeNetwork(network) : null;
    const result = {};
    const dataplansNetworkBuckets = {
      MTN_PLAN: 'mtn',
      GLO_PLAN: 'glo',
      AIRTEL_PLAN: 'airtel',
      '9MOBILE_PLAN': '9mobile',
      ETISALAT_PLAN: '9mobile',
    };

    const pushPlan = (networkKey, plan = {}) => {
      const normalizedNetwork = this.normalizeNetwork(networkKey);
      if (!normalizedNetwork) return;
      if (targetNetwork && normalizedNetwork !== targetNetwork) return;
      if (!result[normalizedNetwork]) {
        result[normalizedNetwork] = [];
      }

      const planName = String(plan.plan || plan.plan_name || plan.name || '').trim();
      const validity = String(plan.month_validate || plan.validity || '').trim();
      const displayPlanName = validity && planName
        ? `${planName} (${validity})`
        : (planName || String(plan.plan_type || '').trim());
      result[normalizedNetwork].push({
        id: String(plan.id || plan.plan_id || plan.plan_code || planName || '').trim(),
        planCode: String(plan.dataplan_id || plan.plan_code || plan.plan_id || plan.id || planName || '').trim(),
        providerPlanId: String(plan.dataplan_id || plan.plan_id || plan.id || plan.plan_code || planName || '').trim(),
        planName: displayPlanName,
        size: String(plan.plan || plan.volume || plan.size || planName || '').trim(),
        price: Number(plan.plan_amount || plan.amount || plan.price || plan.selling_price || 0),
        validity,
        month_validate: validity,
        network: normalizedNetwork,
        providerPlanType: String(plan.plan_type || '').trim().toLowerCase() || null,
      });
    };

    if (Array.isArray(payload)) {
      for (const item of payload) {
        const networkKey = item?.network || item?.network_name || item?.network_id;
        if (networkKey != null) {
          pushPlan(networkKey, item);
        }
      }
      return result;
    }

    if (payload && typeof payload === 'object') {
      const isDataplansShape = Object.keys(payload).some((key) => Object.prototype.hasOwnProperty.call(dataplansNetworkBuckets, key));
      if (isDataplansShape) {
        for (const [bucketKey, categories] of Object.entries(payload)) {
          const normalizedNetwork = dataplansNetworkBuckets[bucketKey];
          if (!normalizedNetwork || !categories || typeof categories !== 'object') continue;

          for (const plans of Object.values(categories)) {
            if (!Array.isArray(plans)) continue;
            for (const plan of plans) {
              pushPlan(normalizedNetwork, plan);
            }
          }
        }
        return result;
      }

      for (const [networkKey, plans] of Object.entries(payload)) {
        if (!Array.isArray(plans)) continue;
        for (const plan of plans) {
          pushPlan(networkKey, plan);
        }
      }
    }

    return result;
  }

  static async getDataPlans(network = null) {
    const candidates = ['/api/user/', '/api/data-plan/', '/api/dataplans/', '/api/data/plans/'];
    let lastError = null;

    for (const endpoint of candidates) {
      try {
        const payload = await this.request(endpoint);
        const normalized = this.normalizeDataPlansByNetwork(payload, network);
        return {
          success: true,
          data: normalized,
          raw: payload,
        };
      } catch (error) {
        lastError = error;
      }
    }

    logger.warn(`AlrahuzData getDataPlans fallback to empty response: ${lastError?.message || 'unknown error'}`);
    return {
      success: true,
      data: network ? { [this.normalizeNetwork(network)]: [] } : {},
      raw: null,
    };
  }

  static normalizePurchaseResponse(payload = {}, fallbackReference = null) {
    const statusRaw = String(payload?.status || payload?.data?.status || '').toLowerCase();
    const success = payload?.success === true || statusRaw === 'success' || statusRaw === 'pending' || !!payload?.id;
    const pending = statusRaw === 'pending';
    const failed = payload?.success === false || statusRaw === 'failed' || statusRaw === 'error';
    const reference = String(payload?.reference || payload?.id || payload?.data?.id || fallbackReference || '').trim() || null;

    return {
      success,
      pending,
      failed,
      status: failed ? 'failed' : (pending ? 'pending' : (success ? 'success' : 'unknown')),
      message: payload?.message || payload?.detail || '',
      reference,
      orderId: reference,
      raw: payload,
    };
  }

  static normalizeTransactionStatus(payload = {}) {
    const statusCandidate = String(
      payload?.status
      || payload?.Status
      || payload?.data?.status
      || payload?.data?.Status
      || payload?.order_status
      || payload?.orderStatus
      || payload?.transaction_status
      || ''
    ).trim().toLowerCase();

    const message = payload?.message || payload?.detail || payload?.api_response || payload?.data?.message || '';
    const reference = String(
      payload?.id
      || payload?.data?.id
      || payload?.ident
      || payload?.reference
      || payload?.data?.reference
      || ''
    ).trim() || null;

    let status = 'pending';
    if (
      statusCandidate.includes('success')
      || statusCandidate.includes('completed')
      || statusCandidate.includes('deliver')
      || statusCandidate === '1'
      || payload?.success === true
    ) {
      status = 'successful';
    } else if (
      statusCandidate.includes('fail')
      || statusCandidate.includes('error')
      || statusCandidate.includes('cancel')
      || statusCandidate.includes('revers')
      || statusCandidate === '-1'
    ) {
      status = 'failed';
    } else if (
      statusCandidate.includes('pending')
      || statusCandidate.includes('process')
      || statusCandidate.includes('queue')
      || statusCandidate === '0'
    ) {
      status = 'pending';
    }

    return {
      success: status === 'successful',
      pending: status === 'pending',
      failed: status === 'failed',
      status,
      message,
      reference,
      raw: payload,
    };
  }

  static async purchaseData({ network, planId, phoneNumber, customReference, portedNumber = true }) {
    const networkId = this.getNetworkId(network);
    if (!networkId) {
      throw new Error(`Unsupported network for AlrahuzData: ${network}`);
    }
    if (!planId) {
      throw new Error('planId is required for AlrahuzData data purchase.');
    }
    if (!phoneNumber) {
      throw new Error('phoneNumber is required for AlrahuzData data purchase.');
    }

    const payload = await this.request('/api/data/', {
      method: 'POST',
      data: {
        network: Number(networkId),
        mobile_number: String(phoneNumber),
        plan: String(planId),
        Ported_number: Boolean(portedNumber),
        ...(customReference ? { request_id: String(customReference) } : {}),
      },
    });

    return this.normalizePurchaseResponse(payload, customReference);
  }

  static async getDataTransactionById(id) {
    if (!id) {
      throw new Error('id is required to query Alrahuz data transaction.');
    }

    const encodedId = encodeURIComponent(String(id).trim());
    const candidates = [`/api/data/${encodedId}/`, `/api/data/${encodedId}`];
    let lastError = null;

    for (const endpoint of candidates) {
      try {
        const payload = await this.request(endpoint, { method: 'GET' });
        return this.normalizeTransactionStatus(payload);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Unable to query Alrahuz data transaction status.');
  }

  static async purchaseAirtime({ network, amount, phoneNumber, customReference, portedNumber = true }) {
    const networkId = this.getNetworkId(network);
    if (!networkId) {
      throw new Error(`Unsupported network for AlrahuzData: ${network}`);
    }
    if (!amount || Number(amount) <= 0) {
      throw new Error('amount is required for AlrahuzData airtime purchase.');
    }
    if (!phoneNumber) {
      throw new Error('phoneNumber is required for AlrahuzData airtime purchase.');
    }

    const payload = await this.request('/api/topup/', {
      method: 'POST',
      data: {
        network: Number(networkId),
        amount: Number(amount),
        mobile_number: String(phoneNumber),
        Ported_number: Boolean(portedNumber),
        airtime_type: 'VTU',
        ...(customReference ? { request_id: String(customReference) } : {}),
      },
    });

    return this.normalizePurchaseResponse(payload, customReference);
  }
}

module.exports = AlrahuzDataService;
