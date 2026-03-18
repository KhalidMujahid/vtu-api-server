/**
 * VTU Provider Configuration
 * Supports three VTU providers with failover capability
 * 
 * Providers:
 * - clubkonnect: Club Konnect API (Primary)
 * - airtimenigeria: Airtime Nigeria API
 * - smeplug: SMEPlug API
 */

module.exports = {
  // Available VTU Providers
  providers: {
    clubkonnect: {
      id: 'clubkonnect',
      name: 'Club Konnect',
      displayName: 'Club Konnect (NelloBytes)',
      description: 'Smart bundles · corporate · nellobytes',
      color: '#f59e0b', // amber
      icon: 'zap',
      baseUrl: process.env.VTU_BASE_URL || 'https://www.nellobytesystems.com',
      apiKey: process.env.NELLO_API_KEY || '',
      apiSecret: process.env.NELLO_API_KEY || '',
      timeout: 45000,
      retryCount: 3,
      supportedServices: ['data_recharge', 'airtime_recharge', 'sme_data', 'cable_tv'],
      supportedNetworks: ['mtn', 'glo', 'airtel', '9mobile'],
      status: 'active',
      priority: 1,
      isDefault: true,
      features: {
        dataBundle: true,
        airtime: true,
        cableTv: true,
        electricity: false,
        smeData: true,
      },
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerHour: 500,
      },
      // Uses NelloBytes API
      source: 'nellobytes',
    },
    
    airtimenigeria: {
      id: 'airtimenigeria',
      name: 'Airtime Nigeria',
      displayName: 'Airtime Nigeria',
      description: 'Recharge · data · discoin',
      color: '#0284c7', // sky blue
      icon: 'airplay',
      baseUrl: process.env.AIRTIME_NIGERIA_BASE_URL || 'https://www.airtimenigeria.com/api/v1',
      apiKey: process.env.AIRTIME_NIGERIA_API_KEY || '',
      apiSecret: process.env.AIRTIME_NIGERIA_API_SECRET || '',
      timeout: 45000,
      retryCount: 2,
      supportedServices: ['data_recharge', 'airtime_recharge', 'cable_tv', 'electricity'],
      supportedNetworks: ['mtn', 'glo', 'airtel', '9mobile'],
      status: 'active',
      priority: 2,
      isDefault: false,
      features: {
        dataBundle: true,
        airtime: true,
        cableTv: true,
        electricity: true,
        smeData: false,
      },
      rateLimit: {
        requestsPerMinute: 50,
        requestsPerHour: 400,
      },
      // Uses AirtimeNigeria.com API
      source: 'airtimenigeria',
    },
    
    smeplug: {
      id: 'smeplug',
      name: 'SMEPlug',
      displayName: 'SMEPlug',
      description: 'Utility · data · airtime',
      color: '#7c3aed', // indigo
      icon: 'plug',
      baseUrl: process.env.SMEPLUG_BASE_URL || 'https://api.smeplug.ng/v1',
      apiKey: process.env.SMEPLUG_API_KEY || '',
      apiSecret: process.env.SMEPLUG_API_SECRET || '',
      timeout: 35000,
      retryCount: 3,
      supportedServices: ['data_recharge', 'airtime_recharge', 'sme_data', 'electricity', 'cable_tv'],
      supportedNetworks: ['mtn', 'glo', 'airtel', '9mobile'],
      status: 'active',
      priority: 3,
      isDefault: false,
      features: {
        dataBundle: true,
        airtime: true,
        cableTv: true,
        electricity: true,
        smeData: true,
      },
      rateLimit: {
        requestsPerMinute: 40,
        requestsPerHour: 300,
      },
    },
  },

  // Network to Provider mapping (for fallback routing)
  networkProviders: {
    mtn: ['clubkonnect', 'airtimenigeria', 'smeplug'],
    glo: ['clubkonnect', 'airtimenigeria', 'smeplug'],
    airtel: ['clubkonnect', 'airtimenigeria', 'smeplug'],
    '9mobile': ['clubkonnect', 'airtimenigeria', 'smeplug'],
  },

  // Default settings
  defaults: {
    primaryProvider: process.env.DEFAULT_VTU_PROVIDER || 'clubkonnect',
    failoverEnabled: true,
    failoverDelay: 5000, // ms before switching to fallback
    healthCheckInterval: 300000, // 5 minutes
  },

  // Service types mapping
  serviceTypes: {
    data_recharge: {
      endpoint: '/data',
      method: 'POST',
    },
    airtime_recharge: {
      endpoint: '/airtime',
      method: 'POST',
    },
    sme_data: {
      endpoint: '/sme-data',
      method: 'POST',
    },
    cable_tv: {
      endpoint: '/cable',
      method: 'POST',
    },
    electricity: {
      endpoint: '/electricity',
      method: 'POST',
    },
  },

  // Bill payment service types (electricity, cable)
  billPaymentServices: {
    electricity: {
      providers: ['airtimenigeria', 'smeplug'],
      defaultProvider: 'smeplug',
    },
    cable_tv: {
      providers: ['clubkonnect', 'airtimenigeria', 'smeplug'],
      defaultProvider: 'clubkonnect',
    },
  },

  // Service routing configuration (for API Console)
  // Maps each service type to a provider
  serviceRouting: {
    data: 'clubkonnect',
    airtime: 'airtimenigeria',
    airtimepin: 'airtimenigeria',
    education: 'smeplug',
    electricity: 'clubkonnect',
    cable: 'airtimenigeria',
    airtime2cash: 'smeplug',
  },

  // Get provider for specific service
  getProviderForService(serviceType) {
    const providerId = this.serviceRouting[serviceType];
    if (providerId && this.providers[providerId]) {
      return this.providers[providerId];
    }
    return this.providers[this.defaults.primaryProvider];
  },

  // Get provider ID for specific service
  getProviderIdForService(serviceType) {
    return this.serviceRouting[serviceType] || this.defaults.primaryProvider;
  },

  // Set provider for specific service
  setProviderForService(serviceType, providerId) {
    if (this.providers[providerId]) {
      this.serviceRouting[serviceType] = providerId;
      return true;
    }
    return false;
  },

  // Update service routing configuration
  updateServiceRouting(config) {
    const validServices = ['data', 'airtime', 'airtimepin', 'education', 'electricity', 'cable', 'airtime2cash'];
    
    for (const [service, provider] of Object.entries(config)) {
      if (validServices.includes(service) && this.providers[provider]) {
        this.serviceRouting[service] = provider;
      }
    }
    return this.serviceRouting;
  },

  // Get all service routing configuration
  getServiceRouting() {
    return { ...this.serviceRouting };
  },
};
