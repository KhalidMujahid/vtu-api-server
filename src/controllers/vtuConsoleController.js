
const VtuProviderService = require('../services/vtuProviderService');
const ProviderMarkupService = require('../services/providerMarkupService');
const ProviderStatus = require('../models/ProviderStatus');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');
const vtuConfig = require('../config/vtuProviders');

const SERVICE_TYPE_TO_CONSOLE = {
  data_recharge: 'data',
  sme_data: 'data',
  airtime_recharge: 'airtime',
  airtime_swap: 'airtime2cash',
  recharge_pin: 'airtimepin',
  electricity: 'electricity',
  cable_tv: 'cable',
  education_pin: 'education',
};

function toConsoleServiceName(serviceType = '') {
  return SERVICE_TYPE_TO_CONSOLE[String(serviceType).trim().toLowerCase()] || String(serviceType).trim().toLowerCase();
}

function toConsoleServiceList(serviceTypes = []) {
  return [...new Set((serviceTypes || []).map(toConsoleServiceName).filter(Boolean))];
}

function normalizeProviderId(providerId = '') {
  if (typeof vtuConfig.normalizeProviderId === 'function') {
    return vtuConfig.normalizeProviderId(providerId);
  }
  return String(providerId || '').trim().toLowerCase();
}


exports.getAllProviders = async (req, res, next) => {
  try {
    const providers = await VtuProviderService.getAllProvidersWithStatus();
    const providersWithConsoleServices = providers.map((provider) => ({
      ...provider,
      rawSupportedServices: provider.supportedServices || [],
      supportedServices: toConsoleServiceList(provider.supportedServices),
    }));
    
    res.status(200).json({
      status: 'success',
      results: providersWithConsoleServices.length,
      data: {
        providers: providersWithConsoleServices,
        primaryProvider: providersWithConsoleServices.find(p => p.isDefault)?.providerId || 'clubkonnect',
      }
    });
  } catch (error) {
    next(error);
  }
};




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
      data: {
        ...provider,
        rawSupportedServices: provider.supportedServices || [],
        supportedServices: toConsoleServiceList(provider.supportedServices),
      }
    });
  } catch (error) {
    next(error);
  }
};




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




exports.getProviderConfig = async (req, res, next) => {
  try {
    const providers = VtuProviderService.getAllProviders();
    
    
    const serviceRouting = vtuConfig.getServiceRouting();
    
    
    const dbStatuses = await ProviderStatus.find({}).lean();
    const statusMap = {};
    dbStatuses.forEach(s => {
      statusMap[s.providerName] = s;
    });

    const balanceEntries = await Promise.all(
      providers.map(async (provider) => [
        provider.id,
        await VtuProviderService.getProviderBalance(provider.id),
      ])
    );
    const balanceMap = Object.fromEntries(balanceEntries);
    
    
    const publicConfig = providers.map(p => {
      const dbStatus = statusMap[p.id] || {};
      return {
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        color: p.color,
        icon: p.icon,
        rawSupportedServices: p.supportedServices,
        supportedServices: toConsoleServiceList(p.supportedServices),
        supportedNetworks: p.supportedNetworks,
        features: p.features,
        rateLimit: p.rateLimit,
        
        status: dbStatus.status || p.status || 'active',
        isDefault: dbStatus.isDefault || p.isDefault || false,
        priority: dbStatus.priority || p.priority,
        totalRequests: dbStatus.totalRequests || 0,
        successfulRequests: dbStatus.successfulRequests || 0,
        failedRequests: dbStatus.failedRequests || 0,
        successRate: dbStatus.successRate || 100,
        uptime: dbStatus.uptime || 100,
        lastChecked: dbStatus.lastChecked || null,
        balance: balanceMap[p.id] || null,
      };
    });
    
    
    const primaryProvider = publicConfig.find(p => p.isDefault) || publicConfig.find(p => p.status === 'active') || providers[0];
    
    res.status(200).json({
      status: 'success',
      data: {
        providers: publicConfig,
        serviceRouting,
        defaults: {
          primaryProvider: primaryProvider?.id || 'clubkonnect',
          failoverEnabled: true,
        }
      }
    });
  } catch (error) {
    next(error);
  }
};




