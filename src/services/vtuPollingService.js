const Transaction = require('../models/Transaction');
const vtuConfig = require('../config/vtuProviders');
const NelloBytesService = require('./nelloBytesService');
const SmePlugService = require('./smePlugService');
const PluginngService = require('./pluginngService');
const ReloadlyGiftCardService = require('./reloadlyGiftCardService');
const VtuTransactionLifecycleService = require('./vtuTransactionLifecycleService');
const logger = require('../utils/logger');

const SUCCESS_STATES = new Set(['success', 'successful', 'completed', 'delivered', 'order_completed']);
const FAILURE_STATES = new Set(['failed', 'failure', 'error', 'reversed', 'cancelled', 'order_cancelled']);

class VtuPollingService {
  static getProviderSource(transaction) {
    const providerKey = transaction.service?.provider || transaction.provider?.name;
    return vtuConfig.providers[providerKey]?.source || providerKey || 'unknown';
  }

  static getMaxAttempts() {
    return Number(process.env.VTU_POLL_MAX_ATTEMPTS || 20);
  }

  static getTimeoutMs() {
    return Number(process.env.VTU_POLL_TIMEOUT_MS || 20 * 60 * 1000);
  }

  static async pollTransaction(transactionId, attempt = 1) {
    const transaction = await Transaction.findById(transactionId);

    if (!transaction) {
      logger.warn(`Skipping poll for missing transaction ${transactionId}`);
      return { completed: true, reason: 'missing_transaction' };
    }

    if (VtuTransactionLifecycleService.isTerminalStatus(transaction.status)) {
      return { completed: true, reason: 'already_terminal' };
    }

    const ageMs = Date.now() - new Date(transaction.createdAt).getTime();
    if (attempt > this.getMaxAttempts() || ageMs > this.getTimeoutMs()) {
      await VtuTransactionLifecycleService.markFailed(transaction._id, {
        source: 'polling-timeout',
        note: 'Transaction timed out while waiting for provider confirmation',
      });
      return { completed: true, reason: 'timed_out' };
    }

    const providerStatus = await this.fetchProviderStatus(transaction);

    if (providerStatus.state === 'successful') {
      await VtuTransactionLifecycleService.markSuccessful(transaction._id, {
        source: `polling:${providerStatus.provider}`,
        note: providerStatus.note,
        providerName: transaction.service?.provider,
        providerReference: providerStatus.providerReference,
        providerResponse: providerStatus.raw,
      });
      return { completed: true, reason: 'successful' };
    }

    if (providerStatus.state === 'failed') {
      await VtuTransactionLifecycleService.markFailed(transaction._id, {
        source: `polling:${providerStatus.provider}`,
        note: providerStatus.note,
        providerName: transaction.service?.provider,
        providerReference: providerStatus.providerReference,
        providerResponse: providerStatus.raw,
      });
      return { completed: true, reason: 'failed' };
    }

    await VtuTransactionLifecycleService.markPending(transaction._id, {
      source: `polling:${providerStatus.provider}`,
      note: providerStatus.note,
      providerName: transaction.service?.provider,
      providerReference: providerStatus.providerReference,
      providerResponse: providerStatus.raw,
    });

    await VtuTransactionLifecycleService.schedulePolling(transaction._id, {
      attempt: attempt + 1,
      reason: providerStatus.note || 'still_processing',
    });

    return { completed: false, reason: 'rescheduled' };
  }

  static async recoverPendingTransactions() {
    const cutoff = new Date(Date.now() - this.getTimeoutMs());
    const pendingTransactions = await Transaction.find({
      status: 'pending',
      createdAt: { $gte: cutoff },
      'service.orderId': { $exists: true, $ne: null },
    })
      .select('_id reference metadata createdAt')
      .sort({ createdAt: 1 })
      .limit(Number(process.env.VTU_RECOVERY_BATCH_SIZE || 100))
      .lean();

    let recovered = 0;

    for (const transaction of pendingTransactions) {
      await VtuTransactionLifecycleService.schedulePolling(transaction._id, {
        attempt: Number(transaction.metadata?.vtuPolling?.lastRecoveryAttempt || 1),
        delay: Number(process.env.VTU_RECOVERY_REQUEUE_DELAY_MS || 1000),
        reason: 'recovery',
      });
      recovered += 1;
    }

    return {
      scanned: pendingTransactions.length,
      recovered,
    };
  }

  static async fetchProviderStatus(transaction) {
    const source = this.getProviderSource(transaction);

    switch (source) {
      case 'nellobytes':
        return this.fetchNelloBytesStatus(transaction);
      case 'smeplug':
        return this.fetchSmePlugStatus(transaction);
      case 'airtimenigeria':
        return {
          state: 'pending',
          provider: source,
          providerReference: transaction.service?.orderId,
          note: 'Awaiting AirtimeNigeria callback confirmation',
          raw: null,
        };
      case 'pluginng':
        return this.fetchPluginngStatus(transaction);
      case 'reloadly':
        return this.fetchReloadlyStatus(transaction);
      default:
        return {
          state: 'pending',
          provider: source,
          providerReference: transaction.service?.orderId,
          note: 'Awaiting provider confirmation',
          raw: null,
        };
    }
  }

