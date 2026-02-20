const axios = require('axios');
const Transaction = require('../models/Transaction');
const ProviderStatus = require('../models/ProviderStatus');
const ServicePricing = require('../models/ServicePricing');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

class TelecomService {
  static providerConfigs = {
    mtn: {
      name: 'MTN',
      baseUrl: 'https://api.mtnmock.com/v1',
      endpoints: {
        data: '/data/purchase',
        airtime: '/airtime/purchase',
        swap: '/airtime/swap',
        pin: '/recharge-pin/purchase',
        balance: '/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer MTN_MOCK_API_KEY',
      },
      timeout: 30000,
      retryCount: 3,
    },
    airtel: {
      name: 'Airtel',
      baseUrl: 'https://api.airtelmock.com/v1',
      endpoints: {
        data: '/data/request',
        airtime: '/topup',
        swap: '/convert',
        pin: '/pin/generate',
        balance: '/account/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'API-Key': 'AIRTEL_MOCK_API_KEY',
        'API-Secret': 'AIRTEL_MOCK_SECRET',
      },
      timeout: 25000,
      retryCount: 2,
    },
    glo: {
      name: 'Glo',
      baseUrl: 'https://api.glomock.com/api',
      endpoints: {
        data: '/services/data',
        airtime: '/services/airtime',
        swap: '/services/convert',
        pin: '/services/voucher',
        balance: '/account/balance',
      },
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'GLO_MOCK_API_KEY',
      },
      timeout: 35000,
      retryCount: 3,
    },
    '9mobile': {
      name: '9mobile',
      baseUrl: 'https://api.9mobilemock.com/v2',
      endpoints: {
        data: '/data/subscribe',
        airtime: '/recharge',
        swap: '/airtime-to-cash',
        pin: '/voucher',
        balance: '/wallet',
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic M0JZT0JLSFY1M0JYOFY1Mzo=',
      },
      timeout: 40000,
      retryCount: 2,
    },
  };

  static apiConfig = {
    baseUrl: process.env.VTU_BASE_URL,
    token: process.env.VTU_API_TOKEN,
    timeout: 30000,
  };

  static async processWithProvider(transaction, preferredProvider = null) {
    const { type, service } = transaction;

    const providerName = preferredProvider || service.provider;
    if (!providerName) throw new AppError('No provider specified', 400);

    const providers = await this.getAvailableProviders(type, providerName);
    if (!providers.length) throw new AppError('No available providers', 503);

    let lastError;

    for (const provider of providers) {
      try {
        let result;

        if (type === 'data_recharge') {
          result = await this.processDataRecharge(transaction, provider.providerName);
        } else if (type === 'sme_data') {
          result = await this.processSMEData(transaction, provider.providerName);
        } else {
          throw new AppError(`Unsupported service: ${type}`, 400);
        }

        await this.markProviderSuccess(provider.providerName);
        return result;

      } catch (err) {
        lastError = err;
        await this.markProviderFailure(provider.providerName);
        logger.error(`Provider ${provider.providerName} failed → ${err.message}`);
      }
    }

    throw new AppError(`All providers failed → ${lastError?.message}`, 503);
  }

  static async getAvailableProviders(serviceType, preferredProvider) {
    const providers = await ProviderStatus.find({
      supportedServices: serviceType,
      status: { $in: ['active', 'degraded'] },
    })
      .sort({ priority: 1, successRate: -1 })
      .lean();

    if (!preferredProvider) return providers;

    const preferred = providers.find(p => p.providerName === preferredProvider);
    return preferred
      ? [preferred, ...providers.filter(p => p.providerName !== preferredProvider)]
      : providers;
  }

  static http() {
    return axios.create({
      baseURL: this.apiConfig.baseUrl,
      timeout: this.apiConfig.timeout,
      headers: {
        Authorization: `Bearer ${this.apiConfig.token}`,
        'Content-Type': 'application/json',
      },
    });
  }


  static async processDataRecharge(transaction, providerName) {
    const { service, amount, reference } = transaction;

    try {
      const res = await this.http().post('/data', {
        phone: service.phoneNumber,
        network: providerName,
        plan: service.plan,
        amount,
        reference,
      });

      return {
        success: true,
        message: 'Data recharge successful',
        data: res.data,
        provider: providerName,
      };
    } catch (err) {
      throw new AppError(
        err.response?.data?.message || `Data purchase failed on ${providerName}`,
        err.response?.status || 503
      );
    }
  }

  static async processSMEData(transaction, providerName) {
    const { service, amount, reference } = transaction;

    try {
      const res = await this.http().post('/sme-data', {
        phone: service.phoneNumber,
        network: providerName,
        plan: service.plan,
        dataAmount: service.dataAmount,
        validity: service.validity,
        amount,
        reference,
      });

      return {
        success: true,
        message: 'SME data purchase successful',
        data: res.data,
        provider: providerName,
      };
    } catch (err) {
      throw new AppError(
        err.response?.data?.message || `SME data failed on ${providerName}`,
        err.response?.status || 503
      );
    }
  }


  static async markProviderSuccess(providerName) {
    await ProviderStatus.findOneAndUpdate(
      { providerName },
      { $inc: { successfulRequests: 1, totalRequests: 1 }, $set: { lastChecked: new Date() } }
    );
  }

  static async markProviderFailure(providerName) {
    await ProviderStatus.findOneAndUpdate(
      { providerName },
      { $inc: { failedRequests: 1, totalRequests: 1 }, $set: { lastChecked: new Date() } }
    );
  }


  static async retryFailedTransaction(transactionId) {
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) throw new AppError('Transaction not found', 404);
    if (transaction.status !== 'failed') throw new AppError('Transaction not failed', 400);

    return this.processWithProvider(transaction);
  }
}

  static async processAirtimeRecharge(transaction, providerName) {
    try {
      const { service } = transaction;
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      const mockResponse = {
        success: true,
        message: 'Airtime recharge successful',
        data: {
          transactionId: `AIR-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          phoneNumber: service.phoneNumber,
          network: service.provider.toUpperCase(),
          amount: transaction.amount,
          date: new Date().toISOString(),
          reference: `REF-${Date.now()}`,
          balance: Math.floor(Math.random() * 10000),
        },
        provider: providerName,
      };
      
      await this.simulateDelay(800, 2500);
      
      if (Math.random() < 0.05) {
        throw new AppError(`Provider ${providerName} temporary failure`, 503);
      }
      
      logger.info(`Airtime recharge successful: ${service.phoneNumber}, Amount: ${transaction.amount}, Provider: ${providerName}`);
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in processAirtimeRecharge:', error);
      throw error;
    }
  }

  static async processAirtimeSwap(transaction, providerName) {
    try {
      const { service, metadata } = transaction;
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      const mockResponse = {
        success: true,
        message: 'Airtime swap successful',
        data: {
          transactionId: `SWAP-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          phoneNumber: service.phoneNumber,
          network: service.provider.toUpperCase(),
          airtimeAmount: metadata.airtimeAmount,
          walletAmount: metadata.walletAmount,
          swapRate: metadata.swapRate,
          date: new Date().toISOString(),
          reference: `SWAP-REF-${Date.now()}`,
          confirmationCode: `SWAP${Math.floor(Math.random() * 1000000)}`,
        },
        provider: providerName,
      };
      
      await this.simulateDelay(1500, 4000);
      
      if (Math.random() < 0.15) {
        throw new AppError(`Provider ${providerName} swap service temporarily unavailable`, 503);
      }
      
      logger.info(`Airtime swap successful: ${service.phoneNumber}, Amount: ${metadata.airtimeAmount}, Provider: ${providerName}`);
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in processAirtimeSwap:', error);
      throw error;
    }
  }

  static async processRechargePin(transaction, providerName) {
    try {
      const { service, metadata } = transaction;
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      const pins = [];
      for (let i = 0; i < metadata.quantity; i++) {
        pins.push({
          pin: Math.floor(1000000000 + Math.random() * 9000000000).toString(),
          serial: `SN${Date.now()}${i}`.substring(0, 12),
          expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), 
        });
      }
      
      const mockResponse = {
        success: true,
        message: 'Recharge PINs generated successfully',
        data: {
          transactionId: `PIN-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          network: service.provider.toUpperCase(),
          pinType: service.plan,
          quantity: metadata.quantity,
          pins: pins,
          date: new Date().toISOString(),
          reference: `PIN-REF-${Date.now()}`,
        },
        provider: providerName,
      };
      
      await this.simulateDelay(2000, 5000);
      
      if (Math.random() < 0.08) {
        throw new AppError(`Provider ${providerName} PIN generation service temporarily unavailable`, 503);
      }
      
      logger.info(`Recharge PINs generated: ${service.provider}, Quantity: ${metadata.quantity}, Provider: ${providerName}`);
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in processRechargePin:', error);
      throw error;
    }
  }

  // Process SME/CG/Gifting data
  static async processSMEData(transaction, providerName) {
    try {
      const { service } = transaction;
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      // Mock API call to provider
      const mockResponse = {
        success: true,
        message: 'SME Data purchase successful',
        data: {
          transactionId: `SME-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          phoneNumber: service.phoneNumber,
          network: service.provider.toUpperCase(),
          plan: service.plan,
          dataAmount: service.dataAmount,
          validity: service.validity,
          amount: transaction.amount,
          date: new Date().toISOString(),
          token: Math.random().toString(36).substring(2, 15).toUpperCase(),
          reference: `SME-REF-${Date.now()}`,
        },
        provider: providerName,
      };
      
      // Simulate API delay
      await this.simulateDelay(1200, 3500);
      
      // Simulate occasional failure (12% chance for testing - SME data can be less reliable)
      if (Math.random() < 0.12) {
        throw new AppError(`Provider ${providerName} SME data service temporarily unavailable`, 503);
      }
      
      logger.info(`SME Data purchase successful: ${service.phoneNumber}, Plan: ${service.plan}, Provider: ${providerName}`);
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in processSMEData:', error);
      throw error;
    }
  }

  // Verify phone number with provider
  static async verifyPhoneNumber(phoneNumber, providerName) {
    try {
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      // Mock verification response
      const mockResponse = {
        success: true,
        data: {
          phoneNumber,
          network: providerName.toUpperCase(),
          status: 'active',
          name: 'JOHN DOE', // Mock name
          isVerified: true,
          canReceive: true,
        },
        provider: providerName,
      };
      
      // Simulate API delay
      await this.simulateDelay(500, 1500);
      
      // Simulate occasional failure (3% chance)
      if (Math.random() < 0.03) {
        throw new AppError(`Provider ${providerName} verification service temporarily unavailable`, 503);
      }
      
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in verifyPhoneNumber:', error);
      throw error;
    }
  }

  // Get provider balance
  static async getProviderBalance(providerName) {
    try {
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        throw new AppError(`Provider ${providerName} not configured`, 500);
      }
      
      // Mock balance response
      const mockResponse = {
        success: true,
        data: {
          provider: providerName,
          balance: Math.floor(Math.random() * 1000000), // Random balance
          currency: 'NGN',
          lastUpdated: new Date().toISOString(),
          status: 'active',
        },
      };
      
      // Simulate API delay
      await this.simulateDelay(300, 1000);
      
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in getProviderBalance:', error);
      throw error;
    }
  }

  // Check provider status
  static async checkProviderStatus(providerName) {
    try {
      const config = this.providerConfigs[providerName];
      
      if (!config) {
        return {
          provider: providerName,
          status: 'inactive',
          message: 'Provider not configured',
          lastChecked: new Date().toISOString(),
        };
      }
      
      // Mock status check
      const statuses = ['active', 'degraded', 'maintenance'];
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
      
      const mockResponse = {
        provider: providerName,
        status: randomStatus,
        message: randomStatus === 'active' ? 'Service is operational' : 
                 randomStatus === 'degraded' ? 'Service experiencing delays' : 
                 'Service under maintenance',
        responseTime: Math.floor(Math.random() * 500) + 50,
        lastChecked: new Date().toISOString(),
      };
      
      // Simulate API delay
      await this.simulateDelay(200, 800);
      
      // Update provider status in database
      await ProviderStatus.findOneAndUpdate(
        { providerName },
        {
          $set: {
            status: mockResponse.status,
            lastChecked: new Date(),
            averageResponseTime: mockResponse.responseTime,
          },
        },
        { upsert: true, new: true }
      );
      
      return mockResponse;
      
    } catch (error) {
      logger.error('Error in checkProviderStatus:', error);
      
      // Update provider as inactive on error
      await ProviderStatus.findOneAndUpdate(
        { providerName },
        {
          $set: {
            status: 'inactive',
            lastChecked: new Date(),
          },
        },
        { upsert: true }
      );
      
      return {
        provider: providerName,
        status: 'inactive',
        message: 'Error checking provider status',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  // Simulate API delay
  static simulateDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  // Retry failed transaction with fallback provider
  static async retryFailedTransaction(transactionId, retryCount = 0) {
    try {
      const transaction = await Transaction.findById(transactionId);
      
      if (!transaction) {
        throw new AppError('Transaction not found', 404);
      }
      
      if (transaction.status !== 'failed') {
        throw new AppError('Transaction is not in failed state', 400);
      }
      
      if (retryCount >= transaction.maxRetries) {
        throw new AppError('Max retry attempts reached', 400);
      }
      
      // Get next provider to try
      const currentProvider = transaction.provider?.name;
      const availableProviders = await this.getAvailableProviders(transaction.type, currentProvider);
      
      // Exclude already tried providers
      const triedProviders = transaction.metadata?.triedProviders || [];
      const nextProvider = availableProviders.find(p => !triedProviders.includes(p.providerName));
      
      if (!nextProvider) {
        throw new AppError('No more providers to try', 503);
      }
      
      // Update transaction with retry info
      transaction.retryCount += 1;
      transaction.provider = {
        name: nextProvider.providerName,
        alternate: currentProvider,
      };
      
      if (!transaction.metadata) transaction.metadata = {};
      if (!transaction.metadata.triedProviders) transaction.metadata.triedProviders = [];
      transaction.metadata.triedProviders.push(nextProvider.providerName);
      transaction.nextRetry = null;
      
      await transaction.save();
      
      // Retry the transaction
      const result = await this.processWithProvider(transaction, nextProvider.providerName);
      
      return {
        transaction,
        result,
        retryCount: transaction.retryCount,
      };
      
    } catch (error) {
      logger.error('Error in retryFailedTransaction:', error);
      throw error;
    }
  }

  // Bulk process transactions (for efficiency)
  static async bulkProcessTransactions(transactions, providerName) {
    try {
      const results = [];
      const failed = [];
      
      for (const transaction of transactions) {
        try {
          const result = await this.processWithProvider(transaction, providerName);
          results.push({
            transactionId: transaction._id,
            reference: transaction.reference,
            status: 'success',
            result,
          });
        } catch (error) {
          failed.push({
            transactionId: transaction._id,
            reference: transaction.reference,
            status: 'failed',
            error: error.message,
          });
        }
      }
      
      return {
        total: transactions.length,
        successful: results.length,
        failed: failed.length,
        results,
        failedTransactions: failed,
      };
      
    } catch (error) {
      logger.error('Error in bulkProcessTransactions:', error);
      throw error;
    }
  }
}

module.exports = TelecomService;