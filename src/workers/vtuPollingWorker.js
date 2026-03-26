const { Worker } = require('bullmq');
const { createRedisConnection, ensureRedisNoEviction } = require('../config/redis');
const {
  VTU_TRANSACTION_QUEUE,
  VTU_POLL_JOB,
  VTU_RECOVERY_JOB,
  scheduleRecoveryJob,
} = require('../queues/vtuTransactionQueue');
const VtuPollingService = require('../services/vtuPollingService');
const logger = require('../utils/logger');

let worker;

async function startVtuPollingWorker() {
  if (worker || process.env.VTU_POLLING_ENABLED === 'false') {
    return worker;
  }

  const connection = createRedisConnection();
  await ensureRedisNoEviction(connection);
  await scheduleRecoveryJob();

  worker = new Worker(
    VTU_TRANSACTION_QUEUE,
    async (job) => {
      if (job.name === VTU_RECOVERY_JOB) {
        return VtuPollingService.recoverPendingTransactions();
      }

      if (job.name === VTU_POLL_JOB) {
        const { transactionId, attempt = 1 } = job.data;
        return VtuPollingService.pollTransaction(transactionId, attempt);
      }

      return null;
    },
    {
      connection,
      concurrency: Number(process.env.VTU_POLL_WORKER_CONCURRENCY || 5),
    }
  );

  worker.on('completed', (job, result) => {
    logger.info(`VTU polling job completed for ${job.data.transactionId}`, result);
  });

  worker.on('failed', (job, error) => {
    logger.error(`VTU polling job failed for ${job?.data?.transactionId}:`, error);
  });

  return worker;
}

async function stopVtuPollingWorker() {
  if (!worker) {
    return;
  }

  await worker.close();
  worker = null;
}

module.exports = {
  startVtuPollingWorker,
  stopVtuPollingWorker,
};
