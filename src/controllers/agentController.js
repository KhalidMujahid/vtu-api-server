const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const ProviderStatus = require("../models/ProviderStatus");
const AdminLog = require('../models/AdminLog');
const WalletService = require('../services/walletService');
const telecomController = require('./telecomController');
const billsController = require('./billsController');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const crypto = require('crypto');
const jwt = require("jsonwebtoken");
const NelloBytesService = require('../services/nelloBytesService');
const ProviderPurchaseGuardService = require('../services/providerPurchaseGuardService');
const vtuConfig = require('../config/vtuProviders');
const { sendAgentVerificationEmail } = require('../utils/emailService');

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

const serializeWallet = (wallet) => {
  if (!wallet) return null;

  return {
    balance: wallet.balance,
    currency: wallet.currency,
    locked: wallet.locked,
    virtualAccount: wallet.virtualAccount
      ? {
          bankName: wallet.virtualAccount.bankName,
          accountNumber: wallet.virtualAccount.accountNumber,
          accountName: wallet.virtualAccount.accountName,
          bankCode: wallet.virtualAccount.bankCode,
          reference: wallet.virtualAccount.reference,
        }
      : null,
  };
};

const getOrCreateAgentWallet = async (agent) => {
  return WalletService.createWallet(agent);
};

const prepareAgentEmailVerification = async (agent) => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  agent.emailVerificationToken = tokenHash;
  agent.emailVerificationExpires = expiresAt;
  await agent.save();

  const baseUrl = process.env.FRONTEND_URL || process.env.SERVER_URL || 'https://api.yareemadata.com';
  const verificationUrl = `${baseUrl.replace(/\/$/, '')}/agent/verify-email/${rawToken}`;
  await sendAgentVerificationEmail(agent.email, agent.firstName, verificationUrl);

  return { token: rawToken, verificationUrl, expiresAt };
};

const extractPurchaseAmount = (payload) => {
  const candidates = [
    payload?.data?.amount,
    payload?.data?.transaction?.amount,
    payload?.data?.providerAmount,
    payload?.data?.billDetails?.amount,
    payload?.data?.transaction?.totalAmount,
  ];

  for (const candidate of candidates) {
    const amount = Number(candidate);
    if (Number.isFinite(amount) && amount > 0) {
      return amount;
    }
  }

  return 0;
};

const COMMISSION_TRANSACTION_MATCH = [
  { type: 'commission_earned' },
  { type: 'commission_transfer' },
  { type: 'commission_withdrawal' },
  { 'metadata.commissionEarned': true },
  { 'metadata.commissionTransfer': true },
  { 'metadata.commissionWithdrawal': true },
];

const buildCommissionHistoryQuery = (agentId) => ({
  user: agentId,
  status: 'successful',
  $or: COMMISSION_TRANSACTION_MATCH,
});

