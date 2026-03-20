const axios = require('axios');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ServicePricing = require('../models/ServicePricing');
const Wallet = require("../models/Wallet");
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const NelloBytesService = require('../services/nelloBytesService');
const VtuProviderService = require('../services/vtuProviderService');
const AirtimeNigeriaService = require('../services/airtimeNigeriaService');
const SmePlugService = require('../services/smePlugService');
const vtuConfig = require('../config/vtuProviders');
const crypto = require('crypto');

const SERVER_URL = process.env.SERVER_URL || 'https://api.yareemadata.com';
const AIRTIME_CALLBACK_URL = process.env.AIRTIME_CALLBACK_URL || `${SERVER_URL}/api/v1/telecom/airtime/webhook`;

function generateReference(prefix = 'TX') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

exports.getDataPlans = async (req, res, next) => {
  try {
    const { network, source } = req.query;
    
    // If source is 'nellobytes', fetch from NelloBytes API
    if (source === 'nellobytes') {
      const plans = await NelloBytesService.getDataPlans(network);
      return res.status(200).json({
        status: 'success',
        data: plans,
        source: 'nellobytes',
      });
    }
    
    // Default: fetch from database
    const query = { serviceType: 'data_recharge', isActive: true, isAvailable: true };

    if (network) {
      const allowedNetworks = ['mtn', 'glo', 'airtel', '9mobile'];
      if (!allowedNetworks.includes(network.toLowerCase())) {
        return next(new AppError('Invalid network provider', 400));
      }
      query.network = network.toLowerCase();
    }

    const dataPlans = await ServicePricing.find(query)
      .sort({ sellingPrice: 1 })
      .select('-costPrice -profitMargin -createdBy -updatedBy')
      .lean();

    const groupedPlans = dataPlans.reduce((acc, plan) => {
      acc[plan.network] = acc[plan.network] || [];
      acc[plan.network].push({
        id: plan._id,
        planCode: plan.planCode,
        planName: plan.planName,
        size: plan.size,
        price: plan.sellingPrice,
        validity: plan.validity,
      });
      return acc;
    }, {});

    res.status(200).json({ status: 'success', results: dataPlans.length, data: groupedPlans, source: 'database' });
  } catch (error) {
    next(error);
  }
};

