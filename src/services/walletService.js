const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const MonnifyService = require('./monnifyService');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const mongoose = require("mongoose");
const axios = require("axios");

class WalletService {
  static async createWallet(user, verification = {}) {

    const existingWallet = await Wallet.findOne({ user: user._id });
  
    if (existingWallet) {
      return existingWallet;
    }
  
    const { bvn, nin } = verification;
  
    const accessToken = await this.getMonnifyToken();
  
    const reference = `wallet_${user._id}_${Date.now()}`;
  
    const payload = {
      accountReference: reference,
      accountName: `${user.firstName} ${user.lastName}`,
      currencyCode: "NGN",
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      customerEmail: user.email,
      customerName: `${user.firstName} ${user.lastName}`,
      getAllAvailableBanks: true
    };
  
    if (bvn) payload.bvn = bvn;
    if (nin) payload.nin = nin;
  
    let response;
  
    try {
  
      response = await axios.post(
        `${process.env.MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          }
        }
      );
  
    } catch (error) {
  
      if (error.response?.data?.responseMessage?.includes("cannot reserve more than")) {
  
        const existing = await Wallet.findOne({ user: user._id });
  
        if (existing) return existing;
  
        throw new Error("Wallet already exists for this user");
      }
  
      throw new Error(
        error.response?.data?.responseMessage || "Monnify wallet creation failed"
      );
    }
  
    const accounts = response.data.responseBody.accounts;
  
    const wallet = await Wallet.create({
      user: user._id,
      balance: 0,
      currency: "NGN",
      locked: false,
      totalFunded: 0,
      totalSpent: 0,
      monnifyAccounts: accounts.map((acc, index) => ({
        bankName: acc.bankName,
        accountNumber: acc.accountNumber,
        accountName: acc.accountName,
        bankCode: acc.bankCode,
        isDefault: index === 0
      }))
    });
  
    return wallet;
  }

  static async getMonnifyToken() {

    const auth = Buffer.from(
      `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`
    ).toString('base64');

    const response = await axios.post(
      `${process.env.MONNIFY_BASE_URL}/api/v1/auth/login`,
      {},
      {
        headers: {
          Authorization: `Basic ${auth}`
        }
      }
    );

    return response.data.responseBody.accessToken;
  }

  static async getAccountDetailsByEmail(email) {
    try {
      const authToken = await this.getAccessToken();
      if (!authToken) {
        throw new AppError('Failed to get Monnify access token', 500);
      }
  
      const monnify = this.getMonnifyClient();
      
      logger.info(`Fetching account details for email: ${email}`);
      
      const user = await User.findOne({ email }).select('+monnifyAccountReference');
      
      if (user && user.monnifyAccountReference) {
        const [status, response] = await monnify.reservedAccount.getReservedAccountDetails(
          authToken, 
          user.monnifyAccountReference
        );
        
        if (status === 200) {
          return {
            success: true,
            accounts: response.responseBody?.accounts || [],
            accountReference: user.monnifyAccountReference,
            collectionChannel: response.responseBody?.collectionChannel,
            reservationReference: response.responseBody?.reservationReference
          };
        }
      }
      
      logger.warn(`Could not fetch account details for email: ${email}`);
      
      return {
        success: false,
        accounts: [],
        message: "Account exists but details need to be fetched from Monnify dashboard using accountReference"
      };
      
    } catch (error) {
      logger.error('Error getting account details by email:', error);
      return {
        success: false,
        accounts: [],
        error: error.message
      };
    }
  }

  static async walletExists(userId) {
    const wallet = await Wallet.findOne({ user: userId });
    return !!wallet;
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

  static async getWalletWithAccounts(userId) {
    try {
      const wallet = await Wallet.findOne({ user: userId });
      
      if (!wallet) {
        return null;
      }
      
      return {
        balance: wallet.balance,
        currency: wallet.currency,
        locked: wallet.locked,
        accounts: wallet.accountNumbers,
        primaryAccount: wallet.primaryAccountNumber,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error getting wallet with accounts:', error);
      throw new AppError('Failed to get wallet details', 500);
    }
  }

  static async creditWallet(userId, amount, reference, description = 'Wallet funding', metadata = {}) {
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
          fundingType: 'monnify_credit',
          ...metadata,
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

  static async debitWallet(userId, amount, reference, description = 'Wallet debit', metadata = {}) {
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
        type: metadata.transactionType || 'wallet_transfer',
        category: metadata.category || 'transfer',
        amount,
        fee: metadata.fee || 0,
        totalAmount: amount + (metadata.fee || 0),
        previousBalance,
        newBalance,
        status: 'successful',
        description,
        metadata,
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

  static async transferFunds(senderId, recipientId, amount, transactionPin, description = '') {
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
        description: description || `Transfer to user ${recipientId}`,
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
        description: description || `Transfer from user ${senderId}`,
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

  static async refreshMonnifyAccounts(userId) {
    try {
      const wallet = await Wallet.findOne({ user: userId });
      
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      if (!wallet.accountReference) {
        throw new AppError('No Monnify account reference found', 400);
      }
      
      const accountDetails = await MonnifyService.getAccountDetails(wallet.accountReference);
      
      if (accountDetails && accountDetails.accounts) {
        wallet.monnifyAccounts = accountDetails.accounts.map((acc, index) => ({
          bankName: acc.bankName,
          accountNumber: acc.accountNumber,
          accountName: acc.accountName,
          bankCode: acc.bankCode,
          isDefault: index === 0,
          accountReference: wallet.accountReference,
        }));
        
        await wallet.save();
        logger.info(`Refreshed Monnify accounts for user: ${userId}`);
      }
      
      return wallet;
    } catch (error) {
      logger.error('Error refreshing Monnify accounts:', error);
      throw new AppError('Failed to refresh accounts', 500);
    }
  }

  static async getFundingAccounts(userId) {
    try {
      const wallet = await Wallet.findOne({ user: userId });
      
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }
      
      return {
        accounts: wallet.accountNumbers,
        primaryAccount: wallet.primaryAccountNumber,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error getting funding accounts:', error);
      throw new AppError('Failed to get funding accounts', 500);
    }
  }
}

module.exports = WalletService;