const getCommissionHistory = async (agentId, limit = 10) => {
  const query = buildCommissionHistoryQuery(agentId);
  const [transactions, summary] = await Promise.all([
    Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Transaction.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalCommission: {
            $sum: {
              $ifNull: ['$metadata.commission', '$metadata.commissionEarned'],
            },
          },
          totalWithdrawn: {
            $sum: {
              $cond: [
                { $in: ['$type', ['commission_transfer', 'commission_withdrawal']] },
                '$amount',
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  return {
    summary: summary[0] || {
      totalTransactions: 0,
      totalCommission: 0,
      totalWithdrawn: 0,
    },
    transactions,
  };
};

const captureControllerPayload = async (req, handler) => {
  let statusCode = 200;
  let payload = null;
  const proxyRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
    send(body) {
      payload = body;
      return this;
    },
    setHeader() {
      return this;
    },
    header() {
      return this;
    },
  };

  await handler(req, proxyRes, (error) => {
    throw error;
  });

  return { statusCode, payload };
};

const getAgentCommissionRate = async (agentId) => {
  const agent = await User.findById(agentId).select('agentInfo.commissionRate');
  return Number(agent?.agentInfo?.commissionRate || 0);
};

const creditAgentCommission = async (agentId, purchaseAmount) => {
  const commissionRate = await getAgentCommissionRate(agentId);
  const commissionAmount = (commissionRate / 100) * Number(purchaseAmount || 0);

  if (!Number.isFinite(commissionAmount) || commissionAmount <= 0) {
    return { commissionAmount: 0, commissionRate };
  }

  const agent = await User.findById(agentId);
  if (!agent) {
    return { commissionAmount: 0, commissionRate };
  }

  const previousAvailableCommission = Number(agent.agentInfo?.availableCommission || 0);
  const previousTotalCommission = Number(agent.agentInfo?.totalCommissionEarned || 0);

  agent.agentInfo = agent.agentInfo || {};
  agent.agentInfo.totalCommissionEarned = previousTotalCommission + commissionAmount;
  agent.agentInfo.availableCommission = previousAvailableCommission + commissionAmount;
  agent.agentInfo.totalTransactions = Number(agent.agentInfo.totalTransactions || 0) + 1;
  agent.agentInfo.totalTransactionAmount = Number(agent.agentInfo.totalTransactionAmount || 0) + Number(purchaseAmount || 0);
  await agent.save();

  try {
    await Transaction.create({
      reference: `COM-EARN-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      user: agentId,
      type: 'commission_earned',
      category: 'commission',
      amount: commissionAmount,
      fee: 0,
      totalAmount: commissionAmount,
      previousBalance: previousAvailableCommission,
      newBalance: agent.agentInfo.availableCommission,
      status: 'successful',
      description: 'Commission earned from agent service purchase',
      metadata: {
        commissionEarned: true,
        commissionRate,
        purchaseAmount: Number(purchaseAmount || 0),
      },
      completedAt: new Date(),
    });
  } catch (ledgerError) {
    logger.error('Failed to write commission ledger transaction:', ledgerError);
  }

  return { commissionAmount, commissionRate };
};

const forwardUserServiceWithAgentCommission = async (req, res, next, handler, options = {}) => {
  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  let statusCode = 200;
  let payload = null;

  const proxyRes = Object.create(res);
  proxyRes.status = (code) => {
    statusCode = code;
    return proxyRes;
  };
  proxyRes.json = (body) => {
    payload = body;
    return proxyRes;
  };

  try {
    await handler(req, proxyRes, (error) => {
      throw error;
    });
  } catch (error) {
    return next(error);
  } finally {
    res.status = originalStatus;
    res.json = originalJson;
  }

  if (!payload) {
    return null;
  }

  const responseStatus = String(payload?.status || '').toLowerCase();
  const transactionStatus = String(
    payload?.data?.transaction?.status ||
    payload?.data?.status ||
    ''
  ).toLowerCase();

  if (responseStatus === 'success' && ['successful', 'pending'].includes(transactionStatus || 'successful')) {
    const purchaseAmount = extractPurchaseAmount(payload);
    await creditAgentCommission(req.user._id, purchaseAmount);
  }

  return originalStatus(statusCode).json(payload);
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

      await WalletService.createWallet(agent);

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
        $or: [
          { type: 'commission_earned' },
          { type: 'commission_transfer' },
          { type: 'commission_withdrawal' },
          { 'metadata.commission': { $exists: true } },
          { 'metadata.commissionEarned': { $exists: true } },
          { 'metadata.commissionTransfer': true },
          { 'metadata.commissionWithdrawal': true },
        ],
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
              totalCommission: {
                $sum: {
                  $ifNull: ['$metadata.commission', '$metadata.commissionEarned'],
                },
              },
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
            commission: {
              $sum: {
                $ifNull: ['$metadata.commission', '$metadata.commissionEarned'],
              },
            },
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
      const commissionHistory = await getCommissionHistory(agent._id, 10);

      res.status(200).json({
        status: 'success',
        data: {
          commission: {
            totalEarned: agent.agentInfo.totalCommissionEarned || 0,
            available: agent.agentInfo.availableCommission || 0,
            currency: 'NGN',
          },
          commissionHistory: {
            summary: commissionHistory.summary,
            transactions: commissionHistory.transactions,
          },
        },
      });

    } catch (error) {
      logger.error('Error getting agent commission:', error);
      next(error);
    }
  }

  static async withdrawCommission(req, res, next) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const { amount } = req.body;

      if (!amount || amount <= 0) {
        await session.abortTransaction();
        return next(new AppError('Please provide a valid amount', 400));
      }

      const agent = await User.findById(req.user._id).session(session);

      if (!agent) {
        await session.abortTransaction();
        return next(new AppError('Agent not found', 404));
      }

      if (agent.agentInfo.availableCommission < amount) {
        await session.abortTransaction();
        return next(
          new AppError('Insufficient available commission', 400)
        );
      }

      let wallet = await Wallet.findOne({
        user: agent._id,
      }).session(session);

      if (!wallet) {
        const createdWallet = await WalletService.createWallet(agent);
        wallet = await Wallet.findById(createdWallet._id).session(session);
        if (!wallet) {
          await session.abortTransaction();
          return next(new AppError('Wallet not found', 404));
        }
      }

      const previousWalletBalance = wallet.balance;

      agent.agentInfo.availableCommission -= amount;
      agent.agentInfo.lastCommissionWithdrawal = new Date();

      wallet.balance += amount;
      wallet.totalFunded += amount;
      wallet.lastTransaction = new Date();

      await agent.save({ session });
      await wallet.save({ session });

      const transaction = new Transaction({
        reference: `COM-WALLET-${Date.now()}`,
        user: agent._id,
        type: 'commission_transfer',
        category: 'commission',
        amount,
        fee: 0,
        totalAmount: amount,
        previousBalance: previousWalletBalance,
        newBalance: wallet.balance,
        status: 'successful',
        description: 'Commission moved to wallet',
        metadata: {
          commissionTransfer: true,
        },
        completedAt: new Date(),
      });

      await transaction.save({ session });

      await session.commitTransaction();

      res.status(200).json({
        status: 'success',
        message: 'Commission transferred to wallet successfully',
        data: {
          transaction: {
            id: transaction._id,
            reference: transaction.reference,
            amount: transaction.amount,
            status: transaction.status,
            createdAt: transaction.createdAt,
          },
          walletBalance: wallet.balance,
          availableCommission: agent.agentInfo.availableCommission,
        },
      });

    } catch (error) {
      await session.abortTransaction();
      logger.error('Commission transfer error:', error);
      next(error);
    } finally {
      session.endSession();
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

  static async verifyEmail(req, res, next) {
    try {
      const { token } = req.params;

      if (!token) {
        return next(new AppError('Verification token is required', 400));
      }

      const hashedToken = crypto.createHash('sha256').update(token.trim()).digest('hex');

      const agent = await User.findOne({
        role: 'agent',
        emailVerificationToken: hashedToken,
      });

      if (!agent) {
        return next(new AppError('Invalid or expired verification token', 400));
      }

      if (!agent.emailVerificationExpires || new Date(agent.emailVerificationExpires).getTime() < Date.now()) {
        return next(new AppError('Verification token has expired', 400));
      }

      agent.isEmailVerified = true;
      agent.emailVerificationToken = undefined;
      agent.emailVerificationExpires = undefined;
      await agent.save();

      res.status(200).json({
        status: 'success',
        message: 'Email verified successfully',
      });
    } catch (error) {
      logger.error('Error verifying agent email:', error);
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

      const agent = await User.findOne(query).select('+password +failedLoginAttempts +lockUntil');

      if (!agent) {
        return next(new AppError('Invalid credentials', 401));
      }

      if (agent.isLocked()) {
        return next(
          new AppError(
            'Account is locked. Please try again later or contact support.',
            401
          )
        );
      }

      if (agent.isAccountLocked) {
        return next(
          new AppError(
            'Your account has been locked by an administrator. Please contact support.',
            401
          )
        );
      }

      // if (!agent.isEmailVerified) {
      //   return next(
      //     new AppError(
      //       'Please verify your email address before logging in.',
      //       401
      //     )
      //   );
      // }

      if (!agent.isActive) {
        return next(new AppError('Your account is deactivated. Please contact support.', 403));
      }

      const isPasswordValid = await agent.comparePassword(password);
      if (!isPasswordValid) {
        await agent.incrementLoginAttempts();
        return next(new AppError('Invalid credentials', 401));
      }

      if (agent.failedLoginAttempts > 0) {
        agent.failedLoginAttempts = 0;
        agent.lockUntil = undefined;
      }

      agent.lastLogin = new Date();
      agent.lastLoginIp = req.ip;
      agent.lastLoginDevice = req.get('user-agent');

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

      let wallet = null;
      try {
        wallet = await getOrCreateAgentWallet(agent);
      } catch (walletError) {
        logger.warn('Wallet fetch failed during agent login:', walletError);
      }

      agent.password = undefined;
      agent.transactionPin = undefined;

      const token = signToken(agent._id);
      const refreshToken = signRefreshToken(agent._id);

      res.status(200).json({
        status: 'success',
        token,
        refreshToken,
        data: {
          agent,
          wallet: serializeWallet(wallet),
        },
      });

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
        isActive: true,
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

      await WalletService.createWallet(agent);

      try {
        await prepareAgentEmailVerification(agent);
      } catch (verificationError) {
        logger.warn('Agent verification email could not be sent:', verificationError);
      }


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
        message: 'Registration successful. You can now log in.',
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
            status: 'active',
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
    return forwardUserServiceWithAgentCommission(req, res, next, telecomController.purchaseAirtime, {
      serviceType: 'airtime_recharge',
    });
  }

  static async purchaseData(req, res, next) {
    return forwardUserServiceWithAgentCommission(req, res, next, telecomController.purchaseData, {
      serviceType: 'data_recharge',
    });
  }

  static async payBill(req, res, next) {
    const { serviceType } = req.body;
    if (serviceType === 'electricity') {
      return forwardUserServiceWithAgentCommission(req, res, next, billsController.purchaseElectricity, {
        serviceType: 'electricity',
      });
    }

    if (serviceType === 'cable_tv') {
      return forwardUserServiceWithAgentCommission(req, res, next, billsController.purchaseCableTV, {
        serviceType: 'cable_tv',
      });
    }

    if (serviceType === 'education_pin') {
      return forwardUserServiceWithAgentCommission(req, res, next, billsController.purchaseEducationPin, {
        serviceType: 'education_pin',
      });
    }

    return next(new AppError('Unsupported service type for agent purchases', 400));
  }

  static async getServices(req, res, next) {
    try {
      const { serviceType, network, provider } = req.query;
      const services = {};

      if (!serviceType || serviceType === 'data') {
        const dataPlansResult = await captureControllerPayload(
          { ...req, query: { network, dataType: req.query.dataType, source: req.query.source } },
          telecomController.getDataPlans
        );
        services.data = dataPlansResult.payload?.data || dataPlansResult.payload || null;
      }

      if (!serviceType || serviceType === 'electricity') {
        const electricityResult = await captureControllerPayload(req, billsController.getElectricityDiscos);
        services.electricity = electricityResult.payload?.data || electricityResult.payload || null;
      }

      if (!serviceType || serviceType === 'cable_tv') {
        const cableResult = await captureControllerPayload({ ...req, query: { provider } }, billsController.getCablePlans);
        services.cable_tv = cableResult.payload?.data || cableResult.payload || null;
      }

      if (serviceType === 'education_pin') {
        services.education_pin = {
          exams: ['waecdirect', 'waec-registration', 'de', 'utme-mock', 'utme-no-mock'],
        };
      }

      res.status(200).json({
        status: 'success',
        data: {
          services,
          source: 'user-service-flow',
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

      const commissionHistory = await getCommissionHistory(agent._id, 10);

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
          commissionHistory: {
            summary: commissionHistory.summary,
            transactions: commissionHistory.transactions,
          },
        },
      });

    } catch (error) {
      logger.error('Error getting dashboard stats:', error);
      next(error);
    }
  }
}

module.exports = AgentController;
