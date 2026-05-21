const axios = require('axios');
const Transaction = require('../models/Transaction');
const ProviderStatus = require('../models/ProviderStatus');
const ServicePricing = require('../models/ServicePricing');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

class TelecomService {
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


  static async processDataRecharge(transaction) {
    const { service } = transaction;

    if (!service?.provider || !service?.phoneNumber || !service?.plan) {
      throw new AppError('Incomplete service data', 400);
    }

    try {
      const response = await axios.get(
        process.env.VTU_BASE_URL,
        {
          params: {
            token: process.env.VTU_API_TOKEN,
            network: service.provider.toUpperCase(),
            phone: service.phoneNumber,
            size: service.plan.toUpperCase()
          },
          timeout: 30000
        }
      );

      const apiResponse = response.data;


      if (
        apiResponse.status === 'success' ||
        apiResponse.Status === 'successful' ||
        apiResponse.response === 'success'
      ) {

        logger.info(`SMEData success → ${service.phoneNumber}`);

        return {
          success: true,
          message: 'Data purchase successful',
          provider: 'smedata',
          apiResponse
        };
      }

      throw new AppError(
        apiResponse.message || apiResponse.error || 'Data purchase failed',
        400
      );

    } catch (error) {

      logger.error('SMEData Error:', error.response?.data || error.message);

      throw new AppError(
        error.response?.data?.message ||
        error.message ||
        'SMEData request failed',
        error.response?.status || 503
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
      
      
      const currentProvider = transaction.provider?.name;
      const availableProviders = await this.getAvailableProviders(transaction.type, currentProvider);
      
      
      const triedProviders = transaction.metadata?.triedProviders || [];
      const nextProvider = availableProviders.find(p => !triedProviders.includes(p.providerName));
      
      if (!nextProvider) {
        throw new AppError('No more providers to try', 503);
      }
      
      
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

  
  static async bulkProcessTransactions(transactions, providerName) {
    const settled = await Promise.allSettled(
      transactions.map((transaction) => this.processWithProvider(transaction, providerName))
    );

    const results = [];
    const failed = [];

    settled.forEach((outcome, index) => {
      const transaction = transactions[index];
      if (outcome.status === 'fulfilled') {
        results.push({
          transactionId: transaction._id,
          reference: transaction.reference,
          status: 'success',
          result: outcome.value,
        });
      } else {
        failed.push({
          transactionId: transaction._id,
          reference: transaction.reference,
          status: 'failed',
          error: outcome.reason?.message || String(outcome.reason),
        });
      }
    });

    return {
      total: transactions.length,
      successful: results.length,
      failed: failed.length,
      results,
      failedTransactions: failed,
    };
  }
}

module.exports = TelecomService;