exports.purchaseData = async (req, res, next) => {
  try {
    const { phoneNumber, network, dataPlan, transactionPin, amount, provider } = req.body;
    
    // Get default provider for data from config
    const defaultProvider = vtuConfig.getProviderIdForService('data');
    const activeProvider = provider || defaultProvider;
    
    // More specific validation
    if (!phoneNumber) {
      return next(new AppError('Phone number is required', 400));
    }
    if (!network) {
      return next(new AppError('Network is required', 400));
    }
    if (!dataPlan) {
      return next(new AppError('Data plan is required', 400));
    }
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
    }

    if (!/^(?:\+234|0)[789][01]\d{8}$/.test(phoneNumber)) {
      return next(new AppError('Invalid phone number', 400));
    }

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const isPinValid = await user.compareTransactionPin(transactionPin);
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    // Get pricing from database or use provided amount
    let pricing = null;
    let sellingPrice = 0;

    if (amount && !isNaN(amount) && parseFloat(amount) > 0) {
      // Use amount provided by user
      sellingPrice = parseFloat(amount);
      pricing = { sellingPrice };
    } else {
      // Try to get pricing from database
      pricing = await ServicePricing.findOne({
        serviceType: 'data_recharge',
        network: network.toLowerCase(),
        planCode: dataPlan,
        isActive: true,
        isAvailable: true,
      });

      if (!pricing) {
        return next(new AppError('Data plan not available. Please check the plan ID or provide an amount.', 404));
      }
      sellingPrice = pricing.sellingPrice;
    }

    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    // Debit wallet
    await wallet.debit(sellingPrice, `Data purchase: ${network} ${dataPlan}`);

    const reference = generateReference('DATA');
    const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/nellobytes`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'data_recharge',
      category: 'telecom',
      amount: sellingPrice,
      totalAmount: sellingPrice,
      previousBalance: wallet.balance + sellingPrice,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${network.toUpperCase()} ${dataPlan} for ${phoneNumber}`,
      service: {
        provider: activeProvider,
        network: network.toLowerCase(),
        plan: dataPlan,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: `Purchase initiated via ${activeProvider}`, timestamp: new Date() }],
    });

    try {
      let apiResponse;
      
      // Route to the appropriate provider
      if (activeProvider === 'airtimenigeria') {
        // Use AirtimeNigeria API
        apiResponse = await AirtimeNigeriaService.purchaseData({
          phone: phoneNumber,
          packageCode: dataPlan,
          callbackUrl,
          customerReference: reference,
        });
        transaction.service.provider = 'airtimenigeria';
        
      } else if (activeProvider === 'smeplug') {
        // Use SMEPlug API
        const smeCallbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
        apiResponse = await SmePlugService.purchaseData({
          phone: phoneNumber,
          network: network.toLowerCase(),
          planId: dataPlan,
          customerReference: reference,
          callbackUrl: smeCallbackUrl,
        });
        transaction.service.provider = 'smeplug';
        
      } else {
        // Default: Use NelloBytes (Club Konnect)
        apiResponse = await NelloBytesService.purchaseData({
          network: network.toLowerCase(),
          dataPlan: dataPlan,
          mobileNumber: phoneNumber,
          callBackURL: callbackUrl,
        });
        transaction.service.provider = 'nellobytes';
      }

      // Check if successful
      if (apiResponse.success || apiResponse.status === 'success' || apiResponse.statusCode === '100') {
        transaction.status = 'pending';
        transaction.service.orderId = apiResponse.reference || apiResponse.orderId;
        transaction.providerResponse = apiResponse;
        transaction.statusHistory.push({ 
          status: 'pending', 
          note: `Order received: ${apiResponse.reference || apiResponse.orderId}`, 
          timestamp: new Date() 
        });
        await transaction.save();

        res.status(200).json({
          status: 'success',
          message: 'Data purchase initiated successfully',
          data: {
            reference,
            orderId: apiResponse.reference || apiResponse.orderId,
            phoneNumber,
            network,
            dataPlan,
            amount: sellingPrice,
            status: 'pending',
            provider: activeProvider,
          },
        });
      } else {
        throw new AppError(apiResponse.message || 'Purchase failed', 400);
      }
    } catch (err) {
      // Refund wallet on failure
      await wallet.credit(sellingPrice, 'Data purchase refund');

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`Data purchase failed → ${err.message}`);
      return next(new AppError(`Data purchase failed: ${err.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

const networkMap = {
  MTN: "01",
  GLO: "02",
  AIRTEL: "04",
  "9MOBILE": "03",
  ETISALAT: "03",
};

const profitConfig = {
  MTN: 3,
  GLO: 4,
  AIRTEL: 3,
  "9MOBILE": 2,
};

exports.purchaseAirtime = async (req, res, next) => {
  try {
    const { phoneNumber, network, amount, transactionPin, provider } = req.body;

    if (!phoneNumber || !network || !amount || !transactionPin) {
      return next(new AppError("All fields required", 400));
    }

    // Get default provider for airtime from config
    const defaultProvider = vtuConfig.getProviderIdForService('airtime');
    const activeProvider = provider || defaultProvider;

    const user = await User.findById(req.user.id).select("+transactionPin");

    if (!user) {
      return next(new AppError("User not found", 404));
    }

    const isValidPin = await user.compareTransactionPin(transactionPin);
    if (!isValidPin) {
      return next(new AppError("Invalid transaction PIN", 401));
    }

    const wallet = await Wallet.findOne({ user: user._id });

    if (!wallet) {
      return next(new AppError("Wallet not found", 404));
    }

    if (wallet.balance < amount) {
      return next(new AppError("Insufficient wallet balance", 400));
    }

    const networkCode = networkMap[network.toUpperCase()];
    if (!networkCode) {
      return next(new AppError("Invalid network selected", 400));
    }

    const requestId = `AIR-${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")}`;

    const profitPercent = profitConfig[network.toUpperCase()] || 0;
    const profit = (profitPercent / 100) * amount;

    await wallet.debit(amount, "Airtime purchase");

    const transaction = await Transaction.create({
      reference: requestId,
      user: user._id,
      type: "airtime_recharge",
      category: "telecom",
      amount,
      profit,
      totalAmount: amount,
      status: "pending",
      description: `${network} airtime for ${phoneNumber}`,
      service: {
        provider: activeProvider,
        network,
        phoneNumber,
      },
      statusHistory: [
        {
          status: "pending",
          note: `Transaction initiated via ${activeProvider}`,
          timestamp: new Date(),
        },
      ],
    });

    let apiResponse;
    let responseData;

    // Route to the appropriate provider
    if (activeProvider === 'airtimenigeria') {
      // Use AirtimeNigeria API
      apiResponse = await AirtimeNigeriaService.purchaseAirtime({
        network: network.toLowerCase(),
        phone: phoneNumber,
        amount: parseInt(amount),
        maxAmount: parseInt(amount),
        customerReference: requestId,
      });
      responseData = { status: apiResponse.status === 'success' ? 'ORDER_RECEIVED' : 'FAILED' };
      
    } else if (activeProvider === 'smeplug') {
      // Use SMEPlug API
      const smeCallbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
      apiResponse = await SmePlugService.purchaseAirtime({
        phone: phoneNumber,
        network: network.toLowerCase(),
        amount: parseInt(amount),
        customerReference: requestId,
        callbackUrl: smeCallbackUrl,
      });
      responseData = { status: apiResponse.status === 'success' ? 'ORDER_RECEIVED' : 'FAILED' };
      
    } else {
      // Default: Use NelloBytes
      apiResponse = await axios.get(
        "https://www.nellobytesystems.com/APIAirtimeV1.asp",
        {
          params: {
            UserID: process.env.NELLO_USER_ID,
            APIKey: process.env.NELLO_API_KEY,
            MobileNetwork: networkCode,
            Amount: amount,
            MobileNumber: phoneNumber,
            RequestID: requestId,
            CallBackURL: AIRTIME_CALLBACK_URL,
          },
          timeout: 10000,
        }
      );
      responseData = apiResponse.data;
    }

    if (responseData.status === "ORDER_RECEIVED") {
      transaction.status = "pending";

      transaction.service = {
        ...transaction.service,
        orderId: apiResponse?.reference || responseData?.orderid || requestId
      };

      transaction.statusHistory.push({
        status: "pending",
        note: "Order received by provider",
        timestamp: new Date(),
      });

      await transaction.save();
    } else {
      transaction.status = "failed";

      transaction.statusHistory.push({
        status: "failed",
        note: responseData.status || "Provider rejected request",
        timestamp: new Date(),
      });

      await transaction.save();

      await wallet.credit(amount, "Airtime refund");
    }

    res.status(200).json({
      status: "success",
      message: "Airtime purchase processing",
      data: {
        reference: requestId,
        provider: activeProvider,
        providerResponse: responseData,
      },
    });
  } catch (error) {
    console.error("Airtime Error:", error);
    next(error);
  }
};

exports.airtimeCallback = async (req, res) => {
  try {

    const { orderid, orderstatus, statuscode, orderremark } = req.query;

    const transaction = await Transaction.findOne({
      "service.orderId": orderid
    });

    if (!transaction) {
      return res.send("Transaction not found");
    }

    if (transaction.status === "successful") {
      return res.send("Already processed");
    }

    if (orderstatus === "ORDER_COMPLETED" || statuscode === "200") {

      transaction.status = "successful";

      transaction.statusHistory.push({
        status: "successful",
        note: orderremark || "Airtime delivered successfully",
        timestamp: new Date()
      });

      await transaction.save();
      
      // Send notification
      await NotificationService.airtimePurchase(
        transaction.user,
        transaction.service?.network,
        transaction.amount,
        transaction.service?.phoneNumber
      );

    } else {

      transaction.status = "failed";

      transaction.statusHistory.push({
        status: "failed",
        note: orderremark || "Provider reported failure",
        timestamp: new Date()
      });

      await transaction.save();
      
      // Refund wallet and send notification
      const wallet = await Wallet.findOne({ user: transaction.user });
      if (wallet) {
        await wallet.credit(transaction.amount, 'Airtime purchase refund');
      }
      
      await NotificationService.create({
        user: transaction.user,
        title: 'Airtime Purchase Failed',
        message: `Your airtime purchase of ₦${transaction.amount} to ${transaction.service?.phoneNumber} failed. Amount has been refunded.`,
        type: 'airtime_failed',
        reference: transaction.reference,
      });

    }

    res.send("OK");

  } catch (error) {
    console.error("Callback Error:", error);
    res.send("OK");
  }
};

exports.queryAirtimeStatus = async (requestId) => {

  const response = await axios.get(
    "https://www.nellobytesystems.com/APIQueryV1.asp",
    {
      params: {
        UserID: process.env.NELLO_USER_ID,
        APIKey: process.env.NELLO_API_KEY,
        RequestID: requestId,
      },
    }
  );

  return response.data;
};

exports.airtimeWebhook = async (req, res) => {
  try {
    const { orderid, statuscode, status } = req.body;

    const transaction = await Transaction.findOne({ reference: orderid });
    if (!transaction) return res.status(404).send('Transaction not found');

    if (transaction.status === 'successful' || transaction.status === 'failed') {
      return res.status(200).send('Already processed');
    }

    if (statuscode === "100") {
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: status,
        timestamp: new Date(),
      });

    } else if (statuscode === "200") {
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: 'Confirmed by provider',
        timestamp: new Date(),
      });

      // Send notification for successful airtime purchase
      await NotificationService.airtimePurchase(
        transaction.user,
        transaction.service?.network,
        transaction.amount,
        transaction.service?.phoneNumber
      );

    } else {
      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: status || 'Provider failure',
        timestamp: new Date(),
      });

      // Refund wallet on failure
      const wallet = await Wallet.findOne({ user: transaction.user });
      if (wallet) {
        await wallet.credit(transaction.amount, 'Airtime purchase refund');
      }

      // Send notification for failed airtime purchase
      await NotificationService.create({
        user: transaction.user,
        title: 'Airtime Purchase Failed',
        message: `Your airtime purchase of ₦${transaction.amount} to ${transaction.service?.phoneNumber} failed. Amount has been refunded.`,
        type: 'airtime_failed',
        reference: transaction.reference,
      });
    }

    await transaction.save();

    res.status(200).send('OK');

  } catch (error) {
    console.error(error);
    res.status(500).send('Webhook error');
  }
};

