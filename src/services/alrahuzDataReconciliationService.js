const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const NotificationService = require('./NotificationService');
const AlrahuzDataService = require('./alrahuzDataService');
const logger = require('../utils/logger');

class AlrahuzDataReconciliationService {
  static async refundTransactionToWallet(transaction, reason = 'Data purchase refund') {
    if (!transaction) return null;

    const alreadyRefunded = Boolean(transaction.metadata?.refundProcessed);
    if (alreadyRefunded) {
      return await Wallet.findOne({ user: transaction.user });
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

  static async reconcileTransaction(transaction, providerOrderId = null) {
    if (!transaction) {
      return { updated: false, status: 'unknown', providerResult: null };
    }

    const orderId = String(
      providerOrderId
      || transaction?.service?.orderId
      || transaction?.provider?.providerReference
      || ''
    ).trim();

    if (!orderId) {
      return { updated: false, status: 'pending', providerResult: null };
    }

    const providerResult = await AlrahuzDataService.getDataTransactionById(orderId);

    transaction.providerResponse = {
      ...(transaction.providerResponse || {}),
      query: providerResult?.raw || null,
      queryOrderId: orderId,
      queryAt: new Date().toISOString(),
    };

    if (providerResult.status === 'successful') {
      if (transaction.status !== 'successful') {
        transaction.status = 'successful';
        transaction.completedAt = new Date();
        transaction.statusHistory = transaction.statusHistory || [];
        transaction.statusHistory.push({
          status: 'successful',
          note: providerResult.message || 'Confirmed by Alrahuz transaction query',
          timestamp: new Date(),
        });
        await transaction.save();

        await NotificationService.dataPurchase(
          transaction.user,
          transaction.service?.network,
          transaction.service?.plan,
          transaction.service?.phoneNumber
        );
        return { updated: true, status: 'successful', providerResult };
      }
      return { updated: false, status: 'successful', providerResult };
    }

    if (providerResult.status === 'failed') {
      if (transaction.status !== 'failed') {
        await this.refundTransactionToWallet(transaction, 'Data purchase refund');
        transaction.status = 'failed';
        transaction.failureReason = providerResult.message || 'Failed per Alrahuz transaction query';
        transaction.completedAt = new Date();
        transaction.statusHistory = transaction.statusHistory || [];
        transaction.statusHistory.push({
          status: 'failed',
          note: providerResult.message || 'Failed per Alrahuz transaction query',
          timestamp: new Date(),
        });
        await transaction.save();

        await NotificationService.create({
          user: transaction.user,
          title: 'Data Purchase Failed',
          message: `Your ${transaction.service?.network || ''} data purchase failed. Amount has been refunded to your wallet.`,
          type: 'data',
          reference: transaction.reference,
        });
        return { updated: true, status: 'failed', providerResult };
      }
      return { updated: false, status: 'failed', providerResult };
    }

    if (transaction.status !== 'pending') {
      transaction.status = 'pending';
      transaction.statusHistory = transaction.statusHistory || [];
      transaction.statusHistory.push({
        status: 'pending',
        note: providerResult.message || 'Still pending on Alrahuz',
        timestamp: new Date(),
      });
      await transaction.save();
      return { updated: true, status: 'pending', providerResult };
    }

    await transaction.save();
    return { updated: false, status: 'pending', providerResult };
  }

  static async reconcilePendingTransactions(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || process.env.ALRAHUZ_RECON_LIMIT || 50), 200));

    const pendingTransactions = await Transaction.find({
      type: 'data_recharge',
      status: 'pending',
      'service.provider': 'alrahuzdata',
      'service.orderId': { $exists: true, $ne: '' },
    })
      .sort({ createdAt: 1 })
      .limit(limit);

    let checked = 0;
    let updated = 0;
    let successful = 0;
    let failed = 0;
    let pending = 0;
    let errors = 0;

    for (const transaction of pendingTransactions) {
      checked += 1;
      try {
        const result = await this.reconcileTransaction(transaction);
        if (result.updated) updated += 1;
        if (result.status === 'successful') successful += 1;
        else if (result.status === 'failed') failed += 1;
        else pending += 1;
      } catch (error) {
        errors += 1;
        logger.warn(`Alrahuz reconciliation failed for ${transaction.reference}: ${error.message}`);
      }
    }

    return {
      checked,
      updated,
      successful,
      failed,
      pending,
      errors,
    };
  }
}

module.exports = AlrahuzDataReconciliationService;

