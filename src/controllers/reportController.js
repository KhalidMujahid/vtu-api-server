const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const KYC = require('../models/KYC');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const { buildDateRangeFilter } = require('../utils/dateRange');

function resolveReportDateFilter({ type = 'daily', startDate, endDate }) {
  if (startDate || endDate) {
    return buildDateRangeFilter(startDate, endDate);
  }

  const now = new Date();
  let from;
  let to = new Date();

  if (type === 'daily') {
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
    to = new Date(now);
    to.setHours(23, 59, 59, 999);
  } else if (type === 'weekly') {
    from = new Date(now);
    from.setDate(from.getDate() - 7);
  } else if (type === 'monthly') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (type === 'custom') {
    return null;
  } else {
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
  }

  return { createdAt: { $gte: from, $lte: to } };
}


exports.getMyReport = async (req, res, next) => {
  try {
    const { 
      type = 'daily',
      startDate, 
      endDate,
      status,
      category,
      page = 1,
      limit = 20
    } = req.query;

    const userId = req.user.id;

    const dateFilter = resolveReportDateFilter({ type, startDate, endDate });
    if (!dateFilter) {
      return next(new AppError('Please provide startDate and endDate for custom range', 400));
    }

    
    const query = { 
      user: userId,
      ...dateFilter 
    };
    if (status) query.status = status;
    if (category) query.category = category;

    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Transaction.countDocuments(query);

    
    const summary = await Transaction.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          successfulTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'successful'] }, 1, 0] }
          },
          failedTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          pendingTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    
    const byCategory = await Transaction.aggregate([
      { $match: { ...query, status: 'successful' } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        summary: summary[0] || {
          totalTransactions: 0,
          totalSpent: 0,
          successfulTransactions: 0,
          failedTransactions: 0,
          pendingTransactions: 0
        },
        byCategory,
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    logger.error('User report error:', error);
    next(error);
  }
};


exports.getTransactionReport = async (req, res, next) => {
  try {
    const { 
      type = 'daily', 
      startDate, 
      endDate,
      status,
      type: transactionType,
      page = 1,
      limit = 50
    } = req.query;

    const dateFilter = resolveReportDateFilter({ type, startDate, endDate });
    if (!dateFilter) {
      return next(new AppError('Please provide startDate and endDate for custom range', 400));
    }

    
    const query = { ...dateFilter };
    if (status) query.status = status;
    if (transactionType) query.type = transactionType;

    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const transactions = await Transaction.find(query)
      .populate('user', 'firstName lastName email phoneNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Transaction.countDocuments(query);

    
    const summary = await Transaction.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          successfulTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'successful'] }, 1, 0] }
          },
          failedTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          pendingTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    
    const byType = await Transaction.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        summary: summary[0] || {
          totalTransactions: 0,
          totalAmount: 0,
          successfulTransactions: 0,
          failedTransactions: 0,
          pendingTransactions: 0
        },
        byType,
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    logger.error('Transaction report error:', error);
    next(error);
  }
};




