const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const ServicePricing = require('../models/ServicePricing');
const ProviderStatus = require('../models/ProviderStatus');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const telecomService = require('./telecomService');
const billsService = require('./billsService');

class TransactionService {
  static async createTransaction(data) {
    try {
      const transaction = new Transaction({
        ...data,
        reference: data.reference || Transaction.generateReference(),
        userReference: `USER${data.user}`,
      });
      
      await transaction.save();
      logger.info(`Transaction created: ${transaction.reference}`);
      
      return transaction;
    } catch (error) {
      logger.error('Error creating transaction:', error);
      throw new AppError('Failed to create transaction', 500);
    }
  }

  static async getTransaction(reference) {
    try {
      const transaction = await Transaction.findOne({ reference });
      
      if (!transaction) {
        throw new AppError('Transaction not found', 404);
      }
      
      return transaction;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error getting transaction:', error);
      throw new AppError('Failed to get transaction', 500);
    }
  }

  static async getUserTransactions(userId, filters = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        type,
        status,
        startDate,
        endDate,
        search,
      } = filters;
      
      const query = { user: userId };
      
      if (type) query.type = type;
      if (status) query.status = status;
      
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }
      
      if (search) {
        query.$or = [
          { reference: { $regex: search, $options: 'i' } },
          { 'service.phoneNumber': { $regex: search, $options: 'i' } },
          { 'service.meterNumber': { $regex: search, $options: 'i' } },
        ];
      }
      
      const skip = (page - 1) * limit;
      
      const transactions = await Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
      
      const total = await Transaction.countDocuments(query);
      
      return {
        transactions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error getting user transactions:', error);
      throw new AppError('Failed to get transactions', 500);
    }
  }

  static async processTelecomTransaction(transactionId, providerName = null) {
    const session = await Transaction.startSession();
    
    try {
      session.startTransaction();
      
      const transaction = await Transaction.findById(transactionId).session(session);
      
      if (!transaction) {
        throw new AppError('Transaction not found', 404);
      }
      
      if (transaction.status !== 'pending') {
        throw new AppError('Transaction already processed', 400);
      }
      
      const wallet = await Wallet.findOne({ user: transaction.user }).session(session);
      
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      if (wallet.locked) {
        transaction.status = 'failed';
        transaction.statusHistory.push({
          status: 'failed',
          note: 'Wallet is locked',
        });
        await transaction.save({ session });
        throw new AppError('Wallet is locked', 400);
      }
      
      if (wallet.balance < transaction.totalAmount) {
        transaction.status = 'failed';
        transaction.statusHistory.push({
          status: 'failed',
          note: 'Insufficient balance',
        });
        await transaction.save({ session });
        throw new AppError('Insufficient balance', 400);
      }
      
      transaction.status = 'processing';
      transaction.statusHistory.push({
        status: 'processing',
        note: 'Processing with provider',
      });
      
      if (providerName) {
        transaction.provider = {
          name: providerName,
          ...transaction.provider,
        };
      }
      
      await transaction.save({ session });
      
      const previousBalance = wallet.balance;
      wallet.balance -= transaction.totalAmount;
      wallet.totalSpent += transaction.totalAmount;
      wallet.lastTransaction = new Date();
      await wallet.save({ session });
      
      transaction.previousBalance = previousBalance;
      transaction.newBalance = wallet.balance;
      
      await session.commitTransaction();
      
      this.processWithProvider(transaction);
      
      return transaction;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error processing telecom transaction:', error);
      
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to process transaction', 500);
    } finally {
      session.endSession();
    }
  }

  static async processWithProvider(transaction) {
    try {
      let success = false;
      let providerResponse = null;
      let usedProvider = null;
      
      const providers = await this.getAvailableProviders(transaction.type, transaction.service?.provider);
      
      for (const provider of providers) {
        try {
          logger.info(`Processing transaction ${transaction.reference} with provider: ${provider.providerName}`);
          
          switch (transaction.type) {
            case 'data_recharge':
            case 'airtime_recharge':
            case 'airtime_swap':
            case 'sme_data':
            case 'recharge_pin':
              providerResponse = await telecomService.processWithProvider(
                transaction,
                provider.providerName
              );
              break;
              
            case 'electricity':
            case 'cable_tv':
              providerResponse = await billsService.processWithProvider(
                transaction,
                provider.providerName
              );
              break;
              
            default:
              throw new AppError(`Service type ${transaction.type} not supported`, 400);
          }
          
          usedProvider = provider.providerName;
          success = true;
          break;
        } catch (providerError) {
          logger.error(`Provider ${provider.providerName} failed:`, providerError);
          
          await ProviderStatus.findOneAndUpdate(
            { providerName: provider.providerName },
            {
              $inc: { failedRequests: 1, totalRequests: 1 },
              $set: { lastChecked: new Date() },
            }
          );
          
          continue;
        }
      }
      
      const updateData = {
        status: success ? 'successful' : 'failed',
        provider: {
          name: usedProvider,
          providerResponse: providerResponse,
        },
        completedAt: new Date(),
      };
      
      if (!success) {
        updateData.statusHistory = [
          ...transaction.statusHistory,
          {
            status: 'failed',
            note: 'All providers failed',
            timestamp: new Date(),
          },
        ];
        
        await this.refundFailedTransaction(transaction._id);
      } else {
        updateData.statusHistory = [
          ...transaction.statusHistory,
          {
            status: 'successful',
            note: `Processed successfully with ${usedProvider}`,
            timestamp: new Date(),
          },
        ];
        
        if (usedProvider) {
          await ProviderStatus.findOneAndUpdate(
            { providerName: usedProvider },
            {
              $inc: { successfulRequests: 1, totalRequests: 1 },
              $set: { lastChecked: new Date() },
            }
          );
        }
      }
      
      await Transaction.findByIdAndUpdate(transaction._id, updateData);
      
      if (transaction.callbackUrl) {
        await this.sendWebhookNotification(transaction, success);
      }
      
      logger.info(`Transaction ${transaction.reference} completed with status: ${success ? 'successful' : 'failed'}`);
      
    } catch (error) {
      logger.error('Error in processWithProvider:', error);
      
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: 'failed',
        statusHistory: [
          ...transaction.statusHistory,
          {
            status: 'failed',
            note: 'System error during processing',
            timestamp: new Date(),
          },
        ],
        completedAt: new Date(),
      });
      
      await this.refundFailedTransaction(transaction._id);
    }
  }

  static async getAvailableProviders(serviceType, preferredProvider = null) {
    try {
      const query = {
        supportedServices: serviceType,
        status: 'active',
      };
      
      const providers = await ProviderStatus.find(query)
        .sort({ priority: 1, successRate: -1 })
        .lean();
      
      if (preferredProvider) {
        const preferred = providers.find(p => p.providerName === preferredProvider);
        if (preferred) {
          return [
            preferred,
            ...providers.filter(p => p.providerName !== preferredProvider),
          ];
        }
      }
      
      return providers;
    } catch (error) {
      logger.error('Error getting available providers:', error);
      return [];
    }
  }

  static async refundFailedTransaction(transactionId) {
    const session = await Transaction.startSession();
    
    try {
      session.startTransaction();
      
      const transaction = await Transaction.findById(transactionId).session(session);
      
      if (!transaction || transaction.status !== 'failed') {
        throw new AppError('Transaction not found or not failed', 400);
      }
      
      if (transaction.status === 'refunded') {
        throw new AppError('Transaction already refunded', 400);
      }
      
      const wallet = await Wallet.findOne({ user: transaction.user }).session(session);
      
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      wallet.balance += transaction.totalAmount;
      wallet.totalSpent -= transaction.totalAmount;
      await wallet.save({ session });
      
      transaction.status = 'refunded';
      transaction.statusHistory.push({
        status: 'refunded',
        note: 'Automatic refund for failed transaction',
        timestamp: new Date(),
      });
      await transaction.save({ session });
      
      const refundTransaction = new Transaction({
        reference: Transaction.generateReference(),
        userReference: `USER${transaction.user}`,
        user: transaction.user,
        type: transaction.type,
        category: transaction.category,
        amount: transaction.totalAmount,
        fee: 0,
        totalAmount: transaction.totalAmount,
        previousBalance: wallet.balance - transaction.totalAmount,
        newBalance: wallet.balance,
        status: 'successful',
        description: `Refund for failed transaction ${transaction.reference}`,
        metadata: {
          refundFor: transaction.reference,
          originalTransaction: transaction._id,
        },
      });
      
      await refundTransaction.save({ session });
      
      await session.commitTransaction();
      
      logger.info(`Transaction ${transaction.reference} refunded to user ${transaction.user}`);
      
      return refundTransaction;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error refunding transaction:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async sendWebhookNotification(transaction, success) {
    try {
      const webhookData = {
        event: success ? 'transaction.successful' : 'transaction.failed',
        data: {
          reference: transaction.reference,
          status: transaction.status,
          amount: transaction.amount,
          serviceType: transaction.type,
          provider: transaction.provider?.name,
          timestamp: new Date().toISOString(),
        },
      };
      
      logger.info(`Webhook would be sent to ${transaction.callbackUrl}:`, webhookData);
      
      await Transaction.findByIdAndUpdate(transaction._id, {
        webhookDelivered: true,
        webhookAttempts: { $inc: 1 },
      });
      
    } catch (error) {
      logger.error('Error sending webhook:', error);
    }
  }
}

module.exports = TransactionService;