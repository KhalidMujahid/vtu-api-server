const ServicePricing = require('../models/ServicePricing');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const NelloBytesService = require('../services/nelloBytesService');
const NotificationService = require('../services/NotificationService');
const vtuConfig = require('../config/vtuProviders');

const SERVER_URL = process.env.SERVER_URL || 'https://api.yareemadata.com';
const BILL_SOURCE_TO_PROVIDER = {
  nellobytes: 'clubkonnect',
  clubkonnect: 'clubkonnect',
  airtimenigeria: 'airtimenigeria',
  smeplug: 'smeplug',
};

exports.verifyElectricityCustomer = async (req, res, next) => {
  try {
    const { meterNumber, disco, meterType = 'prepaid', source } = req.body;
    
    if (!meterNumber || !disco) {
      return next(new AppError('Please provide meter number and DISCO', 400));
    }
    
    const defaultProvider = await vtuConfig.getProviderIdForService('electricity');
    const activeProvider = BILL_SOURCE_TO_PROVIDER[source] || source || defaultProvider;
    const activeSource = vtuConfig.providers[activeProvider]?.source || activeProvider;

    if (activeProvider === 'clubkonnect' || activeSource === 'nellobytes') {
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
            meterType,
            customerName: result.customerName,
            verified: result.valid,
            provider: activeProvider,
          },
        });
      } catch (error) {
        logger.error(`NelloBytes electricity verification error: ${error.message}`);
        return next(new AppError('Unable to verify meter number', 500));
      }
    }
    
    return next(new AppError(`Electricity verification is not implemented for ${activeProvider}`, 400));
  } catch (error) {
    next(error);
  }
};

