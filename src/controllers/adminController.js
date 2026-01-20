const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const KYC = require('../models/KYC');
const ServicePricing = require('../models/ServicePricing');
const ProviderStatus = require('../models/ProviderStatus');
const AdminLog = require('../models/AdminLog');
const WalletService = require('../services/walletService');
const TransactionService = require('../services/transactionService');
const TelecomService = require('../services/telecomService');
const BillsService = require('../services/billsService');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

class AdminController {
  // Dashboard Statistics
  static async getDashboardStats(req, res, next) {
    try {
      const today = new Date();
      const startOfToday = new Date(today.setHours(0, 0, 0, 0));
      const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      
      // Get all counts in parallel for better performance
      const [
        totalUsers,
        newUsersToday,
        activeUsers,
        totalTransactions,
        transactionsToday,
        totalRevenue,
        revenueToday,
        pendingKYC,
        totalWallets,
        lockedWallets,
        providerStatus,
      ] = await Promise.all([
        // User stats
        User.countDocuments(),
        User.countDocuments({ createdAt: { $gte: startOfToday } }),
        User.countDocuments({ lastLogin: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
        
        // Transaction stats
        Transaction.countDocuments(),
        Transaction.countDocuments({ createdAt: { $gte: startOfToday } }),
        
        // Revenue stats (sum of successful transaction amounts)
        Transaction.aggregate([
          { $match: { status: 'successful' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Transaction.aggregate([
          { $match: { status: 'successful', createdAt: { $gte: startOfToday } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        
        // KYC stats
        KYC.countDocuments({ status: 'pending' }),
        
        // Wallet stats
        Wallet.countDocuments(),
        Wallet.countDocuments({ locked: true }),
        
        // Provider stats
        ProviderStatus.find({}).lean(),
      ]);
      
      // Get transaction breakdown by type
      const transactionBreakdown = await Transaction.aggregate([
        { $match: { createdAt: { $gte: startOfMonth } } },
        { $group: { _id: '$type', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]);
      
      // Get recent transactions
      const recentTransactions = await Transaction.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('user', 'firstName lastName email phoneNumber')
        .lean();
      
      // Get revenue trend (last 7 days)
      const revenueTrend = await Transaction.aggregate([
        {
          $match: {
            status: 'successful',
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            amount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      
      // Calculate success rate
      const successRate = await Transaction.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]);
      
      const total = successRate.reduce((sum, item) => sum + item.count, 0);
      const successful = successRate.find(item => item._id === 'successful')?.count || 0;
      const successRatePercent = total > 0 ? (successful / total) * 100 : 0;
      
      res.status(200).json({
        status: 'success',
        data: {
          overview: {
            totalUsers,
            newUsersToday,
            activeUsers,
            totalTransactions,
            transactionsToday,
            totalRevenue: totalRevenue[0]?.total || 0,
            revenueToday: revenueToday[0]?.total || 0,
            pendingKYC,
            totalWallets,
            lockedWallets,
            successRate: successRatePercent.toFixed(2),
          },
          transactionBreakdown,
          recentTransactions,
          revenueTrend,
          providerStatus: providerStatus.map(p => ({
            name: p.providerName,
            status: p.status,
            successRate: p.successRate,
            totalRequests: p.totalRequests,
            lastChecked: p.lastChecked,
          })),
          charts: {
            dailyTransactions: await this.getDailyTransactionChart(),
            userGrowth: await this.getUserGrowthChart(),
            revenueByService: await this.getRevenueByServiceChart(),
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting dashboard stats:', error);
      next(error);
    }
  }

  // User Management
  static async getUsers(req, res, next) {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        role,
        kycStatus,
        isActive,
        isVerified,
        startDate,
        endDate,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const query = {};
      
      // Search by name, email, or phone
      if (search) {
        query.$or = [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } },
        ];
      }
      
      if (role) query.role = role;
      if (kycStatus) query.kycStatus = kycStatus;
      if (isActive !== undefined) query.isActive = isActive === 'true';
      if (isVerified !== undefined) query.isEmailVerified = isVerified === 'true';
      
      // Date range filter
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }
      
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      
      const [users, total] = await Promise.all([
        User.find(query)
          .select('-password -transactionPin -verificationToken -resetPasswordToken')
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        User.countDocuments(query),
      ]);
      
      // Get wallet balances for users
      const usersWithBalances = await Promise.all(
        users.map(async (user) => {
          const wallet = await Wallet.findOne({ user: user._id }).lean();
          return {
            ...user,
            walletBalance: wallet?.balance || 0,
            walletLocked: wallet?.locked || false,
          };
        })
      );
      
      res.status(200).json({
        status: 'success',
        data: {
          users: usersWithBalances,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting users:', error);
      next(error);
    }
  }

  static async getUser(req, res, next) {
    try {
      const { id } = req.params;
      
      const user = await User.findById(id)
        .select('-password -transactionPin -verificationToken -resetPasswordToken')
        .lean();
      
      if (!user) {
        return next(new AppError('User not found', 404));
      }
      
      // Get user's wallet
      const wallet = await Wallet.findOne({ user: id }).lean();
      
      // Get user's KYC info
      const kyc = await KYC.findOne({ user: id }).lean();
      
      // Get user's recent transactions
      const recentTransactions = await Transaction.find({ user: id })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      
      // Get transaction statistics
      const transactionStats = await Transaction.aggregate([
        { $match: { user: id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
          },
        },
      ]);
      
      res.status(200).json({
        status: 'success',
        data: {
          user,
          wallet,
          kyc,
          recentTransactions,
          transactionStats,
        },
      });
      
    } catch (error) {
      logger.error('Error getting user:', error);
      next(error);
    }
  }

  static async suspendUser(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      
      const user = await User.findById(id);
      
      if (!user) {
        return next(new AppError('User not found', 404));
      }
      
      if (!user.isActive) {
        return next(new AppError('User is already suspended', 400));
      }
      
      // Suspend user
      user.isActive = false;
      await user.save();
      
      // Lock user's wallet
      await WalletService.lockWallet(id, `User suspended by admin: ${reason}`);
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'suspend',
        entity: 'user',
        entityId: id,
        description: `User ${user.email} suspended by ${req.admin.email}. Reason: ${reason}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });
      
      res.status(200).json({
        status: 'success',
        message: 'User suspended successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            isActive: user.isActive,
          },
        },
      });
      
      logger.info(`User suspended: ${user.email} by ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error suspending user:', error);
      next(error);
    }
  }

  static async activateUser(req, res, next) {
    try {
      const { id } = req.params;
      
      const user = await User.findById(id);
      
      if (!user) {
        return next(new AppError('User not found', 404));
      }
      
      if (user.isActive) {
        return next(new AppError('User is already active', 400));
      }
      
      // Activate user
      user.isActive = true;
      await user.save();
      
      // Unlock user's wallet
      await WalletService.unlockWallet(id);
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'activate',
        entity: 'user',
        entityId: id,
        description: `User ${user.email} activated by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });
      
      res.status(200).json({
        status: 'success',
        message: 'User activated successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            isActive: user.isActive,
          },
        },
      });
      
      logger.info(`User activated: ${user.email} by ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error activating user:', error);
      next(error);
    }
  }

  static async resetTransactionPin(req, res, next) {
    try {
      const { id } = req.params;
      
      const user = await User.findById(id);
      
      if (!user) {
        return next(new AppError('User not found', 404));
      }
      
      // Clear transaction PIN
      user.transactionPin = undefined;
      await user.save();
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'update',
        entity: 'user',
        entityId: id,
        description: `Transaction PIN reset for user ${user.email} by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Transaction PIN reset successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
          },
        },
      });
      
      logger.info(`Transaction PIN reset for user: ${user.email} by ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error resetting transaction PIN:', error);
      next(error);
    }
  }

  // Wallet Management
  static async getWallets(req, res, next) {
    try {
      const {
        page = 1,
        limit = 20,
        minBalance,
        maxBalance,
        locked,
        sortBy = 'balance',
        sortOrder = 'desc',
      } = req.query;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const query = {};
      
      // Balance range filter
      if (minBalance || maxBalance) {
        query.balance = {};
        if (minBalance) query.balance.$gte = parseFloat(minBalance);
        if (maxBalance) query.balance.$lte = parseFloat(maxBalance);
      }
      
      if (locked !== undefined) query.locked = locked === 'true';
      
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      
      const [wallets, total] = await Promise.all([
        Wallet.find(query)
          .populate('user', 'firstName lastName email phoneNumber')
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Wallet.countDocuments(query),
      ]);
      
      res.status(200).json({
        status: 'success',
        data: {
          wallets,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
          summary: {
            totalBalance: await Wallet.aggregate([
              { $group: { _id: null, total: { $sum: '$balance' } } },
            ]).then(result => result[0]?.total || 0),
            averageBalance: await Wallet.aggregate([
              { $group: { _id: null, average: { $avg: '$balance' } } },
            ]).then(result => result[0]?.average || 0),
            lockedWallets: await Wallet.countDocuments({ locked: true }),
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting wallets:', error);
      next(error);
    }
  }

  static async getUserWallet(req, res, next) {
    try {
      const { userId } = req.params;
      
      // Check if user exists
      const user = await User.findById(userId);
      if (!user) {
        return next(new AppError('User not found', 404));
      }
      
      const wallet = await Wallet.findOne({ user: userId })
        .populate('user', 'firstName lastName email phoneNumber')
        .lean();
      
      if (!wallet) {
        return next(new AppError('Wallet not found', 404));
      }
      
      // Get wallet transactions
      const transactions = await Transaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      
      res.status(200).json({
        status: 'success',
        data: {
          wallet,
          transactions,
        },
      });
      
    } catch (error) {
      logger.error('Error getting user wallet:', error);
      next(error);
    }
  }

  static async creditWallet(req, res, next) {
    try {
      const { userId } = req.params;
      const { amount, reason, reference } = req.body;
      
      if (!amount || amount <= 0) {
        return next(new AppError('Please provide a valid amount', 400));
      }
      
      // Check if user exists
      const user = await User.findById(userId);
      if (!user) {
        return next(new AppError('User not found', 404));
      }
      
      const wallet = await Wallet.findOne({ user: userId });
      if (!wallet) {
        return next(new AppError('Wallet not found', 404));
      }
      
      if (wallet.locked) {
        return next(new AppError('Wallet is locked', 400));
      }
      
      const transactionReference = reference || `ADMIN-CREDIT-${Date.now()}`;
      
      // Credit wallet
      const result = await WalletService.creditWallet(
        userId,
        amount,
        transactionReference,
        `Manual credit by admin: ${reason || 'No reason provided'}`
      );
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'credit',
        entity: 'wallet',
        entityId: wallet._id,
        changes: {
          old: { balance: result.wallet.balance - amount },
          new: { balance: result.wallet.balance },
        },
        description: `Wallet credited: ${amount} NGN to user ${user.email} by ${req.admin.email}. Reason: ${reason || 'N/A'}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          transactionReference,
          amount,
          reason,
        },
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Wallet credited successfully',
        data: {
          wallet: result.wallet,
          transaction: result.transaction,
        },
      });
      
      logger.info(`Wallet credited: User ${user.email}, Amount: ${amount}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error crediting wallet:', error);
      next(error);
    }
  }

  static async debitWallet(req, res, next) {
    try {
      const { userId } = req.params;
      const { amount, reason, reference } = req.body;
      
      if (!amount || amount <= 0) {
        return next(new AppError('Please provide a valid amount', 400));
      }
      
      // Check if user exists
      const user = await User.findById(userId);
      if (!user) {
        return next(new AppError('User not found', 404));
      }
      
      const wallet = await Wallet.findOne({ user: userId });
      if (!wallet) {
        return next(new AppError('Wallet not found', 404));
      }
      
      if (wallet.locked) {
        return next(new AppError('Wallet is locked', 400));
      }
      
      if (wallet.balance < amount) {
        return next(new AppError('Insufficient wallet balance', 400));
      }
      
      const transactionReference = reference || `ADMIN-DEBIT-${Date.now()}`;
      
      // Debit wallet
      const result = await WalletService.debitWallet(
        userId,
        amount,
        transactionReference,
        `Manual debit by admin: ${reason || 'No reason provided'}`
      );
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'debit',
        entity: 'wallet',
        entityId: wallet._id,
        changes: {
          old: { balance: result.wallet.balance + amount },
          new: { balance: result.wallet.balance },
        },
        description: `Wallet debited: ${amount} NGN from user ${user.email} by ${req.admin.email}. Reason: ${reason || 'N/A'}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          transactionReference,
          amount,
          reason,
        },
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Wallet debited successfully',
        data: {
          wallet: result.wallet,
          transaction: result.transaction,
        },
      });
      
      logger.info(`Wallet debited: User ${user.email}, Amount: ${amount}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error debiting wallet:', error);
      next(error);
    }
  }

  static async lockWallet(req, res, next) {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      
      // Check if user exists
      const user = await User.findById(userId);
      if (!user) {
        return next(new AppError('User not found', 404));
      }
      
      const wallet = await Wallet.findOne({ user: userId });
      if (!wallet) {
        return next(new AppError('Wallet not found', 404));
      }
      
      if (wallet.locked) {
        return next(new AppError('Wallet is already locked', 400));
      }
      
      // Lock wallet
      const lockedWallet = await WalletService.lockWallet(userId, reason || 'Administrative action');
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'suspend',
        entity: 'wallet',
        entityId: wallet._id,
        description: `Wallet locked for user ${user.email} by ${req.admin.email}. Reason: ${reason || 'N/A'}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: { reason },
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Wallet locked successfully',
        data: {
          wallet: lockedWallet,
        },
      });
      
      logger.info(`Wallet locked: User ${user.email}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error locking wallet:', error);
      next(error);
    }
  }

  static async unlockWallet(req, res, next) {
    try {
      const { userId } = req.params;
      
      // Check if user exists
      const user = await User.findById(userId);
      if (!user) {
        return next(new AppError('User not found', 404));
      }
      
      const wallet = await Wallet.findOne({ user: userId });
      if (!wallet) {
        return next(new AppError('Wallet not found', 404));
      }
      
      if (!wallet.locked) {
        return next(new AppError('Wallet is not locked', 400));
      }
      
      // Unlock wallet
      const unlockedWallet = await WalletService.unlockWallet(userId);
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'activate',
        entity: 'wallet',
        entityId: wallet._id,
        description: `Wallet unlocked for user ${user.email} by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Wallet unlocked successfully',
        data: {
          wallet: unlockedWallet,
        },
      });
      
      logger.info(`Wallet unlocked: User ${user.email}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error unlocking wallet:', error);
      next(error);
    }
  }

  // Transaction Management
  static async getTransactions(req, res, next) {
    try {
      const {
        page = 1,
        limit = 20,
        type,
        status,
        userId,
        reference,
        provider,
        startDate,
        endDate,
        minAmount,
        maxAmount,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const query = {};
      
      if (type) query.type = type;
      if (status) query.status = status;
      if (userId) query.user = userId;
      if (reference) query.reference = { $regex: reference, $options: 'i' };
      if (provider) query['provider.name'] = provider;
      
      // Date range filter
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }
      
      // Amount range filter
      if (minAmount || maxAmount) {
        query.amount = {};
        if (minAmount) query.amount.$gte = parseFloat(minAmount);
        if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
      }
      
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      
      const [transactions, total] = await Promise.all([
        Transaction.find(query)
          .populate('user', 'firstName lastName email phoneNumber')
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Transaction.countDocuments(query),
      ]);
      
      // Get transaction statistics
      const stats = await Transaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            totalFee: { $sum: '$fee' },
            totalTransactions: { $sum: 1 },
            successfulTransactions: {
              $sum: { $cond: [{ $eq: ['$status', 'successful'] }, 1, 0] },
            },
            failedTransactions: {
              $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
            },
          },
        },
      ]);
      
      res.status(200).json({
        status: 'success',
        data: {
          transactions,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
          stats: stats[0] || {
            totalAmount: 0,
            totalFee: 0,
            totalTransactions: 0,
            successfulTransactions: 0,
            failedTransactions: 0,
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting transactions:', error);
      next(error);
    }
  }

  static async getTransaction(req, res, next) {
    try {
      const { id } = req.params;
      
      const transaction = await Transaction.findById(id)
        .populate('user', 'firstName lastName email phoneNumber')
        .populate('recipient.user', 'firstName lastName email phoneNumber')
        .lean();
      
      if (!transaction) {
        return next(new AppError('Transaction not found', 404));
      }
      
      res.status(200).json({
        status: 'success',
        data: {
          transaction,
        },
      });
      
    } catch (error) {
      logger.error('Error getting transaction:', error);
      next(error);
    }
  }

  static async refundTransaction(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      
      const transaction = await Transaction.findById(id);
      
      if (!transaction) {
        return next(new AppError('Transaction not found', 404));
      }
      
      if (transaction.status === 'refunded') {
        return next(new AppError('Transaction already refunded', 400));
      }
      
      if (transaction.status !== 'failed') {
        return next(new AppError('Only failed transactions can be refunded', 400));
      }
      
      // Check if already refunded
      const existingRefund = await Transaction.findOne({
        'metadata.refundFor': transaction.reference,
      });
      
      if (existingRefund) {
        return next(new AppError('Refund already processed for this transaction', 400));
      }
      
      // Process refund
      const refundTransaction = await TransactionService.refundFailedTransaction(id);
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'refund',
        entity: 'transaction',
        entityId: id,
        description: `Transaction ${transaction.reference} refunded by ${req.admin.email}. Reason: ${reason || 'Manual refund'}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          originalTransaction: transaction.reference,
          refundTransaction: refundTransaction.reference,
          reason,
        },
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Transaction refunded successfully',
        data: {
          originalTransaction: transaction,
          refundTransaction,
        },
      });
      
      logger.info(`Transaction refunded: ${transaction.reference}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error refunding transaction:', error);
      next(error);
    }
  }

  static async retryFailedTransactions(req, res, next) {
    try {
      const { type, provider, limit = 10 } = req.body;
      
      // Find failed transactions that haven't exceeded max retries
      const query = {
        status: 'failed',
        retryCount: { $lt: 3 }, // Max 3 retries
      };
      
      if (type) query.type = type;
      if (provider) query['provider.name'] = provider;
      
      const failedTransactions = await Transaction.find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit));
      
      if (failedTransactions.length === 0) {
        return res.status(200).json({
          status: 'success',
          message: 'No failed transactions to retry',
          data: { retried: 0, successful: 0, failed: 0 },
        });
      }
      
      const results = {
        retried: failedTransactions.length,
        successful: 0,
        failed: 0,
        details: [],
      };
      
      // Retry each transaction
      for (const transaction of failedTransactions) {
        try {
          let result;
          
          // Determine which service to use based on transaction type
          if (['data_recharge', 'airtime_recharge', 'airtime_swap', 'recharge_pin', 'sme_data'].includes(transaction.type)) {
            result = await TelecomService.retryFailedTransaction(transaction._id, transaction.retryCount);
          } else if (['electricity', 'cable_tv', 'education_pin', 'rrr_payment'].includes(transaction.type)) {
            result = await BillsService.retryFailedTransaction(transaction._id, transaction.retryCount);
          } else {
            results.failed++;
            results.details.push({
              transactionId: transaction._id,
              reference: transaction.reference,
              status: 'failed',
              error: 'Unsupported transaction type for retry',
            });
            continue;
          }
          
          results.successful++;
          results.details.push({
            transactionId: transaction._id,
            reference: transaction.reference,
            status: 'success',
            retryCount: result.retryCount,
          });
          
        } catch (error) {
          results.failed++;
          results.details.push({
            transactionId: transaction._id,
            reference: transaction.reference,
            status: 'failed',
            error: error.message,
          });
        }
      }
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'update',
        entity: 'transaction',
        description: `Bulk retry of ${failedTransactions.length} failed transactions by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          total: failedTransactions.length,
          successful: results.successful,
          failed: results.failed,
        },
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Failed transactions retry completed',
        data: results,
      });
      
      logger.info(`Bulk retry completed: ${results.successful} successful, ${results.failed} failed, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error retrying failed transactions:', error);
      next(error);
    }
  }

  // Service Pricing Management
  static async getPricing(req, res, next) {
    try {
      const {
        page = 1,
        limit = 20,
        serviceType,
        provider,
        network,
        disco,
        cableProvider,
        isActive,
        isAvailable,
        search,
        sortBy = 'sellingPrice',
        sortOrder = 'asc',
      } = req.query;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const query = {};
      
      if (serviceType) query.serviceType = serviceType;
      if (provider) query.provider = provider;
      if (network) query.network = network;
      if (disco) query.disco = disco;
      if (cableProvider) query.cableProvider = cableProvider;
      if (isActive !== undefined) query.isActive = isActive === 'true';
      if (isAvailable !== undefined) query.isAvailable = isAvailable === 'true';
      
      // Search by plan name or code
      if (search) {
        query.$or = [
          { planName: { $regex: search, $options: 'i' } },
          { planCode: { $regex: search, $options: 'i' } },
        ];
      }
      
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      
      const [pricing, total] = await Promise.all([
        ServicePricing.find(query)
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        ServicePricing.countDocuments(query),
      ]);
      
      res.status(200).json({
        status: 'success',
        data: {
          pricing,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting pricing:', error);
      next(error);
    }
  }

  static async createPricing(req, res, next) {
    try {
      const pricingData = req.body;
      
      // Validate required fields
      const requiredFields = ['serviceType', 'provider', 'planName', 'costPrice', 'sellingPrice'];
      for (const field of requiredFields) {
        if (!pricingData[field]) {
          return next(new AppError(`${field} is required`, 400));
        }
      }
      
      // Calculate profit margin
      if (pricingData.costPrice && pricingData.sellingPrice) {
        pricingData.profitMargin = pricingData.sellingPrice - pricingData.costPrice;
      }
      
      // Set created by
      pricingData.createdBy = req.admin._id;
      
      const pricing = await ServicePricing.create(pricingData);
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'create',
        entity: 'pricing',
        entityId: pricing._id,
        description: `Pricing created for ${pricing.serviceType} - ${pricing.planName} by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          serviceType: pricing.serviceType,
          planName: pricing.planName,
          costPrice: pricing.costPrice,
          sellingPrice: pricing.sellingPrice,
        },
      });
      
      res.status(201).json({
        status: 'success',
        message: 'Pricing created successfully',
        data: {
          pricing,
        },
      });
      
      logger.info(`Pricing created: ${pricing.serviceType} - ${pricing.planName}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error creating pricing:', error);
      next(error);
    }
  }

  static async updatePricing(req, res, next) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const pricing = await ServicePricing.findById(id);
      
      if (!pricing) {
        return next(new AppError('Pricing not found', 404));
      }
      
      // Store old data for logging
      const oldData = {
        costPrice: pricing.costPrice,
        sellingPrice: pricing.sellingPrice,
        isActive: pricing.isActive,
        isAvailable: pricing.isAvailable,
      };
      
      // Update pricing
      Object.assign(pricing, updateData);
      
      // Recalculate profit margin if prices changed
      if (updateData.costPrice || updateData.sellingPrice) {
        const newCostPrice = updateData.costPrice || pricing.costPrice;
        const newSellingPrice = updateData.sellingPrice || pricing.sellingPrice;
        pricing.profitMargin = newSellingPrice - newCostPrice;
      }
      
      // Set updated by
      pricing.updatedBy = req.admin._id;
      
      await pricing.save();
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'update',
        entity: 'pricing',
        entityId: id,
        changes: {
          old: oldData,
          new: {
            costPrice: pricing.costPrice,
            sellingPrice: pricing.sellingPrice,
            isActive: pricing.isActive,
            isAvailable: pricing.isAvailable,
          },
        },
        description: `Pricing updated for ${pricing.serviceType} - ${pricing.planName} by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Pricing updated successfully',
        data: {
          pricing,
        },
      });
      
      logger.info(`Pricing updated: ${pricing.serviceType} - ${pricing.planName}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error updating pricing:', error);
      next(error);
    }
  }

  static async deletePricing(req, res, next) {
    try {
      const { id } = req.params;
      
      const pricing = await ServicePricing.findById(id);
      
      if (!pricing) {
        return next(new AppError('Pricing not found', 404));
      }
      
      // Instead of deleting, mark as inactive
      pricing.isActive = false;
      pricing.isAvailable = false;
      await pricing.save();
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'delete',
        entity: 'pricing',
        entityId: id,
        description: `Pricing deactivated for ${pricing.serviceType} - ${pricing.planName} by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Pricing deactivated successfully',
        data: {
          pricing,
        },
      });
      
      logger.info(`Pricing deactivated: ${pricing.serviceType} - ${pricing.planName}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error deleting pricing:', error);
      next(error);
    }
  }

  // Provider Management
  static async getProviders(req, res, next) {
    try {
      const {
        status,
        serviceType,
        search,
        sortBy = 'priority',
        sortOrder = 'asc',
      } = req.query;
      
      const query = {};
      
      if (status) query.status = status;
      if (serviceType) query.supportedServices = serviceType;
      if (search) {
        query.$or = [
          { providerName: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
        ];
      }
      
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      
      const providers = await ProviderStatus.find(query)
        .sort(sort)
        .lean();
      
      res.status(200).json({
        status: 'success',
        data: {
          providers,
          stats: {
            total: providers.length,
            active: providers.filter(p => p.status === 'active').length,
            inactive: providers.filter(p => p.status === 'inactive').length,
            maintenance: providers.filter(p => p.status === 'maintenance').length,
            degraded: providers.filter(p => p.status === 'degraded').length,
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting providers:', error);
      next(error);
    }
  }

  static async updateProviderStatus(req, res, next) {
    try {
      const { name } = req.params;
      const { status, maintenanceMessage, maintenanceStart, maintenanceEnd, priority } = req.body;
      
      const provider = await ProviderStatus.findOne({ providerName: name });
      
      if (!provider) {
        return next(new AppError('Provider not found', 404));
      }
      
      // Store old status for logging
      const oldStatus = provider.status;
      
      // Update provider
      if (status) provider.status = status;
      if (maintenanceMessage) provider.maintenanceMessage = maintenanceMessage;
      if (maintenanceStart) provider.maintenanceStart = new Date(maintenanceStart);
      if (maintenanceEnd) provider.maintenanceEnd = new Date(maintenanceEnd);
      if (priority !== undefined) provider.priority = priority;
      
      provider.lastUpdatedBy = req.admin._id;
      await provider.save();
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'update',
        entity: 'provider',
        entityId: provider._id,
        changes: {
          old: { status: oldStatus },
          new: { status: provider.status },
        },
        description: `Provider ${name} status updated from ${oldStatus} to ${provider.status} by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          maintenanceMessage,
          maintenanceStart,
          maintenanceEnd,
          priority,
        },
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Provider status updated successfully',
        data: {
          provider,
        },
      });
      
      logger.info(`Provider status updated: ${name} from ${oldStatus} to ${provider.status}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error updating provider status:', error);
      next(error);
    }
  }

  // Admin Logs
  static async getAdminLogs(req, res, next) {
    try {
      const {
        page = 1,
        limit = 20,
        action,
        entity,
        adminId,
        status,
        startDate,
        endDate,
        search,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const query = {};
      
      if (action) query.action = action;
      if (entity) query.entity = entity;
      if (adminId) query.admin = adminId;
      if (status) query.status = status;
      
      // Date range filter
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }
      
      // Search by description or admin email
      if (search) {
        query.$or = [
          { description: { $regex: search, $options: 'i' } },
          { adminEmail: { $regex: search, $options: 'i' } },
        ];
      }
      
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      
      const [logs, total] = await Promise.all([
        AdminLog.find(query)
          .populate('admin', 'firstName lastName email')
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        AdminLog.countDocuments(query),
      ]);
      
      res.status(200).json({
        status: 'success',
        data: {
          logs,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting admin logs:', error);
      next(error);
    }
  }

  // Helper Methods for Charts
  static async getDailyTransactionChart() {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const data = await Transaction.aggregate([
        {
          $match: {
            createdAt: { $gte: sevenDaysAgo },
            status: 'successful',
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      
      return {
        labels: data.map(d => d._id),
        datasets: [
          {
            label: 'Transaction Count',
            data: data.map(d => d.count),
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
          },
          {
            label: 'Amount (₦)',
            data: data.map(d => d.amount),
            backgroundColor: 'rgba(255, 99, 132, 0.5)',
          },
        ],
      };
    } catch (error) {
      logger.error('Error getting daily transaction chart:', error);
      return { labels: [], datasets: [] };
    }
  }

  static async getUserGrowthChart() {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      const data = await User.aggregate([
        {
          $match: {
            createdAt: { $gte: sixMonthsAgo },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m', date: '$createdAt' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      
      // Calculate cumulative total
      let cumulative = 0;
      const cumulativeData = data.map(d => {
        cumulative += d.count;
        return {
          month: d._id,
          newUsers: d.count,
          totalUsers: cumulative,
        };
      });
      
      return {
        labels: cumulativeData.map(d => d.month),
        datasets: [
          {
            label: 'New Users',
            data: cumulativeData.map(d => d.newUsers),
            backgroundColor: 'rgba(75, 192, 192, 0.5)',
          },
          {
            label: 'Total Users',
            data: cumulativeData.map(d => d.totalUsers),
            backgroundColor: 'rgba(153, 102, 255, 0.5)',
            type: 'line',
            fill: false,
          },
        ],
      };
    } catch (error) {
      logger.error('Error getting user growth chart:', error);
      return { labels: [], datasets: [] };
    }
  }

  static async getRevenueByServiceChart() {
    try {
      const data = await Transaction.aggregate([
        {
          $match: {
            status: 'successful',
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: '$type',
            amount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { amount: -1 } },
        { $limit: 10 },
      ]);
      
      // Map service types to readable names
      const serviceNames = {
        'data_recharge': 'Data Recharge',
        'airtime_recharge': 'Airtime',
        'electricity': 'Electricity',
        'cable_tv': 'Cable TV',
        'wallet_transfer': 'Wallet Transfer',
        'fund_wallet': 'Wallet Funding',
        'withdrawal': 'Withdrawal',
        'education_pin': 'Education PINs',
        'airtime_swap': 'Airtime Swap',
        'recharge_pin': 'Recharge PINs',
      };
      
      return {
        labels: data.map(d => serviceNames[d._id] || d._id),
        datasets: [
          {
            label: 'Revenue (₦)',
            data: data.map(d => d.amount),
            backgroundColor: [
              'rgba(255, 99, 132, 0.5)',
              'rgba(54, 162, 235, 0.5)',
              'rgba(255, 206, 86, 0.5)',
              'rgba(75, 192, 192, 0.5)',
              'rgba(153, 102, 255, 0.5)',
              'rgba(255, 159, 64, 0.5)',
              'rgba(199, 199, 199, 0.5)',
              'rgba(83, 102, 255, 0.5)',
              'rgba(40, 159, 64, 0.5)',
              'rgba(210, 199, 199, 0.5)',
            ],
          },
        ],
      };
    } catch (error) {
      logger.error('Error getting revenue by service chart:', error);
      return { labels: [], datasets: [] };
    }
  }

  // Additional Admin Functions
  static async broadcastNotification(req, res, next) {
    try {
      const { title, message, type, targetUsers, sendEmail, sendSMS } = req.body;
      
      if (!title || !message) {
        return next(new AppError('Title and message are required', 400));
      }
      
      // Determine target users
      let users;
      if (targetUsers === 'all') {
        users = await User.find({}).select('email phoneNumber firstName');
      } else if (targetUsers === 'active') {
        users = await User.find({ isActive: true }).select('email phoneNumber firstName');
      } else {
        return next(new AppError('Invalid target users', 400));
      }
      
      // In a real implementation, you would:
      // 1. Send emails if sendEmail is true
      // 2. Send SMS if sendSMS is true
      // 3. Store notification in database
      
      // For now, we'll log the notification
      const notification = {
        title,
        message,
        type: type || 'info',
        targetCount: users.length,
        sentAt: new Date(),
        sentBy: req.admin.email,
      };
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'create',
        entity: 'notification',
        description: `Broadcast notification sent to ${users.length} users by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: notification,
      });
      
      res.status(200).json({
        status: 'success',
        message: `Notification prepared for ${users.length} users`,
        data: {
          notification,
          usersCount: users.length,
        },
      });
      
      logger.info(`Broadcast notification: ${title}, Target: ${users.length} users, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error sending broadcast notification:', error);
      next(error);
    }
  }

  static async getSystemSettings(req, res, next) {
    try {
      // This would typically fetch from a Settings model
      const settings = {
        general: {
          platformName: 'Yareema Data Hub',
          currency: 'NGN',
          timezone: 'Africa/Lagos',
          maintenanceMode: false,
        },
        fees: {
          walletTransferFee: 0.02, // 2%
          walletTransferMinFee: 10, // ₦10
          withdrawalFee: 0.015, // 1.5%
          withdrawalMinFee: 50, // ₦50
        },
        limits: {
          maxWalletBalance: 10000000, // ₦10,000,000
          minTransactionAmount: 50,
          maxTransactionAmount: 500000,
          dailyTransactionLimit: 1000000,
        },
        security: {
          loginAttempts: 5,
          lockDuration: 2, // hours
          sessionTimeout: 24, // hours
          requireTransactionPin: true,
        },
        kyc: {
          basicLimit: 50000,
          advancedLimit: 500000,
          verifiedLimit: 10000000,
        },
      };
      
      res.status(200).json({
        status: 'success',
        data: {
          settings,
        },
      });
      
    } catch (error) {
      logger.error('Error getting system settings:', error);
      next(error);
    }
  }

  static async updateSystemSettings(req, res, next) {
    try {
      const { settings } = req.body;
      
      if (!settings) {
        return next(new AppError('Settings data is required', 400));
      }
      
      // In a real implementation, you would save to a Settings model
      // For now, we'll just log the update
      
      // Log the action
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'update',
        entity: 'system',
        description: `System settings updated by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: { settings },
      });
      
      res.status(200).json({
        status: 'success',
        message: 'System settings updated successfully',
        data: {
          settings,
        },
      });
      
      logger.info(`System settings updated by ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error updating system settings:', error);
      next(error);
    }
  }

  static async exportData(req, res, next) {
    try {
      const { type, format = 'json', startDate, endDate } = req.body;
      
      if (!type) {
        return next(new AppError('Export type is required', 400));
      }
      
      let data;
      let filename;
      
      switch (type) {
        case 'transactions':
          const query = {};
          if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
          }
          
          data = await Transaction.find(query)
            .populate('user', 'firstName lastName email phoneNumber')
            .lean();
          
          filename = `transactions_${new Date().toISOString().split('T')[0]}`;
          break;
          
        case 'users':
          data = await User.find({})
            .select('-password -transactionPin -verificationToken -resetPasswordToken')
            .lean();
          
          filename = `users_${new Date().toISOString().split('T')[0]}`;
          break;
          
        case 'wallets':
          data = await Wallet.find({})
            .populate('user', 'firstName lastName email phoneNumber')
            .lean();
          
          filename = `wallets_${new Date().toISOString().split('T')[0]}`;
          break;
          
        default:
          return next(new AppError('Invalid export type', 400));
      }
      
      // Log the export
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'export',
        entity: type,
        description: `${type} data exported by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          format,
          recordCount: data.length,
          startDate,
          endDate,
        },
      });
      
      if (format === 'csv') {
        // Convert to CSV
        // In a real implementation, you would use a CSV library
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
        
        // Simple CSV conversion (for demonstration)
        if (data.length > 0) {
          const headers = Object.keys(data[0]).join(',');
          const rows = data.map(row => 
            Object.values(row).map(value => 
              typeof value === 'object' ? JSON.stringify(value) : value
            ).join(',')
          );
          
          return res.send([headers, ...rows].join('\n'));
        }
        
        return res.send('');
      } else {
        // Return JSON
        res.status(200).json({
          status: 'success',
          data: {
            type,
            format,
            count: data.length,
            data,
          },
        });
      }
      
      logger.info(`Data exported: ${type}, Count: ${data.length}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error exporting data:', error);
      next(error);
    }
  }
}

// Export controller methods
module.exports = {
  // Dashboard
  getDashboardStats: AdminController.getDashboardStats,
  
  // User Management
  getUsers: AdminController.getUsers,
  getUser: AdminController.getUser,
  suspendUser: AdminController.suspendUser,
  activateUser: AdminController.activateUser,
  resetTransactionPin: AdminController.resetTransactionPin,
  
  // Wallet Management
  getWallets: AdminController.getWallets,
  getUserWallet: AdminController.getUserWallet,
  creditWallet: AdminController.creditWallet,
  debitWallet: AdminController.debitWallet,
  lockWallet: AdminController.lockWallet,
  unlockWallet: AdminController.unlockWallet,
  
  // Transaction Management
  getTransactions: AdminController.getTransactions,
  getTransaction: AdminController.getTransaction,
  refundTransaction: AdminController.refundTransaction,
  retryFailedTransactions: AdminController.retryFailedTransactions,
  
  // Service Pricing Management
  getPricing: AdminController.getPricing,
  createPricing: AdminController.createPricing,
  updatePricing: AdminController.updatePricing,
  deletePricing: AdminController.deletePricing,
  
  // Provider Management
  getProviders: AdminController.getProviders,
  updateProviderStatus: AdminController.updateProviderStatus,
  
  // Admin Logs
  getAdminLogs: AdminController.getAdminLogs,
  
  // Additional Functions
  broadcastNotification: AdminController.broadcastNotification,
  getSystemSettings: AdminController.getSystemSettings,
  updateSystemSettings: AdminController.updateSystemSettings,
  exportData: AdminController.exportData,
};