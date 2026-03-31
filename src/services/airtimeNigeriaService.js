/**
 * AirtimeNigeria.com API Service
 * Documentation: https://www.airtimenigeria.com
 */

const axios = require('axios');
const logger = require('../utils/logger');

class AirtimeNigeriaService {
  static normalizeNetwork(network = '') {
    const value = String(network).trim().toLowerCase();
    const aliases = {
      mtn: 'mtn',
      glo: 'glo',
      airtel: 'airtel',
      etisalat: '9mobile',
      '9mobile': '9mobile',
      m_9mobile: '9mobile',
    };
    return aliases[value] || value;
  }

  static inferDataType(label = '') {
    const normalized = String(label).toLowerCase();
    if (normalized.includes('awoof')) return 'awoof';
    if (normalized.includes('direct')) return 'direct';
    if (normalized.includes('sme')) return 'sme';
    if (normalized.includes('corporate')) return 'corporate';
    if (normalized.includes('night')) return 'night';
    if (normalized.includes('daily')) return 'daily';
    if (normalized.includes('weekly')) return 'weekly';
    if (normalized.includes('monthly')) return 'monthly';
    return 'other';
  }
  static baseUrl = 'https://www.airtimenigeria.com/api/v1';
  
  static getConfig() {
    return {
      baseUrl: process.env.AIRTIME_NIGERIA_BASE_URL || 'https://www.airtimenigeria.com/api/v1',
      apiKey: process.env.AIRTIME_NIGERIA_API_KEY || '',
      timeout: 45000,
    };
  }