exports.saveServiceConfig = async (req, res, next) => {
  try {
    const { data, airtime, airtimepin, education, electricity, cable, airtime2cash } = req.body;
    
    
    const config = {};
    if (data) config.data = data;
    if (airtime) config.airtime = airtime;
    if (airtimepin) config.airtimepin = airtimepin;
    if (education) config.education = education;
    if (electricity) config.electricity = electricity;
    if (cable) config.cable = cable;
    if (airtime2cash) config.airtime2cash = airtime2cash;
    
    
    const updatedRouting = vtuConfig.updateServiceRouting(config);
    
    
    await vtuConfig.saveToDatabase(updatedRouting, req.user?.id);
    
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




exports.getServiceConfig = async (req, res, next) => {
  try {
    const requestedProviderId = String(req.query?.providerId || '').trim().toLowerCase() || null;

    
    const serviceRouting = vtuConfig.getServiceRouting();
    
    
    let providers = VtuProviderService.getAllProviders().map(p => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      rawSupportedServices: p.supportedServices,
      supportedServices: toConsoleServiceList(p.supportedServices),
    }));

    if (requestedProviderId) {
      providers = providers.filter((provider) => provider.id === requestedProviderId);

      if (!providers.length) {
        return res.status(404).json({
          status: 'error',
          message: `Provider '${requestedProviderId}' not found`,
        });
      }
    }
    
    
    const serviceLabels = {
      data: 'Data Recharge',
      airtime: 'Airtime Recharge',
      airtimepin: 'Airtime PIN',
      education: 'Exam PIN',
      electricity: 'Electricity Bill Payment',
      cable: 'Cable TV Subscription',
      airtime2cash: 'Airtime to Cash',
    };
    
    const requestedProviderServices = requestedProviderId
      ? (providers[0]?.supportedServices || [])
      : null;

    const filteredServiceRouting = requestedProviderId
      ? Object.fromEntries(
          requestedProviderServices.map((serviceKey) => [serviceKey, serviceRouting[serviceKey] || null])
        )
      : serviceRouting;

    const filteredServiceLabels = requestedProviderId
      ? Object.fromEntries(
          requestedProviderServices.map((serviceKey) => [serviceKey, serviceLabels[serviceKey] || serviceKey])
        )
      : serviceLabels;

    
    const routingDetails = {};
    for (const [service, providerId] of Object.entries(filteredServiceRouting)) {
      const provider = VtuProviderService.getAllProviders().find(p => p.id === providerId);
      routingDetails[service] = {
        providerId,
        providerName: provider?.displayName || providerId,
        label: serviceLabels[service] || service,
        supportedBySelectedProvider: requestedProviderId ? requestedProviderServices.includes(service) : null,
      };
    }
    
    res.status(200).json({
      status: 'success',
      data: {
        serviceRouting: filteredServiceRouting,
        routingDetails,
        availableProviders: providers,
        serviceLabels: filteredServiceLabels,
        providerServices: requestedProviderServices,
        defaults: {
          failoverEnabled: vtuConfig.defaults?.failoverEnabled || true,
          failoverDelay: vtuConfig.defaults?.failoverDelay || 5000,
        }
      }
    });
  } catch (error) {
    next(error);
  }
};




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




exports.getProviderMarkups = async (req, res, next) => {
  try {
    const markups = await ProviderMarkupService.getAllMarkups();
    res.status(200).json({
      status: 'success',
      data: {
        markups,
      },
    });
  } catch (error) {
    next(error);
  }
};




exports.getProviderMarkupOptions = async (req, res, next) => {
  try {
    const providers = VtuProviderService.getAllProviders();
    const markups = await ProviderMarkupService.getAllMarkups();

    const serviceLabels = {
      data_recharge: 'Data Recharge',
      airtime_recharge: 'Airtime Recharge',
      recharge_pin: 'Recharge PIN',
      electricity: 'Electricity',
      cable_tv: 'Cable TV',
      education_pin: 'Education PIN',
      airtime_swap: 'Airtime Swap',
      sme_data: 'SME Data',
    };

    const options = providers.map((provider) => {
      const normalizedProviderId = ProviderMarkupService.normalizeProviderId(provider.id);
      const providerMarkups = markups[normalizedProviderId] || {};
      const supportedServiceTypes = [...new Set((provider.supportedServices || []).map((serviceType) => (
        ProviderMarkupService.normalizeServiceType(serviceType)
      )))];

      const services = supportedServiceTypes.map((serviceType) => ({
        serviceType,
        label: serviceLabels[serviceType] || serviceType,
        percentage: Number(providerMarkups[serviceType] || 0),
      }));

      return {
        providerId: provider.id,
        displayName: provider.displayName || provider.name || provider.id,
        services,
      };
    });

    res.status(200).json({
      status: 'success',
      data: {
        options,
      },
    });
  } catch (error) {
    next(error);
  }
};




