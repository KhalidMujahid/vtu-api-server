/**
 * VTU Provider Service
 * Handles multi-provider routing, failover, and health checks
 */

const axios = require('axios');
const ProviderStatus = require('../models/ProviderStatus');
const vtuConfig = require('../config/vtuProviders');
const logger = require('../utils/logger');
const AirtimeNigeriaService = require('./airtimeNigeriaService');
const SmePlugService = require('./smePlugService');
const NelloBytesService = require('./nelloBytesService');
const PluginngService = require('./pluginngService');

class VtuProviderService {
  static AUTO_FAILOVER_THRESHOLD = 40;
  
  /**
   * Get all configured providers
   */
  static getAllProviders() {
    return Object.values(vtuConfig.providers);
  }

  /**
   * Get provider by ID
   */
  static getProvider(providerId) {
    return vtuConfig.providers[providerId] || null;
  }

  /**
   * Get provider status from database
   */
  static async getProviderStatus(providerId) {
    const provider = vtuConfig.providers[providerId];
    if (!provider) {
      return { providerId, status: 'unknown', message: 'Provider not configured' };
    }

    try {
      const [dbStatus, balance] = await Promise.all([
        ProviderStatus.findOne({ providerName: providerId }),
        this.getProviderBalance(providerId),
      ]);
      
      return {
        providerId,
        providerName: provider.name,
        displayName: provider.displayName,
        status: dbStatus?.status || 'active',
        isDefault: provider.isDefault,
        priority: provider.priority,
        supportedServices: provider.supportedServices,
        supportedNetworks: provider.supportedNetworks,
        uptime: dbStatus?.uptime || 99.9,
        successRate: dbStatus?.successRate || 100,
        averageResponseTime: dbStatus?.averageResponseTime || 0,
        totalRequests: dbStatus?.totalRequests || 0,
        lastChecked: dbStatus?.lastChecked || new Date(),
        color: provider.color,
        icon: provider.icon,
        features: provider.features,
        balance,
      };
    } catch (error) {
      logger.error(`Error getting provider status for ${providerId}:`, error);
      return {
        providerId,
        providerName: provider.name,
        status: 'active',
        isDefault: provider.isDefault,
        priority: provider.priority,
        color: provider.color,
        balance: {
          providerId,
          providerName: provider.name,
          available: false,
          balance: null,
          currency: 'NGN',
          message: error.message || 'Unable to fetch provider balance',
          lastUpdated: new Date(),
        },
      };
    }
  }

  /**
   * Get all providers with their statuses
   */
  static async getAllProvidersWithStatus() {
    const providers = this.getAllProviders();
    const statuses = await Promise.all(
      providers.map(p => this.getProviderStatus(p.id))
    );
    return statuses;
  }

  /**
   * Get primary provider (default or first active)
   */
  static async getPrimaryProvider() {
    const dbProvider = await ProviderStatus.findOne({ isDefault: true, status: 'active' });
    if (dbProvider && vtuConfig.providers[dbProvider.providerName]) {
      return vtuConfig.providers[dbProvider.providerName];
    }
    
    // Return config default
    const defaultId = vtuConfig.defaults.primaryProvider;
    return vtuConfig.providers[defaultId] || Object.values(vtuConfig.providers)[0];
  }

  /**
   * Set primary provider
   */
  static async setPrimaryProvider(providerId) {
    const provider = vtuConfig.providers[providerId];
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    // Update all providers to non-default
    await ProviderStatus.updateMany({}, { isDefault: false });

    // Set the selected provider as default in database
    await ProviderStatus.findOneAndUpdate(
      { providerName: providerId },
      { 
        providerName: providerId,
        isDefault: true,
        status: 'active',
        supportedServices: provider.supportedServices,
      },
      { upsert: true, new: true }
    );

    logger.info(`Primary VTU provider switched to: ${provider.name}`);
    
    return {
      success: true,
      message: `Primary VTU provider switched to ${provider.name}`,
      provider: {
        id: provider.id,
        name: provider.name,
        displayName: provider.displayName,
      }
    };
  }

