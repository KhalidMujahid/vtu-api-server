const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const NotificationService = require('./NotificationService');
const NelloBytesService = require('./nelloBytesService');
const SmePlugService = require('./smePlugService');
const logger = require('../utils/logger');

function normalizeCallbackStatus(input = '') {
  return String(input || '').trim().toUpperCase();
}

function classifyNelloStatus({ statusCode = '', orderStatus = '', rawStatus = '' } = {}) {
  const code = String(statusCode).trim();
  const normalizedOrderStatus = normalizeCallbackStatus(orderStatus);
  const normalizedRawStatus = normalizeCallbackStatus(rawStatus);
  const statusSignals = [normalizedOrderStatus, normalizedRawStatus].filter(Boolean);

  if (code === '200' || statusSignals.includes('ORDER_COMPLETED')) {
    return 'successful';
  }

  if (code === '100' || statusSignals.includes('ORDER_RECEIVED') || statusSignals.includes('ORDER_ONHOLD')) {
    return 'pending';
  }

  return 'failed';
}

async function refundIfNeeded(transaction, reason = 'Airtime purchase refund') {
  if (!transaction || transaction?.metadata?.refundProcessed) return false;

  const amount = Number(transaction.totalAmount || transaction.amount || 0);
  if (amount <= 0) return false;

  const wallet = await Wallet.findOne({ user: transaction.user });
  if (!wallet) return false;

  await wallet.credit(amount);

  transaction.metadata = {
    ...(transaction.metadata || {}),
    refundProcessed: true,
    refundProcessedAt: new Date().toISOString(),
    refundReason: reason,
  };

  return true;
}

class AirtimeReconciliationService {
  static async notifySuccess(transaction) {
    if (!transaction) return;

    if (transaction.type === 'airtime_recharge') {
      await NotificationService.airtimePurchase(
        transaction.user,
        transaction.service?.network,
        transaction.amount,
        transaction.service?.phoneNumber
      );
      return;
    }

    if (transaction.type === 'data_recharge') {
      await NotificationService.dataPurchase(
        transaction.user,
        transaction.service?.network,
        transaction.service?.plan,
        transaction.service?.phoneNumber
      );
      return;
    }

    await NotificationService.create({
      user: transaction.user,
      title: 'Transaction Successful',
      message: `Your ${transaction.type || 'transaction'} of N${transaction.amount} was confirmed successful.`,
      type: 'transaction_successful',
      reference: transaction.reference,
    });
  }

  static async notifyFailed(transaction) {
    if (!transaction) return;
    await NotificationService.create({
      user: transaction.user,
      title: 'Transaction Failed',
      message: `Your ${transaction.type || 'transaction'} of N${transaction.amount} failed. Amount has been refunded.`,
      type: 'transaction_failed',
      reference: transaction.reference,
    });
  }

  static async reconcilePendingClubKonnectTransactions(options = {}) {
    const requestedLimit = Number(options.limit ?? process.env.AIRTIME_RECONCILE_BATCH_SIZE ?? 100);
    const limit = Number.isNaN(requestedLimit) ? 100 : Math.max(1, Math.min(500, requestedLimit));

    const maxAgeDaysRaw = Number(options.maxAgeDays ?? process.env.AIRTIME_RECONCILE_MAX_AGE_DAYS ?? 30);
    const maxAgeDays = Number.isNaN(maxAgeDaysRaw) ? 30 : Math.max(1, maxAgeDaysRaw);
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    const transactions = await Transaction.find({
      status: 'pending',
      createdAt: { $gte: cutoffDate },
      $or: [{ 'service.provider': 'clubkonnect' }, { 'service.provider': 'nellobytes' }],
    })
      .sort({ createdAt: 1 })
      .limit(limit);

    let updatedSuccessful = 0;
    let updatedFailed = 0;
    let stillPending = 0;
    let skipped = 0;
    let errors = 0;

    for (const transaction of transactions) {
      try {
        const providerResult = await NelloBytesService.queryDataTransaction({
          orderId: transaction.service?.orderId || null,
          requestId: transaction.service?.requestId || transaction.reference || null,
        });

        const mappedStatus = classifyNelloStatus({
          statusCode: providerResult?.statusCode,
          orderStatus: providerResult?.status,
          rawStatus: providerResult?.status,
        });

        if (mappedStatus === 'pending') {
          stillPending += 1;
          continue;
        }

        transaction.providerResponse = {
          ...(transaction.providerResponse || {}),
          query: providerResult?.response || providerResult,
        };
        transaction.statusHistory = transaction.statusHistory || [];

        if (mappedStatus === 'successful') {
          transaction.status = 'successful';
          transaction.completedAt = new Date();
          transaction.statusHistory.push({
            status: 'successful',
            note: providerResult?.remark || providerResult?.status || `Confirmed by scheduled clubkonnect reconciliation (${transaction.type})`,
            timestamp: new Date(),
          });
          await transaction.save();

          await this.notifySuccess(transaction);

          updatedSuccessful += 1;
          continue;
        }

        transaction.status = 'failed';
        transaction.completedAt = new Date();
        transaction.statusHistory.push({
          status: 'failed',
          note: providerResult?.remark || providerResult?.status || `Failed per scheduled clubkonnect reconciliation (${transaction.type})`,
          timestamp: new Date(),
        });

        await refundIfNeeded(transaction, 'Transaction refund');
        await transaction.save();
        await this.notifyFailed(transaction);
        updatedFailed += 1;
      } catch (error) {
        errors += 1;
        skipped += 1;
        logger.warn(`Scheduled clubkonnect reconcile skipped for ${transaction.reference}: ${error.message}`);
      }
    }

    return {
      scanned: transactions.length,
      updatedSuccessful,
      updatedFailed,
      stillPending,
      skipped,
      errors,
    };
  }