  static async fetchNelloBytesStatus(transaction) {
    const raw = await NelloBytesService.queryDataTransaction({
      orderId: transaction.service?.orderId,
      requestId: transaction.reference,
    });

    const statusCode = String(raw.statusCode || '').toLowerCase();
    const status = String(raw.status || '').toLowerCase();

    if (statusCode === '200' || status === 'order_completed') {
      return {
        state: 'successful',
        provider: 'nellobytes',
        providerReference: raw.orderId,
        note: raw.remark || 'Provider confirmed successful delivery',
        raw,
      };
    }

    if (statusCode === '100' || status === 'order_received' || status === 'order_onhold') {
      return {
        state: 'pending',
        provider: 'nellobytes',
        providerReference: raw.orderId,
        note: raw.remark || 'Provider is still processing the order',
        raw,
      };
    }

    return {
      state: 'failed',
      provider: 'nellobytes',
      providerReference: raw.orderId,
      note: raw.remark || 'Provider reported a failed transaction',
      raw,
    };
  }

  static async fetchSmePlugStatus(transaction) {
    const response = await SmePlugService.getTransactions();
    const records = response.transactions || [];
    const orderId = transaction.service?.orderId;

    const providerTransaction =
      records.find((item) => item?.reference === orderId) ||
      records.find((item) => item?.reference === transaction.reference) ||
      records.find((item) => item?.customer_reference === transaction.reference);

    if (!providerTransaction) {
      return {
        state: 'pending',
        provider: 'smeplug',
        providerReference: orderId,
        note: 'SMEPlug transaction is not yet visible in the provider ledger',
        raw: records.slice(0, 5),
      };
    }

    const status = String(providerTransaction.status || providerTransaction.delivery_status || '').toLowerCase();

    if (SUCCESS_STATES.has(status)) {
      return {
        state: 'successful',
        provider: 'smeplug',
        providerReference: providerTransaction.reference || orderId,
        note: providerTransaction.response || providerTransaction.message || 'Provider confirmed successful delivery',
        raw: providerTransaction,
      };
    }

    if (FAILURE_STATES.has(status)) {
      return {
        state: 'failed',
        provider: 'smeplug',
        providerReference: providerTransaction.reference || orderId,
        note: providerTransaction.response || providerTransaction.message || 'Provider reported a failed transaction',
        raw: providerTransaction,
      };
    }

    return {
      state: 'pending',
      provider: 'smeplug',
      providerReference: providerTransaction.reference || orderId,
      note: providerTransaction.response || providerTransaction.message || 'Provider is still processing the order',
      raw: providerTransaction,
    };
  }

  static async fetchPluginngStatus(transaction) {
    const reference = transaction.reference || transaction.service?.orderId;
    const result = await PluginngService.queryTransaction(reference);

    if (result.success) {
      return {
        state: 'successful',
        provider: 'pluginng',
        providerReference: result.orderId || reference,
        note: result.note || 'Provider confirmed successful delivery',
        raw: result.raw,
      };
    }

    if (result.pending) {
      return {
        state: 'pending',
        provider: 'pluginng',
        providerReference: result.orderId || reference,
        note: result.note || 'Provider is still processing the order',
        raw: result.raw,
      };
    }

    return {
      state: 'failed',
      provider: 'pluginng',
      providerReference: result.orderId || reference,
      note: result.note || 'Provider reported a failed transaction',
      raw: result.raw,
    };
  }

  static async fetchReloadlyStatus(transaction) {
    const providerReference = transaction.service?.orderId || transaction.reference;
    let rawResponse;
    try {
      rawResponse = await ReloadlyGiftCardService.getTransactionById(providerReference);
    } catch (error) {
      return {
        state: 'pending',
        provider: 'reloadly',
        providerReference: String(providerReference),
        note: error.message || 'Reloadly transaction is not yet queryable',
        raw: null,
      };
    }
    const raw = Array.isArray(rawResponse) ? rawResponse[0] || {} : rawResponse || {};
    const status = String(raw.status || '').toUpperCase();

    if (status === 'SUCCESSFUL') {
      return {
        state: 'successful',
        provider: 'reloadly',
        providerReference: String(raw.transactionId || providerReference),
        note: 'Reloadly confirmed successful gift card delivery',
        raw,
      };
    }

    if (status === 'FAILED' || status === 'REFUNDED') {
      return {
        state: 'failed',
        provider: 'reloadly',
        providerReference: String(raw.transactionId || providerReference),
        note: `Reloadly reported transaction as ${status || 'FAILED'}`,
        raw,
      };
    }

    return {
      state: 'pending',
      provider: 'reloadly',
      providerReference: String(raw.transactionId || providerReference),
      note: `Reloadly status is ${status || 'PENDING'}`,
      raw,
    };
  }
}

module.exports = VtuPollingService;
