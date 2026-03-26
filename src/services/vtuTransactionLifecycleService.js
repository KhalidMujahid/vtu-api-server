const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const NotificationService = require('./NotificationService');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');
const {
  enqueueTransactionPolling,
  cancelTransactionPolling,
} = require('../queues/vtuTransactionQueue');

const TERMINAL_STATUSES = new Set(['successful', 'failed', 'refunded', 'cancelled']);

function mergeMetadata(metadata = {}, patch = {}) {
  return {
    ...metadata,
    vtuPolling: {
      ...(metadata.vtuPolling || {}),
      ...patch,
    },
  };
}

class VtuTransactionLifecycleService {
  static isTerminalStatus(status) {
    return TERMINAL_STATUSES.has(status);
  }

  static async schedulePolling(transaction, options = {}) {
    const transactionId = String(transaction._id || transaction);
    return enqueueTransactionPolling(transactionId, options);
  }

  static async markPending(transactionId, details = {}) {
    const transaction = await Transaction.findById(transactionId);
    if (!transaction || this.isTerminalStatus(transaction.status)) {
      return transaction;
    }

    transaction.metadata = mergeMetadata(transaction.metadata, {
      lastPendingUpdateAt: new Date(),
      lastPendingUpdateSource: details.source || 'system',
      lastProviderPayload: details.providerResponse || null,
      pollingActive: true,
    });

    if (details.note) {
      transaction.statusHistory.push({
        status: 'pending',
        note: details.note,
        timestamp: new Date(),
      });
    }

    if (details.providerReference || details.providerResponse) {
      transaction.provider = {
        ...(transaction.provider || {}),
        name: details.providerName || transaction.provider?.name || transaction.service?.provider,
        providerReference:
          details.providerReference ||
          transaction.provider?.providerReference ||
          transaction.service?.orderId,
        providerResponse: details.providerResponse || transaction.provider?.providerResponse,
      };
    }

    await transaction.save();
    return transaction;
  }

  static async markSuccessful(transactionId, details = {}) {
    return this.#transitionTransaction(transactionId, 'successful', details);
  }

  static async markFailed(transactionId, details = {}) {
    return this.#transitionTransaction(transactionId, 'failed', details);
  }

  static async #transitionTransaction(transactionId, nextStatus, details = {}) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const transaction = await Transaction.findById(transactionId).session(session);

      if (!transaction) {
        throw new AppError('Transaction not found', 404);
      }

      if (this.isTerminalStatus(transaction.status)) {
        await session.abortTransaction();
        await cancelTransactionPolling(String(transaction._id));
        return {
          transaction,
          alreadyFinal: true,
        };
      }

      const now = new Date();

      transaction.status = nextStatus;
      transaction.completedAt = now;
      transaction.provider = {
        ...(transaction.provider || {}),
        name: details.providerName || transaction.provider?.name || transaction.service?.provider,
        providerReference:
          details.providerReference ||
          transaction.provider?.providerReference ||
          transaction.service?.orderId,
        providerResponse: details.providerResponse || transaction.provider?.providerResponse,
      };
      transaction.metadata = mergeMetadata(transaction.metadata, {
        pollingActive: false,
        lastResolvedAt: now,
        resolutionSource: details.source || 'system',
        lastProviderPayload: details.providerResponse || null,
        refundProcessed:
          nextStatus === 'failed'
            ? true
            : transaction.metadata?.vtuPolling?.refundProcessed || false,
      });
      transaction.statusHistory.push({
        status: nextStatus,
        note:
          details.note ||
          (nextStatus === 'successful'
            ? 'Transaction completed successfully'
            : 'Transaction failed'),
        timestamp: now,
      });

      if (nextStatus === 'failed') {
        const wallet = await Wallet.findOne({ user: transaction.user }).session(session);

        if (!wallet) {
          throw new AppError('Wallet not found for refund', 404);
        }

        wallet.balance += transaction.totalAmount;
        wallet.totalSpent = Math.max(0, wallet.totalSpent - transaction.totalAmount);
        wallet.lastTransaction = now;
        await wallet.save({ session });

        transaction.newBalance = wallet.balance;
      }

      await transaction.save({ session });
      await session.commitTransaction();

      await cancelTransactionPolling(String(transaction._id));
      await this.#sendNotification(transaction, nextStatus, details);

      return {
        transaction,
        alreadyFinal: false,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async #sendNotification(transaction, status, details = {}) {
    try {
      if (status === 'successful') {
        if (transaction.type === 'data_recharge') {
          await NotificationService.dataPurchase(
            transaction.user,
            transaction.service?.network,
            transaction.service?.plan,
            transaction.service?.phoneNumber
          );
          return;
        }

        if (transaction.type === 'airtime_recharge') {
          await NotificationService.airtimePurchase(
            transaction.user,
            transaction.service?.network,
            transaction.amount,
            transaction.service?.phoneNumber
          );
          return;
        }
      }

      if (status === 'failed') {
        await NotificationService.create({
          user: transaction.user,
          title: 'Purchase Failed',
          message:
            details.notificationMessage ||
            `Your ${transaction.type} of N${transaction.amount} failed. Amount has been refunded.`,
          type: 'purchase_failed',
          reference: transaction.reference,
        });
      }
    } catch (error) {
      logger.error('Failed to send VTU transaction notification:', error);
    }
  }
}

module.exports = VtuTransactionLifecycleService;
