module.exports = {
  providers: {
    clubkonnect: {
      id: 'clubkonnect',
      name: 'Club Konnect',
      displayName: 'Club Konnect (NelloBytes)',
      description: 'Smart bundles · corporate · nellobytes',
      color: '#f59e0b',
      icon: 'zap',
      baseUrl: process.env.VTU_BASE_URL || 'https://www.nellobytesystems.com',
      apiKey: process.env.NELLO_API_KEY || '',
      apiSecret: process.env.NELLO_API_KEY || '',
      timeout: 45000,
      retryCount: 3,
      supportedServices: ['data_recharge', 'airtime_recharge', 'sme_data', 'cable_tv', 'electricity', 'recharge_pin', 'education_pin'],
      supportedNetworks: ['mtn', 'glo', 'airtel', '9mobile'],
      status: 'active',
      priority: 1,
      isDefault: true,
      source: 'nellobytes',
      features: {
        dataBundle: true,
        airtime: true,
        cableTv: true,
        electricity: true,
        smeData: true,
      },
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerHour: 500,
      },
    },
    
    airtimenigeria: {
      id: 'airtimenigeria',
      name: 'Airtime Nigeria',
      displayName: 'Airtime Nigeria',
      description: 'Recharge · data · discoin',
      color: '#0284c7',
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
      source: 'airtimenigeria',
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
    },
    
    smeplug: {
      id: 'smeplug',
      name: 'SMEPlug',
      displayName: 'SMEPlug',
      description: 'Utility · data · airtime',
      color: '#7c3aed', 
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
      source: 'smeplug',
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

    pluginng: {
      id: 'pluginng',
      name: 'Pluginng',
      displayName: 'Pluginng',
      description: 'Data - airtime - cable - electricity - exam',
      color: '#16a34a',
      icon: 'puzzle',
      baseUrl: process.env.PLUGINNG_BASE_URL || 'https://pluginng.com',
      apiKey: process.env.PLUGINNG_TOKEN || '',
      apiSecret: process.env.PLUGINNG_PASSWORD || '',
      timeout: 45000,
      retryCount: 2,
      supportedServices: ['data_recharge', 'airtime_recharge', 'sme_data', 'electricity', 'cable_tv', 'education_pin'],
      supportedNetworks: ['mtn', 'glo', 'airtel', '9mobile'],
      status: 'active',
      priority: 4,
      isDefault: false,
      source: 'pluginng',
      features: {
        dataBundle: true,
        airtime: true,
        cableTv: true,
        electricity: true,
        smeData: true,
      },
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerHour: 500,
      },
    },
  },

  networkProviders: {
    mtn: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng'],
    glo: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng'],
    airtel: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng'],
    '9mobile': ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng'],
  },

  defaults: {
    primaryProvider: process.env.DEFAULT_VTU_PROVIDER || 'clubkonnect',
    failoverEnabled: true,
    failoverDelay: 5000,
    healthCheckInterval: 300000,
  },

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

  billPaymentServices: {
    electricity: {
      providers: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng'],
      defaultProvider: 'clubkonnect',
    },
    cable_tv: {
      providers: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng'],
      defaultProvider: 'clubkonnect',
    },
  },

  serviceRouting: {
    data: 'clubkonnect',
    airtime: 'airtimenigeria',
    airtimepin: 'airtimenigeria',
    education: 'smeplug',
    electricity: 'clubkonnect',
    cable: 'clubkonnect',
    airtime2cash: 'smeplug',
  },

  async getProviderForService(serviceType) {
    const providerId = await this.getProviderIdForService(serviceType);
    if (providerId && this.providers[providerId]) {
      return this.providers[providerId];
    }
    return this.providers[this.defaults.primaryProvider];
  },

  getProviderForServiceSync(serviceType) {
    const providerId = this.serviceRouting[serviceType] || this.defaults.primaryProvider;
    if (providerId && this.providers[providerId]) {
      return this.providers[providerId];
    }
    return this.providers[this.defaults.primaryProvider];
  },

  /**
   * Get provider ID for a service - always fetches from database
   * @param {string} serviceType - The service type (data, airtime, etc.)
   * @returns {string} Provider ID
   */
  async getProviderIdForService(serviceType) {
    try {
      const VtuConfig = require('../models/VtuConfig');
      
      if (VtuConfig.db && VtuConfig.db.collection) {
        const dbConfig = await VtuConfig.findOne({ key: 'serviceRouting' }).lean();
        
        if (dbConfig && dbConfig.value && dbConfig.value[serviceType]) {
          this.serviceRouting[serviceType] = dbConfig.value[serviceType];
          console.log('getProviderIdForService - routing config fetched from DB:', serviceType, '=', dbConfig.value[serviceType]);
          return dbConfig.value[serviceType];
        }
      }
    } catch (error) {
      console.error('getProviderIdForService - DB fetch error:', error.message);
    }
    
    return this.serviceRouting[serviceType] || this.defaults.primaryProvider;
  },

  getProviderIdForServiceSync(serviceType) {
    return this.serviceRouting[serviceType] || this.defaults.primaryProvider;
  },

  setProviderForService(serviceType, providerId) {
    if (this.providers[providerId]) {
      this.serviceRouting[serviceType] = providerId;
      return true;
    }
    return false;
  },

  updateServiceRouting(config) {
    const validServices = ['data', 'airtime', 'airtimepin', 'education', 'electricity', 'cable', 'airtime2cash'];
    
    for (const [service, provider] of Object.entries(config)) {
      if (validServices.includes(service) && this.providers[provider]) {
        this.serviceRouting[service] = provider;
      }
    }
    return this.serviceRouting;
  },

  getServiceRouting() {
    return { ...this.serviceRouting };
  },

  getDataPlansService(source) {
    const serviceMap = {
      'nellobytes': require('../services/nelloBytesService'),
      'airtimenigeria': require('../services/airtimeNigeriaService'),
      'smeplug': require('../services/smePlugService'),
      'pluginng': require('../services/pluginngService'),
    };
    return serviceMap[source] || null;
  },

  getAirtimeService(source) {
    const serviceMap = {
      'nellobytes': require('../services/nelloBytesService'),
      'airtimenigeria': require('../services/airtimeNigeriaService'),
      'smeplug': require('../services/smePlugService'),
      'pluginng': require('../services/pluginngService'),
    };
    return serviceMap[source] || null;
  },

  /**
   * Load service routing from database
   */
  async loadFromDatabase() {
    let VtuConfig;
    try {
      VtuConfig = require('../models/VtuConfig');
      
      console.log('Loading VTU config from database...');
      
      if (!VtuConfig.db || !VtuConfig.db.collection) {
        console.log('Database not ready yet, using default config');
        return this.serviceRouting;
      }
      
      const dbConfig = await VtuConfig.findOne({ key: 'serviceRouting' }).lean();
      console.log('Database query result:', dbConfig);
      
      if (dbConfig && dbConfig.value) {
        this.serviceRouting = { ...this.serviceRouting, ...dbConfig.value };
        console.log('✓ VTU service routing loaded from database:', JSON.stringify(dbConfig.value));
      } else {
        console.log('⚠ No VTU service routing found in database. Using default config.');
        console.log('   Save a config using API Console to persist settings.');
      }
      return this.serviceRouting;
    } catch (error) {
      console.error('Error loading VTU config from database:', error.message);
      console.error(error.stack);
      return this.serviceRouting;
    }
  },

  /**
   * Save service routing to database
   */
  async saveToDatabase(serviceRouting, userId = null) {
    try {
      const VtuConfig = require('../models/VtuConfig');
      
      console.log('Saving VTU config to database:', serviceRouting);
      
      const result = await VtuConfig.findOneAndUpdate(
        { key: 'serviceRouting' },
        {
          key: 'serviceRouting',
          value: serviceRouting,
          description: 'VTU service provider routing configuration',
          updatedBy: userId,
          updatedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      
      console.log('✓ VTU service routing saved to database:', result);
      return true;
    } catch (error) {
      console.error('Error saving VTU config to database:', error.message);
      console.error(error.stack);
      return false;
    }
  },

  /**
   * Initialize config from database on startup
   */
  async initialize() {
    await this.loadFromDatabase();
  },

  /**
   * Transform data plans from different providers into a unified format
   * @param {string} source - The provider source (nellobytes, airtimenigeria, smeplug)
   * @param {object} data - Raw data from the provider API
   * @returns {object} Normalized data with unified structure
   */
  transformDataPlans(source, data) {
    console.log('transformDataPlans - source:', source, 'data keys:', data ? Object.keys(data) : 'no data');
    
    if (!data) return {};
    
    try {
      let normalizedData = {};

      switch (source) {
        case 'nellobytes':
          normalizedData = this._normalizeNelloBytes(data);
          break;
        case 'smeplug':
          normalizedData = this._normalizeSmePlug(data);
          break;
        case 'airtimenigeria':
          normalizedData = this._normalizeAirtimeNigeria(data);
          break;
        case 'pluginng':
          normalizedData = this._normalizePluginng(data);
          break;
        default:
          return data;
      }

      console.log('transformDataPlans - normalized keys:', Object.keys(normalizedData));
      return normalizedData;
    } catch (error) {
      console.error('Error transforming data plans:', error.message);
      return data;
    }
  },

  /**
   * Normalize ClubKonnect/NelloBytes response
   */
  _normalizeNelloBytes(data) {
    const result = {};
    const mobileNetwork = data.MOBILE_NETWORK || data;
    
    // Map network names to lowercase
    const networkMap = {
      'MTN': 'mtn',
      'Glo': 'glo',
      'Airtel': 'airtel',
      'm_9mobile': '9mobile',
      '9mobile': '9mobile',
      '01': 'mtn',
      '1': 'mtn',
      '02': 'glo',
      '2': 'glo',
      '03': '9mobile',
      '3': '9mobile',
      '04': 'airtel',
      '4': 'airtel',
    };

    for (const [networkKey, networkData] of Object.entries(mobileNetwork)) {
      const normalizedKey = networkMap[networkKey] || networkKey.toLowerCase();
      
      if (Array.isArray(networkData)) {
        // Handle nested PRODUCT array format from ClubKonnect/NelloBytes
        if (networkData[0] && Array.isArray(networkData[0].PRODUCT)) {
          const products = networkData[0].PRODUCT || [];
          result[normalizedKey] = products.map(plan => this._normalizeNelloBytesPlan(plan));
        } else {
          result[normalizedKey] = networkData.map(plan => this._normalizePlanItem(plan, 'nellobytes'));
        }
      } else if (networkData && Array.isArray(networkData.PRODUCT)) {
        result[normalizedKey] = networkData.PRODUCT.map(plan => this._normalizeNelloBytesPlan(plan));
      }
    }

    return result;
  },

  /**
   * Normalize ClubKonnect plan item
   */
  _normalizeNelloBytesPlan(plan) {
    const planName = plan.PRODUCT_NAME || '';
    return {
      id: plan.PRODUCT_ID || plan.ID || '',
      planCode: plan.PRODUCT_CODE || '',
      planName,
      network: '', // Will be set by parent
      size: planName || '',
      price: parseFloat(plan.PRODUCT_AMOUNT) || 0,
      validity: this._extractValidity(planName || ''),
      providerPlanType: this._extractDataType(planName || ''),
    };
  },

  /**
   * Normalize SMEPlug response
   */
  _normalizeSmePlug(data) {
    const result = {};
    const plans = data.plans || data;
    
    const networkMap = {
      'MTN': 'mtn',
      'Glo': 'glo',
      'Airtel': 'airtel',
      '9mobile': '9mobile',
      '01': 'mtn',
      '1': 'mtn',
      '02': 'glo',
      '2': 'glo',
      '03': '9mobile',
      '3': '9mobile',
      '04': 'airtel',
      '4': 'airtel',
    };

    for (const [networkKey, networkPlans] of Object.entries(plans)) {
      const normalizedKey = networkMap[networkKey] || networkKey.toLowerCase();
      
      if (Array.isArray(networkPlans)) {
        result[normalizedKey] = networkPlans.map(plan => this._normalizeSmePlugPlan(plan));
      }
    }

    return result;
  },

  /**
   * Normalize SMEPlug plan item
   */
  _normalizeSmePlugPlan(plan) {
    const planName = plan.planName || '';
    return {
      id: plan.id || '',
      planCode: plan.planCode || '',
      planName,
      network: plan.network || '',
      size: plan.size || planName || '',
      price: parseFloat(plan.price) || 0,
      validity: plan.validity || this._extractValidity(planName || ''),
      providerPlanType: this._extractDataType(
        `${planName} ${plan.plan_type || ''} ${plan.category || ''}`.trim()
      ),
    };
  },

  /**
   * Normalize AirtimeNigeria response
   */
  _normalizeAirtimeNigeria(data) {
    const result = {};
    const networkData = data.data || data;
    
    const networkMap = {
      'MTN': 'mtn',
      'Glo': 'glo',
      'Airtel': 'airtel',
      '9mobile': '9mobile',
      '01': 'mtn',
      '1': 'mtn',
      '02': 'glo',
      '2': 'glo',
      '03': '9mobile',
      '3': '9mobile',
      '04': 'airtel',
      '4': 'airtel',
    };

    for (const [networkKey, networkPlans] of Object.entries(networkData)) {
      const normalizedKey = networkMap[networkKey] || networkKey.toLowerCase();
      
      if (Array.isArray(networkPlans)) {
        result[normalizedKey] = networkPlans.map(plan => this._normalizeAirtimeNigeriaPlan(plan));
      }
    }

    return result;
  },

  /**
   * Normalize AirtimeNigeria plan item
   */
  _normalizeAirtimeNigeriaPlan(plan) {
    const planName = plan.planName || plan.plan_summary || '';
    return {
      id: plan.planId || plan.plan_id || '',
      planCode: plan.planCode || plan.plan_code || '',
      planName,
      network: plan.network || '',
      size: plan.size || '',
      price: parseFloat(plan.price) || 0,
      validity: plan.validity || '',
      providerPlanType: this._extractDataType(
        `${planName} ${plan.plan_type || ''} ${plan.category || ''}`.trim()
      ),
    };
  },

  /**
   * Normalize generic plan item
   */
  _normalizePlanItem(plan, source) {
    if (source === 'nellobytes') {
      return this._normalizeNelloBytesPlan(plan);
    } else if (source === 'smeplug') {
      return this._normalizeSmePlugPlan(plan);
    } else if (source === 'airtimenigeria') {
      return this._normalizeAirtimeNigeriaPlan(plan);
    }
    return plan;
  },

  /**
   * Normalize Pluginng response
   */
  _normalizePluginng(data) {
    const result = {};
    const plans = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

    for (const group of plans) {
      if (String(group?.category || '').toLowerCase() !== 'data') continue;
      if (String(group?.status ?? '1') !== '1') continue;
      if (!Array.isArray(group?.plan)) continue;

      const network = this._normalizePluginngNetwork(group?.title);
      if (!network) continue;

      if (!result[network]) {
        result[network] = [];
      }

      for (const item of group.plan) {
        const planName = item?.plan || '';
        const typeHint = `${group.title || ''} ${planName}`.trim();
        result[network].push({
          id: `${group.subcategory_id}:${planName}`,
          planCode: planName,
          providerPlanId: planName,
          planName,
          network,
          size: planName,
          price: parseFloat(item?.amount) || 0,
          validity: this._extractValidity(planName),
          providerPlanType: this._extractDataType(typeHint),
          providerMeta: {
            subcategoryId: String(group.subcategory_id || ''),
            title: group.title || '',
          },
        });
      }
    }

    return result;
  },

  _normalizePluginngNetwork(title = '') {
    const normalized = String(title).toLowerCase();
    if (normalized.startsWith('mtn')) return 'mtn';
    if (normalized.startsWith('airtel')) return 'airtel';
    if (normalized.startsWith('glo')) return 'glo';
    if (normalized.startsWith('9mobile')) return '9mobile';
    return null;
  },

  /**
   * Extract validity from plan name
   */
  _extractValidity(planName) {
    const match = planName.match(/(\d+\s*(?:day|week|month|year|hour|hr)s?)/i);
    return match ? match[1] : '';
  },

  /**
   * Extract normalized data type from plan metadata/name
   */
  _extractDataType(planName = '') {
    const normalized = String(planName).toLowerCase();
    if (!normalized) return 'other';

    if (normalized.includes('awoof')) return 'awoof';
    if (normalized.includes('direct')) return 'direct';
    if (normalized.includes('sme')) return 'sme';
    if (normalized.includes('corporate')) return 'corporate';
    if (normalized.includes('gifting') || normalized.includes('gift')) return 'gifting';
    if (normalized.includes('night')) return 'night';
    if (normalized.includes('daily')) return 'daily';
    if (normalized.includes('weekly')) return 'weekly';
    if (normalized.includes('monthly')) return 'monthly';
    return 'other';
  },
};
