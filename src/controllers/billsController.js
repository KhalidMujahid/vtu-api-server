<<<<<<< HEAD
const TransactionService = require('../services/transactionService');
const ServicePricing = require('../models/ServicePricing');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const NelloBytesService = require('../services/nelloBytesService');
const NotificationService = require('../services/NotificationService');

const SERVER_URL = process.env.SERVER_URL || 'https://api.yareemadata.com';

exports.verifyElectricityCustomer = async (req, res, next) => {
  try {
    const { meterNumber, disco, meterType = 'prepaid', source } = req.body;
    
    if (!meterNumber || !disco) {
      return next(new AppError('Please provide meter number and DISCO', 400));
    }
    
    if (source === 'nellobytes') {
      try {
        const result = await NelloBytesService.verifyElectricityMeter({
          electricCompany: disco,
          meterNo: meterNumber,
          meterType,
        });
        
        return res.status(200).json({
          status: 'success',
          message: 'Customer verification successful',
          data: {
            meterNumber,
            disco,
            customerName: result.customerName,
            verified: result.valid,
          },
        });
      } catch (error) {
        logger.error(`NelloBytes electricity verification error: ${error.message}`);
        return next(new AppError('Unable to verify meter number', 500));
      }
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
    const { meterNumber, disco, amount, phoneNumber, meterType = 'prepaid', transactionPin, source } = req.body;
    
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
    
    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }
    
    if (wallet.balance < amount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }
    
    // Debit wallet
    await wallet.debit(amount, `Electricity bill payment: ${disco}`);
    
    const reference = `ELEC-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/bills/webhook/nellobytes`;
    
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'electricity',
      category: 'bills',
      amount,
      totalAmount: amount,
      previousBalance: wallet.balance + amount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${disco.toUpperCase()} electricity bill payment of ₦${amount} for meter ${meterNumber}`,
      service: {
        provider: 'nellobytes',
        disco,
        meterNumber,
        meterType,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Payment initiated', timestamp: new Date() }],
    });
    
    try {
      // Call NelloBytes API if source is 'nellobytes' or default
      if (source === 'nellobytes' || !source) {
        const apiResponse = await NelloBytesService.payElectricityBill({
          electricCompany: disco,
          meterNo: meterNumber,
          meterType,
          amount,
          phoneNumber: phoneNumber || user.phoneNumber,
          callBackURL: callbackUrl,
        });
        
        if (apiResponse.success || apiResponse.statusCode === '100') {
          transaction.status = 'pending';
          transaction.service.orderId = apiResponse.orderId;
          transaction.providerResponse = apiResponse.response;
          transaction.statusHistory.push({ 
            status: 'pending', 
            note: `Order received: ${apiResponse.orderId}`, 
            timestamp: new Date() 
          });
          await transaction.save();
          
          return res.status(200).json({
            status: 'success',
            message: 'Electricity bill payment initiated',
            data: {
              reference,
              orderId: apiResponse.orderId,
              meterNumber,
              disco,
              amount,
              status: 'pending',
            },
          });
        }
        throw new Error(apiResponse.response?.status || 'Payment failed');
      }
      
      const pricing = await ServicePricing.findOne({
        serviceType: 'electricity',
        disco,
        isActive: true,
      });
      
      if (!pricing) {
        throw new Error('Service temporarily unavailable for this DISCO');
      }
      
      transaction.status = 'successful';
      transaction.statusHistory.push({ status: 'successful', note: 'Payment successful', timestamp: new Date() });
      await transaction.save();
      
      res.status(200).json({
        status: 'success',
        message: 'Electricity bill payment successful',
        data: {
          reference,
          meterNumber,
          disco,
          amount,
          status: 'successful',
        },
      });
      
    } catch (err) {
      // Refund wallet on failure
      await wallet.credit(amount, 'Electricity payment refund');
      
      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();
      
      logger.error(`Electricity payment failed: ${err.message}`);
      return next(new AppError(`Payment failed: ${err.message}`, 500));
    }
    
    logger.info(`Electricity purchase: User ${req.user.id}, ${disco} ₦${amount} for meter ${meterNumber}`);
  } catch (error) {
    next(error);
  }
};

exports.getCablePlans = async (req, res, next) => {
  try {
    const { provider, source } = req.query;
    
    // If source is 'nellobytes', fetch from NelloBytes API
    if (source === 'nellobytes') {
      const plans = await NelloBytesService.getCablePackages(provider);
      return res.status(200).json({
        status: 'success',
        data: plans,
        source: 'nellobytes',
      });
    }
    
    // Default: fetch from database
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
      source: 'database',
    });
  } catch (error) {
    next(error);
  }
};

exports.purchaseCableTV = async (req, res, next) => {
  try {
    const { smartCardNumber, provider, planId, months = 1, transactionPin, source } = req.body;
    
    if (!smartCardNumber || !provider || !planId && !months && !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }
    
    let totalAmount;
    let plan;
    
    // If using NelloBytes
    if (source === 'nellobytes' || !source) {
      try {
        // First verify smartcard
        const verifyResult = await NelloBytesService.verifyCableSmartCard({
          cableTV: provider,
          smartCardNo: smartCardNumber,
        });
        
        if (!verifyResult.valid) {
          return next(new AppError('Invalid smartcard number', 400));
        }
        
        // Get packages to find the price
        const packages = await NelloBytesService.getCablePackages(provider);
        plan = packages[provider]?.find(p => p.code === planId || p.variation_code === planId);
        
        if (!plan) {
          return next(new AppError('Plan not found', 404));
        }
        
        totalAmount = plan.sellingPrice * months;
        
        if (wallet.balance < totalAmount) {
          return next(new AppError('Insufficient wallet balance', 400));
        }
        
        // Debit wallet
        await wallet.debit(totalAmount, `Cable TV: ${provider}`);
        
        const reference = `CABLE-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const callbackUrl = `${SERVER_URL}/api/v1/bills/webhook/nellobytes`;
        
        const transaction = await Transaction.create({
          reference,
          user: user._id,
          type: 'cable_tv',
          category: 'bills',
          amount: totalAmount,
          totalAmount,
          previousBalance: wallet.balance + totalAmount,
          newBalance: wallet.balance,
          status: 'pending',
          description: `${provider.toUpperCase()} subscription for ${smartCardNumber}`,
          service: {
            provider: 'nellobytes',
            cableProvider: provider,
            smartCardNumber,
            package: planId,
            customerName: verifyResult.customerName,
            months,
          },
          statusHistory: [{ status: 'pending', note: 'Subscription initiated', timestamp: new Date() }],
        });
        
        // Purchase from NelloBytes
        const apiResponse = await NelloBytesService.purchaseCableTV({
          cableTV: provider,
          packageCode: planId,
          smartCardNo: smartCardNumber,
          phoneNo: user.phoneNumber,
          callBackURL: callbackUrl,
        });
        
        if (apiResponse.success || apiResponse.statusCode === '100') {
          transaction.status = 'pending';
          transaction.service.orderId = apiResponse.orderId;
          transaction.providerResponse = apiResponse.response;
          transaction.statusHistory.push({ 
            status: 'pending', 
            note: `Order received: ${apiResponse.orderId}`, 
            timestamp: new Date() 
          });
          await transaction.save();
          
          return res.status(200).json({
            status: 'success',
            message: 'Cable TV subscription initiated',
            data: {
              reference,
              orderId: apiResponse.orderId,
              smartCardNumber,
              provider,
              customerName: verifyResult.customerName,
              months,
              amount: totalAmount,
              status: 'pending',
            },
          });
        }
        
        throw new Error(apiResponse.response?.status || 'Purchase failed');
        
      } catch (error) {
        // Refund wallet on failure
        if (wallet) {
          await wallet.credit(totalAmount, 'Cable TV refund');
        }
        
        logger.error(`Cable TV purchase failed: ${error.message}`);
        return next(new AppError(`Purchase failed: ${error.message}`, 500));
      }
    }
    
    // Default: use database pricing
    plan = await ServicePricing.findOne({
      _id: planId,
      serviceType: 'cable_tv',
      cableProvider: provider,
      isActive: true,
      isAvailable: true,
    });
    
    if (!plan) {
      return next(new AppError('Plan not found or unavailable', 404));
    }
    
    totalAmount = plan.sellingPrice * months;
    
    if (wallet.balance < totalAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }
    
    await wallet.debit(totalAmount, `Cable TV: ${provider}`);
    
    const reference = Transaction.generateReference();
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'cable_tv',
      category: 'bills',
      amount: totalAmount,
      totalAmount,
      previousBalance: wallet.balance + totalAmount,
      newBalance: wallet.balance,
      status: 'successful',
      description: `${provider.toUpperCase()} ${plan.planName} subscription for ${months} month${months > 1 ? 's' : ''}`,
      service: {
        provider,
        smartCardNumber,
        package: plan.planName,
      },
      statusHistory: [{ status: 'successful', note: 'Subscription successful', timestamp: new Date() }],
    });
    
    res.status(200).json({
      status: 'success',
      message: 'Cable TV subscription successful',
      data: {
        reference,
        smartCardNumber,
        provider,
        plan: plan.planName,
        months,
        amount: totalAmount,
        status: 'successful',
      },
    });
    
    logger.info(`Cable TV purchase: User ${user._id}, ${provider} ${plan.planName} x${months}`);
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

