const axios = require('axios');
const logger = require('../utils/logger');

class FxRateService {
  static cache = new Map();

  static get config() {
    return {
      baseUrl: process.env.FX_RATE_API_BASE_URL || 'https://api.frankfurter.dev/v2',
      timeout: Number(process.env.FX_RATE_TIMEOUT_MS || 15000),
      defaultBaseCurrency: process.env.FX_RATE_BASE_CURRENCY || 'USD',
      defaultQuoteCurrency: process.env.FX_RATE_QUOTE_CURRENCY || 'NGN',
      cacheTtlMs: Number(process.env.FX_RATE_CACHE_TTL_MS || 15 * 60 * 1000),
    };
  }

  static makeCacheKey(baseCurrency, quoteCurrency) {
    return `${String(baseCurrency || '').toUpperCase()}->${String(quoteCurrency || '').toUpperCase()}`;
  }

  static getCachedRate(baseCurrency, quoteCurrency) {
    const key = this.makeCacheKey(baseCurrency, quoteCurrency);
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.rate;
  }

  static setCachedRate(baseCurrency, quoteCurrency, rate) {
    const key = this.makeCacheKey(baseCurrency, quoteCurrency);
    this.cache.set(key, {
      rate,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }

  static async getRate(baseCurrency, quoteCurrency = this.config.defaultQuoteCurrency) {
    const normalizedBaseCurrency = String(baseCurrency || this.config.defaultBaseCurrency).trim().toUpperCase();
    const normalizedQuoteCurrency = String(quoteCurrency || this.config.defaultQuoteCurrency).trim().toUpperCase();

    const cachedRate = this.getCachedRate(normalizedBaseCurrency, normalizedQuoteCurrency);
    if (Number.isFinite(cachedRate) && cachedRate > 0) {
      return {
        baseCurrency: normalizedBaseCurrency,
        quoteCurrency: normalizedQuoteCurrency,
        rate: cachedRate,
        source: 'cache',
      };
    }

    try {
      const response = await axios.get(
        `${this.config.baseUrl}/rate/${encodeURIComponent(normalizedBaseCurrency)}/${encodeURIComponent(normalizedQuoteCurrency)}`,
        { timeout: this.config.timeout }
      );

      const rate = Number(response.data?.rate);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Invalid FX rate response');
      }

      this.setCachedRate(normalizedBaseCurrency, normalizedQuoteCurrency, rate);

      return {
        baseCurrency: normalizedBaseCurrency,
        quoteCurrency: normalizedQuoteCurrency,
        rate,
        source: 'frankfurter',
        date: response.data?.date || null,
      };
    } catch (error) {
      logger.warn('FX rate lookup failed', {
        baseCurrency: normalizedBaseCurrency,
        quoteCurrency: normalizedQuoteCurrency,
        message: error.message,
      });
      throw error;
    }
  }

  static async convert(amount, baseCurrency, quoteCurrency = this.config.defaultQuoteCurrency) {
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return {
        amount: null,
        rate: null,
        source: 'invalid-amount',
      };
    }

    const quote = await this.getRate(baseCurrency, quoteCurrency);
    const convertedAmount = amountNumber * quote.rate;

    return {
      amount: convertedAmount,
      rate: quote.rate,
      baseCurrency: quote.baseCurrency,
      quoteCurrency: quote.quoteCurrency,
      source: quote.source,
      date: quote.date || null,
    };
  }
}

module.exports = FxRateService;