exports.setProviderMarkup = async (req, res, next) => {
  try {
    const providerId = req.params.providerId || req.body.providerId;
    const { serviceType, percentage } = req.body;

    if (!providerId) {
      return res.status(400).json({
        status: 'error',
        message: 'providerId is required',
      });
    }

    if (!serviceType) {
      return res.status(400).json({
        status: 'error',
        message: 'serviceType is required',
      });
    }

    if (percentage === undefined || percentage === null) {
      return res.status(400).json({
        status: 'error',
        message: 'percentage is required',
      });
    }

    const normalizedProviderId = ProviderMarkupService.normalizeProviderId(providerId);
    if (!vtuConfig.providers[normalizedProviderId]) {
      return res.status(400).json({
        status: 'error',
        message: `Unknown provider '${providerId}'`,
      });
    }

    const result = await ProviderMarkupService.setMarkupPercentage({
      providerId: normalizedProviderId,
      serviceType,
      percentage,
      updatedBy: req.user?.id || null,
    });

    res.status(200).json({
      status: 'success',
      message: 'Provider markup updated successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};




exports.getProviderProfiles = async (req, res, next) => {
  try {
    const providers = VtuProviderService.getAllProviders();
    const providerIds = providers.map((provider) => provider.id);

    const [dbStatuses, balances, txGroups] = await Promise.all([
      ProviderStatus.find({ providerName: { $in: providerIds } }).lean(),
      Promise.all(providerIds.map((providerId) => VtuProviderService.getProviderBalance(providerId))),
      Transaction.aggregate([
        {
          $project: {
            providerId: {
              $toLower: {
                $trim: {
                  input: {
                    $ifNull: ['$service.provider', '$provider.name'],
                  },
                },
              },
            },
            amount: { $ifNull: ['$amount', 0] },
            status: 1,
            createdAt: 1,
          },
        },
        {
          $match: {
            providerId: { $ne: '' },
          },
        },
        {
          $group: {
            _id: '$providerId',
            transactionsCount: { $sum: 1 },
            successfulCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'successful'] }, 1, 0],
              },
            },
            failedCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'failed'] }, 1, 0],
              },
            },
            pendingCount: {
              $sum: {
                $cond: [{ $in: ['$status', ['pending', 'processing']] }, 1, 0],
              },
            },
            totalAmount: { $sum: '$amount' },
            successfulAmount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'successful'] }, '$amount', 0],
              },
            },
            lastTransactionAt: { $max: '$createdAt' },
          },
        },
      ]),
    ]);

    const statusMap = new Map(
      (dbStatuses || []).map((status) => [normalizeProviderId(status.providerName), status])
    );
    const balanceMap = new Map(
      (balances || []).map((balance) => [normalizeProviderId(balance.providerId), balance])
    );

    const txMap = new Map();
    for (const tx of txGroups || []) {
      const normalizedProviderId = normalizeProviderId(tx._id);
      const current = txMap.get(normalizedProviderId) || {
        transactionsCount: 0,
        successfulCount: 0,
        failedCount: 0,
        pendingCount: 0,
        totalAmount: 0,
        successfulAmount: 0,
        lastTransactionAt: null,
      };

      current.transactionsCount += tx.transactionsCount || 0;
      current.successfulCount += tx.successfulCount || 0;
      current.failedCount += tx.failedCount || 0;
      current.pendingCount += tx.pendingCount || 0;
      current.totalAmount += Number(tx.totalAmount || 0);
      current.successfulAmount += Number(tx.successfulAmount || 0);
      if (!current.lastTransactionAt || (tx.lastTransactionAt && new Date(tx.lastTransactionAt) > new Date(current.lastTransactionAt))) {
        current.lastTransactionAt = tx.lastTransactionAt;
      }

      txMap.set(normalizedProviderId, current);
    }

    const profiles = providers.map((provider) => {
      const normalizedId = normalizeProviderId(provider.id);
      const dbStatus = statusMap.get(normalizedId) || {};
      const balance = balanceMap.get(normalizedId) || null;
      const tx = txMap.get(normalizedId) || {
        transactionsCount: 0,
        successfulCount: 0,
        failedCount: 0,
        pendingCount: 0,
        totalAmount: 0,
        successfulAmount: 0,
        lastTransactionAt: null,
      };

      const txSuccessRate = tx.transactionsCount > 0
        ? Number(((tx.successfulCount / tx.transactionsCount) * 100).toFixed(2))
        : 0;
      const apiSuccessRate = Number(dbStatus.successRate ?? 0);

      return {
        providerId: provider.id,
        name: provider.name,
        displayName: provider.displayName,
        status: dbStatus.status || provider.status || 'active',
        isDefault: dbStatus.isDefault || provider.isDefault || false,
        supportedServices: toConsoleServiceList(provider.supportedServices),
        supportedNetworks: provider.supportedNetworks || [],
        balance: balance
          ? {
              available: balance.available,
              amount: balance.balance,
              currency: balance.currency || 'NGN',
              message: balance.message || null,
              lastUpdated: balance.lastUpdated || null,
            }
          : null,
        accumulatedProfile: {
          transactionsCount: tx.transactionsCount,
          successfulCount: tx.successfulCount,
          failedCount: tx.failedCount,
          pendingCount: tx.pendingCount,
          totalAmount: Number(tx.totalAmount || 0),
          successfulAmount: Number(tx.successfulAmount || 0),
          successRate: txSuccessRate,
          lastTransactionAt: tx.lastTransactionAt || null,
        },
        apiProfile: {
          totalRequests: dbStatus.totalRequests || 0,
          successfulRequests: dbStatus.successfulRequests || 0,
          failedRequests: dbStatus.failedRequests || 0,
          successRate: Number(apiSuccessRate.toFixed(2)),
          uptime: dbStatus.uptime ?? 100,
          averageResponseTime: dbStatus.averageResponseTime ?? null,
          lastChecked: dbStatus.lastChecked || null,
        },
      };
    });

    res.status(200).json({
      status: 'success',
      results: profiles.length,
      data: {
        profiles,
        generatedAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};




exports.updateProvider = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const {
      status,
      isDefault,
      priority,
      apiKey,
      apiSecret,
      baseUrl,
      callbackUrl,
      supportedServices,
      rateLimit,
      healthCheckEndpoint,
      healthCheckInterval,
      fallbackTo,
      maintenanceMessage,
      maintenanceStart,
      maintenanceEnd,
      description,
      contactEmail,
      contactPhone,
    } = req.body;

    const allowedStatuses = ['active', 'inactive', 'maintenance', 'degraded'];
    
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`
      });
    }
    
    
    const configProvider = vtuConfig.providers[providerId];
    if (!configProvider) {
      return res.status(404).json({
        status: 'error',
        message: `Provider ${providerId} not found in configuration`
      });
    }
    
    
    const updateData = {
      providerName: providerId,
      lastUpdatedBy: req.user?.id,
    };
    
    if (status) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (apiKey) updateData.apiKey = apiKey;
    if (apiSecret) updateData.apiSecret = apiSecret;
    if (baseUrl) updateData.baseUrl = baseUrl;
    if (callbackUrl) updateData.callbackUrl = callbackUrl;
    if (supportedServices) updateData.supportedServices = supportedServices;
    if (rateLimit) updateData.rateLimit = rateLimit;
    if (healthCheckEndpoint) updateData.healthCheckEndpoint = healthCheckEndpoint;
    if (healthCheckInterval) updateData.healthCheckInterval = healthCheckInterval;
    if (fallbackTo) updateData.fallbackTo = fallbackTo;
    if (maintenanceMessage) updateData.maintenanceMessage = maintenanceMessage;
    if (maintenanceStart) updateData.maintenanceStart = maintenanceStart;
    if (maintenanceEnd) updateData.maintenanceEnd = maintenanceEnd;
    if (description) updateData.description = description;
    if (contactEmail) updateData.contactEmail = contactEmail;
    if (contactPhone) updateData.contactPhone = contactPhone;
    
    
    if (isDefault !== undefined) {
      if (isDefault) {
        await ProviderStatus.updateMany({}, { isDefault: false });
        updateData.isDefault = true;
      } else {
        updateData.isDefault = false;
      }
    }
    
    
    const updated = await ProviderStatus.findOneAndUpdate(
      { providerName: providerId },
      { $set: updateData },
      { new: true, upsert: true }
    );
    
    logger.info(`Provider ${providerId} updated by user: ${req.user?.id || 'system'}`);
    
    res.status(200).json({
      status: 'success',
      message: 'Provider updated successfully',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};




exports.createProvider = async (req, res, next) => {
  try {
    const {
      providerId,
      name,
      displayName,
      description,
      color,
      icon,
      baseUrl,
      apiKey,
      apiSecret,
      timeout,
      supportedServices,
      supportedNetworks,
      status,
      priority,
      isDefault,
      features,
      rateLimit,
      healthCheckEndpoint,
      healthCheckInterval,
      fallbackTo,
    } = req.body;
    
    if (!providerId) {
      return res.status(400).json({
        status: 'error',
        message: 'Provider ID is required'
      });
    }
    
    
    const existing = await ProviderStatus.findOne({ providerName: providerId });
    if (existing) {
      return res.status(400).json({
        status: 'error',
        message: `Provider ${providerId} already exists. Use PUT to update.`
      });
    }
    
    const allowedStatuses = ['active', 'inactive', 'maintenance', 'degraded'];
    const providerStatus = status && allowedStatuses.includes(status) ? status : 'active';
    
    
    const newProvider = new ProviderStatus({
      providerName: providerId,
      name,
      displayName,
      description,
      supportedServices: supportedServices || [],
      status: providerStatus,
      priority: priority || 1,
      isDefault: isDefault || false,
      apiKey,
      apiSecret,
      baseUrl,
      supportedNetworks,
      features,
      rateLimit,
      healthCheckEndpoint,
      healthCheckInterval,
      fallbackTo,
      lastUpdatedBy: req.user?.id,
    });
    
    await newProvider.save();
    
    logger.info(`Provider ${providerId} created by user: ${req.user?.id || 'system'}`);
    
    res.status(201).json({
      status: 'success',
      message: 'Provider created successfully',
      data: newProvider
    });
  } catch (error) {
    next(error);
  }
};




exports.getApiLogs = async (req, res, next) => {
  try {
    const { provider, limit = 20 } = req.query;
    
    
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




exports.initializeProviders = async (req, res, next) => {
  try {
    const providers = VtuProviderService.getAllProviders();
    const results = [];
    
    for (const provider of providers) {
      
      const existing = await ProviderStatus.findOne({ providerName: provider.id });
      
      if (existing) {
        
        await ProviderStatus.findOneAndUpdate(
          { providerName: provider.id },
          {
            $set: {
              supportedServices: provider.supportedServices,
              status: provider.status,
              priority: provider.priority,
              isDefault: provider.isDefault,
              description: provider.description,
              rateLimit: provider.rateLimit,
              healthCheckInterval: provider.healthCheckInterval || 300000,
            }
          },
          { new: true }
        );
        results.push({ provider: provider.id, action: 'updated' });
      } else {
        
        const newProvider = new ProviderStatus({
          providerName: provider.id,
          name: provider.name,
          displayName: provider.displayName,
          description: provider.description,
          supportedServices: provider.supportedServices,
          supportedNetworks: provider.supportedNetworks,
          status: provider.status || 'active',
          priority: provider.priority || 1,
          isDefault: provider.isDefault || false,
          rateLimit: provider.rateLimit,
          healthCheckInterval: provider.healthCheckInterval || 300000,
          features: provider.features,
        });
        await newProvider.save();
        results.push({ provider: provider.id, action: 'created' });
      }
    }
    
    logger.info(`Providers initialized: ${results.length} providers processed`);
    
    res.status(200).json({
      status: 'success',
      message: 'Providers initialized successfully',
      data: {
        results,
        total: results.length
      }
    });
  } catch (error) {
    next(error);
  }
};




exports.deleteProvider = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const { hardDelete } = req.query;
    
    const provider = await ProviderStatus.findOne({ providerName: providerId });
    
    if (!provider) {
      return res.status(404).json({
        status: 'error',
        message: 'Provider not found in database'
      });
    }
    
    if (hardDelete === 'true') {
      
      await ProviderStatus.deleteOne({ providerName: providerId });
      logger.info(`Provider ${providerId} hard deleted by user: ${req.user?.id || 'system'}`);
      
      res.status(200).json({
        status: 'success',
        message: 'Provider deleted permanently'
      });
    } else {
      
      provider.status = 'inactive';
      await provider.save();
      logger.info(`Provider ${providerId} soft deleted by user: ${req.user?.id || 'system'}`);
      
      res.status(200).json({
        status: 'success',
        message: 'Provider marked as inactive'
      });
    }
  } catch (error) {
    next(error);
  }
};




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
