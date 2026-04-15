const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');

class NelloBytesService {
  static config = {
    baseUrl: 'https://www.nellobytesystems.com',
    userId: process.env.NELLO_USER_ID || 'CK101269269',
    apiKey: process.env.NELLO_API_KEY || '1N6P675ASG2341TWAMI0979GVVTMCCGI83AZ54I6H5JBN2WE1E467642F15HG661',
    timeout: 45000,
  };

  static networkCodes = {
    mtn: '01',
    glo: '02',
    '9mobile': '03',
    airtel: '04',
    '01': '01',
    '1': '01',
    '02': '02',
    '2': '02',
    '03': '03',
    '3': '03',
    '04': '04',
    '4': '04',
    etisalat: '03',
    m_9mobile: '03',
  };

  static normalizeNetwork(network = '') {
    const key = String(network).trim().toLowerCase();
    if (!key) return '';
    if (['01', '1'].includes(key)) return 'mtn';
    if (['02', '2'].includes(key)) return 'glo';
    if (['03', '3'].includes(key)) return '9mobile';
    if (['04', '4'].includes(key)) return 'airtel';
    if (key === 'etisalat') return '9mobile';
    if (key === 'm_9mobile') return '9mobile';
    return key;
  }

  static cableCodes = {
    dstv: 'dstv',
    gotv: 'gotv',
    startimes: 'startimes',
    showmax: 'showmax',
  };

  static electricityCodes = {
    ekedc: '01',
    ikedc: '02',
    aedc: '03',
    kedco: '04',
    kaedco: '08',
    kaedc: '08',
    phedc: '05',
    jedc: '06',
    ibedc: '07',
    eedc: '09',
    bedc: '10',
    yedc: '11',
    aple: '12',
  };

  static meterTypes = {
    prepaid: '01',
    postpaid: '02',
  };

  static electricityCodeNames = {
    '01': 'ekedc',
    '02': 'ikedc',
    '03': 'aedc',
    '04': 'kedco',
    '05': 'phedc',
    '06': 'jedc',
    '07': 'ibedc',
    '08': 'kaedc',
    '09': 'eedc',
    '10': 'bedc',
    '11': 'yedc',
    '12': 'aple',
  };

  static normalizeMobileNumber(phoneNumber) {
    if (!phoneNumber) {
      return '';
    }

    const digits = String(phoneNumber).replace(/\D/g, '');

    if (!digits) return '';

    if (digits.length === 13 && digits.startsWith('234')) {
      return `0${digits.substring(3)}`;
    }

    if (digits.length === 11 && digits.startsWith('0')) {
      return digits;
    }

    if (digits.length === 10) {
      return `0${digits}`;
    }

    return digits;
  }

  static resolveElectricityCompany(electricCompany) {
    const value = String(electricCompany || '').trim().toLowerCase();

    if (!value) {
      throw new AppError('Invalid electricity company', 400);
    }

    const aliases = {
      eko: 'ekedc',
      ekoelectric: 'ekedc',
      ekoelectricity: 'ekedc',
      ikeja: 'ikedc',
      ikejaelectric: 'ikedc',
      abuja: 'aedc',
      abujaelectric: 'aedc',
      kedco: 'kedco',
      kano: 'kedco',
      kanoelectric: 'kedco',
      kaduna: 'kaedc',
      kadunaelectric: 'kaedc',
      portharcourt: 'phedc',
      phed: 'phedc',
      jos: 'jedc',
      ibadan: 'ibedc',
      enugu: 'eedc',
      benin: 'bedc',
      yola: 'yedc',
      aba: 'aple',
    };

    const normalizedName = aliases[value] || value;
    const code = this.electricityCodes[normalizedName] || this.electricityCodes[value] || (this.electricityCodeNames[value] ? value : null);

    if (!code) {
      throw new AppError('Invalid electricity company', 400);
    }

    return {
      code,
      key: this.electricityCodeNames[code] || normalizedName,
    };
  }

