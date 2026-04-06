module.exports = {
  providerAliases: {
    clubconnect: 'clubkonnect',
    club_konnect: 'clubkonnect',
    clubkonnect: 'clubkonnect',
    nello: 'clubkonnect',
    nellobytes: 'clubkonnect',
    alrahuz: 'alrahuzdata',
    alrahuzdata: 'alrahuzdata',
  },

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
    alrahuzdata: {
      id: 'alrahuzdata',
      name: 'AlrahuzData',
      displayName: 'AlrahuzData',
      description: 'Data - airtime - cable - electricity - exam',
      color: '#0f766e',
      icon: 'database',
      baseUrl: process.env.ALRAHUZDATA_BASE_URL || 'https://alrahuzdata.com.ng',
      apiKey: process.env.ALRAHUZDATA_TOKEN || '',
      apiSecret: process.env.ALRAHUZDATA_TOKEN || '',
      timeout: 45000,
      retryCount: 2,
      supportedServices: ['data_recharge', 'airtime_recharge', 'sme_data', 'electricity', 'cable_tv', 'education_pin'],
      supportedNetworks: ['mtn', 'glo', 'airtel', '9mobile'],
      status: 'active',
      priority: 5,
      isDefault: false,
      source: 'alrahuzdata',
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
    mtn: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng', 'alrahuzdata'],
    glo: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng', 'alrahuzdata'],
    airtel: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng', 'alrahuzdata'],
    '9mobile': ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng', 'alrahuzdata'],
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
      providers: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng', 'alrahuzdata'],
      defaultProvider: 'clubkonnect',
    },
    cable_tv: {
      providers: ['clubkonnect', 'airtimenigeria', 'smeplug', 'pluginng', 'alrahuzdata'],
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

  normalizeProviderId(providerId) {
    const key = String(providerId || '').trim().toLowerCase();
    if (!key) return '';
    return this.providerAliases[key] || key;
  },

  async getProviderForService(serviceType) {
    const providerId = this.normalizeProviderId(await this.getProviderIdForService(serviceType));
    if (providerId && this.providers[providerId]) {
      return this.providers[providerId];
    }
    return this.providers[this.defaults.primaryProvider];
  },

  getProviderForServiceSync(serviceType) {
    const providerId = this.normalizeProviderId(this.serviceRouting[serviceType] || this.defaults.primaryProvider);
    if (providerId && this.providers[providerId]) {
      return this.providers[providerId];
    }
    return this.providers[this.defaults.primaryProvider];
  },

  async getProviderIdForService(serviceType) {
    try {
      const VtuConfig = require('../models/VtuConfig');
      
      if (VtuConfig.db && VtuConfig.db.collection) {
        const dbConfig = await VtuConfig.findOne({ key: 'serviceRouting' }).lean();
        
        if (dbConfig && dbConfig.value && dbConfig.value[serviceType]) {
          const resolvedProviderId = this.normalizeProviderId(dbConfig.value[serviceType]);
          if (this.providers[resolvedProviderId]) {
            this.serviceRouting[serviceType] = resolvedProviderId;
            console.log('getProviderIdForService - routing config fetched from DB:', serviceType, '=', resolvedProviderId);
            return resolvedProviderId;
          }
        }
      }
    } catch (error) {
      console.error('getProviderIdForService - DB fetch error:', error.message);
    }
    
    const fallbackProviderId = this.normalizeProviderId(this.serviceRouting[serviceType] || this.defaults.primaryProvider);
    return this.providers[fallbackProviderId] ? fallbackProviderId : this.defaults.primaryProvider;
  },

  getProviderIdForServiceSync(serviceType) {
    const providerId = this.normalizeProviderId(this.serviceRouting[serviceType] || this.defaults.primaryProvider);
    return this.providers[providerId] ? providerId : this.defaults.primaryProvider;
  },

  setProviderForService(serviceType, providerId) {
    const resolvedProviderId = this.normalizeProviderId(providerId);
    if (this.providers[resolvedProviderId]) {
      this.serviceRouting[serviceType] = resolvedProviderId;
      return true;
    }
    return false;
  },

  updateServiceRouting(config) {
    const validServices = ['data', 'airtime', 'airtimepin', 'education', 'electricity', 'cable', 'airtime2cash'];
    
    for (const [service, provider] of Object.entries(config)) {
      const resolvedProviderId = this.normalizeProviderId(provider);
      if (validServices.includes(service) && this.providers[resolvedProviderId]) {
        this.serviceRouting[service] = resolvedProviderId;
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
      'alrahuzdata': require('../services/alrahuzDataService'),
    };
    return serviceMap[source] || null;
  },

  getAirtimeService(source) {
    const serviceMap = {
      'nellobytes': require('../services/nelloBytesService'),
      'airtimenigeria': require('../services/airtimeNigeriaService'),
      'smeplug': require('../services/smePlugService'),
      'pluginng': require('../services/pluginngService'),
      'alrahuzdata': require('../services/alrahuzDataService'),
    };
    return serviceMap[source] || null;
  },

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
        const normalizedRouting = {};
        for (const [service, providerId] of Object.entries(dbConfig.value)) {
          const resolvedProviderId = this.normalizeProviderId(providerId);
          if (this.providers[resolvedProviderId]) {
            normalizedRouting[service] = resolvedProviderId;
          }
        }
        this.serviceRouting = { ...this.serviceRouting, ...normalizedRouting };
        console.log('✓ VTU service routing loaded from database:', JSON.stringify(normalizedRouting));
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

  async saveToDatabase(serviceRouting, userId = null) {
    try {
      const VtuConfig = require('../models/VtuConfig');
      
      const normalizedRouting = this.updateServiceRouting(serviceRouting);
      console.log('Saving VTU config to database:', normalizedRouting);
      
      const result = await VtuConfig.findOneAndUpdate(
        { key: 'serviceRouting' },
        {
          key: 'serviceRouting',
          value: normalizedRouting,
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

  


  async initialize() {
    await this.loadFromDatabase();
  },


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
        case 'alrahuzdata':
          normalizedData = this._normalizeAlrahuzData(data);
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


  _normalizeNelloBytes(data) {
    const result = {};
    const mobileNetwork = data.MOBILE_NETWORK || data;
    
    
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


  _normalizeNelloBytesPlan(plan) {
    const planName = plan.PRODUCT_NAME || '';
    return {
      id: plan.PRODUCT_ID || plan.ID || '',
      planCode: plan.PRODUCT_CODE || '',
      planName,
      network: '', 
      size: planName || '',
      price: parseFloat(plan.PRODUCT_AMOUNT) || 0,
      validity: this._extractValidity(planName || ''),
      providerPlanType: this._extractDataType(planName || ''),
    };
  },


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

  _normalizeAlrahuzData(data) {
    const payload = data?.data || data?.plans || data;
    const result = {};
    const aliases = {
      mtn: 'mtn',
      airtel: 'airtel',
      glo: 'glo',
      etisalat: '9mobile',
      '9mobile': '9mobile',
      '1': 'mtn',
      '2': 'glo',
      '3': '9mobile',
      '4': 'airtel',
      '01': 'mtn',
      '02': 'glo',
      '03': '9mobile',
      '04': 'airtel',
    };

    const normalizeKey = (value) => aliases[String(value || '').trim().toLowerCase()] || String(value || '').trim().toLowerCase();

    const pushPlan = (network, item) => {
      const normalizedNetwork = normalizeKey(network);
      if (!normalizedNetwork) return;
      if (!result[normalizedNetwork]) {
        result[normalizedNetwork] = [];
      }

      const planName = String(item?.plan || item?.plan_name || item?.name || '').trim();
      result[normalizedNetwork].push({
        id: String(item?.id || item?.plan_id || item?.plan_code || planName || '').trim(),
        planCode: String(item?.plan_code || item?.plan_id || item?.id || planName || '').trim(),
        providerPlanId: String(item?.plan_id || item?.id || item?.plan_code || planName || '').trim(),
        planName,
        network: normalizedNetwork,
        size: String(item?.volume || item?.size || planName || '').trim(),
        price: parseFloat(item?.amount || item?.price || item?.selling_price || 0) || 0,
        validity: String(item?.validity || '').trim(),
        providerPlanType: this._extractDataType(planName),
      });
    };

    if (Array.isArray(payload)) {
      for (const item of payload) {
        const network = item?.network || item?.network_name || item?.network_id;
        if (network != null) {
          pushPlan(network, item);
        }
      }
      return result;
    }

    if (payload && typeof payload === 'object') {
      for (const [network, plans] of Object.entries(payload)) {
        if (!Array.isArray(plans)) continue;
        for (const item of plans) {
          pushPlan(network, item);
        }
      }
    }

    return result;
  },

  


  _extractValidity(planName) {
    const match = planName.match(/(\d+\s*(?:day|week|month|year|hour|hr)s?)/i);
    return match ? match[1] : '';
  },

  


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