exports.getFinancialReport = async (req, res, next) => {
  try {
    const { type = 'monthly', startDate, endDate } = req.query;

    const dateFilter = resolveReportDateFilter({ type, startDate, endDate });
    if (!dateFilter) {
      return next(new AppError('Please provide startDate and endDate', 400));
    }

    
    const revenue = await Transaction.aggregate([
      { $match: { ...dateFilter, status: 'successful' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
        totalFees: { $sum: '$fee' }
        }
      }
    ]);

    
    const walletStats = await Wallet.aggregate([
      {
        $group: {
          _id: null,
          totalBalance: { $sum: '$balance' },
          totalFunded: { $sum: '$totalFunded' },
          totalSpent: { $sum: '$totalSpent' },
          totalWithdrawn: { $sum: '$totalWithdrawn' },
          walletCount: { $sum: 1 }
        }
      }
    ]);

    
    const revenueByCategory = await Transaction.aggregate([
      { $match: { ...dateFilter, status: 'successful' } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    
    const revenueByType = await Transaction.aggregate([
      { $match: { ...dateFilter, status: 'successful' } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    
    const dailyRevenue = await Transaction.aggregate([
      { $match: { ...dateFilter, status: 'successful' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalRevenue: revenue[0]?.totalRevenue || 0,
          totalFees: revenue[0]?.totalFees || 0,
          netRevenue: (revenue[0]?.totalRevenue || 0) - (revenue[0]?.totalFees || 0)
        },
        walletStats: walletStats[0] || {
          totalBalance: 0,
          totalFunded: 0,
          totalSpent: 0,
          totalWithdrawn: 0,
          walletCount: 0
        },
        revenueByCategory,
        revenueByType,
        dailyRevenue
      }
    });
  } catch (error) {
    logger.error('Financial report error:', error);
    next(error);
  }
};




exports.getUserReport = async (req, res, next) => {
  try {
    const { type = 'monthly', startDate, endDate } = req.query;

    const dateFilter = resolveReportDateFilter({ type, startDate, endDate });
    if (!dateFilter) {
      return next(new AppError('Please provide startDate and endDate', 400));
    }

    
    const userStats = await User.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalNewUsers: { $sum: 1 }
        }
      }
    ]);

    
    const usersByRole = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    
    const kycStatus = await User.aggregate([
      {
        $group: {
          _id: '$kycStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    
    const activeUsers = await User.countDocuments({ isActive: true });
    const inactiveUsers = await User.countDocuments({ isActive: false });

    
    const usersWithWallet = await Wallet.countDocuments();

    
    const topUsers = await Transaction.aggregate([
      { $match: { ...dateFilter, status: 'successful' } },
      {
        $group: {
          _id: '$user',
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      },
      { $sort: { totalAmount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          userId: '$_id',
          name: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
          email: '$user.email',
          totalTransactions: 1,
          totalAmount: 1
        }
      }
    ]);

    
    const dailyNewUsers = await User.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    
    const emailVerified = await User.countDocuments({ isEmailVerified: true });
    const emailUnverified = await User.countDocuments({ isEmailVerified: false });

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          newUsers: userStats[0]?.totalNewUsers || 0,
          totalUsers: await User.countDocuments(),
          activeUsers,
          inactiveUsers,
          usersWithWallet,
          emailVerified,
          emailUnverified
        },
        usersByRole,
        kycStatus,
        topUsers,
        dailyNewUsers
      }
    });
  } catch (error) {
    logger.error('User report error:', error);
    next(error);
  }
};




exports.getAgentReport = async (req, res, next) => {
  try {
    const { type = 'monthly', startDate, endDate } = req.query;

    const dateFilter = resolveReportDateFilter({ type, startDate, endDate });
    if (!dateFilter) {
      return next(new AppError('Please provide startDate and endDate', 400));
    }

    
    const agents = await User.find({ role: 'agent' })
      .select('agentInfo firstName lastName email phoneNumber isActive createdAt')
      .lean();

    
    const totalAgents = agents.length;
    const verifiedAgents = agents.filter(a => a.agentInfo?.isVerified).length;
    const activeAgents = agents.filter(a => a.isActive).length;

    
    const totalCommissionEarned = agents.reduce(
      (sum, a) => sum + (a.agentInfo?.totalCommissionEarned || 0), 
      0
    );
    const totalCommissionPaid = agents.reduce(
      (sum, a) => sum + (a.agentInfo?.availableCommission || 0), 
      0
    );

    
    const agentTransactions = await Transaction.aggregate([
      { 
        $match: { 
          ...dateFilter,
          user: { $in: agents.map(a => a._id) },
          status: 'successful'
        } 
      },
      {
        $group: {
          _id: '$user',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);

    
    const topAgents = agents
      .map(agent => {
        const tx = agentTransactions.find(
          t => t._id.toString() === agent._id.toString()
        );
        return {
          agentId: agent.agentInfo?.agentId,
          name: `${agent.firstName} ${agent.lastName}`,
          email: agent.email,
          totalTransactions: tx?.count || 0,
          totalSales: tx?.totalAmount || 0,
          commissionEarned: agent.agentInfo?.totalCommissionEarned || 0,
          rating: agent.agentInfo?.performanceRating || 0,
          isVerified: agent.agentInfo?.isVerified || false
        };
      })
      .sort((a, b) => b.totalSales - a.totalSales)
      .slice(0, 10);

    
    const agentsByState = await User.aggregate([
      { $match: { role: 'agent' } },
      {
        $group: {
          _id: '$agentInfo.assignedArea.state',
          count: { $sum: 1 }
        }
      },
      { $match: { _id: { $ne: null } } }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalAgents,
          verifiedAgents,
          activeAgents,
          totalCommissionEarned,
          totalCommissionPaid
        },
        topAgents,
        agentsByState,
        agentTransactions: agentTransactions.length
      }
    });
  } catch (error) {
    logger.error('Agent report error:', error);
    next(error);
  }
};




exports.getServiceReport = async (req, res, next) => {
  try {
    const { type = 'monthly', startDate, endDate } = req.query;

    const dateFilter = resolveReportDateFilter({ type, startDate, endDate });
    if (!dateFilter) {
      return next(new AppError('Please provide startDate and endDate', 400));
    }

    
    const byCategory = await Transaction.aggregate([
      { $match: { ...dateFilter, status: 'successful' } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    
    const byType = await Transaction.aggregate([
      { $match: { ...dateFilter, status: 'successful' } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    
    const byNetwork = await Transaction.aggregate([
      { 
        $match: { 
          ...dateFilter, 
          status: 'successful',
          category: 'telecom'
        } 
      },
      {
        $group: {
          _id: '$service.network',
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    
    const byProvider = await Transaction.aggregate([
      { 
        $match: { 
          ...dateFilter, 
          status: 'successful',
          category: 'bills'
        } 
      },
      {
        $group: {
          _id: '$service.provider',
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    
    const totalTransactions = await Transaction.countDocuments(dateFilter);
    const successfulTransactions = await Transaction.countDocuments({
      ...dateFilter,
      status: 'successful'
    });
    const failedTransactions = await Transaction.countDocuments({
      ...dateFilter,
      status: 'failed'
    });

    
    const avgTransaction = await Transaction.aggregate([
      { $match: { ...dateFilter, status: 'successful' } },
      {
        $group: {
          _id: null,
          avgAmount: { $avg: '$totalAmount' }
        }
      }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalTransactions,
          successfulTransactions,
          failedTransactions,
          successRate: totalTransactions > 0 
            ? ((successfulTransactions / totalTransactions) * 100).toFixed(2) 
            : 0,
          avgTransactionValue: avgTransaction[0]?.avgAmount || 0
        },
        byCategory,
        byType,
        byNetwork,
        byProvider
      }
    });
  } catch (error) {
    logger.error('Service report error:', error);
    next(error);
  }
};




exports.getDashboardSummary = async (req, res, next) => {
  try {
    
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const endOfDay = new Date(now.setHours(23, 59, 59, 999));

    const todayTransactions = await Transaction.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });

    const todayRevenue = todayTransactions
      .filter(t => t.status === 'successful')
      .reduce((sum, t) => sum + t.totalAmount, 0);

    const todayCount = todayTransactions.length;
    const todaySuccessful = todayTransactions.filter(t => t.status === 'successful').length;

    
    const totalUsers = await User.countDocuments();
    const totalAgents = await User.countDocuments({ role: 'agent' });
    const totalTransactions = await Transaction.countDocuments();
    
    const walletStats = await Wallet.aggregate([
      {
        $group: {
          _id: null,
          totalBalance: { $sum: '$balance' }
        }
      }
    ]);

    
    const recentTransactions = await Transaction.find()
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(10);

    
    const topServicesToday = await Transaction.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          status: 'successful'
        } 
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 5 }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        today: {
          transactions: todayCount,
          successful: todaySuccessful,
          revenue: todayRevenue,
          successRate: todayCount > 0 
            ? ((todaySuccessful / todayCount) * 100).toFixed(2) 
            : 0
        },
        overall: {
          totalUsers,
          totalAgents,
          totalTransactions,
          totalWalletBalance: walletStats[0]?.totalBalance || 0
        },
        recentTransactions,
        topServicesToday
      }
    });
  } catch (error) {
    logger.error('Dashboard summary error:', error);
    next(error);
  }
};
