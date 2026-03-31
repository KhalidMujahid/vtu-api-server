const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const ServicePricing = require("../models/ServicePricing");
const ProviderStatus  = require("../models/ProviderStatus");
const AdminLog = require('../models/AdminLog');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const crypto = require('crypto');
const jwt = require("jsonwebtoken");
const NelloBytesService = require('../services/nelloBytesService');
const ProviderPurchaseGuardService = require('../services/providerPurchaseGuardService');
const vtuConfig = require('../config/vtuProviders');

function normalizeDataType(dataType) {
  if (!dataType) return null;
  const key = String(dataType).trim().toLowerCase();
  const aliases = {
    sme: 'sme',
    direct: 'direct',
    awoof: 'awoof',
    gift: 'gifting',
    gifting: 'gifting',
    corporate: 'corporate',
    night: 'night',
    daily: 'daily',
    weekly: 'weekly',
    monthly: 'monthly',
    all: 'all',
  };
  return aliases[key] || key;
}

function inferDataTypeFromPlanName(planName = '') {
  const normalized = String(planName).toLowerCase();
  if (!normalized) return 'other';
  if (normalized.includes('awoof')) return 'awoof';
  if (normalized.includes('direct')) return 'direct';
  if (normalized.includes('sme')) return 'sme';
  if (normalized.includes('corporate')) return 'corporate';
  if (normalized.includes('gifting') || normalized.includes('gift')) return 'gifting';
  if (normalized.includes('night')) return 'night';
  if (normalized.includes('daily')) return 'daily';
  if (normalized.includes('weekly')) return 'weekly';
  if (normalized.includes('monthly')) return 'monthly';
  return 'other';
}

function normalizeElectricityDiscos(rawDiscos) {
  if (Array.isArray(rawDiscos)) {
    return rawDiscos.map((item) => {
      if (typeof item === 'string') {
        return { code: item, name: item };
      }

      return {
        code: item.code || item.id || item.disco_code || item.value || item.name,
        name: item.name || item.disco || item.label || item.code || item.id,
      };
    });
  }

  if (rawDiscos && typeof rawDiscos === 'object') {
    return Object.entries(rawDiscos).map(([code, value]) => ({
      code,
      name: typeof value === 'string' ? value : value?.name || value?.disco || code,
    }));
  }

  return [];
}

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

const signRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRE,
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const refreshToken = signRefreshToken(user._id);
  
  user.password = undefined;
  user.transactionPin = undefined;
  
  res.status(statusCode).json({
    status: 'success',
    token,
    refreshToken,
    data: {
      user,
    },
  });
};

