const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

class WalletService {
  static async createWallet(userId) {
    try {
      const wallet = new Wallet({
        user: userId,
        balance: 0,
        locked: false,
      });
      
      await wallet.save();
      logger.info(`Wallet created for user: ${userId}`);
      
      return wallet;
    } catch (error) {
      logger.error('Error creating wallet:', error);
      throw new AppError('Failed to create wallet', 500);
    }
  }

  static async getWallet(userId) {
    try {
      const wallet = await Wallet.findOne({ user: userId });
      
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      return wallet;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error getting wallet:', error);
      throw new AppError('Failed to get wallet', 500);
    }
  }

  static async creditWallet(userId, amount, reference, description = 'Wallet funding') {
    const session = await Wallet.startSession();
    
    try {
      session.startTransaction();
      
      const wallet = await Wallet.findOne({ user: userId }).session(session);
      
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      if (wallet.locked) {
        throw new AppError('Wallet is locked', 400);
      }
      
      const previousBalance = wallet.balance;
      const newBalance = previousBalance + amount;
      
      wallet.balance = newBalance;
      wallet.totalFunded += amount;
      wallet.lastTransaction = new Date();
      await wallet.save({ session });
      
      const transaction = new Transaction({
        reference,
        userReference: `USER${userId}`,
        user: userId,
        type: 'fund_wallet',
        category: 'funding',
        amount,
        fee: 0,
        totalAmount: amount,
        previousBalance,
        newBalance,
        status: 'successful',
        description,
        metadata: {
          fundingType: 'manual_credit',
        },
      });
      
      await transaction.save({ session });
      
      await session.commitTransaction();
      
      logger.info(`Wallet credited: User ${userId}, Amount: ${amount}, New Balance: ${newBalance}`);
      
      return {
        wallet,
        transaction,
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error crediting wallet:', error);
      
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to credit wallet', 500);
    } finally {
      session.endSession();
    }
  }

  static async debitWallet(userId, amount, reference, description = 'Wallet debit') {
    const session = await Wallet.startSession();
    
    try {
      session.startTransaction();
      
      const wallet = await Wallet.findOne({ user: userId }).session(session);
      
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      if (wallet.locked) {
        throw new AppError('Wallet is locked', 400);
      }
      
      if (wallet.balance < amount) {
        throw new AppError('Insufficient balance', 400);
      }
      
      const previousBalance = wallet.balance;
      const newBalance = previousBalance - amount;
      
      wallet.balance = newBalance;
      wallet.totalSpent += amount;
      wallet.lastTransaction = new Date();
      await wallet.save({ session });
      
      const transaction = new Transaction({
        reference,
        userReference: `USER${userId}`,
        user: userId,
        type: 'wallet_transfer',
        category: 'transfer',
        amount,
        fee: 0,
        totalAmount: amount,
        previousBalance,
        newBalance,
        status: 'successful',
        description,
        metadata: {
          debitType: 'manual_debit',
        },
      });
      
      await transaction.save({ session });
      
      await session.commitTransaction();
      
      logger.info(`Wallet debited: User ${userId}, Amount: ${amount}, New Balance: ${newBalance}`);
      
      return {
        wallet,
        transaction,
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error debiting wallet:', error);
      
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to debit wallet', 500);
    } finally {
      session.endSession();
    }
  }

  static async transferFunds(senderId, recipientId, amount, transactionPin) {
    const session = await Wallet.startSession();
    
    try {
      session.startTransaction();
      
      const senderWallet = await Wallet.findOne({ user: senderId }).session(session);
      const recipientWallet = await Wallet.findOne({ user: recipientId }).session(session);
      
      if (!senderWallet || !recipientWallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      if (senderWallet.locked) {
        throw new AppError('Your wallet is locked', 400);
      }
      
      if (recipientWallet.locked) {
        throw new AppError('Recipient wallet is locked', 400);
      }
      
      if (senderWallet.balance < amount) {
        throw new AppError('Insufficient balance', 400);
      }
      
      const fee = Math.max(10, amount * 0.02);
      const totalDebit = amount + fee;
      
      if (senderWallet.balance < totalDebit) {
        throw new AppError('Insufficient balance to cover amount and fee', 400);
      }
      
      const senderPreviousBalance = senderWallet.balance;
      const senderNewBalance = senderPreviousBalance - totalDebit;
      
      const recipientPreviousBalance = recipientWallet.balance;
      const recipientNewBalance = recipientPreviousBalance + amount;
      
      senderWallet.balance = senderNewBalance;
      senderWallet.totalSpent += totalDebit;
      senderWallet.lastTransaction = new Date();
      await senderWallet.save({ session });
      
      recipientWallet.balance = recipientNewBalance;
      recipientWallet.totalFunded += amount;
      recipientWallet.lastTransaction = new Date();
      await recipientWallet.save({ session });
      
      const transferReference = Transaction.generateReference();
      const feeReference = Transaction.generateReference();
      
      const transferTransaction = new Transaction({
        reference: transferReference,
        userReference: `USER${senderId}`,
        user: senderId,
        type: 'wallet_transfer',
        category: 'transfer',
        amount,
        fee,
        totalAmount: totalDebit,
        previousBalance: senderPreviousBalance,
        newBalance: senderNewBalance,
        status: 'successful',
        description: `Transfer to user ${recipientId}`,
        recipient: {
          user: recipientId,
        },
        metadata: {
          transferType: 'wallet_to_wallet',
          feeBreakdown: {
            transferFee: fee,
          },
        },
      });
      
      const feeTransaction = new Transaction({
        reference: feeReference,
        userReference: `USER${senderId}`,
        user: senderId,
        type: 'wallet_transfer',
        category: 'transfer',
        amount: fee,
        fee: 0,
        totalAmount: fee,
        previousBalance: senderPreviousBalance - amount,
        newBalance: senderNewBalance,
        status: 'successful',
        description: 'Transfer fee',
        metadata: {
          transferType: 'fee',
          linkedReference: transferReference,
        },
      });
      
      const creditTransaction = new Transaction({
        reference: Transaction.generateReference(),
        userReference: `USER${recipientId}`,
        user: recipientId,
        type: 'wallet_transfer',
        category: 'transfer',
        amount,
        fee: 0,
        totalAmount: amount,
        previousBalance: recipientPreviousBalance,
        newBalance: recipientNewBalance,
        status: 'successful',
        description: `Transfer from user ${senderId}`,
        metadata: {
          transferType: 'wallet_to_wallet',
          sender: senderId,
          linkedReference: transferReference,
        },
      });
      
      await Promise.all([
        transferTransaction.save({ session }),
        feeTransaction.save({ session }),
        creditTransaction.save({ session }),
      ]);
      
      await session.commitTransaction();
      
      logger.info(`Transfer completed: From ${senderId} to ${recipientId}, Amount: ${amount}, Fee: ${fee}`);
      
      return {
        senderWallet,
        recipientWallet,
        transferTransaction,
        feeTransaction,
        creditTransaction,
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error transferring funds:', error);
      
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to transfer funds', 500);
    } finally {
      session.endSession();
    }
  }

  static async lockWallet(userId, reason = 'Administrative action') {
    try {
      const wallet = await Wallet.findOne({ user: userId });
      
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      if (wallet.locked) {
        throw new AppError('Wallet is already locked', 400);
      }
      
      wallet.locked = true;
      wallet.lockReason = reason;
      wallet.lockedAt = new Date();
      await wallet.save();
      
      logger.info(`Wallet locked: User ${userId}, Reason: ${reason}`);
      
      return wallet;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error locking wallet:', error);
      throw new AppError('Failed to lock wallet', 500);
    }
  }

  static async unlockWallet(userId) {
    try {
      const wallet = await Wallet.findOne({ user: userId });
      
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      if (!wallet.locked) {
        throw new AppError('Wallet is not locked', 400);
      }
      
      wallet.locked = false;
      wallet.unlockedAt = new Date();
      await wallet.save();
      
      logger.info(`Wallet unlocked: User ${userId}`);
      
      return wallet;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error unlocking wallet:', error);
      throw new AppError('Failed to unlock wallet', 500);
    }
  }
}

module.exports = WalletService;