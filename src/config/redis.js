const IORedis = require('ioredis');
const logger = require('../utils/logger');

let sharedConnection;

function getRedisOverrides() {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

function buildRedisConfig() {
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
      ...getRedisOverrides(),
    };
  }

  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    ...getRedisOverrides(),
  };
}

function createRedisConnection() {
  const config = buildRedisConfig();

  if (config.url) {
    return new IORedis(config.url, getRedisOverrides());
  }

  return new IORedis(config);
}

function getRedisConnection() {
  if (!sharedConnection) {
    sharedConnection = createRedisConnection();
  }

  return sharedConnection;
}

async function ensureRedisNoEviction(connection = getRedisConnection()) {
  try {
    const response = await connection.config('GET', 'maxmemory-policy');
    const policy = Array.isArray(response) ? response[1] : null;

    if (policy === 'noeviction') {
      return { policy, updated: false };
    }

    if (process.env.VTU_REDIS_ENFORCE_NOEVICTION === 'false') {
      logger.warn(`Redis eviction policy is ${policy}. BullMQ works best with noeviction.`);
      return { policy, updated: false };
    }

    await connection.config('SET', 'maxmemory-policy', 'noeviction');
    logger.info(`Redis eviction policy changed from ${policy} to noeviction for BullMQ.`);
    return { policy: 'noeviction', updated: true };
  } catch (error) {
    logger.warn(
      `Unable to verify or set Redis eviction policy to noeviction: ${error.message}`
    );
    return { policy: null, updated: false, error: error.message };
  }
}

module.exports = {
  buildRedisConfig,
  createRedisConnection,
  getRedisConnection,
  ensureRedisNoEviction,
};