  static getHeaders() {
    const config = this.getConfig();
    return {
      'Authorization': `Bearer ${config.apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /**
   * Purchase Airtime
   * @param {Object} options - { network, phone, amount, maxAmount, callbackUrl, customerReference }
   */
  static async purchaseAirtime(options) {
    const { network, phone, amount, maxAmount, callbackUrl, customerReference } = options;
    
    try {
      const response = await axios.post(
        `${this.getConfig().baseUrl}/airtime`,
        {
          network_operator: network,
          phone,
          amount,
          max_amount: maxAmount || amount,
          callback_url: callbackUrl || '',
          customer_reference: customerReference || '',
        },
        {
          headers: this.getHeaders(),
          timeout: this.getConfig().timeout,
        }
      );

      if (response.data.success) {
        return {
          success: true,
          reference: response.data.details?.reference,
          status: response.data.status,
          message: response.data.message,
          data: {
            package: response.data.details?.package,
            recipients: response.data.details?.recipients,
            airtimeAmount: response.data.details?.airtime_amount,
            totalCost: response.data.details?.total_cost,
            currency: response.data.details?.currency,
          },
        };
      }

      throw new Error(response.data.message || 'Airtime purchase failed');
    } catch (error) {
      logger.error('AirtimeNigeria purchaseAirtime error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Airtime purchase failed');
    }
  }

  /**
   * Purchase Data
   * @param {Object} options - { phone, packageCode, planId, variationCode, maxAmount, callbackUrl, customerReference }
   */
  static async purchaseData(options) {
    const { phone, packageCode, planId, variationCode, maxAmount, callbackUrl, customerReference } = options;
    
    try {
      const requestBody = {
        phone,
        max_amount: maxAmount || '99999',
        callback_url: callbackUrl || '',
        customer_reference: customerReference || '',
      };

      // Variation code is preferred for MTN SME plans.
      if (variationCode) {
        requestBody.variation_code = variationCode;
      } else if (packageCode) {
        requestBody.package_code = packageCode;
      } else if (planId) {
        requestBody.plan_id = planId;
      } else {
        throw new Error('Either variationCode, packageCode, or planId is required');
      }

      const response = await axios.post(
        `${this.getConfig().baseUrl}/data`,
        requestBody,
        {
          headers: this.getHeaders(),
          timeout: this.getConfig().timeout,
        }
      );

      if (response.data.success) {
        return {
          success: true,
          reference: response.data.details?.reference,
          status: response.data.status,
          message: response.data.message,
          data: {
            package: response.data.details?.package,
            recipients: response.data.details?.recipients,
            numberOfRecipients: response.data.details?.number_of_recipients,
            unitCost: response.data.details?.unit_cost,
            totalCost: response.data.details?.total_cost,
            currency: response.data.details?.currency,
          },
        };
      }

      throw new Error(response.data.message || 'Data purchase failed');
    } catch (error) {
      logger.error('AirtimeNigeria purchaseData error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Data purchase failed');
    }
  }

  /**
   * Purchase Data from Wallet (Bulk Data)
   * @param {Object} options - { phone, packageCode, planId, processType, callbackUrl, customerReference }
   */
  static async purchaseDataFromWallet(options) {
    const { phone, packageCode, planId, processType, callbackUrl, customerReference } = options;
    
    try {
      const requestBody = {
        phone,
        process_type: processType || 'queue',
        callback_url: callbackUrl || '',
        customer_reference: customerReference || '',
      };

      if (packageCode) {
        requestBody.package_code = packageCode;
      } else if (planId) {
        requestBody.plan_id = planId;
      } else {
        throw new Error('Either packageCode or planId is required');
      }

      const response = await axios.post(
        `${this.getConfig().baseUrl}/data/wallet`,
        requestBody,
        {
          headers: this.getHeaders(),
          timeout: this.getConfig().timeout,
        }
      );

      if (response.data.success) {
        return {
          success: true,
          reference: response.data.details?.reference,
          status: response.data.status,
          message: response.data.message,
          data: {
            package: response.data.details?.package,
            recipients: response.data.details?.recipients,
            gatewayResponse: response.data.details?.gateway_response,
            deliveryStatus: response.data.details?.delivery_status,
            totalCost: response.data.details?.total_cost,
            currency: response.data.details?.currency,
          },
        };
      }

      throw new Error(response.data.message || 'Data wallet purchase failed');
    } catch (error) {
      logger.error('AirtimeNigeria purchaseDataFromWallet error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Data wallet purchase failed');
    }
  }

  /**
   * Get Data Plans
   * @param {string} network - Optional network filter (mtn, airtel, glo, 9mobile)
   */
  static async getDataPlans(network = null) {
    try {
      const response = await axios.get(
        `${this.getConfig().baseUrl}/variations/data`,
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      if (response.data.success) {
        let plans = response.data.data || response.data.variations || response.data.details || [];
        if (!Array.isArray(plans) && Array.isArray(plans?.data)) {
          plans = plans.data;
        }
        if (!Array.isArray(plans)) {
          plans = Object.values(plans || {}).flat().filter(Boolean);
        }
        
        // Filter by network if specified
        if (network) {
          plans = plans.filter((plan) => {
            const planNetwork = this.normalizeNetwork(plan.network_operator || plan.network || plan.provider || '');
            return planNetwork === this.normalizeNetwork(network);
          });
        }

        // Group plans by network
        const groupedPlans = plans.reduce((acc, plan) => {
          const normalizedNetwork = this.normalizeNetwork(plan.network_operator || plan.network || plan.provider || '');
          if (!normalizedNetwork) {
            return acc;
          }

          if (!acc[normalizedNetwork]) {
            acc[normalizedNetwork] = [];
          }

          const planName = plan.plan_summary || plan.name || plan.package || plan.variation || '';
          const size = plan.size || plan.data_size || planName.split('|')[1] || plan.data_amount || '';
          const planType = plan.plan_type || plan.category || this.inferDataType(planName);

          acc[normalizedNetwork].push({
            planCode: plan.package_code || plan.plan_code || plan.variation_code,
            planId: plan.plan_id,
            variationCode: plan.variation_code || plan.package_code || plan.plan_code,
            planName,
            size,
            price: plan.agent_price || plan.price || plan.amount || 0,
            validity: plan.validity || plan.valid_for || '',
            currency: plan.currency,
            plan_type: planType,
            category: planType,
          });
          return acc;
        }, {});

        return {
          success: true,
          data: groupedPlans,
          rawData: plans,
        };
      }

      throw new Error(response.data.message || 'Failed to get data plans');
    } catch (error) {
      if (error.response?.status === 404) {
        return this.getLegacyDataPlans(network);
      }
      logger.error('AirtimeNigeria getDataPlans error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Failed to get data plans');
    }
  }

  static async getLegacyDataPlans(network = null) {
    const response = await axios.get(
      `${this.getConfig().baseUrl}/data/plans`,
      {
        headers: this.getHeaders(),
        timeout: 30000,
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to get data plans');
    }

    let plans = response.data.data || [];
    if (network) {
      plans = plans.filter(plan => this.normalizeNetwork(plan.network_operator) === this.normalizeNetwork(network));
    }

    const groupedPlans = plans.reduce((acc, plan) => {
      const normalizedNetwork = this.normalizeNetwork(plan.network_operator);
      if (!acc[normalizedNetwork]) {
        acc[normalizedNetwork] = [];
      }
      const planName = plan.plan_summary || '';
      const planType = plan.plan_type || plan.category || this.inferDataType(planName);
      acc[normalizedNetwork].push({
        planCode: plan.package_code,
        planId: plan.plan_id,
        variationCode: plan.variation_code || plan.package_code,
        planName,
        size: planName.split('|')[1] || '',
        price: plan.agent_price,
        validity: plan.validity,
        currency: plan.currency,
        plan_type: planType,
        category: planType,
      });
      return acc;
    }, {});

    return {
      success: true,
      data: groupedPlans,
      rawData: plans,
    };
  }

  /**
   * Get Wallet Balance
   */
  static async getWalletBalance() {
    try {
      const response = await axios.get(
        `${this.getConfig().baseUrl}/balance`,
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      if (response.data.success) {
        return {
          success: true,
          data: {
            universalWallet: response.data.universal_wallet?.balance || 0,
            smsWallet: response.data.sms_wallet?.balance || 0,
            mtnDataWallet: response.data.mtn_data_wallet?.balance || 0,
            airtelEdsWallet: response.data.airtel_eds_wallet?.balance || 0,
            gloCgWallet: response.data.glo_cg_wallet?.balance || 0,
          },
        };
      }

      throw new Error(response.data.message || 'Failed to get wallet balance');
    } catch (error) {
      logger.error('AirtimeNigeria getWalletBalance error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Failed to get wallet balance');
    }
  }

  /**
   * Verify webhook/callback payload
   */
  static verifyCallback(payload) {
    if (Array.isArray(payload) && payload.length > 0) {
      const transaction = payload[0];
      return {
        reference: transaction.reference,
        customerReference: transaction.customer_reference,
        recipient: transaction.recipient,
        status: transaction.delivery_status,
        message: transaction.gateway_response,
      };
    }

    if (payload && typeof payload === 'object') {
      const transaction = payload.data || payload.transaction || payload;
      return {
        reference: transaction.reference || transaction.id || transaction.order_id || null,
        customerReference: transaction.customer_reference || transaction.customerReference || null,
        recipient: transaction.recipient || transaction.phone || null,
        status: transaction.delivery_status || transaction.status || null,
        message: transaction.gateway_response || transaction.message || null,
      };
    }

    return null;
  }
}

module.exports = AirtimeNigeriaService;