  static resolveMeterType(meterType = 'prepaid') {
    const value = String(meterType || '').trim().toLowerCase();
    return this.meterTypes[value] || (value === '01' || value === '02' ? value : '01');
  }

  static normalizeElectricityDiscosResponse(response) {
    const safeResolveElectricityCompany = (candidate) => {
      try {
        return this.resolveElectricityCompany(candidate);
      } catch (error) {
        return null;
      }
    };

    const normalizeProducts = (products = []) => {
      if (!Array.isArray(products)) return [];

      return products.map((product = {}) => ({
        id: String(product.PRODUCT_ID || product.product_id || product.id || '').trim() || null,
        type: String(product.PRODUCT_TYPE || product.product_type || product.type || '').trim() || null,
        discountAmount: Number(product.PRODUCT_DISCOUNT_AMOUNT ?? product.product_discount_amount ?? product.discount_amount ?? NaN),
        discount: String(product.PRODUCT_DISCOUNT || product.product_discount || product.discount || '').trim() || null,
        minAmount: Number(product.MINAMOUNT ?? product.minamount ?? product.minAmount ?? NaN),
        maxAmount: Number(product.MAXAMOUNT ?? product.maxamount ?? product.maxAmount ?? NaN),
      })).map((product) => ({
        ...product,
        discountAmount: Number.isNaN(product.discountAmount) ? null : product.discountAmount,
        minAmount: Number.isNaN(product.minAmount) ? null : product.minAmount,
        maxAmount: Number.isNaN(product.maxAmount) ? null : product.maxAmount,
      }));
    };

    const electricCompanyData = response?.ELECTRIC_COMPANY;
    if (electricCompanyData && typeof electricCompanyData === 'object') {
      const parsed = [];

      Object.entries(electricCompanyData).forEach(([companyKey, companyValue]) => {
        if (!Array.isArray(companyValue)) return;

        companyValue.forEach((item = {}) => {
          const explicitCode = String(item.ID || item.id || '').trim();
          const resolved = safeResolveElectricityCompany(explicitCode)
            || safeResolveElectricityCompany(item.NAME || item.name)
            || safeResolveElectricityCompany(companyKey);

          parsed.push({
            code: resolved?.code || explicitCode || null,
            key: resolved?.key || String(companyKey || '').trim().toLowerCase() || null,
            name: String(item.NAME || item.name || companyKey || '').trim(),
            products: normalizeProducts(item.PRODUCT || item.product),
          });
        });
      });

      return parsed.filter((item) => item.code || item.name);
    }

    const raw = response?.DISCOS || response?.discos || response?.data || response;

    if (Array.isArray(raw)) {
      return raw.map((item) => {
        const code = String(item.code || item.id || item.disco_code || item.value || '').trim();
        const name = String(item.name || item.disco || item.label || '').trim();
        const resolved = safeResolveElectricityCompany(code) || safeResolveElectricityCompany(name);

        return {
          code: resolved?.code || code || null,
          key: resolved?.key || null,
          name: name || resolved?.key?.toUpperCase() || code,
        };
      });
    }

    if (raw && typeof raw === 'object') {
      return Object.entries(raw).map(([code, value]) => {
        const resolved = safeResolveElectricityCompany(code)
          || safeResolveElectricityCompany(value?.name || value?.disco || value);
        return {
          code: resolved?.code || code,
          key: resolved?.key || null,
          name: typeof value === 'string' ? value : value?.name || value?.disco || resolved?.key?.toUpperCase() || code,
        };
      });
    }

    return Object.entries(this.electricityCodeNames).map(([code, key]) => ({
      code,
      key,
      name: key.toUpperCase(),
    }));
  }

