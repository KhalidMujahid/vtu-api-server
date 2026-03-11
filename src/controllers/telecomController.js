<<<<<<< HEAD
const axios = require('axios');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ServicePricing = require('../models/ServicePricing');
const Wallet = require("../models/Wallet");
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const NelloBytesService = require('../services/nelloBytesService');
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
    const { phoneNumber, network, dataPlan, transactionPin, amount } = req.body;
    
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
        provider: 'nellobytes',
        network: network.toLowerCase(),
        plan: dataPlan,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Purchase initiated', timestamp: new Date() }],
    });

    try {
      // Call NelloBytes API
      const apiResponse = await NelloBytesService.purchaseData({
        network: network.toLowerCase(),
        dataPlan: dataPlan,
        mobileNumber: phoneNumber,
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

        res.status(200).json({
          status: 'success',
          message: 'Data purchase initiated successfully',
          data: {
            reference,
            orderId: apiResponse.orderId,
            phoneNumber,
            network,
            dataPlan,
            amount: sellingPrice,
            status: 'pending',
          },
        });
      } else {
        throw new AppError(apiResponse.response?.status || 'Purchase failed', 400);
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
    const { phoneNumber, network, amount, transactionPin } = req.body;

    if (!phoneNumber || !network || !amount || !transactionPin) {
      return next(new AppError("All fields required", 400));
    }

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
        provider: "nellobytes",
        network,
        phoneNumber,
      },
      statusHistory: [
        {
          status: "pending",
          note: "Transaction initiated",
          timestamp: new Date(),
        },
      ],
    });

    const apiResponse = await axios.get(
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

    const responseData = apiResponse.data;

    if (responseData.status === "ORDER_RECEIVED") {
      transaction.status = "pending";

      transaction.service = {
        ...transaction.service,
        orderId: responseData.orderid
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
=======
const axios = require('axios');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ServicePricing = require('../models/ServicePricing');
const Wallet = require("../models/Wallet");
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const NelloBytesService = require('../services/nelloBytesService');
const crypto = require('crypto');

const SERVER_URL = process.env.SERVER_URL || 'https://api.yareemadata.com';

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
    const { phoneNumber, network, dataPlan, transactionPin } = req.body;
    
    if (!phoneNumber || !network || !dataPlan || !transactionPin) {
      return next(new AppError('All fields required: phoneNumber, network, dataPlan, transactionPin', 400));
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

    // Get pricing from database
    const pricing = await ServicePricing.findOne({
      serviceType: 'data_recharge',
      network: network.toLowerCase(),
      planCode: dataPlan,
      isActive: true,
      isAvailable: true,
    });

    if (!pricing) {
      return next(new AppError('Data plan not available', 404));
    }

    if (wallet.balance < pricing.sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    // Debit wallet
    await wallet.debit(pricing.sellingPrice, `Data purchase: ${network} ${dataPlan}`);

    const reference = generateReference('DATA');
    const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/nellobytes`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'data_recharge',
      category: 'telecom',
      amount: pricing.sellingPrice,
      totalAmount: pricing.sellingPrice,
      previousBalance: wallet.balance + pricing.sellingPrice,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${network.toUpperCase()} ${dataPlan} for ${phoneNumber}`,
      service: {
        provider: 'nellobytes',
        network: network.toLowerCase(),
        plan: dataPlan,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Purchase initiated', timestamp: new Date() }],
    });

    try {
      // Call NelloBytes API
      const apiResponse = await NelloBytesService.purchaseData({
        network: network.toLowerCase(),
        dataPlan: dataPlan,
        mobileNumber: phoneNumber,
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

        res.status(200).json({
          status: 'success',
          message: 'Data purchase initiated successfully',
          data: {
            reference,
            orderId: apiResponse.orderId,
            phoneNumber,
            network,
            dataPlan,
            amount: pricing.sellingPrice,
            status: 'pending',
          },
        });
      } else {
        throw new AppError(apiResponse.response?.status || 'Purchase failed', 400);
      }
    } catch (err) {
      // Refund wallet on failure
      await wallet.credit(pricing.sellingPrice, 'Data purchase refund');

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
    const { phoneNumber, network, amount, transactionPin } = req.body;

    if (!phoneNumber || !network || !amount || !transactionPin) {
      return next(new AppError("All fields required", 400));
    }

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
        provider: "nellobytes",
        network,
        phoneNumber,
      },
      statusHistory: [
        {
          status: "pending",
          note: "Transaction initiated",
          timestamp: new Date(),
        },
      ],
    });

    const apiResponse = await axios.get(
      "https://www.nellobytesystems.com/APIAirtimeV1.asp",
      {
        params: {
          UserID: process.env.NELLO_USER_ID,
          APIKey: process.env.NELLO_API_KEY,
          MobileNetwork: networkCode,
          Amount: amount,
          MobileNumber: phoneNumber,
          RequestID: requestId,
          CallBackURL: process.env.AIRTIME_CALLBACK_URL,
        },
        timeout: 10000,
      }
    );

    const responseData = apiResponse.data;

    if (responseData.status === "ORDER_RECEIVED") {
      transaction.status = "pending";

      transaction.service = {
        ...transaction.service,
        orderId: responseData.orderid
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

    } else {

      transaction.status = "failed";

      transaction.statusHistory.push({
        status: "failed",
        note: orderremark || "Provider reported failure",
        timestamp: new Date()
      });

    }

    await transaction.save();

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

    } else {
      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: status || 'Provider failure',
        timestamp: new Date(),
      });

      const user = await User.findById(transaction.user);
      user.walletBalance += transaction.amount;
      await user.save();
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
>>>>>>> 8afeb82 (another commit)
};