class AgentController {
  static async getAgents(req, res, next) {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        state,
        city,
        isVerified,
        isActive,
        minCommission,
        maxCommission,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const query = { role: 'agent' };
      
      if (search) {
        query.$or = [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } },
          { 'agentInfo.agentId': { $regex: search, $options: 'i' } },
          { 'agentInfo.referralCode': { $regex: search, $options: 'i' } },
        ];
      }
      
      if (state) query['agentInfo.assignedArea.state'] = state;
      if (city) query['agentInfo.assignedArea.city'] = city;
      
      if (isVerified !== undefined) query['agentInfo.isVerified'] = isVerified === 'true';
      if (isActive !== undefined) query.isActive = isActive === 'true';
      
      if (minCommission || maxCommission) {
        query['agentInfo.totalCommissionEarned'] = {};
        if (minCommission) query['agentInfo.totalCommissionEarned'].$gte = parseFloat(minCommission);
        if (maxCommission) query['agentInfo.totalCommissionEarned'].$lte = parseFloat(maxCommission);
      }
      
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      
      const [agents, total] = await Promise.all([
        User.find(query)
          .select('-password -transactionPin -verificationToken -resetPasswordToken')
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        User.countDocuments(query),
      ]);
      
      const agentStats = await User.aggregate([
        { $match: { role: 'agent' } },
        {
          $group: {
            _id: null,
            totalAgents: { $sum: 1 },
            verifiedAgents: {
              $sum: { $cond: [{ $eq: ['$agentInfo.isVerified', true] }, 1, 0] },
            },
            activeAgents: {
              $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] },
            },
            totalCommissionEarned: { $sum: '$agentInfo.totalCommissionEarned' },
            totalTransactions: { $sum: '$agentInfo.totalTransactions' },
            averageCommissionRate: { $avg: '$agentInfo.commissionRate' },
          },
        },
      ]);
      
      res.status(200).json({
        status: 'success',
        data: {
          agents,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
          stats: agentStats[0] || {
            totalAgents: 0,
            verifiedAgents: 0,
            activeAgents: 0,
            totalCommissionEarned: 0,
            totalTransactions: 0,
            averageCommissionRate: 0,
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting agents:', error);
      next(error);
    }
  }

  static async getAgent(req, res, next) {
    try {
      const { id } = req.params;
      
      const agent = await User.findOne({ _id: id, role: 'agent' })
        .select('-password -transactionPin -verificationToken -resetPasswordToken')
        .lean();
      
      if (!agent) {
        return next(new AppError('Agent not found', 404));
      }
      
      const wallet = await Wallet.findOne({ user: id }).lean();
      
      const recentTransactions = await Transaction.find({ user: id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const [monthlyStats, weeklyStats, referralStats] = await Promise.all([
        Transaction.aggregate([
          {
            $match: {
              user: id,
              createdAt: { $gte: thirtyDaysAgo },
              status: 'successful',
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalAmount: { $sum: '$amount' },
              averageAmount: { $avg: '$amount' },
            },
          },
        ]),
        
        Transaction.aggregate([
          {
            $match: {
              user: id,
              createdAt: { $gte: sevenDaysAgo },
              status: 'successful',
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalAmount: { $sum: '$amount' },
            },
          },
        ]),
        
        User.countDocuments({ referredBy: id }),
      ]);
      
      const estimatedCommission = agent.agentInfo.commissionRate * 
        (monthlyStats[0]?.totalAmount || 0) / 100;
      
      res.status(200).json({
        status: 'success',
        data: {
          agent,
          wallet,
          stats: {
            monthly: monthlyStats[0] || { count: 0, totalAmount: 0, averageAmount: 0 },
            weekly: weeklyStats[0] || { count: 0, totalAmount: 0 },
            referrals: referralStats,
            estimatedMonthlyCommission: estimatedCommission,
          },
          recentTransactions: recentTransactions.slice(0, 10),
        },
      });
      
    } catch (error) {
      logger.error('Error getting agent:', error);
      next(error);
    }
  }

  static async createAgent(req, res, next) {
    try {
      const {
        firstName,
        lastName,
        email,
        phoneNumber,
        password,
        commissionRate = 5,
        assignedArea,
        bankDetails,
      } = req.body;
      
      const existingUser = await User.findOne({
        $or: [{ email }, { phoneNumber }],
      });
      
      if (existingUser) {
        return next(new AppError('User with this email or phone already exists', 400));
      }
      
      if (commissionRate < 0 || commissionRate > 50) {
        return next(new AppError('Commission rate must be between 0 and 50%', 400));
      }
      
      const agentData = {
        firstName,
        lastName,
        email,
        phoneNumber,
        password: password || `Agent@${Date.now().toString().slice(-6)}`,
        role: 'agent',
        roles: ['agent'],
        isEmailVerified: true,
        isPhoneVerified: true,
        isActive: true,
        isApproved: false,
        kycStatus: 'verified',
        agentInfo: {
          commissionRate,
          assignedArea: assignedArea || {},
          bankDetails: bankDetails || {},
          activationDate: new Date(),
          isVerified: false,
        },
      };
      
      const agent = await User.create(agentData);
      
      await Wallet.create({
        user: agent._id,
        balance: 0,
      });
      
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'create',
        entity: 'user',
        entityId: agent._id,
        description: `Agent ${agent.email} created by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          agentId: agent.agentInfo.agentId,
          commissionRate,
        },
      });
      
      res.status(201).json({
        status: 'success',
        message: 'Agent created successfully',
        data: {
          agent: {
            id: agent._id,
            firstName: agent.firstName,
            lastName: agent.lastName,
            email: agent.email,
            phoneNumber: agent.phoneNumber,
            agentId: agent.agentInfo.agentId,
            commissionRate: agent.agentInfo.commissionRate,
            referralCode: agent.agentInfo.referralCode,
          },
          temporaryPassword: agentData.password,
        },
      });
      
      logger.info(`Agent created: ${agent.email}, Agent ID: ${agent.agentInfo.agentId}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error creating agent:', error);
      next(error);
    }
  }

  static async updateAgent(req, res, next) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const agent = await User.findOne({ _id: id, role: 'agent' });
      
      if (!agent) {
        return next(new AppError('Agent not found', 404));
      }
      
      const oldData = {
        commissionRate: agent.agentInfo.commissionRate,
        isVerified: agent.agentInfo.isVerified,
        isActive: agent.isActive,
      };
      
      if (updateData.firstName) agent.firstName = updateData.firstName;
      if (updateData.lastName) agent.lastName = updateData.lastName;
      if (updateData.phoneNumber) agent.phoneNumber = updateData.phoneNumber;
      if (updateData.isActive !== undefined) agent.isActive = updateData.isActive;
      
      if (updateData.commissionRate !== undefined) {
        if (updateData.commissionRate < 0 || updateData.commissionRate > 50) {
          return next(new AppError('Commission rate must be between 0 and 50%', 400));
        }
        agent.agentInfo.commissionRate = updateData.commissionRate;
      }
      
      if (updateData.isVerified !== undefined) {
        agent.agentInfo.isVerified = updateData.isVerified;
      }
      
      if (updateData.assignedArea) {
        agent.agentInfo.assignedArea = {
          ...agent.agentInfo.assignedArea,
          ...updateData.assignedArea,
        };
      }
      
      if (updateData.bankDetails) {
        agent.agentInfo.bankDetails = {
          ...agent.agentInfo.bankDetails,
          ...updateData.bankDetails,
        };
      }
      
      await agent.save();
      
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'update',
        entity: 'user',
        entityId: id,
        changes: {
          old: oldData,
          new: {
            commissionRate: agent.agentInfo.commissionRate,
            isVerified: agent.agentInfo.isVerified,
            isActive: agent.isActive,
          },
        },
        description: `Agent ${agent.email} updated by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          agentId: agent.agentInfo.agentId,
          updatedFields: Object.keys(updateData),
        },
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Agent updated successfully',
        data: {
          agent: {
            id: agent._id,
            firstName: agent.firstName,
            lastName: agent.lastName,
            email: agent.email,
            phoneNumber: agent.phoneNumber,
            agentId: agent.agentInfo.agentId,
            commissionRate: agent.agentInfo.commissionRate,
            isVerified: agent.agentInfo.isVerified,
            isActive: agent.isActive,
          },
        },
      });
      
      logger.info(`Agent updated: ${agent.email}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error updating agent:', error);
      next(error);
    }
  }

  static async verifyAgentDocuments(req, res, next) {
    try {
      const { id } = req.params;
      const { documentType, status, remarks } = req.body;
      
      const agent = await User.findOne({ _id: id, role: 'agent' });
      
      if (!agent) {
        return next(new AppError('Agent not found', 404));
      }
      
      if (!agent.agentInfo.verificationDocuments || agent.agentInfo.verificationDocuments.length === 0) {
        return next(new AppError('No verification documents found for this agent', 400));
      }
      
      const documentIndex = agent.agentInfo.verificationDocuments.findIndex(
        doc => doc.documentType === documentType
      );
      
      if (documentIndex === -1) {
        return next(new AppError(`Document type '${documentType}' not found`, 404));
      }
      
      agent.agentInfo.verificationDocuments[documentIndex].verified = status === 'approved';
      
      const allDocumentsVerified = agent.agentInfo.verificationDocuments.every(
        doc => doc.verified === true
      );
      
      if (allDocumentsVerified) {
        agent.agentInfo.isVerified = true;
        agent.kycStatus = 'verified';
      }
      
      await agent.save();
      
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'update',
        entity: 'user',
        entityId: id,
        description: `Agent document ${documentType} ${status} by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          documentType,
          status,
          remarks,
          isAgentVerified: agent.agentInfo.isVerified,
        },
      });
      
      res.status(200).json({
        status: 'success',
        message: `Document ${status} successfully`,
        data: {
          agent: {
            id: agent._id,
            email: agent.email,
            agentId: agent.agentInfo.agentId,
            isVerified: agent.agentInfo.isVerified,
            verifiedDocuments: agent.agentInfo.verificationDocuments.filter(doc => doc.verified).length,
            totalDocuments: agent.agentInfo.verificationDocuments.length,
          },
        },
      });
      
      logger.info(`Agent document verified: ${agent.email}, Document: ${documentType}, Status: ${status}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error verifying agent documents:', error);
      next(error);
    }
  }

  static async getAgentPerformance(req, res, next) {
    try {
      const { id } = req.params;
      const { period = 'monthly' } = req.query;
      
      const agent = await User.findOne({ _id: id, role: 'agent' });
      
      if (!agent) {
        return next(new AppError('Agent not found', 404));
      }
      
      let startDate;
      const endDate = new Date();
      
      switch (period) {
        case 'daily':
          startDate = new Date();
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'weekly':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'monthly':
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'yearly':
          startDate = new Date();
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
        default:
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      }
      
      const transactionStats = await Transaction.aggregate([
        {
          $match: {
            user: agent._id,
            createdAt: { $gte: startDate, $lte: endDate },
            status: 'successful',
          },
        },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
            averageAmount: { $avg: '$amount' },
            successfulTransactions: { $sum: 1 },
            failedTransactions: {
              $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
            },
          },
        },
      ]);
      
      const dailyTrend = await Transaction.aggregate([
        {
          $match: {
            user: agent._id,
            createdAt: { $gte: startDate, $lte: endDate },
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
      
      const typeBreakdown = await Transaction.aggregate([
        {
          $match: {
            user: agent._id,
            createdAt: { $gte: startDate, $lte: endDate },
            status: 'successful',
          },
        },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
          },
        },
        { $sort: { amount: -1 } },
      ]);
      
      const commissionEarned = (transactionStats[0]?.totalAmount || 0) * (agent.agentInfo.commissionRate / 100);
      
      res.status(200).json({
        status: 'success',
        data: {
          period,
          dateRange: {
            startDate,
            endDate,
          },
          agent: {
            id: agent._id,
            name: agent.fullName,
            agentId: agent.agentInfo.agentId,
            commissionRate: agent.agentInfo.commissionRate,
          },
          performance: {
            transactions: transactionStats[0] || {
              totalTransactions: 0,
              totalAmount: 0,
              averageAmount: 0,
              successfulTransactions: 0,
              failedTransactions: 0,
            },
            commission: {
              rate: agent.agentInfo.commissionRate,
              earned: commissionEarned,
              estimatedMonthly: commissionEarned * (30 / ((endDate - startDate) / (24 * 60 * 60 * 1000))),
            },
            dailyTrend,
            typeBreakdown,
            successRate: transactionStats[0]?.totalTransactions > 0 
              ? (transactionStats[0].successfulTransactions / transactionStats[0].totalTransactions) * 100 
              : 0,
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting agent performance:', error);
      next(error);
    }
  }

  static async getAgentCommissionReport(req, res, next) {
    try {
      const { id } = req.params;
      const { startDate, endDate, page = 1, limit = 20 } = req.query;
      
      const agent = await User.findOne({ _id: id, role: 'agent' });
      
      if (!agent) {
        return next(new AppError('Agent not found', 404));
      }
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const dateFilter = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);
      
      const query = {
        user: agent._id,
        status: 'successful',
        'metadata.commissionEarned': { $exists: true },
      };
      
      if (Object.keys(dateFilter).length > 0) {
        query.createdAt = dateFilter;
      }
      
      const [transactions, total] = await Promise.all([
        Transaction.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Transaction.countDocuments(query),
      ]);
      
      const commissionStats = await Transaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
            totalCommission: { $sum: '$metadata.commissionEarned' },
          },
        },
      ]);
      
      const monthlyTrend = await Transaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m', date: '$createdAt' },
            },
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
            commission: { $sum: '$metadata.commissionEarned' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      
      res.status(200).json({
        status: 'success',
        data: {
          agent: {
            id: agent._id,
            name: agent.fullName,
            agentId: agent.agentInfo.agentId,
            commissionRate: agent.agentInfo.commissionRate,
            totalCommissionEarned: agent.agentInfo.totalCommissionEarned,
            availableCommission: agent.agentInfo.availableCommission,
          },
          dateRange: {
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null,
          },
          commissionStats: commissionStats[0] || {
            totalTransactions: 0,
            totalAmount: 0,
            totalCommission: 0,
          },
          transactions,
          monthlyTrend,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
      
    } catch (error) {
      logger.error('Error getting agent commission report:', error);
      next(error);
    }
  }

  static async getAgentCommission(req, res, next) {
    try {
      const agent = req.user;
      
      const transactions = await Transaction.find({
        user: agent._id,
        'metadata.commissionWithdrawal': true,
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
      
      res.status(200).json({
        status: 'success',
        data: {
          commission: {
            totalEarned: agent.agentInfo.totalCommissionEarned || 0,
            available: agent.agentInfo.availableCommission || 0,
            currency: 'NGN',
          },
          recentWithdrawals: transactions,
        },
      });
      
    } catch (error) {
      logger.error('Error getting agent commission:', error);
      next(error);
    }
  }

  static async withdrawCommission(req, res, next) {
    try {
      const { amount, bankCode, accountNumber } = req.body;
      
      if (!amount || amount <= 0) {
        return next(new AppError('Please provide a valid amount', 400));
      }
      
      const agent = req.user;
      
      let bankDetails = agent.agentInfo?.bankDetails;
      
      if (bankCode && accountNumber) {
        bankDetails = {
          bankName: '',
          accountNumber: accountNumber,
          accountName: '',
          isVerified: false,
        };
      }
      
      if (!bankDetails || !bankDetails.accountNumber) {
        return next(new AppError('No bank account set up. Please contact support or provide bank details.', 400));
      }
      
      if (agent.agentInfo.availableCommission < amount) {
        return next(new AppError('Insufficient available commission', 400));
      }
      
      const transactionReference = `COM-WDL-${Date.now()}`;
      
      const transaction = await Transaction.create({
        reference: transactionReference,
        user: agent._id,
        type: 'commission_withdrawal',
        category: 'commission',
        amount,
        fee: 0,
        totalAmount: amount,
        previousBalance: agent.agentInfo.availableCommission,
        newBalance: agent.agentInfo.availableCommission - amount,
        status: 'processing',
        description: `Commission withdrawal to ${bankDetails.bankName || 'bank'} - ${bankDetails.accountNumber}`,
        metadata: {
          bankDetails,
          commissionWithdrawal: true,
        },
      });
      
      agent.agentInfo.availableCommission -= amount;
      agent.agentInfo.lastCommissionWithdrawal = new Date();
      await agent.save();
      
      setTimeout(async () => {
        try {
          await Transaction.findByIdAndUpdate(transaction._id, {
            status: 'successful',
            statusHistory: [
              {
                status: 'successful',
                note: 'Commission payment processed',
                timestamp: new Date(),
              },
            ],
            completedAt: new Date(),
          });
        } catch (error) {
          logger.error('Error updating commission transaction:', error);
        }
      }, 5000);
      
      res.status(200).json({
        status: 'success',
        message: 'Commission withdrawal request submitted',
        data: {
          transaction: {
            id: transaction._id,
            reference: transaction.reference,
            amount: transaction.amount,
            status: transaction.status,
            createdAt: transaction.createdAt,
          },
          remainingCommission: agent.agentInfo.availableCommission,
        },
      });
      
      logger.info(`Commission withdrawal: ${agent.email}, Amount: ${amount}`);
      
    } catch (error) {
      logger.error('Error withdrawing commission:', error);
      next(error);
    }
  }

  static async processCommissionWithdrawal(req, res, next) {
    try {
      const { id } = req.params;
      const { amount, paymentMethod, reference } = req.body;
      
      if (!amount || amount <= 0) {
        return next(new AppError('Please provide a valid amount', 400));
      }
      
      const agent = await User.findOne({ _id: id, role: 'agent' });
      
      if (!agent) {
        return next(new AppError('Agent not found', 404));
      }
      
      if (!agent.agentInfo.bankDetails || !agent.agentInfo.bankDetails.accountNumber) {
        return next(new AppError('Agent has no bank details set up', 400));
      }
      
      if (agent.agentInfo.availableCommission < amount) {
        return next(new AppError('Insufficient available commission', 400));
      }
      
      const transactionReference = reference || `COM-WDL-${Date.now()}`;
      
      const transaction = await Transaction.create({
        reference: transactionReference,
        user: agent._id,
        type: 'commission_withdrawal',
        category: 'commission',
        amount,
        fee: 0,
        totalAmount: amount,
        previousBalance: agent.agentInfo.availableCommission,
        newBalance: agent.agentInfo.availableCommission - amount,
        status: 'processing',
        description: `Commission withdrawal to ${agent.agentInfo.bankDetails.bankName} - ${agent.agentInfo.bankDetails.accountNumber}`,
        metadata: {
          paymentMethod,
          bankDetails: agent.agentInfo.bankDetails,
          commissionWithdrawal: true,
        },
      });
      
      agent.agentInfo.availableCommission -= amount;
      agent.agentInfo.lastCommissionWithdrawal = new Date();
      await agent.save();
      
      await AdminLog.log({
        admin: req.admin._id,
        adminEmail: req.admin.email,
        adminRole: req.admin.role,
        action: 'debit',
        entity: 'wallet',
        entityId: id,
        changes: {
          old: { availableCommission: agent.agentInfo.availableCommission + amount },
          new: { availableCommission: agent.agentInfo.availableCommission },
        },
        description: `Commission withdrawal of ${amount} NGN processed for agent ${agent.email} by ${req.admin.email}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: 'success',
        metadata: {
          transactionReference,
          amount,
          paymentMethod,
          bankDetails: agent.agentInfo.bankDetails,
        },
      });
      
      setTimeout(async () => {
        try {
          await Transaction.findByIdAndUpdate(transaction._id, {
            status: 'successful',
            statusHistory: [
              ...transaction.statusHistory,
              {
                status: 'successful',
                note: 'Commission payment processed',
                timestamp: new Date(),
              },
            ],
            completedAt: new Date(),
          });
        } catch (error) {
          logger.error('Error updating commission transaction:', error);
        }
      }, 5000);
      
      res.status(200).json({
        status: 'success',
        message: 'Commission withdrawal request processed',
        data: {
          agent: {
            id: agent._id,
            email: agent.email,
            agentId: agent.agentInfo.agentId,
            availableCommission: agent.agentInfo.availableCommission,
            totalCommissionEarned: agent.agentInfo.totalCommissionEarned,
          },
          transaction,
          withdrawalDetails: {
            amount,
            bankName: agent.agentInfo.bankDetails.bankName,
            accountNumber: agent.agentInfo.bankDetails.accountNumber,
            accountName: agent.agentInfo.bankDetails.accountName,
            estimatedDelivery: 'Within 24 hours',
          },
        },
      });
      
      logger.info(`Commission withdrawal processed: Agent ${agent.email}, Amount: ${amount}, Admin: ${req.admin.email}`);
      
    } catch (error) {
      logger.error('Error processing commission withdrawal:', error);
      next(error);
    }
  }

    static async login(req, res, next) {
        try {
          const { email, phoneNumber, password } = req.body;
    
          if ((!email && !phoneNumber) || !password) {
            return next(new AppError('Please provide email/phone and password', 400));
          }
    
          const query = { 
            role: 'agent',
            $or: []
          };
          
          if (email) query.$or.push({ email });
          if (phoneNumber) query.$or.push({ phoneNumber });
          
          const agent = await User.findOne(query).select('+password');
          
          if (!agent) {
            return next(new AppError('Invalid credentials', 401));
          }
          
          if (!agent.isActive) {
            return next(new AppError('Your account is deactivated. Please contact support.', 403));
          }
          
          const isPasswordValid = await agent.comparePassword(password);
          if (!isPasswordValid) {
            return next(new AppError('Invalid credentials', 401));
          }
          
          agent.lastLogin = new Date();
          agent.lastLoginIp = req.ip;
          agent.lastLoginDevice = req.get('user-agent');
          agent.failedLoginAttempts = 0;
          agent.lockUntil = undefined;
          
          await agent.save({ validateBeforeSave: false });
          
          await AdminLog.log({
            admin: agent._id,
            adminEmail: agent.email,
            adminRole: agent.role,
            action: 'login',
            entity: 'user',
            entityId: agent._id,
            description: `Agent ${agent.email} logged in`,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            status: 'success',
          });
          
          logger.info(`Agent login: ${agent.email}, Agent ID: ${agent.agentInfo.agentId}`);
          
          createSendToken(agent, 200, res);
          
        } catch (error) {
          logger.error('Error during agent login:', error);
          next(error);
        }
      }
    
      static async register(req, res, next) {
        try {
          const {
            firstName,
            lastName,
            email,
            phoneNumber,
            password,
            referralCode,
            businessName,
            businessAddress,
            state,
            city,
            idType,
            idNumber,
          } = req.body;
          
          const existingUser = await User.findOne({
            $or: [{ email }, { phoneNumber }],
          });
          
          if (existingUser) {
            return next(new AppError('User with this email or phone already exists', 400));
          }
          
          let referringAgent = null;
          if (referralCode) {
            referringAgent = await User.findOne({
              'agentInfo.referralCode': referralCode,
              role: 'agent',
              'agentInfo.isVerified': true,
              isActive: true,
            });
            
            if (!referringAgent) {
              return next(new AppError('Invalid referral code', 400));
            }
          }
          
          const agentData = {
            firstName,
            lastName,
            email,
            phoneNumber,
            password,
            role: 'agent',
            roles: ['agent'],
            isEmailVerified: false,
            isPhoneVerified: false,
            isActive: false,
            isApproved: false,
            kycStatus: 'pending',
            referredBy: referringAgent?._id,
            agentInfo: {
              businessName,
              businessAddress,
              assignedArea: { state, city },
              idVerification: {
                type: idType,
                number: idNumber,
                verified: false,
              },
              isVerified: false,
              activationDate: null,
              referralCode: `AGT${Date.now().toString().slice(-6)}`,
            },
          };
          
          const agent = await User.create(agentData);
          
          await Wallet.create({
            user: agent._id,
            balance: 0,
          });
          
          const verificationToken = crypto.randomBytes(32).toString('hex');
          agent.emailVerificationToken = crypto
            .createHash('sha256')
            .update(verificationToken)
            .digest('hex');
          agent.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
          await agent.save();

          
          await AdminLog.log({
            admin: agent._id,
            adminEmail: agent.email,
            adminRole: agent.role,
            action: 'register',
            entity: 'user',
            entityId: agent._id,
            description: `Agent ${agent.email} registered`,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            status: 'success',
            metadata: {
              referredBy: referringAgent?._id,
              referralCode: referringAgent?.agentInfo.referralCode,
            },
          });
          
          res.status(201).json({
            status: 'success',
            message: 'Registration successful. Please check your email for verification.',
            data: {
              agent: {
                id: agent._id,
                firstName: agent.firstName,
                lastName: agent.lastName,
                email: agent.email,
                phoneNumber: agent.phoneNumber,
                agentId: agent.agentInfo.agentId,
                referralCode: agent.agentInfo.referralCode,
                isVerified: agent.agentInfo.isVerified,
                status: 'pending_approval',
              },
            },
          });
          
          logger.info(`Agent registered: ${agent.email}, Agent ID: ${agent.agentInfo.agentId}`);
          
        } catch (error) {
          logger.error('Error during agent registration:', error);
          next(error);
        }
      }
    
      static async purchaseAirtime(req, res, next) {
        try {
          const { phoneNumber, amount, network, requestId, bypassOTP } = req.body;
          
          if (!phoneNumber || !amount || !network) {
            return next(new AppError('Please provide phone number, amount, and network', 400));
          }
          
          const agent = req.user;
          const wallet = await Wallet.findOne({ user: agent._id });
          
          if (!wallet) {
            return next(new AppError('Wallet not found', 404));
          }
          
          const service = await ServicePricing.findOne({
            serviceType: 'airtime_recharge',
            network: network.toLowerCase(),
            isActive: true,
            isAvailable: true,
          }).sort({ sellingPrice: 1 });
          
          if (!service) {
            return next(new AppError('Airtime service is currently unavailable for this network', 400));
          }
          
          const commission = (service.agentCommission || 0) * amount / 100;
          const costAfterCommission = amount - commission;
          const totalCost = costAfterCommission;
          
          if (wallet.balance < totalCost) {
            return next(new AppError('Insufficient wallet balance', 400));
          }
          
          const reference = requestId || `AIRT-${Date.now()}`;
          
          const transaction = await Transaction.create({
            reference,
            user: agent._id,
            type: 'airtime_recharge',
            category: 'airtime',
            amount: amount,
            fee: 0,
            totalAmount: totalCost,
            previousBalance: wallet.balance,
            newBalance: wallet.balance - totalCost,
            status: 'processing',
            description: `Airtime recharge of ${amount} NGN to ${phoneNumber} (${network})`,
            metadata: {
              phoneNumber,
              network,
              serviceId: service._id,
              commission,
              costAfterCommission,
              bypassOTP: bypassOTP || false,
            },
          });
          
          wallet.balance -= totalCost;
          await wallet.save();
          
          const provider = await ProviderStatus.findOne({
            supportedServices: 'airtime_recharge',
            status: 'active',
          }).sort({ priority: 1, successRate: -1 });
          
          if (!provider) {
            throw new AppError('No provider available for airtime recharge', 500);
          }

          await ProviderPurchaseGuardService.assertSufficientProviderBalance(
            provider.providerName,
            Number(amount),
            { serviceType: 'airtime_recharge', network, phoneNumber, actor: 'agent' }
          );
          
          const apiResponse = {
            success: true,
            reference: transaction.reference,
            status: 'successful',
            message: 'Airtime recharge successful',
            data: {
              amount,
              phoneNumber,
              network,
              transactionId: `API-${Date.now()}`,
            },
          };
          
          if (apiResponse.success) {
            transaction.status = 'successful';
            transaction.metadata.apiResponse = apiResponse;
            transaction.metadata.providerUsed = provider.providerName;
            transaction.completedAt = new Date();
            transaction.statusHistory.push({
              status: 'successful',
              note: 'Airtime delivered successfully',
              timestamp: new Date(),
            });
            
            agent.agentInfo.totalCommissionEarned += commission;
            agent.agentInfo.availableCommission += commission;
            agent.agentInfo.totalTransactions += 1;
            await agent.save();
            
            await provider.incrementRequest(true);
            
            await AdminLog.log({
              admin: agent._id,
              adminEmail: agent.email,
              adminRole: agent.role,
              action: 'purchase',
              entity: 'transaction',
              entityId: transaction._id,
              description: `Airtime recharge of ${amount} NGN to ${phoneNumber}`,
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
              status: 'success',
              metadata: {
                amount,
                phoneNumber,
                network,
                commission,
                provider: provider.providerName,
              },
            });
            
            logger.info(`Airtime purchase successful: ${agent.email}, Amount: ${amount}, Phone: ${phoneNumber}`);
          } else {
            wallet.balance += totalCost;
            await wallet.save();
            
            transaction.status = 'failed';
            transaction.metadata.apiResponse = apiResponse;
            transaction.metadata.providerUsed = provider.providerName;
            transaction.statusHistory.push({
              status: 'failed',
              note: apiResponse.message || 'Airtime recharge failed',
              timestamp: new Date(),
            });
            
            await provider.incrementRequest(false);
            
            logger.error(`Airtime purchase failed: ${agent.email}, Amount: ${amount}, Phone: ${phoneNumber}`);
          }
          
          await transaction.save();
          
          res.status(200).json({
            status: 'success',
            message: apiResponse.success ? 'Airtime purchase successful' : 'Airtime purchase failed',
            data: {
              transaction: {
                id: transaction._id,
                reference: transaction.reference,
                amount: transaction.amount,
                status: transaction.status,
                timestamp: transaction.createdAt,
              },
              airtimeDetails: {
                phoneNumber,
                network,
                amount,
                commission,
              },
              walletBalance: wallet.balance,
            },
          });
          
        } catch (error) {
          logger.error('Error during airtime purchase:', error);
          next(error);
        }
      }
    
      static async purchaseData(req, res, next) {
        try {
          const { phoneNumber, planId, requestId, dataType } = req.body;
          const requestedDataType = normalizeDataType(dataType);
          
          if (!phoneNumber || !planId) {
            return next(new AppError('Please provide phone number and plan ID', 400));
          }
          
          const agent = req.user;
          const wallet = await Wallet.findOne({ user: agent._id });
          
          if (!wallet) {
            return next(new AppError('Wallet not found', 404));
          }
          
          const service = await ServicePricing.findById(planId);
          
          if (!service || !service.isActive || !service.isAvailable) {
            return next(new AppError('Data plan is currently unavailable', 400));
          }

          const serviceDataType = normalizeDataType(
            service.providerPlanType || inferDataTypeFromPlanName(service.planName || service.size || '')
          ) || 'other';
          if (requestedDataType && requestedDataType !== 'all' && requestedDataType !== serviceDataType) {
            return next(new AppError(`Selected plan is '${serviceDataType}' type, but '${requestedDataType}' was requested`, 400));
          }
          
          const commission = (service.agentCommission || 0) * service.sellingPrice / 100;
          const costAfterCommission = service.sellingPrice - commission;
          const totalCost = costAfterCommission;
          
          if (wallet.balance < totalCost) {
            return next(new AppError('Insufficient wallet balance', 400));
          }
          
          const reference = requestId || `DATA-${Date.now()}`;
          
          const transaction = await Transaction.create({
            reference,
            user: agent._id,
            type: 'data_recharge',
            category: 'data',
            amount: service.sellingPrice,
            fee: 0,
            totalAmount: totalCost,
            previousBalance: wallet.balance,
            newBalance: wallet.balance - totalCost,
            status: 'processing',
            description: `Data recharge: ${service.planName} to ${phoneNumber}`,
            metadata: {
              phoneNumber,
              network: service.network,
              planName: service.planName,
              planCode: service.planCode,
              dataAmount: service.dataAmount,
              validity: service.validity,
              serviceId: service._id,
              commission,
              costAfterCommission,
            },
          });
          
          wallet.balance -= totalCost;
          await wallet.save();
          
          const provider = await ProviderStatus.findOne({
            supportedServices: 'data_recharge',
            status: 'active',
          }).sort({ priority: 1, successRate: -1 });
          
          if (!provider) {
            throw new AppError('No provider available for data recharge', 500);
          }

          await ProviderPurchaseGuardService.assertSufficientProviderBalance(
            provider.providerName,
            Number(service.sellingPrice),
            { serviceType: 'data_recharge', network: service.network, phoneNumber, actor: 'agent' }
          );
          
          const apiResponse = {
            success: true,
            reference: transaction.reference,
            status: 'successful',
            message: 'Data recharge successful',
            data: {
              phoneNumber,
              planName: service.planName,
              dataAmount: service.dataAmount,
              validity: service.validity,
              transactionId: `API-${Date.now()}`,
            },
          };
          
          if (apiResponse.success) {
            transaction.status = 'successful';
            transaction.metadata.apiResponse = apiResponse;
            transaction.metadata.providerUsed = provider.providerName;
            transaction.completedAt = new Date();
            transaction.statusHistory.push({
              status: 'successful',
              note: 'Data delivered successfully',
              timestamp: new Date(),
            });
            
            agent.agentInfo.totalCommissionEarned += commission;
            agent.agentInfo.availableCommission += commission;
            agent.agentInfo.totalTransactions += 1;
            await agent.save();
            
            await provider.incrementRequest(true);
            
            await AdminLog.log({
              admin: agent._id,
              adminEmail: agent.email,
              adminRole: agent.role,
              action: 'purchase',
              entity: 'transaction',
              entityId: transaction._id,
              description: `Data recharge: ${service.planName} to ${phoneNumber}`,
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
              status: 'success',
              metadata: {
                planName: service.planName,
                amount: service.sellingPrice,
                phoneNumber,
                commission,
                provider: provider.providerName,
              },
            });
            
            logger.info(`Data purchase successful: ${agent.email}, Plan: ${service.planName}, Phone: ${phoneNumber}`);
          } else {
            wallet.balance += totalCost;
            await wallet.save();
            
            transaction.status = 'failed';
            transaction.metadata.apiResponse = apiResponse;
            transaction.metadata.providerUsed = provider.providerName;
            transaction.statusHistory.push({
              status: 'failed',
              note: apiResponse.message || 'Data recharge failed',
              timestamp: new Date(),
            });
            
            await provider.incrementRequest(false);
            
            logger.error(`Data purchase failed: ${agent.email}, Plan: ${service.planName}, Phone: ${phoneNumber}`);
          }
          
          await transaction.save();
          
          res.status(200).json({
            status: 'success',
            message: apiResponse.success ? 'Data purchase successful' : 'Data purchase failed',
            data: {
              transaction: {
                id: transaction._id,
                reference: transaction.reference,
                amount: transaction.amount,
                status: transaction.status,
                timestamp: transaction.createdAt,
              },
              dataDetails: {
                phoneNumber,
                planName: service.planName,
                dataAmount: service.dataAmount,
                validity: service.validity,
                network: service.network,
                dataType: serviceDataType,
                commission,
              },
              walletBalance: wallet.balance,
            },
          });
          
        } catch (error) {
          logger.error('Error during data purchase:', error);
          next(error);
        }
      }
    
      static async payBill(req, res, next) {
        try {
          const { serviceType, meterNumber, amount, provider, requestId, customerDetails } = req.body;
          
          if (!serviceType || !meterNumber) {
            return next(new AppError('Please provide service type and meter/customer number', 400));
          }
          
          const agent = req.user;
          const wallet = await Wallet.findOne({ user: agent._id });
          
          if (!wallet) {
            return next(new AppError('Wallet not found', 404));
          }
          
          // Validate service type
          const validServices = ['electricity', 'cable_tv', 'education_pin', 'rrr_payment'];
          if (!validServices.includes(serviceType)) {
            return next(new AppError('Invalid service type', 400));
          }

          if (serviceType === 'electricity') {
            const activeProvider = await vtuConfig.getProviderIdForService('electricity');

            if (activeProvider !== 'clubkonnect') {
              return next(new AppError(`Electricity provider ${activeProvider} is not implemented for agent bill payment`, 400));
            }

            const billAmount = Number(amount);
            if (Number.isNaN(billAmount) || billAmount < 500 || billAmount > 100000) {
              return next(new AppError('Amount must be between ₦500 and ₦100,000', 400));
            }

            const meterType = customerDetails?.meterType || 'prepaid';
            const verification = await NelloBytesService.verifyElectricityMeter({
              electricCompany: provider,
              meterNo: meterNumber,
              meterType,
            });

            if (!verification.valid) {
              return next(new AppError('Invalid meter number', 400));
            }

            if (wallet.balance < billAmount) {
              return next(new AppError('Insufficient wallet balance', 400));
            }

            await ProviderPurchaseGuardService.assertSufficientProviderBalance(
              'clubkonnect',
              billAmount,
              { serviceType: 'electricity', provider, meterNumber, actor: 'agent' }
            );

            const reference = requestId || `${serviceType.toUpperCase()}-${Date.now()}`;
            const previousBalance = wallet.balance;

            wallet.balance -= billAmount;
            await wallet.save();

            const transaction = await Transaction.create({
              reference,
              user: agent._id,
              type: serviceType,
              category: 'bills',
              amount: billAmount,
              fee: 0,
              totalAmount: billAmount,
              previousBalance,
              newBalance: wallet.balance,
              status: 'pending',
              description: `${serviceType} payment for ${meterNumber}`,
              metadata: {
                serviceType,
                meterNumber,
                provider,
                amount: billAmount,
                customerDetails,
                customerName: verification.customerName,
                source: 'nellobytes',
              },
              service: {
                provider: 'clubkonnect',
                disco: provider,
                meterNumber,
                customerName: verification.customerName,
              },
            });

            const apiResponse = await NelloBytesService.payElectricityBill({
              electricCompany: provider,
              meterNo: meterNumber,
              meterType,
              amount: billAmount,
              phoneNo: customerDetails?.phone || agent.phoneNumber,
              requestId: reference,
              callBackURL: `${process.env.SERVER_URL || 'https://api.yareemadata.com'}/api/v1/bills/webhook/nellobytes`,
            });

            if (apiResponse.success || apiResponse.statusCode === '100') {
              transaction.status = apiResponse.statusCode === '200' ? 'successful' : 'pending';
              transaction.metadata.apiResponse = apiResponse.response;
              transaction.metadata.providerUsed = 'clubkonnect';
              transaction.service.orderId = apiResponse.orderId;
              transaction.service.meterType = meterType;
              transaction.statusHistory.push({
                status: transaction.status,
                note: transaction.status === 'successful' ? 'Bill payment successful' : 'Bill payment initiated',
                timestamp: new Date(),
              });

              if (transaction.status === 'successful') {
                transaction.completedAt = new Date();
              }

              await transaction.save();

              return res.status(200).json({
                status: 'success',
                message: transaction.status === 'successful' ? 'Bill payment successful' : 'Bill payment initiated',
                data: {
                  transaction: {
                    id: transaction._id,
                    reference: transaction.reference,
                    amount: transaction.amount,
                    status: transaction.status,
                    timestamp: transaction.createdAt,
                  },
                  billDetails: {
                    serviceType,
                    meterNumber,
                    amount: billAmount,
                    provider,
                    customerName: verification.customerName,
                    source: 'nellobytes',
                  },
                  walletBalance: wallet.balance,
                },
              });
            }

            wallet.balance += billAmount;
            await wallet.save();

            transaction.status = 'failed';
            transaction.metadata.apiResponse = apiResponse.response || apiResponse;
            transaction.metadata.providerUsed = 'clubkonnect';
            transaction.statusHistory.push({
              status: 'failed',
              note: apiResponse.status || apiResponse.message || 'Bill payment failed',
              timestamp: new Date(),
            });
            await transaction.save();

            return next(new AppError(apiResponse.status || apiResponse.message || 'Bill payment failed', 500));
          }
          
          // Get service pricing
          let service;
          let query = {
            serviceType,
            isActive: true,
            isAvailable: true,
          };
          
          if (serviceType === 'electricity') {
            query.disco = provider;
          } else if (serviceType === 'cable_tv') {
            query.cableProvider = provider;
          } else {
            query.provider = provider;
          }
          
          service = await ServicePricing.findOne(query).sort({ sellingPrice: 1 });
          
          if (!service) {
            return next(new AppError('Service is currently unavailable', 400));
          }
          
          if (serviceType === 'electricity' && amount) {
            if (service.minAmount && amount < service.minAmount) {
              return next(new AppError(`Minimum amount is ${service.minAmount}`, 400));
            }
            if (service.maxAmount && amount > service.maxAmount) {
              return next(new AppError(`Maximum amount is ${service.maxAmount}`, 400));
            }
          }
          
          const billAmount = amount || service.sellingPrice;
          
          const commission = (service.agentCommission || 0) * billAmount / 100;
          const costAfterCommission = billAmount - commission;
          const totalCost = costAfterCommission;
          
          if (wallet.balance < totalCost) {
            return next(new AppError('Insufficient wallet balance', 400));
          }

          const reference = requestId || `${serviceType.toUpperCase()}-${Date.now()}`;
          
          const transaction = await Transaction.create({
            reference,
            user: agent._id,
            type: serviceType,
            category: 'bills',
            amount: billAmount,
            fee: 0,
            totalAmount: totalCost,
            previousBalance: wallet.balance,
            newBalance: wallet.balance - totalCost,
            status: 'processing',
            description: `${serviceType} payment for ${meterNumber}`,
            metadata: {
              serviceType,
              meterNumber,
              provider,
              amount: billAmount,
              customerDetails,
              serviceId: service._id,
              commission,
              costAfterCommission,
            },
          });
          
          wallet.balance -= totalCost;
          await wallet.save();
          
          const billProvider = await ProviderStatus.findOne({
            supportedServices: serviceType,
            status: 'active',
          }).sort({ priority: 1, successRate: -1 });
          
          if (!billProvider) {
            throw new AppError('No provider available for bill payment', 500);
          }

          await ProviderPurchaseGuardService.assertSufficientProviderBalance(
            billProvider.providerName,
            Number(billAmount),
            { serviceType, provider, meterNumber, actor: 'agent' }
          );
          
          const apiResponse = {
            success: true,
            reference: transaction.reference,
            status: 'successful',
            message: 'Bill payment successful',
            data: {
              serviceType,
              meterNumber,
              amount: billAmount,
              provider,
              transactionId: `API-${Date.now()}`,
            },
          };
          
          if (apiResponse.success) {
            transaction.status = 'successful';
            transaction.metadata.apiResponse = apiResponse;
            transaction.metadata.providerUsed = billProvider.providerName;
            transaction.completedAt = new Date();
            transaction.statusHistory.push({
              status: 'successful',
              note: 'Bill payment successful',
              timestamp: new Date(),
            });
            
            agent.agentInfo.totalCommissionEarned += commission;
            agent.agentInfo.availableCommission += commission;
            agent.agentInfo.totalTransactions += 1;
            await agent.save();
            
            await billProvider.incrementRequest(true);
            
            await AdminLog.log({
              admin: agent._id,
              adminEmail: agent.email,
              adminRole: agent.role,
              action: 'payment',
              entity: 'transaction',
              entityId: transaction._id,
              description: `${serviceType} payment of ${billAmount} NGN for ${meterNumber}`,
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
              status: 'success',
              metadata: {
                serviceType,
                amount: billAmount,
                meterNumber,
                commission,
                provider: billProvider.providerName,
              },
            });
            
            logger.info(`Bill payment successful: ${agent.email}, Service: ${serviceType}, Amount: ${billAmount}`);
          } else {
            wallet.balance += totalCost;
            await wallet.save();
            
            transaction.status = 'failed';
            transaction.metadata.apiResponse = apiResponse;
            transaction.metadata.providerUsed = billProvider.providerName;
            transaction.statusHistory.push({
              status: 'failed',
              note: apiResponse.message || 'Bill payment failed',
              timestamp: new Date(),
            });
            
            await billProvider.incrementRequest(false);
            
            logger.error(`Bill payment failed: ${agent.email}, Service: ${serviceType}, Amount: ${billAmount}`);
          }
          
          await transaction.save();
          
          res.status(200).json({
            status: 'success',
            message: apiResponse.success ? 'Bill payment successful' : 'Bill payment failed',
            data: {
              transaction: {
                id: transaction._id,
                reference: transaction.reference,
                amount: transaction.amount,
                status: transaction.status,
                timestamp: transaction.createdAt,
              },
              billDetails: {
                serviceType,
                meterNumber,
                amount: billAmount,
                provider,
                commission,
              },
              walletBalance: wallet.balance,
            },
          });
          
        } catch (error) {
          logger.error('Error during bill payment:', error);
          next(error);
        }
      }
    
      static async getServices(req, res, next) {
        try {
          const { serviceType, network, provider } = req.query;
          const activeProvider = await vtuConfig.getProviderIdForService('electricity');

          if (serviceType === 'electricity') {
            if (activeProvider === 'clubkonnect') {
              const electricityDiscos = await NelloBytesService.getElectricityDiscos();
              const discos = electricityDiscos.discos || normalizeElectricityDiscos(electricityDiscos);

              return res.status(200).json({
                status: 'success',
                data: {
                  services: {
                    electricity: discos,
                  },
                  providers: [
                    {
                      providerName: 'clubkonnect',
                      displayName: 'Club Konnect (NelloBytes)',
                      status: 'active',
                    },
                  ],
                  source: 'nellobytes',
                  timestamp: new Date(),
                },
              });
            }
          }
          
          const query = {
            isActive: true,
            isAvailable: true,
          };

          if (!serviceType && activeProvider === 'clubkonnect') {
            query.serviceType = { $ne: 'electricity' };
          }
          
          if (serviceType) query.serviceType = serviceType;
          if (network) query.network = network;
          if (provider) query.provider = provider;
          
          const services = await ServicePricing.find(query)
            .sort({ priority: 1, sellingPrice: 1 })
            .lean();
          
          const groupedServices = services.reduce((acc, service) => {
            if (!acc[service.serviceType]) {
              acc[service.serviceType] = [];
            }
            acc[service.serviceType].push(service);
            return acc;
          }, {});
          
          const providers = await ProviderStatus.find({
            status: { $in: ['active', 'degraded'] },
          }).lean();

          if (!serviceType && activeProvider === 'clubkonnect') {
            const electricityDiscos = await NelloBytesService.getElectricityDiscos();
            groupedServices.electricity = electricityDiscos.discos || normalizeElectricityDiscos(electricityDiscos);
          }
          
          res.status(200).json({
            status: 'success',
            data: {
              services: groupedServices,
              providers,
              ...(activeProvider === 'clubkonnect' ? { electricitySource: 'nellobytes' } : {}),
              timestamp: new Date(),
            },
          });
          
        } catch (error) {
          logger.error('Error getting services:', error);
          next(error);
        }
      }
    
      static async verifyCustomer(req, res, next) {
        try {
          const { serviceType, customerId, provider, meterType = 'prepaid' } = req.body;
          
          if (!serviceType || !customerId) {
            return next(new AppError('Please provide service type and customer ID', 400));
          }
          
          const validServices = ['electricity', 'cable_tv'];
          if (!validServices.includes(serviceType)) {
            return next(new AppError('Invalid service type', 400));
          }

          if (serviceType === 'electricity') {
            const activeProvider = await vtuConfig.getProviderIdForService('electricity');

            if (activeProvider === 'clubkonnect') {
              const result = await NelloBytesService.verifyElectricityMeter({
                electricCompany: provider,
                meterNo: customerId,
                meterType,
              });

              return res.status(200).json({
                status: 'success',
                message: 'Customer verification successful',
                data: {
                  customerName: result.customerName,
                  customerId,
                  provider,
                  meterType,
                  verified: result.valid,
                  source: 'nellobytes',
                },
              });
            }
          }
          
          
          const verificationResponse = {
            success: true,
            data: {
              customerName: 'JOHN DOE',
              customerAddress: '123 MAIN STREET, LAGOS',
              outstandingBalance: serviceType === 'electricity' ? 1500 : 0,
              tariff: serviceType === 'electricity' ? 'R2' : null,
              lastPaymentDate: '2024-01-15',
              lastPaymentAmount: serviceType === 'electricity' ? 5000 : 3500,
              status: 'active',
            },
          };
          
          res.status(200).json({
            status: 'success',
            message: 'Customer verification successful',
            data: verificationResponse.data,
          });
          
        } catch (error) {
          logger.error('Error verifying customer:', error);
          next(error);
        }
      }
    
      static async getDashboardStats(req, res, next) {
        try {
          const agent = req.user;
          const wallet = await Wallet.findOne({ user: agent._id }).lean();
          
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          
          const sevenDaysAgo = new Date(today);
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          
          const thirtyDaysAgo = new Date(today);
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          
          const [todayStats, weeklyStats, monthlyStats, totalStats] = await Promise.all([
            Transaction.aggregate([
              {
                $match: {
                  user: agent._id,
                  createdAt: { $gte: today },
                  status: 'successful',
                },
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  amount: { $sum: '$amount' },
                  commission: { $sum: '$metadata.commission' },
                },
              },
            ]),
            
            Transaction.aggregate([
              {
                $match: {
                  user: agent._id,
                  createdAt: { $gte: sevenDaysAgo },
                  status: 'successful',
                },
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  amount: { $sum: '$amount' },
                  commission: { $sum: '$metadata.commission' },
                },
              },
            ]),
            
            Transaction.aggregate([
              {
                $match: {
                  user: agent._id,
                  createdAt: { $gte: thirtyDaysAgo },
                  status: 'successful',
                },
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  amount: { $sum: '$amount' },
                  commission: { $sum: '$metadata.commission' },
                },
              },
            ]),
            
            Transaction.aggregate([
              {
                $match: {
                  user: agent._id,
                  status: 'successful',
                },
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  amount: { $sum: '$amount' },
                  commission: { $sum: '$metadata.commission' },
                },
              },
            ]),
          ]);
          
          const recentTransactions = await Transaction.find({ user: agent._id })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();
          
          const serviceBreakdown = await Transaction.aggregate([
            {
              $match: {
                user: agent._id,
                createdAt: { $gte: thirtyDaysAgo },
                status: 'successful',
              },
            },
            {
              $group: {
                _id: '$type',
                count: { $sum: 1 },
                amount: { $sum: '$amount' },
                commission: { $sum: '$metadata.commission' },
              },
            },
            { $sort: { amount: -1 } },
          ]);
          
          const referralsCount = await User.countDocuments({
            referredBy: agent._id,
            role: 'user',
          });
          
          res.status(200).json({
            status: 'success',
            data: {
              agent: {
                id: agent._id,
                name: agent.fullName,
                agentId: agent.agentInfo.agentId,
                referralCode: agent.agentInfo.referralCode,
                commissionRate: agent.agentInfo.commissionRate,
                isVerified: agent.agentInfo.isVerified,
              },
              wallet: wallet || { balance: 0 },
              stats: {
                today: todayStats[0] || { count: 0, amount: 0, commission: 0 },
                weekly: weeklyStats[0] || { count: 0, amount: 0, commission: 0 },
                monthly: monthlyStats[0] || { count: 0, amount: 0, commission: 0 },
                total: totalStats[0] || { count: 0, amount: 0, commission: 0 },
                referrals: referralsCount,
                availableCommission: agent.agentInfo.availableCommission,
                totalCommissionEarned: agent.agentInfo.totalCommissionEarned,
              },
              recentTransactions,
              serviceBreakdown,
            },
          });
          
        } catch (error) {
          logger.error('Error getting dashboard stats:', error);
          next(error);
        }
      }
    }
    
module.exports = AgentController;
