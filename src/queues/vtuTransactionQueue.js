const { Queue } = require('bullmq');
const { getRedisConnection } = require('../config/redis');

const VTU_TRANSACTION_QUEUE = 'vtu-transaction-polling';
const VTU_POLL_JOB = 'poll-vtu-transaction';
const VTU_RECOVERY_JOB = 'recover-vtu-transaction-polling';

let queue;

function getQueue() {
  if (!queue) {
    queue = new Queue(VTU_TRANSACTION_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    });
  }

  return queue;
}

function getNextDelay(attempt = 1) {
  const baseDelay = Number(process.env.VTU_POLL_BASE_DELAY_MS || 15000);
  const maxDelay = Number(process.env.VTU_POLL_MAX_DELAY_MS || 120000);
  const computedDelay = baseDelay * Math.max(1, attempt);

  return Math.min(computedDelay, maxDelay);
}

async function enqueueTransactionPolling(transactionId, options = {}) {
  const {
    attempt = 1,
    delay = getNextDelay(attempt),
    reason = 'scheduled',
  } = options;

  return getQueue().add(
    VTU_POLL_JOB,
    {
      transactionId,
      attempt,
      reason,
    },
    {
      jobId: `poll:${transactionId}`,
      delay,
    }
  );
}

async function scheduleRecoveryJob() {
  const every = Number(process.env.VTU_RECOVERY_INTERVAL_MS || 300000);

  return getQueue().add(
    VTU_RECOVERY_JOB,
    {
      scheduledAt: new Date().toISOString(),
    },
    {
      jobId: VTU_RECOVERY_JOB,
      repeat: { every },
      removeOnComplete: 50,
      removeOnFail: 50,
    }
  );
}

async function cancelTransactionPolling(transactionId) {
  const jobs = await getQueue().getJobs(['delayed', 'waiting', 'prioritized'], 0, 200);
  const matchingJobs = jobs.filter((job) => job?.data?.transactionId === String(transactionId));

  await Promise.all(
    matchingJobs.map(async (job) => {
      try {
        await job.remove();
      } catch (error) {
        if (error.message !== 'Could not remove job') {
          throw error;
        }
      }
    })
  );
}

module.exports = {
  VTU_TRANSACTION_QUEUE,
  VTU_POLL_JOB,
  VTU_RECOVERY_JOB,
  getQueue,
  getNextDelay,
  enqueueTransactionPolling,
  cancelTransactionPolling,
  scheduleRecoveryJob,
};