  /**
   * Get providers for a specific network (with fallback order)
   */
  static getProvidersForNetwork(network) {
    const networkProviders = vtuConfig.networkProviders[network.toLowerCase()];
    if (!networkProviders) {
      return [];
    }
    return networkProviders
      .map(id => vtuConfig.providers[id])
      .filter(p => p && p.status === 'active');
  }

  /**
   * Get providers for a specific service type
   */
  static getProvidersForService(serviceType) {
    return Object.values(vtuConfig.providers)
      .filter(p => p.supportedServices.includes(serviceType) && p.status === 'active')
      .sort((a, b) => a.priority - b.priority);
  }

  static async getHealthyProvidersForService(serviceType) {
    const providers = this.getProvidersForService(serviceType);
    if (!providers.length) return [];

    const providerIds = providers.map(p => p.id);
    const statuses = await ProviderStatus.find({
      providerName: { $in: providerIds },
      status: { $in: ['active', 'degraded'] },
    }).lean();

    const statusMap = new Map(statuses.map(s => [s.providerName, s]));

    const healthy = providers.filter(provider => {
      const db = statusMap.get(provider.id);
      const rate = typeof db?.successRate === 'number' ? db.successRate : 100;
      return rate >= this.AUTO_FAILOVER_THRESHOLD;
    });

    return healthy.length ? healthy : providers;
  }

  static async autoSwitchProviderIfNeeded(providerId) {
    const affected = await ProviderStatus.findOne({ providerName: providerId });
    if (!affected) return;

    if (Number(affected.successRate || 0) >= this.AUTO_FAILOVER_THRESHOLD) return;

    const candidate = await ProviderStatus.findOne({
      providerName: { $ne: providerId },
      status: 'active',
      successRate: { $gte: this.AUTO_FAILOVER_THRESHOLD },
    }).sort({ successRate: -1, priority: 1 });

    if (!candidate) return;

    const currentPrimary = await ProviderStatus.findOne({ isDefault: true });
    if (currentPrimary?.providerName === candidate.providerName) return;

    await ProviderStatus.updateMany({}, { isDefault: false });
    candidate.isDefault = true;
    await candidate.save();

    logger.warn(
      `Auto failover triggered: switched primary provider from ${providerId} to ${candidate.providerName} (threshold ${this.AUTO_FAILOVER_THRESHOLD}%)`
    );
  }

