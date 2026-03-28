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
  };

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
    kaedc: '04',
    phedc: '05',
    jedc: '06',
    ibedc: '07',
    bedc: '08',
  };

  static meterTypes = {
    prepaid: '01',
    postpaid: '02',
  };

  static normalizeMobileNumber(phoneNumber) {
    if (!phoneNumber) {
      return '';
    }

    return String(phoneNumber)
      .trim()
      .replace(/^\+234/, '')
      .replace(/^234/, '')
      .replace(/^0/, '');
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

      logger.info(`NelloBytes API Response: ${endpoint}`, { response: response.data });
      return response.data;
    } catch (error) {
      logger.error(`NelloBytes API Error: ${endpoint}`, {
        message: error.message,
        response: error.response?.data,
      });
      throw new AppError(`NelloBytes API error: ${error.message}`, error.response?.status || 500);
    }
  }

  /**
   * Get wallet balance
   */
  static async getWalletBalance() {
    const endpoint = '/APIWalletBalanceV1.asp';
    const response = await this.request(endpoint);

    const balanceValue = Number(response?.balance ?? 0);

    return {
      success: true,
      id: response?.id || this.config.userId,
      phoneNumber: response?.phoneno || null,
      balance: Number.isNaN(balanceValue) ? 0 : balanceValue,
      currency: 'NGN',
      date: response?.date || null,
      raw: response,
    };
  }

  // ============================================
  // DATA BUNDLE API
  // ============================================

  /**
   * Get available data plans for a network
   * @param {string} network - mtn, glo, airtel, 9mobile
   */
  static async getDataPlans(network = null) {
    const endpoint = '/APIDatabundlePlansV2.asp';
    const response = await this.request(endpoint);
    
    if (network && this.networkCodes[network.toLowerCase()]) {
      const networkCode = this.networkCodes[network.toLowerCase()];
      return this.parseDataPlansResponse(response, networkCode);
    }
    
    return response;
  }

  /**
   * Parse data plans response
   */
  static parseDataPlansResponse(response, networkCode) {
    if (typeof response === 'string') {
      // Parse the response if it's a string
      const plans = {};
      const networks = ['MTN', 'GLO', 'AIRTEL', '9MOBILE'];
      
      networks.forEach(net => {
        plans[net.toLowerCase()] = [];
      });
      
      return plans;
    }
    return response;
  }

  /**
   * Purchase data bundle
   * @param {Object} options
   * @param {string} options.network - mtn, glo, airtel, 9mobile
   * @param {string} options.dataPlan - Data plan ID
   * @param {string} options.mobileNumber - Recipient phone number
   * @param {string} options.callBackURL - Callback URL for async response
   */
  static async purchaseData({ network, dataPlan, mobileNumber, callBackURL }) {
    const endpoint = '/APIDatabundleV1.asp';
    
    const networkCode = this.networkCodes[network.toLowerCase()];
    if (!networkCode) {
      throw new AppError('Invalid network. Use: mtn, glo, airtel, or 9mobile', 400);
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

  /**
   * Purchase airtime
   * @param {Object} options
   * @param {string} options.network - mtn, glo, airtel, 9mobile
   * @param {number|string} options.amount - Airtime amount
   * @param {string} options.mobileNumber - Recipient phone number
   * @param {string} options.requestId - Optional external request ID
   * @param {string} options.callBackURL - Callback URL
   * @param {string} options.bonusType - Optional promo/bonus code
   */
  static async purchaseAirtime({ network, amount, mobileNumber, requestId = null, callBackURL, bonusType = null }) {
    const endpoint = '/APIAirtimeV1.asp';
    const networkCode = this.networkCodes[network.toLowerCase()];

    if (!networkCode) {
      throw new AppError('Invalid network. Use: mtn, glo, airtel, or 9mobile', 400);
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
      success: response.statuscode === '100' || response.status === 'ORDER_RECEIVED',
      status: response.status,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: response.requestid || resolvedRequestId,
      response,
    };
  }

  /**
   * Query data transaction by OrderID or RequestID
   */
  static async queryDataTransaction({ orderId = null, requestId = null }) {
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

  static async queryAirtimeTransaction({ orderId = null, requestId = null }) {
    return this.queryDataTransaction({ orderId, requestId });
  }

  /**
   * Cancel data transaction (only if status is ORDER_RECEIVED or ORDER_ONHOLD)
   */
  static async cancelDataTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: response.status === 'ORDER_CANCELLED',
      status: response.status,
      orderId: response.orderid,
      response,
    };
  }

  static async cancelAirtimeTransaction(orderId) {
    return this.cancelDataTransaction(orderId);
  }

  // ============================================
  // CABLE TV SUBSCRIPTION API
  // ============================================

  /**
   * Get available cable TV packages
   * @param {string} cableTV - dstv, gotv, startimes
   */
  static async getCablePackages(cableTV = null) {
    const endpoint = '/APICableTVPackagesV2.asp';
    const response = await this.request(endpoint);
    
    if (cableTV && this.cableCodes[cableTV.toLowerCase()]) {
      // Filter packages by provider
      return this.parseCablePackages(response, cableTV.toLowerCase());
    }
    
    return response;
  }

  /**
   * Parse cable packages response
   */
  static parseCablePackages(response, cableTV) {
    if (typeof response === 'string') {
      return response;
    }
    return response;
  }

  /**
   * Verify smartcard/IUC number
   */
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

  /**
   * Purchase cable TV subscription
   */
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
      status: response.status,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: response.requestid || resolvedRequestId,
      response,
    };
  }

  /**
   * Query cable TV transaction
   */
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

  /**
   * Cancel cable TV transaction
   */
  static async cancelCableTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: response.status === 'ORDER_CANCELLED',
      status: response.status,
      orderId: response.orderid,
      response,
    };
  }

  // ============================================
  // ELECTRICITY BILL PAYMENT API
  // ============================================

  /**
   * Get available electricity disco companies
   */
  static async getElectricityDiscos() {
    const endpoint = '/APIElectricityDiscosV2.asp';
    const response = await this.request(endpoint);
    return response;
  }

  /**
   * Verify meter number
   */
  static async verifyElectricityMeter({ electricCompany, meterNo, meterType = 'prepaid' }) {
    const endpoint = '/APIVerifyElectricityV1.asp';
    
    const discoCode = this.electricityCodes[electricCompany.toLowerCase()];
    if (!discoCode) {
      throw new AppError('Invalid electricity company', 400);
    }

    const typeCode = this.meterTypes[meterType.toLowerCase()] || '01';

    const response = await this.request(endpoint, {
      ElectricCompany: discoCode,
      MeterNo: meterNo,
      MeterType: typeCode,
    });

    return {
      valid: response.customer_name && response.customer_name !== 'INVALID_METERNO',
      customerName: response.customer_name,
      response,
    };
  }

  /**
   * Pay electricity bill
   */
  static async payElectricityBill({ electricCompany, meterNo, meterType, amount, phoneNo, requestId = null, callBackURL }) {
    const endpoint = '/APIElectricityV1.asp';
    
    const discoCode = this.electricityCodes[electricCompany.toLowerCase()];
    if (!discoCode) {
      throw new AppError('Invalid electricity company', 400);
    }

    const typeCode = this.meterTypes[meterType.toLowerCase()] || '01';
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
      status: response.status,
      statusCode: response.statuscode,
      orderId: response.orderid,
      meterToken: response.metertoken,
      requestId: response.requestid || resolvedRequestId,
      response,
    };
  }

  /**
   * Query electricity transaction
   */
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

  /**
   * Cancel electricity transaction
   */
  static async cancelElectricityTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: response.status === 'ORDER_CANCELLED',
      status: response.status,
      orderId: response.orderid,
      response,
    };
  }

  // ============================================
  // AIRTIME RECHARGE PIN (EPIN) API
  // ============================================

  /**
   * Get available EPIN services and discounts
   */
  static async getEPINDiscount() {
    const endpoint = '/APIEPINDiscountV2.asp';
    const response = await this.request(endpoint);
    return response;
  }

  /**
   * Buy Airtime EPIN
   */
  static async buyEPIN({ mobileNetwork, value, quantity, requestId = null, callBackURL = null }) {
    const endpoint = '/APIEPINV1.asp';
    
    const networkCode = this.networkCodes[mobileNetwork.toLowerCase()];
    if (!networkCode) {
      throw new AppError('Invalid network. Use: mtn, glo, airtel, or 9mobile', 400);
    }

    // Validate value
    const allowedValues = ['100', '200', '500'];
    if (!allowedValues.includes(String(value))) {
      throw new AppError('Invalid value. Allowed: 100, 200, 500', 400);
    }

    // Validate quantity
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

  /**
   * Query EPIN transaction
   */
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

  // ============================================
  // WAEC e-PIN API
  // ============================================

  /**
   * Get available WAEC packages
   */
  static async getWAECPackages() {
    const endpoint = '/APIWAECPackagesV2.asp';
    const response = await this.request(endpoint);
    return response;
  }

  /**
   * Buy WAEC e-PIN
   * @param {Object} options
   * @param {string} options.examType - waecdirect, waec-registration
   * @param {string} options.phoneNo - Recipient phone number
   * @param {string} options.callBackURL - Callback URL
   */
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
      success: response.statuscode === '200',
      status: response.status,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: response.requestid || resolvedRequestId,
      cardDetails: response.carddetails,
      amountCharged: response.amountcharged,
      response,
    };
  }

  /**
   * Query WAEC transaction
   */
  static async queryWAECTransaction({ orderId = null, requestId = null }) {
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
      cardDetails: response.carddetails,
      response,
    };
  }

  /**
   * Cancel WAEC transaction
   */
  static async cancelWAECTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: response.status === 'ORDER_CANCELLED',
      status: response.status,
      orderId: response.orderid,
      response,
    };
  }

  // ============================================
  // JAMB e-PIN API
  // ============================================

  /**
   * Get available JAMB packages
   */
  static async getJAMBPackages() {
    const endpoint = '/APIJAMBPackagesV2.asp';
    const response = await this.request(endpoint);
    return response;
  }

  /**
   * Verify JAMB Profile ID
   */
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

  /**
   * Buy JAMB e-PIN
   */
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
      success: response.statuscode === '200',
      status: response.status,
      statusCode: response.statuscode,
      orderId: response.orderid,
      requestId: response.requestid || resolvedRequestId,
      cardDetails: response.carddetails,
      amountCharged: response.amountcharged,
      response,
    };
  }

  /**
   * Query JAMB transaction
   */
  static async queryJAMBTransaction({ orderId = null, requestId = null }) {
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
      cardDetails: response.carddetails,
      response,
    };
  }

  /**
   * Cancel JAMB transaction
   */
  static async cancelJAMBTransaction(orderId) {
    const endpoint = '/APICancelV1.asp';
    
    const response = await this.request(endpoint, { OrderID: orderId });
    
    return {
      success: response.status === 'ORDER_CANCELLED',
      status: response.status,
      orderId: response.orderid,
      response,
    };
  }

  // ============================================
  // STATUS CODE HELPERS
  // ============================================

  /**
   * Check if status indicates success
   */
  static isSuccess(statusCode) {
    return statusCode === '100' || statusCode === '200';
  }

  /**
   * Check if status indicates order received (can be cancelled)
   */
  static canCancel(statusCode) {
    return statusCode === '100' || statusCode === 'ORDER_RECEIVED' || statusCode === 'ORDER_ONHOLD';
  }

  /**
   * Get human-readable status message
   */
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