/**
 * NelloBytes Bills Webhook Handler
 */
exports.nelloBytesWebhook = async (req, res, next) => {
  try {
    const queryData = req.query;
    const bodyData = req.body;
    const data = { ...bodyData, ...queryData };
    
    const { orderid, orderstatus, statuscode, orderremark } = data;

    if (!orderid) {
      logger.warn('NelloBytes bills webhook received without orderid');
      return res.status(400).send('Missing orderid');
    }

    logger.info(`NelloBytes bills webhook received: ${orderid}`, { data });

    const transaction = await Transaction.findOne({
      $or: [
        { 'service.orderId': orderid },
        { reference: orderid }
      ]
    });

    if (!transaction) {
      logger.warn(`Transaction not found for orderid: ${orderid}`);
      return res.status(404).send('Transaction not found');
    }

    if (transaction.status === 'successful' || transaction.status === 'failed') {
      return res.status(200).send('Already processed');
    }

    const wallet = await Wallet.findOne({ user: transaction.user });

    if (statuscode === '200' || orderstatus === 'ORDER_COMPLETED') {
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: orderremark || 'Payment completed successfully',
        timestamp: new Date(),
      });
      await transaction.save();
      
      // Send notification based on transaction type
      if (transaction.type === 'electricity') {
        await NotificationService.create({
          user: transaction.user,
          title: 'Electricity Payment Successful',
          message: `Your electricity payment of ₦${transaction.amount} was successful.`,
          type: 'electricity',
          reference: transaction.reference,
        });
      } else if (transaction.type === 'cable_tv') {
        await NotificationService.create({
          user: transaction.user,
          title: 'Cable TV Subscription Successful',
          message: `Your cable TV subscription of ₦${transaction.amount} was successful.`,
          type: 'cable_tv',
          reference: transaction.reference,
        });
      }
      
    } else if (statuscode === '100' || orderstatus === 'ORDER_RECEIVED') {
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: orderremark || 'Payment received, processing',
        timestamp: new Date(),
      });
      await transaction.save();
      
    } else {
      if (wallet) {
        await wallet.credit(transaction.amount, 'Payment failed - refund');
      }

      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: orderremark || 'Payment failed',
        timestamp: new Date(),
      });
      await transaction.save();
      
      // Send failure notification
      await NotificationService.create({
        user: transaction.user,
        title: 'Payment Failed',
        message: `Your ${transaction.type || 'payment'} of ₦${transaction.amount} failed. Amount has been refunded.`,
        type: 'payment_failed',
        reference: transaction.reference,
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('NelloBytes bills webhook error:', error);
    res.status(500).send('Webhook error');
  }
=======
const TransactionService = require('../services/transactionService');
const ServicePricing = require('../models/ServicePricing');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const NelloBytesService = require('../services/nelloBytesService');

const SERVER_URL = process.env.SERVER_URL || 'https://api.yareemadata.com';

exports.verifyElectricityCustomer = async (req, res, next) => {
  try {
    const { meterNumber, disco, meterType = 'prepaid', source } = req.body;
    
    if (!meterNumber || !disco) {
      return next(new AppError('Please provide meter number and DISCO', 400));
    }
    
    if (source === 'nellobytes') {
      try {
        const result = await NelloBytesService.verifyElectricityMeter({
          electricCompany: disco,
          meterNo: meterNumber,
          meterType,
        });
        
        return res.status(200).json({
          status: 'success',
          message: 'Customer verification successful',
          data: {
            meterNumber,
            disco,
            customerName: result.customerName,
            verified: result.valid,
          },
        });
      } catch (error) {
        logger.error(`NelloBytes electricity verification error: ${error.message}`);
        return next(new AppError('Unable to verify meter number', 500));
      }
    }
    
    // Default: mock response
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
    const { meterNumber, disco, amount, phoneNumber, meterType = 'prepaid', transactionPin, source } = req.body;
    
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
    
    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }
    
    if (wallet.balance < amount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }
    
    // Debit wallet
    await wallet.debit(amount, `Electricity bill payment: ${disco}`);
    
    const reference = `ELEC-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/bills/webhook/nellobytes`;
    
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'electricity',
      category: 'bills',
      amount,
      totalAmount: amount,
      previousBalance: wallet.balance + amount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${disco.toUpperCase()} electricity bill payment of ₦${amount} for meter ${meterNumber}`,
      service: {
        provider: 'nellobytes',
        disco,
        meterNumber,
        meterType,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Payment initiated', timestamp: new Date() }],
    });
    
    try {
      // Call NelloBytes API if source is 'nellobytes' or default
      if (source === 'nellobytes' || !source) {
        const apiResponse = await NelloBytesService.payElectricityBill({
          electricCompany: disco,
          meterNo: meterNumber,
          meterType,
          amount,
          phoneNumber: phoneNumber || user.phoneNumber,
          callBackURL: callbackUrl,
        });
        
        if (apiResponse.success || apiResponse.statusCode === '100') {
          transaction.status = 'pending';
          transaction.service.orderId = apiResponse.orderId;
          transaction.providerResponse = apiResponse.response;
          transaction.statusHistory.push({ 
            status: 'pending', 
            note: `Order received: ${apiResponse.orderId}`, 
            timestamp: new Date() 
          });
          await transaction.save();
          
          return res.status(200).json({
            status: 'success',
            message: 'Electricity bill payment initiated',
            data: {
              reference,
              orderId: apiResponse.orderId,
              meterNumber,
              disco,
              amount,
              status: 'pending',
            },
          });
        }
        throw new Error(apiResponse.response?.status || 'Payment failed');
      }
      
      // Fallback: use database pricing
      const pricing = await ServicePricing.findOne({
        serviceType: 'electricity',
        disco,
        isActive: true,
      });
      
      if (!pricing) {
        throw new Error('Service temporarily unavailable for this DISCO');
      }
      
      transaction.status = 'successful';
      transaction.statusHistory.push({ status: 'successful', note: 'Payment successful', timestamp: new Date() });
      await transaction.save();
      
      res.status(200).json({
        status: 'success',
        message: 'Electricity bill payment successful',
        data: {
          reference,
          meterNumber,
          disco,
          amount,
          status: 'successful',
        },
      });
      
    } catch (err) {
      // Refund wallet on failure
      await wallet.credit(amount, 'Electricity payment refund');
      
      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();
      
      logger.error(`Electricity payment failed: ${err.message}`);
      return next(new AppError(`Payment failed: ${err.message}`, 500));
    }
    
    logger.info(`Electricity purchase: User ${req.user.id}, ${disco} ₦${amount} for meter ${meterNumber}`);
  } catch (error) {
    next(error);
  }
};

exports.getCablePlans = async (req, res, next) => {
  try {
    const { provider, source } = req.query;
    
    // If source is 'nellobytes', fetch from NelloBytes API
    if (source === 'nellobytes') {
      const plans = await NelloBytesService.getCablePackages(provider);
      return res.status(200).json({
        status: 'success',
        data: plans,
        source: 'nellobytes',
      });
    }
    
    // Default: fetch from database
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
      source: 'database',
    });
  } catch (error) {
    next(error);
  }
};

exports.purchaseCableTV = async (req, res, next) => {
  try {
    const { smartCardNumber, provider, planId, months = 1, transactionPin, source } = req.body;
    
    if (!smartCardNumber || !provider || !planId && !months && !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }
    
    let totalAmount;
    let plan;
    
    // If using NelloBytes
    if (source === 'nellobytes' || !source) {
      try {
        // First verify smartcard
        const verifyResult = await NelloBytesService.verifyCableSmartCard({
          cableTV: provider,
          smartCardNo: smartCardNumber,
        });
        
        if (!verifyResult.valid) {
          return next(new AppError('Invalid smartcard number', 400));
        }
        
        // Get packages to find the price
        const packages = await NelloBytesService.getCablePackages(provider);
        plan = packages[provider]?.find(p => p.code === planId || p.variation_code === planId);
        
        if (!plan) {
          return next(new AppError('Plan not found', 404));
        }
        
        totalAmount = plan.sellingPrice * months;
        
        if (wallet.balance < totalAmount) {
          return next(new AppError('Insufficient wallet balance', 400));
        }
        
        // Debit wallet
        await wallet.debit(totalAmount, `Cable TV: ${provider}`);
        
        const reference = `CABLE-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const callbackUrl = `${SERVER_URL}/api/v1/bills/webhook/nellobytes`;
        
        const transaction = await Transaction.create({
          reference,
          user: user._id,
          type: 'cable_tv',
          category: 'bills',
          amount: totalAmount,
          totalAmount,
          previousBalance: wallet.balance + totalAmount,
          newBalance: wallet.balance,
          status: 'pending',
          description: `${provider.toUpperCase()} subscription for ${smartCardNumber}`,
          service: {
            provider: 'nellobytes',
            cableProvider: provider,
            smartCardNumber,
            package: planId,
            customerName: verifyResult.customerName,
            months,
          },
          statusHistory: [{ status: 'pending', note: 'Subscription initiated', timestamp: new Date() }],
        });
        
        // Purchase from NelloBytes
        const apiResponse = await NelloBytesService.purchaseCableTV({
          cableTV: provider,
          packageCode: planId,
          smartCardNo: smartCardNumber,
          phoneNo: user.phoneNumber,
          callBackURL: callbackUrl,
        });
        
        if (apiResponse.success || apiResponse.statusCode === '100') {
          transaction.status = 'pending';
          transaction.service.orderId = apiResponse.orderId;
          transaction.providerResponse = apiResponse.response;
          transaction.statusHistory.push({ 
            status: 'pending', 
            note: `Order received: ${apiResponse.orderId}`, 
            timestamp: new Date() 
          });
          await transaction.save();
          
          return res.status(200).json({
            status: 'success',
            message: 'Cable TV subscription initiated',
            data: {
              reference,
              orderId: apiResponse.orderId,
              smartCardNumber,
              provider,
              customerName: verifyResult.customerName,
              months,
              amount: totalAmount,
              status: 'pending',
            },
          });
        }
        
        throw new Error(apiResponse.response?.status || 'Purchase failed');
        
      } catch (error) {
        // Refund wallet on failure
        if (wallet) {
          await wallet.credit(totalAmount, 'Cable TV refund');
        }
        
        logger.error(`Cable TV purchase failed: ${error.message}`);
        return next(new AppError(`Purchase failed: ${error.message}`, 500));
      }
    }
    
    // Default: use database pricing
    plan = await ServicePricing.findOne({
      _id: planId,
      serviceType: 'cable_tv',
      cableProvider: provider,
      isActive: true,
      isAvailable: true,
    });
    
    if (!plan) {
      return next(new AppError('Plan not found or unavailable', 404));
    }
    
    totalAmount = plan.sellingPrice * months;
    
    if (wallet.balance < totalAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }
    
    await wallet.debit(totalAmount, `Cable TV: ${provider}`);
    
    const reference = Transaction.generateReference();
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'cable_tv',
      category: 'bills',
      amount: totalAmount,
      totalAmount,
      previousBalance: wallet.balance + totalAmount,
      newBalance: wallet.balance,
      status: 'successful',
      description: `${provider.toUpperCase()} ${plan.planName} subscription for ${months} month${months > 1 ? 's' : ''}`,
      service: {
        provider,
        smartCardNumber,
        package: plan.planName,
      },
      statusHistory: [{ status: 'successful', note: 'Subscription successful', timestamp: new Date() }],
    });
    
    res.status(200).json({
      status: 'success',
      message: 'Cable TV subscription successful',
      data: {
        reference,
        smartCardNumber,
        provider,
        plan: plan.planName,
        months,
        amount: totalAmount,
        status: 'successful',
      },
    });
    
    logger.info(`Cable TV purchase: User ${user._id}, ${provider} ${plan.planName} x${months}`);
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