exports.purchaseRechargePin = async (req, res, next) => {
  try {
    const { network, pinType, quantity = 1, transactionPin } = req.body;
    if (!network || !pinType || !transactionPin) return next(new AppError('All fields required', 400));

    const user = await User.findById(req.user.id).select('+transactionPin walletBalance');
    if (!(await user.compareTransactionPin(transactionPin))) return next(new AppError('Invalid transaction PIN', 401));

    const pricing = await ServicePricing.findOne({ serviceType: 'recharge_pin', network, planName: pinType, isActive: true });
    if (!pricing) return next(new AppError('PIN not available', 404));

    const totalAmount = pricing.sellingPrice * quantity;
    if (user.walletBalance < totalAmount) return next(new AppError('Insufficient balance', 400));

    user.walletBalance -= totalAmount;
    await user.save();

    const reference = generateReference('PIN');
    const pins = Array.from({ length: quantity }, (_, i) => ({
      pin: Math.floor(1000000000 + Math.random() * 9000000000).toString(),
      serial: `SN${Date.now()}${i}`.substring(0, 12),
      expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }));

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'recharge_pin',
      category: 'telecom',
      amount: totalAmount,
      totalAmount,
      status: 'successful',
      description: `${network.toUpperCase()} ${pinType} x${quantity}`,
      service: { provider: network, plan: pinType, quantity },
      providerResponse: { pins },
      statusHistory: [{ status: 'successful', note: 'Recharge PIN generated', timestamp: new Date() }],
    });

    res.status(200).json({
      status: 'success',
      message: 'Recharge PIN generated successfully',
      data: { reference, network, pinType, quantity, pins },
    });
  } catch (error) {
    next(error);
  }
};

