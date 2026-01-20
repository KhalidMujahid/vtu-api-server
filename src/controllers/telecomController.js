const TransactionService = require('../services/transactionService');
const ServicePricing = require('../models/ServicePricing');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

exports.getDataPlans = async (req, res, next) => {
  try {
    const { network } = req.query;
    
    const query = {
      serviceType: 'data_recharge',
      isActive: true,
      isAvailable: true,
    };
    
    if (network) {
      query.network = network;
    }
    
    const dataPlans = await ServicePricing.find(query)
      .sort({ sellingPrice: 1 })
      .select('-costPrice -profitMargin -createdBy -updatedBy')
      .lean();
    
    const groupedPlans = dataPlans.reduce((acc, plan) => {
      if (!acc[plan.network]) {
        acc[plan.network] = [];
      }
      acc[plan.network].push(plan);
      return acc;
    }, {});
    
    res.status(200).json({
      status: 'success',
      data: {
        plans: groupedPlans,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.purchaseData = async (req, res, next) => {
  try {
    const { phoneNumber, network, planId, transactionPin } = req.body;
    
    if (!phoneNumber || !network || !planId || !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    if (!/^(?:\+234|0)[789][01]\d{8}$/.test(phoneNumber)) {
      return next(new AppError('Invalid phone number format', 400));
    }
    
    const plan = await ServicePricing.findOne({
      _id: planId,
      serviceType: 'data_recharge',
      network,
      isActive: true,
      isAvailable: true,
    });
    
    if (!plan) {
      return next(new AppError('Plan not found or unavailable', 404));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const reference = Transaction.generateReference();
    const transaction = await TransactionService.createTransaction({
      reference,
      user: req.user.id,
      type: 'data_recharge',
      category: 'telecom',
      amount: plan.sellingPrice,
      fee: 0,
      totalAmount: plan.sellingPrice,
      previousBalance: 0,
      newBalance: 0,
      status: 'pending',
      description: `${network.toUpperCase()} ${plan.planName} data plan for ${phoneNumber}`,
      service: {
        provider: network,
        plan: plan.planName,
        phoneNumber,
        planCode: plan.planCode,
        dataAmount: plan.dataAmount,
        validity: plan.validity,
      },
      metadata: {
        planId: plan._id,
        costPrice: plan.costPrice,
        profitMargin: plan.profitMargin,
      },
    });
    
    const processedTransaction = await TransactionService.processTelecomTransaction(
      transaction._id,
      network
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Data purchase initiated',
      data: {
        reference,
        phoneNumber,
        network,
        plan: plan.planName,
        amount: plan.sellingPrice,
        transaction: processedTransaction,
      },
    });
    
    logger.info(`Data purchase initiated: User ${req.user.id}, ${network} ${plan.planName} for ${phoneNumber}`);
  } catch (error) {
    next(error);
  }
};

exports.purchaseAirtime = async (req, res, next) => {
  try {
    const { phoneNumber, network, amount, transactionPin } = req.body;
    
    if (!phoneNumber || !network || !amount || !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    if (!/^(?:\+234|0)[789][01]\d{8}$/.test(phoneNumber)) {
      return next(new AppError('Invalid phone number format', 400));
    }
    
    if (amount < 50 || amount > 10000) {
      return next(new AppError('Amount must be between ₦50 and ₦10,000', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const pricing = await ServicePricing.findOne({
      serviceType: 'airtime_recharge',
      network,
      isActive: true,
    });
    
    if (!pricing) {
      return next(new AppError('Service temporarily unavailable for this network', 503));
    }
    
    const totalAmount = amount; 
    
    const reference = Transaction.generateReference();
    const transaction = await TransactionService.createTransaction({
      reference,
      user: req.user.id,
      type: 'airtime_recharge',
      category: 'telecom',
      amount,
      fee: 0,
      totalAmount: totalAmount,
      previousBalance: 0,
      newBalance: 0,
      status: 'pending',
      description: `${network.toUpperCase()} airtime recharge of ₦${amount} for ${phoneNumber}`,
      service: {
        provider: network,
        phoneNumber,
      },
      metadata: {
        network,
        amount,
      },
    });
    
    const processedTransaction = await TransactionService.processTelecomTransaction(
      transaction._id,
      network
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Airtime purchase initiated',
      data: {
        reference,
        phoneNumber,
        network,
        amount,
        transaction: processedTransaction,
      },
    });
    
    logger.info(`Airtime purchase initiated: User ${req.user.id}, ${network} ₦${amount} for ${phoneNumber}`);
  } catch (error) {
    next(error);
  }
};

exports.airtimeSwap = async (req, res, next) => {
  try {
    const { phoneNumber, network, airtimeAmount, transactionPin } = req.body;
    
    if (!phoneNumber || !network || !airtimeAmount || !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    if (!/^(?:\+234|0)[789][01]\d{8}$/.test(phoneNumber)) {
      return next(new AppError('Invalid phone number format', 400));
    }
    
    if (airtimeAmount < 100 || airtimeAmount > 5000) {
      return next(new AppError('Airtime amount must be between ₦100 and ₦5,000', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const swapRate = 0.7; 
    const walletAmount = Math.floor(airtimeAmount * swapRate);
    
    const reference = Transaction.generateReference();
    const transaction = await TransactionService.createTransaction({
      reference,
      user: req.user.id,
      type: 'airtime_swap',
      category: 'telecom',
      amount: airtimeAmount,
      fee: 0,
      totalAmount: 0, 
      previousBalance: 0,
      newBalance: walletAmount,
      status: 'pending',
      description: `${network.toUpperCase()} airtime swap of ₦${airtimeAmount} for ₦${walletAmount} wallet credit`,
      service: {
        provider: network,
        phoneNumber,
      },
      metadata: {
        swapRate,
        airtimeAmount,
        walletAmount,
      },
    });
    
    const processedTransaction = await TransactionService.processTelecomTransaction(
      transaction._id,
      network
    );
    
    if (processedTransaction.status === 'successful') {
      await WalletService.creditWallet(
        req.user.id,
        walletAmount,
        reference,
        `Airtime swap from ${network}`
      );
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Airtime swap initiated',
      data: {
        reference,
        phoneNumber,
        network,
        airtimeAmount,
        walletAmount,
        swapRate: `${swapRate * 100}%`,
        transaction: processedTransaction,
      },
    });
    
    logger.info(`Airtime swap initiated: User ${req.user.id}, ${network} ₦${airtimeAmount} -> ₦${walletAmount}`);
  } catch (error) {
    next(error);
  }
};

exports.purchaseRechargePin = async (req, res, next) => {
  try {
    const { network, pinType, quantity = 1, transactionPin } = req.body;
    
    if (!network || !pinType || !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const pricing = await ServicePricing.findOne({
      serviceType: 'recharge_pin',
      network,
      planName: pinType,
      isActive: true,
    });
    
    if (!pricing) {
      return next(new AppError('Recharge PIN type not available for this network', 404));
    }
    
    const totalAmount = pricing.sellingPrice * quantity;
    
    const reference = Transaction.generateReference();
    const transaction = await TransactionService.createTransaction({
      reference,
      user: req.user.id,
      type: 'recharge_pin',
      category: 'telecom',
      amount: totalAmount,
      fee: 0,
      totalAmount,
      previousBalance: 0,
      newBalance: 0,
      status: 'pending',
      description: `${network.toUpperCase()} ${pinType} recharge PIN${quantity > 1 ? 's' : ''} (x${quantity})`,
      service: {
        provider: network,
        plan: pinType,
        quantity,
      },
      metadata: {
        network,
        pinType,
        quantity,
        unitPrice: pricing.sellingPrice,
      },
    });
    
    const processedTransaction = await TransactionService.processTelecomTransaction(
      transaction._id,
      network
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Recharge PIN purchase initiated',
      data: {
        reference,
        network,
        pinType,
        quantity,
        amount: totalAmount,
        transaction: processedTransaction,
      },
    });
    
    logger.info(`Recharge PIN purchase: User ${req.user.id}, ${network} ${pinType} x${quantity}`);
  } catch (error) {
    next(error);
  }
};