  static async reconcilePendingSmePlugTransactions(options = {}) {
    const requestedLimit = Number(options.limit ?? process.env.AIRTIME_RECONCILE_BATCH_SIZE ?? 100);
    const limit = Number.isNaN(requestedLimit) ? 100 : Math.max(1, Math.min(500, requestedLimit));

    const maxAgeDaysRaw = Number(options.maxAgeDays ?? process.env.AIRTIME_RECONCILE_MAX_AGE_DAYS ?? 30);
    const maxAgeDays = Number.isNaN(maxAgeDaysRaw) ? 30 : Math.max(1, maxAgeDaysRaw);
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    const transactions = await Transaction.find({
      status: 'pending',
      createdAt: { $gte: cutoffDate },
      'service.provider': 'smeplug',
    })
      .sort({ createdAt: 1 })
      .limit(limit);

    let updatedSuccessful = 0;
    let updatedFailed = 0;
    let stillPending = 0;
    let skipped = 0;
    let errors = 0;

    let providerTransactions = [];
    try {
      const providerFeed = await SmePlugService.getTransactions();
      providerTransactions = Array.isArray(providerFeed?.transactions) ? providerFeed.transactions : [];
    } catch (error) {
      logger.warn(`Scheduled SMEPlug airtime reconciliation skipped (provider feed unavailable): ${error.message}`);
      return {
        scanned: transactions.length,
        updatedSuccessful,
        updatedFailed,
        stillPending: transactions.length,
        skipped,
        errors: transactions.length ? 1 : 0,
      };
    }

    const findProviderTx = (transaction) => {
      const orderId = String(transaction.service?.orderId || '').trim();
      const reference = String(transaction.reference || '').trim();

      return providerTransactions.find((item) => String(item?.reference || '').trim() === orderId)
        || providerTransactions.find((item) => String(item?.reference || '').trim() === reference)
        || providerTransactions.find((item) => String(item?.customer_reference || '').trim() === reference)
        || null;
    };

    for (const transaction of transactions) {
      try {
        const providerTx = findProviderTx(transaction);
        if (!providerTx) {
          stillPending += 1;
          continue;
        }

        const providerStatus = providerTx.status || providerTx.delivery_status || providerTx.deliveryStatus;
        transaction.providerResponse = {
          ...(transaction.providerResponse || {}),
          query: providerTx,
        };
        transaction.statusHistory = transaction.statusHistory || [];

        if (SmePlugService.isSuccessfulDeliveryStatus(providerStatus)) {
          transaction.status = 'successful';
          transaction.completedAt = new Date();
          transaction.statusHistory.push({
            status: 'successful',
            note: providerTx.response || providerTx.message || `Confirmed by scheduled smeplug reconciliation (${transaction.type})`,
            timestamp: new Date(),
          });
          await transaction.save();

          await this.notifySuccess(transaction);
          updatedSuccessful += 1;
          continue;
        }

        if (SmePlugService.isFailedDeliveryStatus(providerStatus)) {
          transaction.status = 'failed';
          transaction.completedAt = new Date();
          transaction.statusHistory.push({
            status: 'failed',
            note: providerTx.response || providerTx.message || `Failed per scheduled smeplug reconciliation (${transaction.type})`,
            timestamp: new Date(),
          });

          await refundIfNeeded(transaction, 'Transaction refund');
          await transaction.save();
          await this.notifyFailed(transaction);
          updatedFailed += 1;
          continue;
        }

        stillPending += 1;
      } catch (error) {
        errors += 1;
        skipped += 1;
        logger.warn(`Scheduled smeplug reconcile skipped for ${transaction.reference}: ${error.message}`);
      }
    }

    return {
      scanned: transactions.length,
      updatedSuccessful,
      updatedFailed,
      stillPending,
      skipped,
      errors,
    };
  }

  static async reconcilePendingTransactions(options = {}) {
    const clubkonnect = await this.reconcilePendingClubKonnectTransactions(options);
    const smeplug = await this.reconcilePendingSmePlugTransactions(options);

    return {
      providers: {
        clubkonnect,
        smeplug,
      },
      totals: {
        scanned: (clubkonnect.scanned || 0) + (smeplug.scanned || 0),
        updatedSuccessful: (clubkonnect.updatedSuccessful || 0) + (smeplug.updatedSuccessful || 0),
        updatedFailed: (clubkonnect.updatedFailed || 0) + (smeplug.updatedFailed || 0),
        stillPending: (clubkonnect.stillPending || 0) + (smeplug.stillPending || 0),
        skipped: (clubkonnect.skipped || 0) + (smeplug.skipped || 0),
        errors: (clubkonnect.errors || 0) + (smeplug.errors || 0),
      },
    };
  }
}

module.exports = AirtimeReconciliationService;
