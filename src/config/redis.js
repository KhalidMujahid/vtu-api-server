const IORedis = require('ioredis');
const logger = require('../utils/logger');

let sharedConnection;
let lastRedisErrorMessage = null;

function isRedisConfigured() {
  return Boolean(
    process.env.REDIS_URL ||
    process.env.REDIS_HOST ||
    process.env.REDIS_PORT
  );
}

function getRedisOverrides() {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000),
  };
}

function buildRedisConfig() {
  if (!isRedisConfigured()) {
    return null;
  }

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
  if (!config) {
    return null;
  }

  let connection;

  if (config.url) {
    connection = new IORedis(config.url, getRedisOverrides());
  } else {
    connection = new IORedis(config);
  }

  connection.on('error', (error) => {
    if (error.message !== lastRedisErrorMessage) {
      lastRedisErrorMessage = error.message;
      logger.warn(`Redis connection error: ${error.message}`);
    }
  });

  return connection;
}

function getRedisConnection() {
  if (!sharedConnection) {
    sharedConnection = createRedisConnection();
  }

  return sharedConnection;
}

async function ensureRedisNoEviction(connection = getRedisConnection()) {
  if (!connection) {
    return { policy: null, updated: false, skipped: true };
  }

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

async function verifyRedisConnection(connection = getRedisConnection()) {
  if (!connection) {
    return { available: false, reason: 'not_configured' };
  }

  try {
    if (connection.status === 'wait') {
      await connection.connect();
    }

    await connection.ping();
    return { available: true };
  } catch (error) {
    logger.warn(`Redis unavailable, VTU queue disabled: ${error.message}`);
    return { available: false, reason: error.message };
  }
}

module.exports = {
  isRedisConfigured,
  buildRedisConfig,
  createRedisConnection,
  getRedisConnection,
  ensureRedisNoEviction,
  verifyRedisConnection,
};