  /**
   * Health check for a single provider
   */
  static async healthCheck(providerId) {
    const provider = vtuConfig.providers[providerId];
    if (!provider) {
      return {
        providerId,
        status: 'unknown',
        message: 'Provider not configured',
        responseTime: 0,
      };
    }

    const startTime = Date.now();
    
    try {
      // Make a test request to provider's health endpoint
      const response = await axios.get(provider.baseUrl + '/health', {
        timeout: provider.timeout,
        validateStatus: () => true, // Accept any status
      });

      const responseTime = Date.now() - startTime;
      
      // Determine status based on response
      let status = 'active';
      let message = 'Service is operational';

      if (response.status >= 500) {
        status = 'down';
        message = 'Service is down';
      } else if (response.status >= 400) {
        status = 'degraded';
        message = 'Service experiencing issues';
      } else if (responseTime > provider.timeout) {
        status = 'degraded';
        message = 'Service is slow';
      }

      // Update provider status in database
      await ProviderStatus.findOneAndUpdate(
        { providerName: providerId },
        {
          $set: {
            status,
            lastChecked: new Date(),
            averageResponseTime: responseTime,
            successRate: status === 'active' ? 100 : 50,
          },
          $inc: { totalRequests: 1 }
        },
        { upsert: true }
      );

      return {
        providerId,
        providerName: provider.name,
        status,
        message,
        responseTime,
        lastChecked: new Date(),
        color: provider.color,
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Update provider status in database
      await ProviderStatus.findOneAndUpdate(
        { providerName: providerId },
        {
          $set: {
            status: 'down',
            lastChecked: new Date(),
            averageResponseTime: responseTime,
          },
          $inc: { totalRequests: 1, failedRequests: 1 }
        },
        { upsert: true }
      );

      return {
        providerId,
        providerName: provider.name,
        status: 'down',
        message: error.message || 'Health check failed',
        responseTime,
        lastChecked: new Date(),
        color: provider.color,
      };
    }
  }

  /**
   * Run health check on all providers
   */
  static async runAllHealthChecks() {
    const providers = this.getAllProviders();
    const results = await Promise.all(
      providers.map(p => this.healthCheck(p.id))
    );
    return results;
  }

  /**
   * Process transaction with provider failover
   */
  static async processWithFailover(transaction, serviceType, network) {
    const providers = await this.getHealthyProvidersForService(serviceType);
    
    if (!providers.length) {
      throw new Error(`No providers available for service: ${serviceType}`);
    }

    let lastError;
    
    for (const provider of providers) {
      try {
        // Attempt to process with this provider
        const result = await this.processTransaction(transaction, provider.id, serviceType);
        
        // Mark provider success
        await this.markProviderSuccess(provider.id);
        
        return {
          ...result,
          provider: provider.id,
          providerName: provider.name,
        };
        
      } catch (error) {
        lastError = error;
        await this.markProviderFailure(provider.id);
        logger.warn(`Provider ${provider.id} failed for ${serviceType}:`, error.message);
      }
    }

    throw new Error(`All providers failed. Last error: ${lastError?.message}`);
  }

  /**
   * Process transaction with a specific provider
   */
  static async processTransaction(transaction, providerId, serviceType) {
    const provider = vtuConfig.providers[providerId];
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const serviceConfig = vtuConfig.serviceTypes[serviceType];
    if (!serviceConfig) {
      throw new Error(`Service type ${serviceType} not supported`);
    }

    try {
      const response = await axios({
        method: serviceConfig.method,
        url: provider.baseUrl + serviceConfig.endpoint,
        data: transaction.service,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
          'X-API-Key': provider.apiKey,
        },
        timeout: provider.timeout,
      });

      return {
        success: true,
        data: response.data,
        provider: providerId,
      };
      
    } catch (error) {
      logger.error(`Provider ${providerId} transaction error:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Mark provider success
   */
  static async markProviderSuccess(providerId) {
    const provider = await ProviderStatus.findOneAndUpdate(
      { providerName: providerId },
      {
        $inc: { successfulRequests: 1, totalRequests: 1 },
        $setOnInsert: { providerName: providerId, status: 'active' },
        $set: { lastChecked: new Date() },
      },
      { upsert: true, new: true }
    );

    if (provider.totalRequests > 0) {
      provider.successRate = (provider.successfulRequests / provider.totalRequests) * 100;
      await provider.save();
    }
  }

  /**
   * Mark provider failure
   */
  static async markProviderFailure(providerId) {
    const provider = await ProviderStatus.findOneAndUpdate(
      { providerName: providerId },
      {
        $inc: { failedRequests: 1, totalRequests: 1 },
        $setOnInsert: { providerName: providerId, status: 'active' },
        $set: { lastChecked: new Date() },
      },
      { upsert: true, new: true }
    );

    if (provider.totalRequests > 0) {
      provider.successRate = (provider.successfulRequests / provider.totalRequests) * 100;
      await provider.save();
      await this.autoSwitchProviderIfNeeded(providerId);
    }
  }

  /**
   * Get provider balance (mock for now - actual implementation would call provider API)
   */
  static async getProviderBalance(providerId) {
    const provider = vtuConfig.providers[providerId];
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    try {
      switch (provider.source) {
        case 'airtimenigeria': {
          const result = await AirtimeNigeriaService.getWalletBalance();
          const wallets = result?.data || {};
          const primaryBalance =
            Number(wallets.universalWallet) ||
            Number(wallets.mtnDataWallet) ||
            Number(wallets.airtelEdsWallet) ||
            Number(wallets.gloCgWallet) ||
            Number(wallets.smsWallet) ||
            0;

          return {
            providerId,
            providerName: provider.name,
            available: true,
            balance: primaryBalance,
            currency: 'NGN',
            breakdown: wallets,
            lastUpdated: new Date(),
          };
        }

        case 'smeplug': {
          const result = await SmePlugService.getWalletBalance();
          return {
            providerId,
            providerName: provider.name,
            available: true,
            balance: Number(result?.balance || 0),
            currency: result?.currency || 'NGN',
            raw: result,
            lastUpdated: new Date(),
          };
        }

        case 'nellobytes':
        case 'clubkonnect': {
          const result = await NelloBytesService.getWalletBalance();
          return {
            providerId,
            providerName: provider.name,
            available: true,
            balance: Number(result?.balance || 0),
            currency: result?.currency || 'NGN',
            accountId: result?.id || null,
            phoneNumber: result?.phoneNumber || null,
            raw: result?.raw || result,
            lastUpdated: new Date(),
          };
        }

        case 'pluginng': {
          const result = await PluginngService.getWalletBalance();
          return {
            providerId,
            providerName: provider.name,
            available: true,
            balance: Number(result?.balance || 0),
            currency: result?.currency || 'NGN',
            raw: result?.raw || result,
            lastUpdated: new Date(),
          };
        }

        default:
          return {
            providerId,
            providerName: provider.name,
            available: false,
            balance: null,
            currency: 'NGN',
            message: 'Balance endpoint is not implemented for this provider yet',
            lastUpdated: new Date(),
          };
      }
    } catch (error) {
      logger.warn(`Unable to fetch balance for provider ${providerId}: ${error.message}`);
      return {
        providerId,
        providerName: provider.name,
        available: false,
        balance: null,
        currency: 'NGN',
        message: error.message || 'Failed to fetch provider balance',
        lastUpdated: new Date(),
      };
    }
  }

  /**
   * Get all provider balances
   */
  static async getAllProviderBalances() {
    const providers = this.getAllProviders();
    return Promise.all(
      providers.map(p => this.getProviderBalance(p.id))
    );
  }

  /**
   * Get provider for specific service
   */
  static getProviderForService(serviceType) {
    const service = vtuConfig.billPaymentServices?.[serviceType];
    if (!service) {
      return Object.values(vtuConfig.providers).find(p => p.isDefault) || Object.values(vtuConfig.providers)[0];
    }
    return vtuConfig.providers[service.defaultProvider];
  }

  /**
   * Set provider for specific service (bill payment)
   */
  static async setProviderForService(serviceType, providerId) {
    const service = vtuConfig.billPaymentServices?.[serviceType];
    if (!service) {
      throw new Error(`Service type ${serviceType} not configurable`);
    }

    const provider = vtuConfig.providers[providerId];
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    if (!provider.supportedServices.includes(serviceType)) {
      throw new Error(`Provider ${providerId} does not support ${serviceType}`);
    }

    // Update the default provider for this service
    service.defaultProvider = providerId;

    logger.info(`Default provider for ${serviceType} switched to: ${provider.name}`);

    return {
      success: true,
      message: `Default provider for ${serviceType} switched to ${provider.name}`,
      serviceType,
      provider: {
        id: provider.id,
        name: provider.name,
      }
    };
  }

  /**
   * Get provider for bill payment service
   */
  static async getProviderForBillPayment(serviceType) {
    return this.getProviderForService(serviceType);
  }

  /**
   * Initialize providers in database
   */
  static async initializeProviders() {
    const providers = this.getAllProviders();
    
    for (const provider of providers) {
      await ProviderStatus.findOneAndUpdate(
        { providerName: provider.id },
        {
          providerName: provider.id,
          supportedServices: provider.supportedServices,
          status: provider.status,
          priority: provider.priority,
          isDefault: provider.isDefault,
          description: provider.description,
        },
        { upsert: true, new: true }
      );
    }
    
    logger.info('VTU Providers initialized');
  }
}

module.exports = VtuProviderService;
