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
   * Purchase Data
   * @param {Object} options - { phone, network, planId, customerReference }
   */
  static async purchaseData(options) {
    const { phone, network, planId, customerReference } = options;
    
    try {
      const networkId = this.getNetworkId(network);
      
      const response = await axios.post(
        `${this.getConfig().baseUrl}/data/purchase`,
        {
          network_id: networkId,
          phone,
          plan_id: planId,
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
   * @param {Object} options - { phone, network, amount, customerReference }
   */
  static async purchaseAirtime(options) {
    const { phone, network, amount, customerReference } = options;
    
    try {
      const networkId = this.getNetworkId(network);
      
      const response = await axios.post(
        `${this.getConfig().baseUrl}/airtime/purchase`,
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
  static verifyCallback(payload) {
    if (payload?.transaction) {
      const tx = payload.transaction;
      return {
        reference: tx.reference,
        customerReference: tx.customer_reference,
        status: tx.status,
        type: tx.type,
        beneficiary: tx.beneficiary,
        amount: tx.price,
        message: tx.response,
      };
    }
    return null;
  }
}

module.exports = SmePlugService;