/**
 * NelloBytes Bills Webhook Handler
 */
exports.nelloBytesWebhook = async (req, res, next) => {
  try {
    const queryData = req.query;
    const bodyData = req.body;
    const data = { ...bodyData, ...queryData };
    
    const { orderid, orderstatus, statuscode, orderremark } = data;

    if (!orderid) {
      logger.warn('NelloBytes bills webhook received without orderid');
      return res.status(400).send('Missing orderid');
    }

    logger.info(`NelloBytes bills webhook received: ${orderid}`, { data });

    const transaction = await Transaction.findOne({
      $or: [
        { 'service.orderId': orderid },
        { reference: orderid }
      ]
    });

    if (!transaction) {
      logger.warn(`Transaction not found for orderid: ${orderid}`);
      return res.status(404).send('Transaction not found');
    }

    if (transaction.status === 'successful' || transaction.status === 'failed') {
      return res.status(200).send('Already processed');
    }

    const wallet = await Wallet.findOne({ user: transaction.user });

    if (statuscode === '200' || orderstatus === 'ORDER_COMPLETED') {
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: orderremark || 'Payment completed successfully',
        timestamp: new Date(),
      });
      await transaction.save();
      
    } else if (statuscode === '100' || orderstatus === 'ORDER_RECEIVED') {
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: orderremark || 'Payment received, processing',
        timestamp: new Date(),
      });
      await transaction.save();
      
    } else {
      if (wallet) {
        await wallet.credit(transaction.amount, 'Payment failed - refund');
      }

      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: orderremark || 'Payment failed',
        timestamp: new Date(),
      });
      await transaction.save();
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('NelloBytes bills webhook error:', error);
    res.status(500).send('Webhook error');
  }
>>>>>>> 8afeb82 (another commit)
};