exports.smedataWebhook = async (req, res, next) => {
  try {
    const { reference, status, providerResponse } = req.body;

    if (!reference || !status) {
      return res.status(400).json({ status: 'error', message: 'Invalid webhook payload' });
    }

    const transaction = await Transaction.findOne({ reference });
    if (!transaction) return res.status(404).json({ status: 'error', message: 'Transaction not found' });

    if (transaction.status === 'successful') return res.status(200).json({ status: 'success', message: 'Transaction already processed' });

    const user = await User.findById(transaction.user);
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (status === 'successful') {
      transaction.status = 'successful';
      transaction.providerResponse = providerResponse || {};
      transaction.statusHistory.push({ status: 'successful', note: 'Transaction confirmed by SMEDATA', timestamp: new Date() });
      await transaction.save();
    } else {
      user.walletBalance += transaction.amount;
      await user.save();

      transaction.status = 'failed';
      transaction.providerResponse = providerResponse || {};
      transaction.statusHistory.push({ status: 'failed', note: 'Transaction failed via webhook. Wallet refunded.', timestamp: new Date() });
      await transaction.save();
    }

    res.status(200).json({ status: 'success', message: 'Webhook processed' });
  } catch (error) {
    logger.error('Webhook processing error:', error);
    next(error);
  }
};

