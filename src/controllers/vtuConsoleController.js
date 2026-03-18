/**
 * VTU API Console Controller
 * Handles provider switching, health checks, and configuration
 */

const VtuProviderService = require('../services/vtuProviderService');
const ProviderStatus = require('../models/ProviderStatus');
const logger = require('../utils/logger');

/**
 * Get all VTU providers with their status
 */
exports.getAllProviders = async (req, res, next) => {
  try {
    const providers = await VtuProviderService.getAllProvidersWithStatus();
    
    res.status(200).json({
      status: 'success',
      results: providers.length,
      data: {
        providers,
        primaryProvider: providers.find(p => p.isDefault)?.providerId || 'clubkonnect',
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get provider details by ID
 */
exports.getProvider = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const provider = await VtuProviderService.getProviderStatus(providerId);
    
    if (!provider) {
      return res.status(404).json({
        status: 'error',
        message: 'Provider not found'
      });
    }
    
    res.status(200).json({
      status: 'success',
      data: provider
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Switch primary VTU provider
 */
exports.switchProvider = async (req, res, next) => {
  try {
    const { providerId } = req.body;
    
    if (!providerId) {
      return res.status(400).json({
        status: 'error',
        message: 'Provider ID is required'
      });
    }
    
    const result = await VtuProviderService.setPrimaryProvider(providerId);
    
    // Log the switch
    logger.info(`Provider switched to ${providerId} by user: ${req.user?.id || 'system'}`);
    
    res.status(200).json({
      status: 'success',
      message: result.message,
      data: result.provider
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Run health check on all providers
 */
exports.runHealthCheck = async (req, res, next) => {
  try {
    const results = await VtuProviderService.runAllHealthChecks();
    
    res.status(200).json({
      status: 'success',
      message: 'Health check completed',
      data: {
        results,
        timestamp: new Date(),
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Run health check on a single provider
 */
exports.runProviderHealthCheck = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const result = await VtuProviderService.healthCheck(providerId);
    
    res.status(200).json({
      status: 'success',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get provider balances
 */
exports.getProviderBalances = async (req, res, next) => {
  try {
    const balances = await VtuProviderService.getAllProviderBalances();
    
    res.status(200).json({
      status: 'success',
      data: {
        balances,
        timestamp: new Date(),
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get provider balance by ID
 */
exports.getProviderBalance = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const balance = await VtuProviderService.getProviderBalance(providerId);
    
    res.status(200).json({
      status: 'success',
      data: balance
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get provider configuration (public info only)
 */
exports.getProviderConfig = async (req, res, next) => {
  try {
    const providers = VtuProviderService.getAllProviders();
    const vtuConfig = require('../config/vtuProviders');
    
    // Get service routing configuration
    const serviceRouting = vtuConfig.getServiceRouting();
    
    // Return only public configuration (no API keys)
    const publicConfig = providers.map(p => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      color: p.color,
      icon: p.icon,
      supportedServices: p.supportedServices,
      supportedNetworks: p.supportedNetworks,
      features: p.features,
      rateLimit: p.rateLimit,
    }));
    
    res.status(200).json({
      status: 'success',
      data: {
        providers: publicConfig,
        serviceRouting,
        defaults: {
          primaryProvider: 'clubkonnect',
          failoverEnabled: true,
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Save service provider configuration
 */
exports.saveServiceConfig = async (req, res, next) => {
  try {
    const { data, airtime, airtimepin, education, electricity, cable, airtime2cash } = req.body;
    
    const vtuConfig = require('../config/vtuProviders');
    
    // Build configuration object
    const config = {};
    if (data) config.data = data;
    if (airtime) config.airtime = airtime;
    if (airtimepin) config.airtimepin = airtimepin;
    if (education) config.education = education;
    if (electricity) config.electricity = electricity;
    if (cable) config.cable = cable;
    if (airtime2cash) config.airtime2cash = airtime2cash;
    
    // Update the service routing
    const updatedRouting = vtuConfig.updateServiceRouting(config);
    
    logger.info(`Service configuration updated by user: ${req.user?.id || 'system'}`, config);
    
    res.status(200).json({
      status: 'success',
      message: 'Service provider configuration saved successfully',
      data: {
        serviceRouting: updatedRouting
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update provider status (activate/deactivate)
 */
exports.updateProviderStatus = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const { status, isDefault } = req.body;
    
    const allowedStatuses = ['active', 'inactive', 'maintenance', 'degraded'];
    
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`
      });
    }
    
    const updateData = {};
    if (status) updateData.status = status;
    if (isDefault !== undefined) {
      if (isDefault) {
        // Reset all other providers to non-default
        await ProviderStatus.updateMany({}, { isDefault: false });
      }
      updateData.isDefault = isDefault;
    }
    
    const updated = await ProviderStatus.findOneAndUpdate(
      { providerName: providerId },
      { $set: updateData },
      { new: true, upsert: true }
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Provider status updated',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get provider statistics
 */
exports.getProviderStats = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    
    const stats = await ProviderStatus.findOne({ providerName: providerId });
    
    if (!stats) {
      return res.status(404).json({
        status: 'error',
        message: 'Provider statistics not found'
      });
    }
    
    res.status(200).json({
      status: 'success',
      data: {
        providerId,
        providerName: stats.providerName,
        totalRequests: stats.totalRequests,
        successfulRequests: stats.successfulRequests,
        failedRequests: stats.failedRequests,
        successRate: stats.successRate,
        uptime: stats.uptime,
        averageResponseTime: stats.averageResponseTime,
        lastChecked: stats.lastChecked,
        status: stats.status,
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get API logs (mock - in production would aggregate from actual logs)
 */
exports.getApiLogs = async (req, res, next) => {
  try {
    const { provider, limit = 20 } = req.query;
    
    // Mock API logs - in production, this would fetch from logs database
    const mockLogs = [
      { timestamp: new Date(), provider: 'clubkonnect', endpoint: '/v1/mtn/data', status: 'success', duration: 87 },
      { timestamp: new Date(Date.now() - 180000), provider: 'airtimenigeria', endpoint: '/api/airtime', status: 'success', duration: 124 },
      { timestamp: new Date(Date.now() - 480000), provider: 'smeplug', endpoint: '/v2/electricity', status: 'pending', duration: 312 },
      { timestamp: new Date(Date.now() - 900000), provider: 'clubkonnect', endpoint: '/v1/glo/data', status: 'success', duration: 91 },
      { timestamp: new Date(Date.now() - 1200000), provider: 'airtimenigeria', endpoint: '/api/data', status: 'success', duration: 156 },
      { timestamp: new Date(Date.now() - 1800000), provider: 'smeplug', endpoint: '/v2/cable', status: 'failed', duration: 45 },
      { timestamp: new Date(Date.now() - 2400000), provider: 'clubkonnect', endpoint: '/v1/mtn/airtime', status: 'success', duration: 78 },
      { timestamp: new Date(Date.now() - 3000000), provider: 'airtimenigeria', endpoint: '/api/sme', status: 'success', duration: 203 },
    ];
    
    let logs = mockLogs;
    if (provider) {
      logs = logs.filter(l => l.provider === provider);
    }
    
    res.status(200).json({
      status: 'success',
      results: logs.length,
      data: {
        logs: logs.slice(0, parseInt(limit)),
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Initialize providers in database
 */
exports.initializeProviders = async (req, res, next) => {
  try {
    await VtuProviderService.initializeProviders();
    
    res.status(200).json({
      status: 'success',
      message: 'Providers initialized successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Switch provider for bill payment service (electricity, cable TV)
 */
exports.switchBillPaymentProvider = async (req, res, next) => {
  try {
    const { serviceType, providerId } = req.body;
    
    const allowedServices = ['electricity', 'cable_tv'];
    
    if (!serviceType || !providerId) {
      return res.status(400).json({
        status: 'error',
        message: 'serviceType and providerId are required'
      });
    }
    
    if (!allowedServices.includes(serviceType)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid service type. Allowed: ${allowedServices.join(', ')}`
      });
    }
    
    const result = await VtuProviderService.setProviderForService(serviceType, providerId);
    
    logger.info(`Bill payment provider switched: ${serviceType} → ${providerId}`);
    
    res.status(200).json({
      status: 'success',
      message: result.message,
      data: {
        serviceType: result.serviceType,
        provider: result.provider
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get bill payment provider configuration
 */
exports.getBillPaymentProviders = async (req, res, next) => {
  try {
    const billPaymentConfig = {
      electricity: {
        serviceName: 'Electricity Bill Payment',
        availableProviders: ['airtimenigeria', 'smeplug'],
        currentProvider: VtuProviderService.getProviderForService('electricity')?.id || 'smeplug',
      },
      cable_tv: {
        serviceName: 'Cable TV Subscription',
        availableProviders: ['clubkonnect', 'airtimenigeria', 'smeplug'],
        currentProvider: VtuProviderService.getProviderForService('cable_tv')?.id || 'clubkonnect',
      }
    };
    
    res.status(200).json({
      status: 'success',
      data: billPaymentConfig
    });
  } catch (error) {
    next(error);
  }
};
