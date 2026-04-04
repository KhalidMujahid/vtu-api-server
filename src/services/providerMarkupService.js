const Settings = require('../models/Settings');
const vtuConfig = require('../config/vtuProviders');

const SETTINGS_KEY = 'pricing.providerMarkupPercentages';

const SERVICE_TYPE_ALIASES = {
  data: 'data_recharge',
  data_recharge: 'data_recharge',
  airtime: 'airtime_recharge',
  airtime_recharge: 'airtime_recharge',
  recharge_pin: 'recharge_pin',
  airtimepin: 'recharge_pin',
  electricity: 'electricity',
  cable: 'cable_tv',
  cable_tv: 'cable_tv',
  education: 'education_pin',
  education_pin: 'education_pin',
};

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeProviderId(providerId = '') {
  if (typeof vtuConfig.normalizeProviderId === 'function') {
    return vtuConfig.normalizeProviderId(providerId);
  }
  return String(providerId || '').trim().toLowerCase();
}

function normalizeServiceType(serviceType = '') {
  const key = String(serviceType || '').trim().toLowerCase();
  return SERVICE_TYPE_ALIASES[key] || key;
}

class ProviderMarkupService {
  static normalizeProviderId(providerId) {
    return normalizeProviderId(providerId);
  }

  static normalizeServiceType(serviceType) {
    return normalizeServiceType(serviceType);
  }

  static async getMarkupConfig() {
    const doc = await Settings.findOne({ key: SETTINGS_KEY }).lean();
    const value = doc?.value;
    return value && typeof value === 'object' ? value : {};
  }

  static async getAllMarkups() {
    return this.getMarkupConfig();
  }

  static async getMarkupPercentage(providerId, serviceType) {
    const normalizedProviderId = normalizeProviderId(providerId);
    const normalizedServiceType = normalizeServiceType(serviceType);
    const config = await this.getMarkupConfig();
    const providerConfig = config[normalizedProviderId] || {};
    const percent = Number(providerConfig[normalizedServiceType] || 0);
    return Number.isFinite(percent) ? percent : 0;
  }

  static async setMarkupPercentage({ providerId, serviceType, percentage, updatedBy = null }) {
    const normalizedProviderId = normalizeProviderId(providerId);
    const normalizedServiceType = normalizeServiceType(serviceType);

    if (!normalizedProviderId || !vtuConfig.providers[normalizedProviderId]) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    if (!normalizedServiceType) {
      throw new Error('serviceType is required');
    }

    const parsedPercentage = Number(percentage);
    if (!Number.isFinite(parsedPercentage) || parsedPercentage < 0 || parsedPercentage > 500) {
      throw new Error('percentage must be a number between 0 and 500');
    }

    const currentConfig = await this.getMarkupConfig();
    const nextConfig = { ...currentConfig };
    const providerConfig = { ...(nextConfig[normalizedProviderId] || {}) };
    providerConfig[normalizedServiceType] = round2(parsedPercentage);
    nextConfig[normalizedProviderId] = providerConfig;

    await Settings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      {
        key: SETTINGS_KEY,
        value: nextConfig,
        category: 'fees',
        description: 'Provider-based markup percentages by service type',
        updatedBy,
      },
      { upsert: true, new: true }
    );

    return {
      providerId: normalizedProviderId,
      serviceType: normalizedServiceType,
      percentage: providerConfig[normalizedServiceType],
      config: nextConfig,
    };
  }

  static async applyMarkup({ providerId, serviceType, baseAmount }) {
    const amount = Number(baseAmount || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      return {
        baseAmount: 0,
        percentage: 0,
        markupAmount: 0,
        chargedAmount: 0,
      };
    }

    const percentage = await this.getMarkupPercentage(providerId, serviceType);
    const markupAmount = round2((amount * percentage) / 100);
    const chargedAmount = round2(amount + markupAmount);

    return {
      baseAmount: round2(amount),
      percentage: round2(percentage),
      markupAmount,
      chargedAmount,
    };
  }
}

module.exports = ProviderMarkupService;