  static async request(endpoint, params = {}) {
    const defaultParams = {
      UserID: this.config.userId,
      APIKey: this.config.apiKey,
      ...params,
    };

    try {
      const url = `${this.config.baseUrl}${endpoint}`;
      logger.info(`NelloBytes API Request: ${endpoint}`, { params: defaultParams });

      const response = await axios.get(url, {
        params: defaultParams,
        timeout: this.config.timeout,
      });

      const payload = this.normalizeResponsePayload(response.data);
      logger.info(`NelloBytes API Response: ${endpoint}`, { response: payload });
      return payload;
    } catch (error) {
      logger.error(`NelloBytes API Error: ${endpoint}`, {
        message: error.message,
        response: error.response?.data,
      });
      throw new AppError(`NelloBytes API error: ${error.message}`, error.response?.status || 500);
    }
  }

  static normalizeResponsePayload(payload) {
    if (typeof payload !== 'string') {
      return payload;
    }

    const trimmed = payload.trim();
    if (!trimmed) {
      return {};
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        logger.warn('NelloBytes response JSON parse failed, returning raw payload');
      }
    }

    return payload;
  }

  static parseBalanceValue(value) {
    if (typeof value === 'number') {
      return Number.isNaN(value) ? null : value;
    }

    if (typeof value !== 'string') {
      return null;
    }

    const cleaned = value.replace(/[^0-9.-]/g, '');
    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned);
    return Number.isNaN(parsed) ? null : parsed;
  }

  


  static async getWalletBalance() {
    const endpoint = '/APIWalletBalanceV1.asp';
    const response = await this.request(endpoint);
    const statusText = String(response?.STATUS || response?.status || '').trim().toUpperCase();

    if (statusText) {
      const knownCredentialErrors = new Set([
        'INVALID_CREDENTIALS',
        'MISSING_CREDENTIALS',
        'MISSING_USERID',
        'MISSING_APIKEY',
      ]);

      if (knownCredentialErrors.has(statusText)) {
        throw new AppError(`ClubKonnect wallet balance error: ${statusText}`, 401);
      }
    }

    const balanceCandidate =
      response?.balance ??
      response?.BALANCE ??
      response?.wallet_balance ??
      response?.WalletBalance ??
      response?.wallet ??
      null;

    const balanceValue = this.parseBalanceValue(balanceCandidate);
    if (balanceValue === null) {
      throw new AppError('ClubKonnect wallet balance was not found in provider response', 502);
    }

    return {
      success: true,
      id: response?.id || this.config.userId,
      phoneNumber: response?.phoneno || null,
      balance: balanceValue,
      currency: 'NGN',
      date: response?.date || null,
      raw: response,
    };
  }

  
  
  

  



  static async getDataPlans(network = null) {
    const endpoint = '/APIDatabundlePlansV2.asp';
    const response = await this.request(endpoint);
    
    const normalized = this.normalizeNetwork(network || '');
    if (network && this.networkCodes[normalized]) {
      const networkCode = this.networkCodes[normalized];
      return this.parseDataPlansResponse(response, networkCode);
    }
    
    return response;
  }

  static parseSpectranetPackagesResponse(response) {
    const raw = response?.SPECTRANET || response?.packages || response?.data || response;
    const entries = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? Object.values(raw)
        : [];

    return entries
      .map((item = {}) => {
        const planId = String(
          item.variation_code ||
          item.dataplan_id ||
          item.plan_id ||
          item.id ||
          ''
        ).trim();

        const planName = String(
          item.name ||
          item.plan_name ||
          item.plan ||
          item.description ||
          ''
        ).trim();

        const amountRaw = item.amount ?? item.plan_amount ?? item.price ?? item.cost ?? null;
        const amount = Number(String(amountRaw ?? '').replace(/[^0-9.]/g, ''));

        return {
          id: planId,
          planId,
          variationCode: planId,
          planName,
          amount: Number.isNaN(amount) ? null : amount,
          validity: item.validity || item.month_validate || null,
          raw: item,
        };
      })
      .filter((item) => item.planId);
  }

  static async getSpectranetPackages() {
    const endpoint = '/APISpectranetPackagesV2.asp';
    const response = await this.request(endpoint, {
      UserID: this.config.userId,
    });

    return {
      success: true,
      packages: this.parseSpectranetPackagesResponse(response),
      response,
    };
  }

  static parseSmilePackagesResponse(response) {
    const raw = response?.SMILE || response?.packages || response?.data || response;
    const entries = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? Object.values(raw)
        : [];

    return entries
      .map((item = {}) => {
        const planId = String(
          item.variation_code ||
          item.dataplan_id ||
          item.plan_id ||
          item.id ||
          ''
        ).trim();

        const planName = String(
          item.name ||
          item.plan_name ||
          item.plan ||
          item.description ||
          ''
        ).trim();

        const amountRaw = item.amount ?? item.plan_amount ?? item.price ?? item.cost ?? null;
        const amount = Number(String(amountRaw ?? '').replace(/[^0-9.]/g, ''));

        return {
          id: planId,
          planId,
          variationCode: planId,
          planName,
          amount: Number.isNaN(amount) ? null : amount,
          validity: item.validity || item.month_validate || null,
          raw: item,
        };
      })
      .filter((item) => item.planId);
  }

  static async getSmilePackages() {
    const endpoint = '/APISmilePackagesV2.asp';
    const response = await this.request(endpoint, {
      UserID: this.config.userId,
    });

    return {
      success: true,
      packages: this.parseSmilePackagesResponse(response),
      response,
    };
  }

  


  static parseDataPlansResponse(response, networkCode) {
    if (typeof response === 'string') {
      
      const plans = {};
      const networks = ['MTN', 'GLO', 'AIRTEL', '9MOBILE'];
      
      networks.forEach(net => {
        plans[net.toLowerCase()] = [];
      });
      
      return plans;
    }
    return response;
  }

  







  static async purchaseData({ network, dataPlan, mobileNumber, callBackURL }) {
    const endpoint = '/APIDatabundleV1.asp';
    
    const normalizedNetwork = this.normalizeNetwork(network);
    const networkCode = this.networkCodes[normalizedNetwork];
    if (!networkCode) {
      throw new AppError('Invalid network. Use: mtn/glo/airtel/9mobile or 01/02/03/04', 400);
    }

    const requestId = uuidv4().substring(0, 8).toUpperCase();

    const response = await this.request(endpoint, {
      MobileNetwork: networkCode,
      DataPlan: dataPlan,
      MobileNumber: this.normalizeMobileNumber(mobileNumber),
      RequestID: requestId,
      CallBackURL: callBackURL || '',
    });

    return {
      success: response.statuscode === '100',
      status: response.status,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: requestId,
      response,
    };
  }

  static async purchaseSpectranetData({ dataPlan, mobileNumber, requestId = null, callBackURL = '' }) {
    const endpoint = '/APISpectranetV1.asp';
    const resolvedRequestId = requestId || uuidv4().substring(0, 12).toUpperCase();

    const response = await this.request(endpoint, {
      MobileNetwork: 'spectranet',
      DataPlan: dataPlan,
      MobileNumber: this.normalizeMobileNumber(mobileNumber),
      RequestID: resolvedRequestId,
      CallBackURL: callBackURL,
    });

    const statusCode = String(response?.statuscode || '');
    const status = String(response?.status || response?.orderstatus || '').toUpperCase();

    return {
      success: statusCode === '100' || status === 'ORDER_RECEIVED' || status === 'ORDER_ONHOLD',
      status: response?.status || response?.orderstatus,
      statusCode,
      orderId: response?.orderid || response?.orderId || null,
      requestId: response?.requestid || resolvedRequestId,
      response,
    };
  }

  static async verifySmileAccount({ mobileNumber }) {
    const endpoint = '/APIVerifySmileV1.asp';

    const response = await this.request(endpoint, {
      MobileNetwork: 'smile-direct',
      MobileNumber: this.normalizeMobileNumber(mobileNumber),
    });

    const customerName = String(response?.customer_name || '').trim();
    return {
      valid: Boolean(customerName && customerName.toUpperCase() !== 'INVALID_ACCOUNTNO'),
      customerName: customerName || null,
      response,
    };
  }

  static async purchaseSmileData({ dataPlan, mobileNumber, requestId = null, callBackURL = '' }) {
    const endpoint = '/APISmileV1.asp';
    const resolvedRequestId = requestId || uuidv4().substring(0, 12).toUpperCase();

    const response = await this.request(endpoint, {
      MobileNetwork: 'smile-direct',
      DataPlan: dataPlan,
      MobileNumber: this.normalizeMobileNumber(mobileNumber),
      RequestID: resolvedRequestId,
      CallBackURL: callBackURL,
    });

    const statusCode = String(response?.statuscode || '');
    const status = String(response?.status || response?.orderstatus || '').toUpperCase();

    return {
      success: statusCode === '100' || status === 'ORDER_RECEIVED' || status === 'ORDER_ONHOLD',
      status: response?.status || response?.orderstatus,
      statusCode,
      orderId: response?.orderid || response?.orderId || null,
      requestId: response?.requestid || resolvedRequestId,
      response,
    };
  }

  









  static async purchaseAirtime({ network, amount, mobileNumber, requestId = null, callBackURL, bonusType = null }) {
    const endpoint = '/APIAirtimeV1.asp';
    const normalizedNetwork = this.normalizeNetwork(network);
    const networkCode = this.networkCodes[normalizedNetwork];

    if (!networkCode) {
      throw new AppError('Invalid network. Use: mtn/glo/airtel/9mobile or 01/02/03/04', 400);
    }

    const normalizedAmount = Number(amount);
    if (Number.isNaN(normalizedAmount) || normalizedAmount < 50 || normalizedAmount > 200000) {
      throw new AppError('Airtime amount must be between 50 and 200000', 400);
    }

    const resolvedRequestId = requestId || uuidv4().substring(0, 8).toUpperCase();

    const response = await this.request(endpoint, {
      MobileNetwork: networkCode,
      Amount: normalizedAmount,
      MobileNumber: this.normalizeMobileNumber(mobileNumber),
      RequestID: resolvedRequestId,
      CallBackURL: callBackURL || '',
      ...(bonusType ? { BonusType: bonusType } : {}),
    });

    return {
      success: response.statuscode === '100' || response.statuscode === '200' || response.status === 'ORDER_RECEIVED',
      status: response.status || response.orderstatus,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: response.requestid || resolvedRequestId,
      response,
    };
  }

  


  static async queryDataTransaction({ orderId = null, requestId = null }) {
    const endpoint = '/APIQueryV1.asp';
    
    const params = {};
    if (orderId) params.OrderID = orderId;
    if (requestId) params.RequestID = requestId;

    const response = await this.request(endpoint, params);
    
    return {
      orderId: response.orderid,
      requestId: response.requestid || requestId || null,
      status: response.status || response.orderstatus,
      statusCode: response.statuscode,
      remark: response.remark || response.orderremark,
      date: response.date || response.orderdate,
      response,
    };
  }

  static async queryAirtimeTransaction({ orderId = null, requestId = null }) {
    return this.queryDataTransaction({ orderId, requestId });
  }

  


  static async cancelDataTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: (response.status || response.orderstatus) === 'ORDER_CANCELLED',
      status: response.status || response.orderstatus,
      orderId: response.orderid,
      response,
    };
  }

  static async cancelAirtimeTransaction(orderId) {
    return this.cancelDataTransaction(orderId);
  }

  
  
  

  



  static async getCablePackages(cableTV = null) {
    const endpoint = '/APICableTVPackagesV2.asp';
    const response = await this.request(endpoint);
    
    if (cableTV && this.cableCodes[cableTV.toLowerCase()]) {
      
      return this.parseCablePackages(response, cableTV.toLowerCase());
    }
    
    return response;
  }

  


  static parseCablePackages(response, cableTV) {
    if (typeof response === 'string') {
      return response;
    }
    return response;
  }

  


  static async verifyCableSmartCard({ cableTV, smartCardNo }) {
    const endpoint = '/APIVerifyCableTVV1.0.asp';
    
    const cableCode = this.cableCodes[cableTV.toLowerCase()];
    if (!cableCode) {
      throw new AppError('Invalid cable TV provider. Use: dstv, gotv, or startimes', 400);
    }

    const response = await this.request(endpoint, {
      CableTV: cableCode,
      SmartCardNo: smartCardNo,
    });

    return {
      valid: response.customer_name && response.customer_name !== 'INVALID_SMARTCARDNO',
      customerName: response.customer_name,
      response,
    };
  }

  


  static async purchaseCableTV({ cableTV, packageCode, smartCardNo, phoneNo, requestId = null, callBackURL }) {
    const endpoint = '/APICableTVV1.asp';
    
    const cableCode = this.cableCodes[cableTV.toLowerCase()];
    if (!cableCode) {
      throw new AppError('Invalid cable TV provider. Use: dstv, gotv, or startimes', 400);
    }

    const resolvedRequestId = requestId || uuidv4().substring(0, 8).toUpperCase();

    const response = await this.request(endpoint, {
      CableTV: cableCode,
      Package: packageCode,
      SmartCardNo: smartCardNo,
      PhoneNo: this.normalizeMobileNumber(phoneNo),
      RequestID: resolvedRequestId,
      CallBackURL: callBackURL || '',
    });

    return {
      success: response.statuscode === '100' || response.statuscode === '200',
      status: response.status || response.orderstatus,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: response.requestid || resolvedRequestId,
      response,
    };
  }

  


  static async queryCableTransaction({ orderId = null, requestId = null }) {
    const endpoint = '/APIQueryV1.asp';
    
    const params = {};
    if (orderId) params.OrderID = orderId;
    if (requestId) params.RequestID = requestId;

    const response = await this.request(endpoint, params);
    
    return {
      orderId: response.orderid,
      status: response.orderstatus,
      statusCode: response.statuscode,
      remark: response.orderremark,
      date: response.orderdate,
      response,
    };
  }

  


  static async cancelCableTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: (response.status || response.orderstatus) === 'ORDER_CANCELLED',
      status: response.status || response.orderstatus,
      orderId: response.orderid,
      response,
    };
  }

  
  
  

  


  static async getElectricityDiscos() {
    const endpoint = '/APIElectricityDiscosV2.asp';
    const response = await this.request(endpoint);
    return {
      raw: response,
      discos: this.normalizeElectricityDiscosResponse(response),
    };
  }

  


  static async verifyElectricityMeter({ electricCompany, meterNo, meterType = 'prepaid' }) {
    const endpoint = '/APIVerifyElectricityV1.asp';
    const { code: discoCode, key } = this.resolveElectricityCompany(electricCompany);
    const typeCode = this.resolveMeterType(meterType);

    const response = await this.request(endpoint, {
      ElectricCompany: discoCode,
      MeterNo: meterNo,
      MeterType: typeCode,
    });

    return {
      valid: response.customer_name && response.customer_name !== 'INVALID_METERNO',
      customerName: response.customer_name,
      electricCompany: key,
      electricCompanyCode: discoCode,
      meterTypeCode: typeCode,
      response,
    };
  }

  


  static async payElectricityBill({ electricCompany, meterNo, meterType, amount, phoneNo, requestId = null, callBackURL }) {
    const endpoint = '/APIElectricityV1.asp';
    const { code: discoCode, key } = this.resolveElectricityCompany(electricCompany);
    const typeCode = this.resolveMeterType(meterType);
    const resolvedRequestId = requestId || uuidv4().substring(0, 8).toUpperCase();

    const response = await this.request(endpoint, {
      ElectricCompany: discoCode,
      MeterNo: meterNo,
      MeterType: typeCode,
      Amount: amount,
      PhoneNo: this.normalizeMobileNumber(phoneNo),
      RequestID: resolvedRequestId,
      CallBackURL: callBackURL || '',
    });

    return {
      success: response.statuscode === '100' || response.statuscode === '200',
      status: response.status || response.orderstatus,
      statusCode: response.statuscode,
      orderId: response.orderid,
      meterToken: response.metertoken,
      electricCompany: key,
      electricCompanyCode: discoCode,
      meterTypeCode: typeCode,
      requestId: response.requestid || resolvedRequestId,
      response,
    };
  }

  


  static async queryElectricityTransaction({ orderId = null, requestId = null }) {
    const endpoint = '/APIQueryV1.asp';
    
    const params = {};
    if (orderId) params.OrderID = orderId;
    if (requestId) params.RequestID = requestId;

    const response = await this.request(endpoint, params);
    
    return {
      orderId: response.orderid,
      status: response.orderstatus,
      statusCode: response.statuscode,
      remark: response.orderremark,
      date: response.orderdate,
      response,
    };
  }

  


  static async cancelElectricityTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: (response.status || response.orderstatus) === 'ORDER_CANCELLED',
      status: response.status || response.orderstatus,
      orderId: response.orderid,
      response,
    };
  }

  
  
  

  


  static async getEPINDiscount() {
    const endpoint = '/APIEPINDiscountV2.asp';
    const response = await this.request(endpoint);
    return response;
  }

  


  static async buyEPIN({ mobileNetwork, value, quantity, requestId = null, callBackURL = null }) {
    const endpoint = '/APIEPINV1.asp';
    
    const normalizedNetwork = this.normalizeNetwork(mobileNetwork);
    const networkCode = this.networkCodes[normalizedNetwork];
    if (!networkCode) {
      throw new AppError('Invalid network. Use: mtn/glo/airtel/9mobile or 01/02/03/04', 400);
    }

    
    const allowedValues = ['100', '200', '500'];
    if (!allowedValues.includes(String(value))) {
      throw new AppError('Invalid value. Allowed: 100, 200, 500', 400);
    }

    
    if (quantity < 1 || quantity > 100) {
      throw new AppError('Invalid quantity. Allowed: 1 to 100', 400);
    }

    const resolvedRequestId = requestId || uuidv4().substring(0, 8).toUpperCase();

    const response = await this.request(endpoint, {
      MobileNetwork: networkCode,
      Value: value,
      Quantity: quantity,
      RequestID: resolvedRequestId,
      CallBackURL: callBackURL || '',
    });

    return {
      success: response.statuscode === '200' || response.TXN_EPIN,
      status: response.status,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: response.requestid || resolvedRequestId,
      epins: response.TXN_EPIN || [],
      response,
    };
  }

  


  static async queryEPINTransaction({ orderId = null, requestId = null }) {
    const endpoint = '/APIQueryV1.asp';
    
    const params = {};
    if (orderId) params.OrderID = orderId;
    if (requestId) params.RequestID = requestId;

    const response = await this.request(endpoint, params);
    
    return {
      orderId: response.orderid,
      status: response.orderstatus,
      statusCode: response.statuscode,
      remark: response.orderremark,
      date: response.orderdate,
      epins: response.TXN_EPIN || [],
      response,
    };
  }

  
  
  

  


  static async getWAECPackages() {
    const endpoint = '/APIWAECPackagesV2.asp';
    const response = await this.request(endpoint);
    return response;
  }

  






  static async buyWAECEPIN({ examType, phoneNo, requestId = null, callBackURL }) {
    const endpoint = '/APIWAECV1.asp';
    
    const resolvedRequestId = requestId || uuidv4().substring(0, 8).toUpperCase();

    const response = await this.request(endpoint, {
      ExamType: examType,
      PhoneNo: this.normalizeMobileNumber(phoneNo),
      RequestID: resolvedRequestId,
      CallBackURL: callBackURL || '',
    });

    return {
      success: response.statuscode === '100' || response.statuscode === '200',
      status: response.status || response.orderstatus,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: response.requestid || resolvedRequestId,
      cardDetails: response.carddetails,
      amountCharged: response.amountcharged,
      response,
    };
  }

  


  static async queryWAECTransaction({ orderId = null, requestId = null }) {
    const endpoint = '/APIQueryV1.asp';
    
    const params = {};
    if (orderId) params.OrderID = orderId;
    if (requestId) params.RequestID = requestId;

    const response = await this.request(endpoint, params);
    
    return {
      orderId: response.orderid,
      requestId: response.requestid || requestId || null,
      status: response.status || response.orderstatus,
      statusCode: response.statuscode,
      remark: response.remark || response.orderremark,
      date: response.date || response.orderdate,
      cardDetails: response.carddetails,
      response,
    };
  }

  


  static async cancelWAECTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: (response.status || response.orderstatus) === 'ORDER_CANCELLED',
      status: response.status || response.orderstatus,
      orderId: response.orderid,
      response,
    };
  }

  
  
  

  


  static async getJAMBPackages() {
    const endpoint = '/APIJAMBPackagesV2.asp';
    const response = await this.request(endpoint);
    return response;
  }

  


  static async verifyJAMBProfile({ examType, profileId }) {
    const endpoint = '/APIVerifyJAMBV1.asp';
    
    const response = await this.request(endpoint, {
      ExamType: examType,
      ProfileID: profileId,
    });

    return {
      valid: response.customer_name && response.customer_name !== 'INVALID_ACCOUNTNO',
      customerName: response.customer_name,
      response,
    };
  }

  


  static async buyJAMPEPIN({ examType, phoneNo, requestId = null, callBackURL }) {
    const endpoint = '/APIJAMBV1.asp';
    
    const resolvedRequestId = requestId || uuidv4().substring(0, 8).toUpperCase();

    const response = await this.request(endpoint, {
      ExamType: examType,
      PhoneNo: this.normalizeMobileNumber(phoneNo),
      RequestID: resolvedRequestId,
      CallBackURL: callBackURL || '',
    });

    return {
      success: response.statuscode === '100' || response.statuscode === '200',
      status: response.status || response.orderstatus,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: response.requestid || resolvedRequestId,
      cardDetails: response.carddetails,
      amountCharged: response.amountcharged,
      response,
    };
  }

  


  static async queryJAMBTransaction({ orderId = null, requestId = null }) {
    const endpoint = '/APIQueryV1.asp';
    
    const params = {};
    if (orderId) params.OrderID = orderId;
    if (requestId) params.RequestID = requestId;

    const response = await this.request(endpoint, params);
    
    return {
      orderId: response.orderid,
      requestId: response.requestid || requestId || null,
      status: response.status || response.orderstatus,
      statusCode: response.statuscode,
      remark: response.remark || response.orderremark,
      date: response.date || response.orderdate,
      cardDetails: response.carddetails,
      response,
    };
  }

  


  static async cancelJAMBTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: (response.status || response.orderstatus) === 'ORDER_CANCELLED',
      status: response.status || response.orderstatus,
      orderId: response.orderid,
      response,
    };
  }

  
  
  

  


  static isSuccess(statusCode) {
    return statusCode === '100' || statusCode === '200';
  }

  


  static canCancel(statusCode) {
    return statusCode === '100' || statusCode === 'ORDER_RECEIVED' || statusCode === 'ORDER_ONHOLD';
  }

  


  static getStatusMessage(statusCode) {
    const messages = {
      '100': 'Order Received - Processing',
      '200': 'Order Completed Successfully',
      '400': 'Bad Request',
      '401': 'Unauthorized',
      '404': 'Not Found',
      '500': 'Internal Server Error',
      'ORDER_RECEIVED': 'Order Received - Processing',
      'ORDER_COMPLETED': 'Order Completed Successfully',
      'ORDER_ONHOLD': 'Order On Hold',
      'ORDER_CANCELLED': 'Order Cancelled',
      'INVALID_CREDENTIALS': 'Invalid API Credentials',
      'MISSING_CREDENTIALS': 'Missing Credentials',
      'INVALID_DATAPLAN': 'Invalid Data Plan',
      'INVALID_RECIPIENT': 'Invalid Recipient Phone Number',
      'INSUFFICIENT_WALLET_BALANCE': 'Insufficient Wallet Balance',
    };
    return messages[statusCode] || 'Unknown Status';
  }
}

module.exports = NelloBytesService;