exports.purchaseElectricity = async (req, res, next) => {
  try {
    const { meterNumber, disco, amount, phoneNumber, meterType = 'prepaid', transactionPin, source } = req.body;
    const parsedAmount = Number(amount);
    
    // Get default provider for electricity from config - always fetches fresh from DB
    const defaultProvider = await vtuConfig.getProviderIdForService('electricity');
    const activeProvider = BILL_SOURCE_TO_PROVIDER[source] || source || defaultProvider;
    const activeSource = vtuConfig.providers[activeProvider]?.source || activeProvider;
    
    if (!meterNumber || !disco || !amount || !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    if (Number.isNaN(parsedAmount) || parsedAmount < 500 || parsedAmount > 100000) {
      return next(new AppError('Amount must be between ₦500 and ₦100,000', 400));
    }
    
    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Electricity provider ${activeProvider} is not implemented`, 400));
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
    
    if (wallet.balance < parsedAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }
    
    // Debit wallet
    await wallet.debit(parsedAmount, `Electricity bill payment: ${disco}`);
    
    const reference = `ELEC-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/bills/webhook/nellobytes`;
    
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'electricity',
      category: 'bills',
      amount: parsedAmount,
      totalAmount: parsedAmount,
      previousBalance: wallet.balance + parsedAmount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${disco.toUpperCase()} electricity bill payment of ₦${amount} for meter ${meterNumber}`,
      service: {
        provider: activeProvider,
        disco,
        meterNumber,
        meterType,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: `Payment initiated via ${activeProvider}`, timestamp: new Date() }],
    });
    
    try {
      // Call NelloBytes API (primary provider for electricity)
      const apiResponse = await NelloBytesService.payElectricityBill({
        electricCompany: disco,
        meterNo: meterNumber,
        meterType,
        amount: parsedAmount,
        phoneNo: phoneNumber || user.phoneNumber,
        requestId: reference,
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
            amount: parsedAmount,
            status: 'pending',
          },
        });
      } else if (transaction.type === 'education_pin') {
        await NotificationService.create({
          user: transaction.user,
          title: 'Education PIN Successful',
          message: `Your ${transaction.service?.plan || 'education'} PIN purchase was successful.`,
          type: 'system',
          reference: transaction.reference,
        });
      }
      
      throw new Error(apiResponse.response?.status || 'Payment failed');
    } catch (apiErr) {
      // Refund wallet on failure
      await wallet.credit(parsedAmount, 'Electricity payment refund');
      
      transaction.status = 'failed';
      transaction.failureReason = apiErr.message;
      transaction.statusHistory.push({ status: 'failed', note: apiErr.message, timestamp: new Date() });
      await transaction.save();
      
      logger.error(`Electricity payment failed: ${apiErr.message}`);
      return next(new AppError(`Payment failed: ${apiErr.message}`, 500));
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
    const activeProvider = BILL_SOURCE_TO_PROVIDER[source] || source || await vtuConfig.getProviderIdForService('cable');
    
    if (!smartCardNumber || !provider || !planId || !transactionPin) {
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
    
    // If using configured provider (default or specified)
    if (activeProvider === 'nellobytes' || activeProvider === 'clubkonnect') {
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
            provider: activeProvider,
            cableProvider: provider,
            smartCardNumber,
            package: planId,
            customerName: verifyResult.customerName,
            months,
          },
          statusHistory: [{ status: 'pending', note: `Subscription initiated via ${activeProvider}`, timestamp: new Date() }],
        });
        
        // Purchase from NelloBytes
        const apiResponse = await NelloBytesService.purchaseCableTV({
          cableTV: provider,
          packageCode: planId,
          smartCardNo: smartCardNumber,
          phoneNo: user.phoneNumber,
          requestId: reference,
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
    const { examType, quantity = 1, transactionPin, source, phoneNumber } = req.body;
    
    if (!examType || !transactionPin) {
      return next(new AppError('Please provide exam type and transaction PIN', 400));
    }

    if (Number(quantity) !== 1) {
      return next(new AppError('ClubKonnect education PIN purchase currently supports quantity 1 only', 400));
    }

    const activeProvider = BILL_SOURCE_TO_PROVIDER[source] || source || await vtuConfig.getProviderIdForService('education');
    const activeSource = vtuConfig.providers[activeProvider]?.source || activeProvider;

    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Education PIN provider ${activeProvider} is not implemented`, 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

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
    
    const totalAmount = pricing.sellingPrice;
    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    if (wallet.balance < totalAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await wallet.debit(totalAmount, `Education PIN purchase: ${examType}`);

    const reference = `EDU-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/bills/webhook/nellobytes`;
    const normalizedExamType = String(examType).toLowerCase();
    const isJamb = normalizedExamType.includes('jamb') || ['de', 'utme-mock', 'utme-no-mock'].includes(normalizedExamType);
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'education_pin',
      category: 'education',
      amount: totalAmount,
      totalAmount,
      previousBalance: wallet.balance + totalAmount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${examType} PIN`,
      service: {
        provider: activeProvider,
        plan: examType,
        phoneNumber: phoneNumber || user.phoneNumber,
      },
      metadata: { examType, quantity: 1, unitPrice: pricing.sellingPrice },
      statusHistory: [{ status: 'pending', note: `Education PIN purchase initiated via ${activeProvider}`, timestamp: new Date() }],
    });

    try {
      const providerResponse = isJamb
        ? await NelloBytesService.buyJAMPEPIN({
            examType: normalizedExamType,
            phoneNo: phoneNumber || user.phoneNumber,
            requestId: reference,
            callBackURL: callbackUrl,
          })
        : await NelloBytesService.buyWAECEPIN({
            examType: normalizedExamType,
            phoneNo: phoneNumber || user.phoneNumber,
            requestId: reference,
            callBackURL: callbackUrl,
          });

      transaction.service.orderId = providerResponse.orderId || reference;
      transaction.providerResponse = providerResponse.response;

      if (providerResponse.success || providerResponse.statusCode === '200') {
        transaction.status = 'successful';
        transaction.statusHistory.push({
          status: 'successful',
          note: providerResponse.response?.remark || 'Education PIN delivered successfully',
          timestamp: new Date(),
        });
      } else if (providerResponse.statusCode === '100') {
        transaction.status = 'pending';
        transaction.statusHistory.push({
          status: 'pending',
          note: providerResponse.response?.remark || 'Order received by provider',
          timestamp: new Date(),
        });
      } else {
        throw new Error(providerResponse.response?.status || 'Education PIN purchase failed');
      }
      await transaction.save();

      return res.status(200).json({
        status: 'success',
        message: providerResponse.statusCode === '200'
          ? 'Education PIN purchased successfully'
          : 'Education PIN purchase initiated',
        data: {
          reference,
          orderId: providerResponse.orderId || reference,
          examType: normalizedExamType,
          amount: totalAmount,
          cardDetails: providerResponse.cardDetails || null,
          provider: activeProvider,
          status: transaction.status,
        },
      });
    } catch (error) {
      await wallet.credit(totalAmount, 'Education PIN refund');

      transaction.status = 'failed';
      transaction.failureReason = error.message;
      transaction.statusHistory.push({
        status: 'failed',
        note: error.message || 'Education PIN purchase failed',
        timestamp: new Date(),
      });
      await transaction.save();

      logger.error(`Education PIN purchase failed: ${error.message}`);
      return next(new AppError(`Education PIN purchase failed: ${error.message}`, 500));
    }
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
};
