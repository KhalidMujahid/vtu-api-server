const TransactionService = require('../services/transactionService');
const ServicePricing = require('../models/ServicePricing');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

exports.verifyElectricityCustomer = async (req, res, next) => {
  try {
    const { meterNumber, disco, meterType } = req.body;
    
    if (!meterNumber || !disco) {
      return next(new AppError('Please provide meter number and DISCO', 400));
    }
    
    const mockCustomerInfo = {
      customerName: 'JOHN DOE',
      customerAddress: '123 TEST STREET, ABUJA',
      tariff: 'R2S',
      minimumAmount: 500,
      maximumAmount: 100000,
      outstandingBalance: 0,
    };
    
    res.status(200).json({
      status: 'success',
      message: 'Customer verification successful',
      data: {
        meterNumber,
        disco,
        ...mockCustomerInfo,
      },
    });
    
    logger.info(`Electricity customer verified: Meter ${meterNumber}, DISCO: ${disco}`);
  } catch (error) {
    next(error);
  }
};

exports.purchaseElectricity = async (req, res, next) => {
  try {
    const { meterNumber, disco, amount, phoneNumber, transactionPin } = req.body;
    
    if (!meterNumber || !disco || !amount || !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    if (amount < 500 || amount > 100000) {
      return next(new AppError('Amount must be between ₦500 and ₦100,000', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const pricing = await ServicePricing.findOne({
      serviceType: 'electricity',
      disco,
      isActive: true,
    });
    
    if (!pricing) {
      return next(new AppError('Service temporarily unavailable for this DISCO', 503));
    }
    
    const reference = Transaction.generateReference();
    const transaction = await TransactionService.createTransaction({
      reference,
      user: req.user.id,
      type: 'electricity',
      category: 'bills',
      amount,
      fee: 0,
      totalAmount: amount,
      previousBalance: 0,
      newBalance: 0,
      status: 'pending',
      description: `${disco.toUpperCase()} electricity bill payment of ₦${amount} for meter ${meterNumber}`,
      service: {
        provider: disco,
        meterNumber,
        phoneNumber,
        disco,
      },
      metadata: {
        disco,
        amount,
        meterNumber,
      },
    });
    
    const processedTransaction = await TransactionService.processTelecomTransaction(
      transaction._id,
      disco
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Electricity bill payment initiated',
      data: {
        reference,
        meterNumber,
        disco,
        amount,
        transaction: processedTransaction,
      },
    });
    
    logger.info(`Electricity purchase: User ${req.user.id}, ${disco} ₦${amount} for meter ${meterNumber}`);
  } catch (error) {
    next(error);
  }
};

exports.getCablePlans = async (req, res, next) => {
  try {
    const { provider } = req.query;
    
    const query = {
      serviceType: 'cable_tv',
      isActive: true,
      isAvailable: true,
    };
    
    if (provider) {
      query.cableProvider = provider;
    }
    
    const cablePlans = await ServicePricing.find(query)
      .sort({ sellingPrice: 1 })
      .select('-costPrice -profitMargin -createdBy -updatedBy')
      .lean();
    
    const groupedPlans = cablePlans.reduce((acc, plan) => {
      if (!acc[plan.cableProvider]) {
        acc[plan.cableProvider] = [];
      }
      acc[plan.cableProvider].push(plan);
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

exports.purchaseCableTV = async (req, res, next) => {
  try {
    const { smartCardNumber, provider, planId, months = 1, transactionPin } = req.body;
    
    if (!smartCardNumber || !provider || !planId || !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const plan = await ServicePricing.findOne({
      _id: planId,
      serviceType: 'cable_tv',
      cableProvider: provider,
      isActive: true,
      isAvailable: true,
    });
    
    if (!plan) {
      return next(new AppError('Plan not found or unavailable', 404));
    }
    
    const totalAmount = plan.sellingPrice * months;
    
    const reference = Transaction.generateReference();
    const transaction = await TransactionService.createTransaction({
      reference,
      user: req.user.id,
      type: 'cable_tv',
      category: 'bills',
      amount: totalAmount,
      fee: 0,
      totalAmount,
      previousBalance: 0,
      newBalance: 0,
      status: 'pending',
      description: `${provider.toUpperCase()} ${plan.planName} subscription for ${months} month${months > 1 ? 's' : ''}`,
      service: {
        provider,
        smartCardNumber,
        package: plan.planName,
      },
      metadata: {
        provider,
        planId: plan._id,
        months,
        unitPrice: plan.sellingPrice,
      },
    });
    
    const processedTransaction = await TransactionService.processTelecomTransaction(
      transaction._id,
      provider
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Cable TV subscription initiated',
      data: {
        reference,
        smartCardNumber,
        provider,
        plan: plan.planName,
        months,
        amount: totalAmount,
        transaction: processedTransaction,
      },
    });
    
    logger.info(`Cable TV purchase: User ${req.user.id}, ${provider} ${plan.planName} x${months}`);
  } catch (error) {
    next(error);
  }
};

exports.purchaseEducationPin = async (req, res, next) => {
  try {
    const { examType, quantity = 1, transactionPin } = req.body;
    
    if (!examType || !transactionPin) {
      return next(new AppError('Please provide exam type and transaction PIN', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const pricing = await ServicePricing.findOne({
      serviceType: 'education_pin',
      planName: examType,
      isActive: true,
    });
    
    if (!pricing) {
      return next(new AppError('Education PIN not available', 404));
    }
    
    const totalAmount = pricing.sellingPrice * quantity;
    
    const reference = Transaction.generateReference();
    const transaction = await TransactionService.createTransaction({
      reference,
      user: req.user.id,
      type: 'education_pin',
      category: 'education',
      amount: totalAmount,
      fee: 0,
      totalAmount,
      previousBalance: 0,
      newBalance: 0,
      status: 'pending',
      description: `${examType} PIN${quantity > 1 ? 's' : ''} (x${quantity})`,
      service: {
        provider: 'exam_board',
        plan: examType,
        quantity,
      },
      metadata: {
        examType,
        quantity,
        unitPrice: pricing.sellingPrice,
      },
    });
    
    const processedTransaction = await TransactionService.processTelecomTransaction(
      transaction._id,
      'education'
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Education PIN purchase initiated',
      data: {
        reference,
        examType,
        quantity,
        amount: totalAmount,
        transaction: processedTransaction,
      },
    });
    
    logger.info(`Education PIN purchase: User ${req.user.id}, ${examType} x${quantity}`);
  } catch (error) {
    next(error);
  }
};