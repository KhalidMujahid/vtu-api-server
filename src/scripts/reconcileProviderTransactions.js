require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const PluginngService = require('../services/pluginngService');
const SmePlugService = require('../services/smePlugService');
const AlrahuzDataService = require('../services/alrahuzDataService');
const NotificationService = require('../services/NotificationService');
const logger = require('../utils/logger');

async function refundTransactionToWallet(transaction, reason = 'Transaction refund') {
  if (!transaction) return null;

  const alreadyRefunded = Boolean(transaction.metadata?.refundProcessed);
  if (alreadyRefunded) {
    return Wallet.findOne({ user: transaction.user });
  }

  const wallet = await Wallet.findOne({ user: transaction.user });
  if (!wallet) return null;

  const refundAmount = Number(transaction.amount || 0);
  if (refundAmount > 0) {
    await wallet.credit(refundAmount, reason);
  }

  transaction.metadata = {
    ...(transaction.metadata || {}),
    refundProcessed: true,
    refundProcessedAt: new Date().toISOString(),
    refundReason: reason,
  };

  if (typeof transaction.previousBalance === 'number') {
    transaction.newBalance = transaction.previousBalance;
  } else {
    transaction.newBalance = wallet.balance;
  }

  return wallet;
}

async function markSuccessful(tx, note, providerResponse = null) {
  if (tx.status !== 'successful') {
    tx.status = 'successful';
    tx.completedAt = new Date();
    tx.statusHistory.push({
      status: 'successful',
      note,
      timestamp: new Date(),
    });
    tx.provider = {
      ...(tx.provider || {}),
      providerResponse: providerResponse || tx.provider?.providerResponse,
    };
    await tx.save();

    try {
      if (tx.type === 'data_recharge') {
        await NotificationService.dataPurchase(tx.user, tx.service?.network, tx.service?.plan, tx.service?.phoneNumber);
      } else {
        await NotificationService.create({
          user: tx.user,
          title: 'Purchase Successful',
          message: `Your ${tx.type} of NGN ${tx.amount} was successful.`,
          type: 'purchase_success',
          reference: tx.reference,
        });
      }
    } catch (notifError) {
      logger.warn(`Notification skipped for ${tx.reference}: ${notifError.message}`);
    }

    return true;
  }
  return false;
}

async function markFailed(tx, note) {
  if (tx.status === 'successful') return false;

  await refundTransactionToWallet(tx, 'Purchase refund');
  if (tx.status !== 'failed') {
    tx.status = 'failed';
    tx.failureReason = note;
    tx.completedAt = new Date();
    tx.statusHistory.push({
      status: 'failed',
      note,
      timestamp: new Date(),
    });
  }
  await tx.save();
  return true;
}

async function getSmePlugReferenceMap() {
  const response = await SmePlugService.getTransactions();
  const records = response.transactions || [];
  const map = new Map();
  for (const rec of records) {
    const status = String(rec.status || rec.delivery_status || '').toLowerCase();
    const key = String(rec.reference || rec.customer_reference || '').trim();
    if (key) map.set(key, { status, note: rec.response || rec.message || '', raw: rec });
  }
  return map;
}

async function reconcilePluginng(tx) {
  const reference = tx.reference || tx.service?.orderId;
  if (!reference) return { state: 'skipped', tx };
  const result = await PluginngService.queryTransaction(reference);

  if (result.success && !result.pending) {
    const updated = await markSuccessful(tx, result.note || 'Reconciled to successful via Pluginng requery', result.raw);
    return { state: 'successful', updated };
  }
  if (result.failed) {
    const updated = await markFailed(tx, result.note || 'Reconciled to failed via Pluginng requery');
    return { state: 'failed', updated };
  }
  return { state: 'pending', tx };
}