/**
 * NelloBytes Webhook Handler
 * Handles callbacks from NelloBytes for data, cable TV, electricity, EPIN, WAEC, JAMB
 */
exports.nelloBytesWebhook = async (req, res, next) => {
  try {
    // NelloBytes sends data as query string or JSON body
    const queryData = req.query;
    const bodyData = req.body;
    
    // Merge both - query params take precedence
    const data = { ...bodyData, ...queryData };
    
    const { orderid, orderstatus, statuscode, orderremark, orderdate } = data;

    if (!orderid) {
      logger.warn('NelloBytes webhook received without orderid');
      return res.status(400).send('Missing orderid');
    }

    logger.info(`NelloBytes webhook received: ${orderid}`, { data });

    // Find transaction by orderId
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

    // Skip if already processed
    if (transaction.status === 'successful' || transaction.status === 'failed') {
      logger.info(`Transaction ${transaction.reference} already processed`);
      return res.status(200).send('Already processed');
    }

    const user = await User.findById(transaction.user);

    // Handle different status codes
    if (statuscode === '200' || orderstatus === 'ORDER_COMPLETED') {
      // Success
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: orderremark || 'Transaction completed successfully',
        timestamp: new Date(),
      });
      await transaction.save();
      
      // Send notification based on transaction type
      if (transaction.type === 'data_recharge') {
        await NotificationService.dataPurchase(
          transaction.user,
          transaction.service?.network,
          transaction.service?.plan,
          transaction.service?.phoneNumber
        );
      } else if (transaction.type === 'airtime_recharge') {
        await NotificationService.airtimePurchase(
          transaction.user,
          transaction.service?.network,
          transaction.amount,
          transaction.service?.phoneNumber
        );
      }
      
      logger.info(`Transaction ${transaction.reference} marked as successful`);
      
    } else if (statuscode === '100' || orderstatus === 'ORDER_RECEIVED') {
      // Order received, still processing
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: orderremark || 'Order received, processing',
        timestamp: new Date(),
      });
      await transaction.save();
      
    } else if (orderstatus === 'ORDER_ONHOLD') {
      // Order on hold
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: orderremark || 'Order on hold',
        timestamp: new Date(),
      });
      await transaction.save();
      
    } else {
      // Failed - refund wallet
      if (user) {
        const wallet = await Wallet.findOne({ user: user._id });
        if (wallet) {
          await wallet.credit(transaction.amount, 'Transaction failed - refund');
        }
      }

      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: orderremark || 'Transaction failed',
        timestamp: new Date(),
      });
      await transaction.save();

      // Send failure notification
      await NotificationService.create({
        user: transaction.user,
        title: 'Transaction Failed',
        message: `Your ${transaction.type || 'transaction'} of ₦${transaction.amount} has failed. Amount has been refunded to your wallet.`,
        type: 'transaction_failed',
        reference: transaction.reference,
      });
      
      logger.info(`Transaction ${transaction.reference} marked as failed, wallet refunded`);
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('NelloBytes webhook error:', error);
    res.status(500).send('Webhook error');
  }
};

/**
 * Get EPIN Plans (from NelloBytes)
 */
