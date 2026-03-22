/**
 * SMEPlug API Service
 * Documentation: https://smeplug.ng
 */

const axios = require('axios');
const logger = require('../utils/logger');

class SmePlugService {
  static baseUrl = 'https://smeplug.ng/api/v1';
  
  static getConfig() {
    return {
      baseUrl: process.env.SMEPLUG_BASE_URL || 'https://smeplug.ng/api/v1',
      apiKey: process.env.SMEPLUG_API_KEY || '',
      timeout: 45000,
    };
  }

  static getHeaders() {
    const config = this.getConfig();
    return {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  // Network ID mapping
  static networkMap = {
    mtn: '1',
    airtel: '2',
    '9mobile': '3',
    glo: '4',
  };

  static getNetworkId(network) {
    return this.networkMap[network.toLowerCase()] || network;
  }

  /**
   * Get Wallet Balance
   */
  static async getWalletBalance() {
    try {
      const response = await axios.get(
        `${this.getConfig().baseUrl}/account/balance`,
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      if (response.data && response.data.balance !== undefined) {
        return {
          success: true,
          balance: response.data.balance,
          currency: 'NGN',
        };
      }

      throw new Error('Failed to get wallet balance');
    } catch (error) {
      logger.error('SmePlug getWalletBalance error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Failed to get wallet balance');
    }
  }

  /**
   * Get Available Networks
   */
  static async getNetworks() {
    try {
      const response = await axios.get(
        `${this.getConfig().baseUrl}/networks`,
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      if (response.data?.status && response.data?.networks) {
        return {
          success: true,
          networks: response.data.networks,
        };
      }

      throw new Error('Failed to get networks');
    } catch (error) {
      logger.error('SmePlug getNetworks error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Failed to get networks');
    }
  }

  /**
   * Get Data Plans
   * @param {string} network - Network name (mtn, airtel, glo, 9mobile)
   */
  static async getDataPlans(network = null) {
    try {
      const networks = network ? [network.toLowerCase()] : ['mtn', 'airtel', 'glo', '9mobile'];
      const allPlans = {};

      for (const net of networks) {
        const networkId = this.getNetworkId(net);
        try {
          console.log(`Fetching SMEPlug data plans for ${net} (network_id: ${networkId})...`);
          const response = await axios.get(
            `${this.getConfig().baseUrl}/data/plans`,
            {
              params: { network_id: networkId },
              headers: this.getHeaders(),
              timeout: 30000,
            }
          );
          
          console.log(`SMEPlug response for ${net}:`, JSON.stringify(response.data));

          // Handle different response structures
          if (response.data?.status && response.data?.data) {
            let plansData = response.data.data;
            
            // If data is an object with a 'data' property that's an array
            if (plansData.data && Array.isArray(plansData.data)) {
              plansData = plansData.data;
            }
            
            // If data is still not an array, try to get the first key's value
            if (!Array.isArray(plansData)) {
              const firstKey = Object.keys(plansData)[0];
              if (firstKey && Array.isArray(plansData[firstKey])) {
                plansData = plansData[firstKey];
              }
            }
            
            if (Array.isArray(plansData)) {
              allPlans[net] = plansData.map(plan => ({
                id: plan.id || plan.plan_id || plan.product_id,
                planCode: plan.plan_id || plan.product_code,
                planName: plan.name || plan.product_name,
                size: plan.size || plan.data_size,
                price: plan.selling_price || plan.price || plan.amount,
                validity: plan.validity,
                network: net,
              }));
            }
          }
        } catch (err) {
          console.error(`SmePlug getDataPlans error for ${net}:`, err.response?.data || err.message);
          logger.warn(`SmePlug getDataPlans error for ${net}:`, err.response?.data || err.message);
        }
      }

      if (Object.keys(allPlans).length === 0) {
        throw new Error('Failed to get data plans from SMEPlug - no plans returned');
      }

      return {
        success: true,
        plans: allPlans,
      };
    } catch (error) {
      console.error('SmePlug getDataPlans error:', error.response?.data || error.message);
      logger.error('SmePlug getDataPlans error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Failed to get data plans');
    }
  }

  /**
   * Purchase Data
   * @param {Object} options - { phone, network, planId, customerReference, callbackUrl }
   */
  static async purchaseData(options) {
    const { phone, network, planId, customerReference, callbackUrl } = options;
    
    try {
      const networkId = this.getNetworkId(network);
      
      const requestBody = {
        network_id: networkId,
        phone,
        plan_id: planId,
        customer_reference: customerReference || '',
      };
      
      // Add callback URL if provided
      if (callbackUrl) {
        requestBody.callback_url = callbackUrl;
      }
      
      const response = await axios.post(
        `${this.getConfig().baseUrl}/data/purchase`,
        requestBody,
        {
          headers: this.getHeaders(),
          timeout: this.getConfig().timeout,
        }
      );

      if (response.data?.status) {
        return {
          success: true,
          reference: response.data?.data?.reference,
          message: response.data?.data?.msg || 'Data purchase successful',
          data: response.data?.data,
        };
      }

      throw new Error(response.data?.message || 'Data purchase failed');
    } catch (error) {
      logger.error('SmePlug purchaseData error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Data purchase failed');
    }
  }

  /**
   * Purchase Airtime
   * @param {Object} options - { phone, network, amount, customerReference, callbackUrl }
   */
  static async purchaseAirtime(options) {
    const { phone, network, amount, customerReference, callbackUrl } = options;
    
    try {
      const networkId = this.getNetworkId(network);
      
      const requestBody = {
        network_id: networkId,
        phone,
        amount: parseInt(amount),
        customer_reference: customerReference || '',
      };
      
      // Add callback URL if provided
      if (callbackUrl) {
        requestBody.callback_url = callbackUrl;
      }
      
      const response = await axios.post(
        `${this.getConfig().baseUrl}/airtime/purchase`,
        requestBody,
        {
          headers: this.getHeaders(),
          timeout: this.getConfig().timeout,
        }
      );

      if (response.data?.status) {
        return {
          success: true,
          reference: response.data?.data?.reference,
          message: response.data?.data?.msg || 'Airtime purchase successful',
          data: response.data?.data,
        };
      }

      throw new Error(response.data?.message || 'Airtime purchase failed');
    } catch (error) {
      logger.error('SmePlug purchaseAirtime error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Airtime purchase failed');
    }
  }

  /**
   * VTU Topup / Share & Sell
   * @param {Object} options - { phone, network, amount, customerReference }
   */
  static async vtuTopup(options) {
    const { phone, network, amount, customerReference } = options;
    
    try {
      const networkId = this.getNetworkId(network);
      
      const response = await axios.post(
        `${this.getConfig().baseUrl}/vtu/topup`,
        {
          network_id: networkId,
          phone,
          amount: parseInt(amount),
          customer_reference: customerReference || '',
        },
        {
          headers: this.getHeaders(),
          timeout: this.getConfig().timeout,
        }
      );

      if (response.data?.status) {
        return {
          success: true,
          reference: response.data?.data?.reference,
          message: response.data?.data?.msg || 'VTU topup successful',
          data: response.data?.data,
        };
      }

      throw new Error(response.data?.message || 'VTU topup failed');
    } catch (error) {
      logger.error('SmePlug vtuTopup error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'VTU topup failed');
    }
  }

  /**
   * Get Banks List
   */
  static async getBanks() {
    try {
      const response = await axios.get(
        `${this.getConfig().baseUrl}/transfer/banks`,
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      if (response.data?.status && response.data?.banks) {
        return {
          success: true,
          banks: response.data.banks,
        };
      }

      throw new Error('Failed to get banks');
    } catch (error) {
      logger.error('SmePlug getBanks error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Failed to get banks');
    }
  }

  /**
   * Resolve Account Details
   * @param {string} bankCode - Bank code
   * @param {string} accountNumber - Account number
   */
  static async resolveAccount(bankCode, accountNumber) {
    try {
      const response = await axios.post(
        `${this.getConfig().baseUrl}/transfer/resolve`,
        {
          bank_code: bankCode,
          account_number: accountNumber,
        },
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      if (response.data?.status) {
        return {
          success: true,
          data: response.data?.data,
        };
      }

      throw new Error(response.data?.message || 'Account resolution failed');
    } catch (error) {
      logger.error('SmePlug resolveAccount error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Account resolution failed');
    }
  }

  /**
   * Bank Transfer
   * @param {Object} options - { bankCode, accountNumber, amount, customerReference }
   */
  static async bankTransfer(options) {
    const { bankCode, accountNumber, amount, customerReference } = options;
    
    try {
      const response = await axios.post(
        `${this.getConfig().baseUrl}/transfer`,
        {
          bank_code: bankCode,
          account_number: accountNumber,
          amount: parseInt(amount),
          customer_reference: customerReference || '',
        },
        {
          headers: this.getHeaders(),
          timeout: this.getConfig().timeout,
        }
      );

      if (response.data?.status) {
        return {
          success: true,
          reference: response.data?.data?.reference,
          message: response.data?.data?.msg || 'Transfer successful',
          data: response.data?.data,
        };
      }

      throw new Error(response.data?.message || 'Transfer failed');
    } catch (error) {
      logger.error('SmePlug bankTransfer error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Transfer failed');
    }
  }

  /**
   * Get Transactions
   */
  static async getTransactions() {
    try {
      const response = await axios.get(
        `${this.getConfig().baseUrl}/transactions`,
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      if (response.data?.status) {
        return {
          success: true,
          transactions: response.data?.data || [],
        };
      }

      throw new Error('Failed to get transactions');
    } catch (error) {
      logger.error('SmePlug getTransactions error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Failed to get transactions');
    }
  }

  /**
   * Verify webhook payload
   */
  // static verifyCallback(payload) {
  //   if (payload?.transaction) {
  //     const tx = payload.transaction;
  //     return {
  //       reference: tx.reference,
  //       customerReference: tx.customer_reference,
  //       status: tx.status,
  //       type: tx.type,
  //       beneficiary: tx.beneficiary,
  //       amount: tx.price,
  //       message: tx.response,
  //     };
  //   }
  //   return null;
  // }

  static verifyCallback(payload) {
  if (payload?.transaction) {
    const tx = payload.transaction;
    return {
      reference: tx.reference,
      customerReference: tx.customer_reference,
      status: tx.status,
      type: tx.type,
      beneficiary: tx.beneficiary,
      amount: parseFloat(tx.price),
      message: tx.response,
    };
  }

  if (payload?.ref) {
    return {
      reference: payload.ref,
      customerReference: payload.customer_ref,
      status: payload.status,
      type: payload.type,
      beneficiary: payload.beneficiary,
      amount: parseFloat(payload.price),
      message: payload.response,
    };
  }

  return null;
}
}

module.exports = SmePlugService;