async function reconcileAlrahuz(tx) {
  const orderId = tx.service?.orderId || tx.provider?.providerReference || tx.reference;
  if (!orderId) return { state: 'skipped', tx };

  const providerResult = await AlrahuzDataService.getDataTransactionById(orderId);

  if (providerResult.status === 'successful') {
    const updated = await markSuccessful(tx, providerResult.message || 'Reconciled to successful via Alrahuz query', providerResult.raw);
    return { state: 'successful', updated };
  }
  if (providerResult.status === 'failed') {
    const updated = await markFailed(tx, providerResult.message || 'Reconciled to failed via Alrahuz query');
    return { state: 'failed', updated };
  }
  return { state: 'pending', tx };
}

async function reconcileSmePlug(tx, referenceMap) {
  const reference = tx.reference || tx.service?.orderId;
  const rec = referenceMap.get(String(reference || ''));
  if (!rec) return { state: 'pending', tx };

  const SUCCESS = new Set(['success', 'successful', 'completed', 'delivered', 'ok', 'done']);
  const FAILED = new Set(['failed', 'failure', 'rejected', 'cancelled', 'canceled', 'error', 'undelivered', 'expired']);

  if (SUCCESS.has(rec.status)) {
    const updated = await markSuccessful(tx, rec.note || 'Reconciled to successful via SMEPlug', rec.raw);
    return { state: 'successful', updated };
  }
  if (FAILED.has(rec.status)) {
    const updated = await markFailed(tx, rec.note || 'Reconciled to failed via SMEPlug');
    return { state: 'failed', updated };
  }
  return { state: 'pending', tx };
}

async function reconcileTransactions({ limit = 200, onlyFailed = true }) {
  const statusFilter = onlyFailed ? 'failed' : { $in: ['failed', 'pending'] };

  const providers = ['pluginng', 'alrahuzdata', 'smeplug'];
  const transactions = await Transaction.find({
    'service.provider': { $in: providers },
    status: statusFilter,
  })
    .sort({ createdAt: -1 })
    .limit(limit);

  const summary = {
    scanned: transactions.length,
    markedSuccessful: 0,
    markedFailed: 0,
    stillPending: 0,
    skipped: 0,
    errors: 0,
    byProvider: {},
  };

  let smePlugMap = null;

  for (const tx of transactions) {
    const provider = tx.service?.provider || tx.provider?.name;
    const providerKey = String(provider || 'unknown');
    summary.byProvider[providerKey] = summary.byProvider[providerKey] || {
      scanned: 0, successful: 0, failed: 0, pending: 0, skipped: 0, errors: 0,
    };
    summary.byProvider[providerKey].scanned += 1;

    try {
      let result;
      if (String(provider).toLowerCase() === 'pluginng') {
        result = await reconcilePluginng(tx);
      } else if (String(provider).toLowerCase() === 'alrahuzdata') {
        result = await reconcileAlrahuz(tx);
      } else if (String(provider).toLowerCase() === 'smeplug') {
        if (!smePlugMap) {
          smePlugMap = await getSmePlugReferenceMap();
        }
        result = await reconcileSmePlug(tx, smePlugMap);
      } else {
        result = { state: 'skipped', tx };
      }

      const state = result.state || 'pending';
      if (state === 'successful') {
        summary.markedSuccessful += 1;
        summary.byProvider[providerKey].successful += 1;
      } else if (state === 'failed') {
        summary.markedFailed += 1;
        summary.byProvider[providerKey].failed += 1;
      } else if (state === 'pending') {
        summary.stillPending += 1;
        summary.byProvider[providerKey].pending += 1;
      } else {
        summary.skipped += 1;
        summary.byProvider[providerKey].skipped += 1;
      }
    } catch (error) {
      summary.errors += 1;
      summary.byProvider[providerKey].errors += 1;
      logger.error(`Reconcile error for ${tx.reference} (${providerKey}): ${error.message}`);
    }
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const onlyFailed = !args.includes('--all');
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) || 200 : 200;

  await connectDB();

  logger.info(`Reconciling provider transactions (onlyFailed=${onlyFailed}, limit=${limit})...`);
  const summary = await reconcileTransactions({ limit, onlyFailed });
  console.log('Reconciliation summary:', JSON.stringify(summary, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  logger.error('Reconcile script failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