exports.getEPINPlans = async (req, res, next) => {
  try {
    const plans = await NelloBytesService.getEPINDiscount();
    
    res.status(200).json({
      status: 'success',
      data: plans,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current VTU provider (for frontend)
 */
exports.getCurrentProvider = async (req, res, next) => {
  try {
    const provider = await VtuProviderService.getPrimaryProvider();
    const allProviders = await VtuProviderService.getAllProvidersWithStatus();
    
    res.status(200).json({
      status: 'success',
      data: {
        currentProvider: provider,
        providers: allProviders,
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get AirtimeNigeria data plans
 */
exports.getAirtimeNigeriaDataPlans = async (req, res, next) => {
  try {
    const { network } = req.query;
    const plans = await AirtimeNigeriaService.getDataPlans(network);
    
    res.status(200).json({
      status: 'success',
      data: plans.data,
      source: 'airtimenigeria',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Purchase data using AirtimeNigeria
 */
exports.purchaseAirtimeNigeriaData = async (req, res, next) => {
  try {
    const { phoneNumber, network, packageCode, planId, transactionPin } = req.body;
    
    if (!phoneNumber || !network) {
      return next(new AppError('Phone number and network are required', 400));
    }
    
    if (!packageCode && !planId) {
      return next(new AppError('Package code or plan ID is required', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
    }

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const isPinValid = await user.compareTransactionPin(transactionPin);
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    // Get pricing - for now, we'll need to get the price from AirtimeNigeria
    const plansResult = await AirtimeNigeriaService.getDataPlans(network);
    let plan = null;
    const networkPlans = plansResult.data[network.toLowerCase()] || [];
    
    if (packageCode) {
      plan = networkPlans.find(p => p.planCode === packageCode);
    } else if (planId) {
      plan = networkPlans.find(p => p.planId === parseInt(planId));
    }
    
    if (!plan) {
      return next(new AppError('Data plan not found', 404));
    }
    
    const sellingPrice = plan.price;
    
    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    // Debit wallet
    await wallet.debit(sellingPrice, `AirtimeNigeria Data: ${network} ${plan.planName}`);

    const reference = `AN-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/airtimenigeria`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'data_recharge',
      category: 'telecom',
      amount: sellingPrice,
      totalAmount: sellingPrice,
      previousBalance: wallet.balance + sellingPrice,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${network.toUpperCase()} ${plan.planName} for ${phoneNumber}`,
      service: {
        provider: 'airtimenigeria',
        network: network.toLowerCase(),
        plan: packageCode || planId,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Purchase initiated via AirtimeNigeria', timestamp: new Date() }],
    });

    try {
      const apiResponse = await AirtimeNigeriaService.purchaseData({
        phone: phoneNumber,
        packageCode,
        planId: planId ? parseInt(planId) : undefined,
        callbackUrl,
        customerReference: reference,
      });

      transaction.status = 'pending';
      transaction.service.orderId = apiResponse.reference;
      transaction.providerResponse = apiResponse;
      transaction.statusHistory.push({ 
        status: 'pending', 
        note: `Order received: ${apiResponse.reference}`, 
        timestamp: new Date() 
      });
      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: 'Data purchase initiated successfully',
        data: {
          reference,
          orderId: apiResponse.reference,
          phoneNumber,
          network,
          plan: plan.planName,
          amount: sellingPrice,
          status: 'pending',
          provider: 'airtimenigeria',
        },
      });
    } catch (err) {
      // Refund wallet on failure
      await wallet.credit(sellingPrice, 'Data purchase refund');

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`AirtimeNigeria data purchase failed → ${err.message}`);
      return next(new AppError(`Data purchase failed: ${err.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Purchase airtime using AirtimeNigeria
 */
exports.purchaseAirtimeNigeriaAirtime = async (req, res, next) => {
  try {
    const { phoneNumber, network, amount, transactionPin } = req.body;
    
    if (!phoneNumber || !network || !amount) {
      return next(new AppError('Phone number, network, and amount are required', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
    }

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

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
    await wallet.debit(amount, `AirtimeNigeria Airtime: ${network} ${amount}`);

    const reference = `AN-AIR-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/airtimenigeria`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'airtime_recharge',
      category: 'telecom',
      amount,
      totalAmount: amount,
      previousBalance: wallet.balance + amount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${network.toUpperCase()} ${amount} airtime for ${phoneNumber}`,
      service: {
        provider: 'airtimenigeria',
        network: network.toLowerCase(),
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Airtime purchase initiated via AirtimeNigeria', timestamp: new Date() }],
    });

    try {
      const apiResponse = await AirtimeNigeriaService.purchaseAirtime({
        network: network.toLowerCase(),
        phone: phoneNumber,
        amount: parseInt(amount),
        maxAmount: parseInt(amount),
        callbackUrl,
        customerReference: reference,
      });

      transaction.status = 'pending';
      transaction.service.orderId = apiResponse.reference;
      transaction.providerResponse = apiResponse;
      transaction.statusHistory.push({ 
        status: 'pending', 
        note: `Order received: ${apiResponse.reference}`, 
        timestamp: new Date() 
      });
      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: 'Airtime purchase initiated successfully',
        data: {
          reference,
          orderId: apiResponse.reference,
          phoneNumber,
          network,
          amount,
          status: 'pending',
          provider: 'airtimenigeria',
        },
      });
    } catch (err) {
      // Refund wallet on failure
      await wallet.credit(amount, 'Airtime purchase refund');

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`AirtimeNigeria airtime purchase failed → ${err.message}`);
      return next(new AppError(`Airtime purchase failed: ${err.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get AirtimeNigeria wallet balance
 */
exports.getAirtimeNigeriaBalance = async (req, res, next) => {
  try {
    const balance = await AirtimeNigeriaService.getWalletBalance();
    
    res.status(200).json({
      status: 'success',
      data: balance.data,
      provider: 'airtimenigeria',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * AirtimeNigeria Webhook Handler
 */
exports.airtimeNigeriaWebhook = async (req, res) => {
  try {
    const payload = req.body;
    logger.info('AirtimeNigeria webhook received:', payload);
    
    // Parse the callback payload
    const result = AirtimeNigeriaService.verifyCallback(payload);
    
    if (!result) {
      return res.status(400).send('Invalid payload');
    }
    
    // Find transaction by reference
    const transaction = await Transaction.findOne({ 'service.orderId': result.reference });
    
    if (!transaction) {
      logger.warn(`Transaction not found for reference: ${result.reference}`);
      return res.status(200).send('OK');
    }
    
    if (transaction.status === 'successful' || transaction.status === 'failed') {
      return res.status(200).send('Already processed');
    }
    
    // Update transaction based on delivery status
    if (result.status === 'success') {
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: result.message || 'Delivered successfully',
        timestamp: new Date(),
      });
      
      await transaction.save();
      
      // Send notification
      await NotificationService.create({
        user: transaction.user,
        title: 'Purchase Successful',
        message: `Your ${transaction.type} of ₦${transaction.amount} was successful.`,
        type: 'purchase_success',
        reference: transaction.reference,
      });
    } else {
      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: result.message || 'Delivery failed',
        timestamp: new Date(),
      });
      
      await transaction.save();
      
      // Refund wallet
      const wallet = await Wallet.findOne({ user: transaction.user });
      if (wallet) {
        await wallet.credit(transaction.amount, 'Purchase refund due to failure');
      }
      
      // Send notification
      await NotificationService.create({
        user: transaction.user,
        title: 'Purchase Failed',
        message: `Your ${transaction.type} of ₦${transaction.amount} failed. Amount has been refunded.`,
        type: 'purchase_failed',
        reference: transaction.reference,
      });
    }
    
    res.status(200).send('OK');
  } catch (error) {
    logger.error('AirtimeNigeria webhook error:', error);
    res.status(200).send('OK'); // Always return OK to prevent retries
  }
};

/**
 * Get SMEPlug networks
 */
exports.getSmePlugNetworks = async (req, res, next) => {
  try {
    const networks = await SmePlugService.getNetworks();
    
    res.status(200).json({
      status: 'success',
      data: networks.networks,
      provider: 'smeplug',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get SMEPlug wallet balance
 */
exports.getSmePlugBalance = async (req, res, next) => {
  try {
    const balance = await SmePlugService.getWalletBalance();
    
    res.status(200).json({
      status: 'success',
      data: {
        balance: balance.balance,
        currency: balance.currency,
      },
      provider: 'smeplug',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Purchase data using SMEPlug
 */
exports.purchaseSmePlugData = async (req, res, next) => {
  try {
    const { phoneNumber, network, planId, transactionPin } = req.body;
    
    if (!phoneNumber || !network || !planId) {
      return next(new AppError('Phone number, network, and plan ID are required', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
    }

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const isPinValid = await user.compareTransactionPin(transactionPin);
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    // For SMEPlug, we'll use a default price since we don't have the plan list
    // In production, you should fetch the plan price first
    const sellingPrice = 200; // Default placeholder - should fetch from API
    
    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    // Debit wallet
    await wallet.debit(sellingPrice, `SMEPlug Data: ${network} ${planId}`);

    const reference = `SP-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'data_recharge',
      category: 'telecom',
      amount: sellingPrice,
      totalAmount: sellingPrice,
      previousBalance: wallet.balance + sellingPrice,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${network.toUpperCase()} data for ${phoneNumber}`,
      service: {
        provider: 'smeplug',
        network: network.toLowerCase(),
        plan: planId,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Purchase initiated via SMEPlug', timestamp: new Date() }],
    });

    try {
      const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
      const apiResponse = await SmePlugService.purchaseData({
        phone: phoneNumber,
        network: network.toLowerCase(),
        planId,
        customerReference: reference,
        callbackUrl,
      });

      transaction.status = 'pending';
      transaction.service.orderId = apiResponse.reference;
      transaction.providerResponse = apiResponse;
      transaction.statusHistory.push({ 
        status: 'pending', 
        note: `Order received: ${apiResponse.reference}`, 
        timestamp: new Date() 
      });
      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: 'Data purchase initiated successfully',
        data: {
          reference,
          orderId: apiResponse.reference,
          phoneNumber,
          network,
          planId,
          amount: sellingPrice,
          status: 'pending',
          provider: 'smeplug',
        },
      });
    } catch (err) {
      // Refund wallet on failure
      await wallet.credit(sellingPrice, 'Data purchase refund');

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`SMEPlug data purchase failed → ${err.message}`);
      return next(new AppError(`Data purchase failed: ${err.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Purchase airtime using SMEPlug
 */
exports.purchaseSmePlugAirtime = async (req, res, next) => {
  try {
    const { phoneNumber, network, amount, transactionPin } = req.body;
    
    if (!phoneNumber || !network || !amount) {
      return next(new AppError('Phone number, network, and amount are required', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
    }

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const isPinValid = await user.compareTransactionPin(transactionPin);
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    const sellingPrice = parseFloat(amount);
    
    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    // Debit wallet
    await wallet.debit(sellingPrice, `SMEPlug Airtime: ${network} ${amount}`);

    const reference = `SP-AIR-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'airtime_recharge',
      category: 'telecom',
      amount: sellingPrice,
      totalAmount: sellingPrice,
      previousBalance: wallet.balance + sellingPrice,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${network.toUpperCase()} ${amount} airtime for ${phoneNumber}`,
      service: {
        provider: 'smeplug',
        network: network.toLowerCase(),
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Airtime purchase initiated via SMEPlug', timestamp: new Date() }],
    });

    try {
      const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
      const apiResponse = await SmePlugService.purchaseAirtime({
        phone: phoneNumber,
        network: network.toLowerCase(),
        amount: parseFloat(amount),
        customerReference: reference,
        callbackUrl,
      });

      transaction.status = 'pending';
      transaction.service.orderId = apiResponse.reference;
      transaction.providerResponse = apiResponse;
      transaction.statusHistory.push({ 
        status: 'pending', 
        note: `Order received: ${apiResponse.reference}`, 
        timestamp: new Date() 
      });
      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: 'Airtime purchase initiated successfully',
        data: {
          reference,
          orderId: apiResponse.reference,
          phoneNumber,
          network,
          amount: sellingPrice,
          status: 'pending',
          provider: 'smeplug',
        },
      });
    } catch (err) {
      // Refund wallet on failure
      await wallet.credit(sellingPrice, 'Airtime purchase refund');

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`SMEPlug airtime purchase failed → ${err.message}`);
      return next(new AppError(`Airtime purchase failed: ${err.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * SMEPlug Webhook Handler
 */
exports.smePlugWebhook = async (req, res) => {
  try {
    const payload = req.body;
    logger.info('SMEPlug webhook received:', payload);
    
    const result = SmePlugService.verifyCallback(payload);
    
    if (!result) {
      return res.status(400).send('Invalid payload');
    }
    
    const transaction = await Transaction.findOne({ 'service.orderId': result.reference });
    
    if (!transaction) {
      logger.warn(`Transaction not found for reference: ${result.reference}`);
      return res.status(200).send('OK');
    }
    
    if (transaction.status === 'successful' || transaction.status === 'failed') {
      return res.status(200).send('Already processed');
    }
    
    if (result.status === 'success') {
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: result.message || 'Delivered successfully',
        timestamp: new Date(),
      });
      
      await transaction.save();
      
      await NotificationService.create({
        user: transaction.user,
        title: 'Purchase Successful',
        message: `Your ${transaction.type} of ₦${transaction.amount} was successful.`,
        type: 'purchase_success',
        reference: transaction.reference,
      });
    } else {
      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: result.message || 'Delivery failed',
        timestamp: new Date(),
      });
      
      await transaction.save();
      
      const wallet = await Wallet.findOne({ user: transaction.user });
      if (wallet) {
        await wallet.credit(transaction.amount, 'Purchase refund due to failure');
      }
      
      await NotificationService.create({
        user: transaction.user,
        title: 'Purchase Failed',
        message: `Your ${transaction.type} of ₦${transaction.amount} failed. Amount has been refunded.`,
        type: 'purchase_failed',
        reference: transaction.reference,
      });
    }
    
    res.status(200).send('OK');
  } catch (error) {
    logger.error('SMEPlug webhook error:', error);
    res.status(200).send('OK');
  }
};