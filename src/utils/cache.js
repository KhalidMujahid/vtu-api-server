const logger = require('../utils/logger');
const { getRedisConnection, isRedisConfigured } = require('../config/redis');

const TTL = {
  PLANS: Number(process.env.PLANS_CACHE_TTL_MS || 5 * 60 * 1000),
};

const inMemoryCache = new Map();
const inMemoryTtl = new Map();

async function redisAvailable(connection) {
  if (!connection) return false;
  try {
    if (connection.status === 'wait') await connection.connect();
    await connection.ping();
    return true;
  } catch (error) {
    return false;
  }
}

function pruneMemory() {
  const now = Date.now();
  for (const [key, expiresAt] of inMemoryTtl.entries()) {
    if (expiresAt <= now) {
      inMemoryCache.delete(key);
      inMemoryTtl.delete(key);
    }
  }
}

async function getCached(key) {
  const connection = getRedisConnection();
  if (isRedisConfigured() && connection) {
    const available = await redisAvailable(connection);
    if (available) {
      try {
        const raw = await connection.get(key);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (error) {
        logger.warn(`Redis cache get failed for ${key}: ${error.message}`);
      }
    }
  }

  pruneMemory();
  const expiresAt = inMemoryTtl.get(key);
  if (expiresAt && expiresAt > Date.now() && inMemoryCache.has(key)) {
    return inMemoryCache.get(key);
  }
  inMemoryCache.delete(key);
  inMemoryTtl.delete(key);
  return null;
}

async function setCached(key, value, ttl = TTL.PLANS) {
  const connection = getRedisConnection();
  if (isRedisConfigured() && connection) {
    const available = await redisAvailable(connection);
    if (available) {
      try {
        await connection.set(key, JSON.stringify(value), 'PX', ttl);
        return;
      } catch (error) {
        logger.warn(`Redis cache set failed for ${key}: ${error.message}`);
      }
    }
  }

  inMemoryCache.set(key, value);
  inMemoryTtl.set(key, Date.now() + ttl);
}

async function clearCached(prefix) {
  const connection = getRedisConnection();
  if (isRedisConfigured() && connection) {
    const available = await redisAvailable(connection);
    if (available) {
      try {
        const keys = await connection.keys(`${prefix}:*`);
        if (keys.length) await connection.del(...keys);
      } catch (error) {
        logger.warn(`Redis cache clear failed for ${prefix}:*: ${error.message}`);
      }
    }
  }

  for (const key of inMemoryCache.keys()) {
    if (key.startsWith(`${prefix}:`)) {
      inMemoryCache.delete(key);
      inMemoryTtl.delete(key);
    }
  }
}

module.exports = {
  TTL,
  getCached,
  setCached,
  clearCached,
};
