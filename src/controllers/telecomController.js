const axios = require('axios');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ServicePricing = require('../models/ServicePricing');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const crypto = require('crypto');

function generateReference(prefix = 'TX') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

exports.getDataPlans = async (req, res, next) => {
  try {
    const { network } = req.query;
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
        planName: plan.planName,
        size: plan.size,
        price: plan.sellingPrice,
        validity: plan.validity,
      });
      return acc;
    }, {});

    res.status(200).json({ status: 'success', results: dataPlans.length, data: groupedPlans });
  } catch (error) {
    next(error);
  }
};

exports.purchaseData = async (req, res, next) => {
  try {
    const { phoneNumber, network, size, transactionPin } = req.body;
    if (!phoneNumber || !network || !size || !transactionPin) return next(new AppError('All fields required', 400));

    if (!/^(?:\+234|0)[789][01]\d{8}$/.test(phoneNumber)) return next(new AppError('Invalid phone number', 400));

    const user = await User.findById(req.user.id).select('+transactionPin walletBalance');
    if (!user) return next(new AppError('User not found', 404));

    if (!(await user.compareTransactionPin(transactionPin))) return next(new AppError('Invalid transaction PIN', 401));

    const plan = await ServicePricing.findOne({ network: network.toLowerCase(),isActive: true });
    if (!plan) return next(new AppError('Plan not available', 404));

    if (user.walletBalance < plan.sellingPrice) return next(new AppError('Insufficient balance', 400));

    user.walletBalance -= plan.sellingPrice;
    await user.save();

    const reference = generateReference('DATA');
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'data_recharge',
      category: 'telecom',
      amount: plan.sellingPrice,
      totalAmount: plan.sellingPrice,
      status: 'pending',
      description: `${network.toUpperCase()} ${size} for ${phoneNumber}`,
      service: { provider: network, phoneNumber, plan: size },
      statusHistory: [{ status: 'pending', note: 'Purchase initiated', timestamp: new Date() }],
    });

    try {
      const apiResponse = await axios.post('https://smedata.ng/wp-json/api/v1/data', {
        network: network.toUpperCase(),
        phone: phoneNumber,
        size,
        reference,
      }, { timeout: 30000 });

      transaction.status = 'successful';
      transaction.providerResponse = apiResponse.data;
      transaction.statusHistory.push({ status: 'successful', note: 'Data purchase successful', timestamp: new Date() });
      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: 'Data purchased successfully',
        data: { reference, phoneNumber, network, size, amount: plan.sellingPrice },
      });
    } catch (err) {
      user.walletBalance += plan.sellingPrice;
      await user.save();

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: 'API failed', timestamp: new Date() });
      await transaction.save();

      logger.error(`Data purchase failed → ${err.message}`);
      return next(new AppError('Data purchase failed. Wallet refunded.', 500));
    }
  } catch (error) {
    next(error);
  }
};

const networkMap = {
  MTN: 1,
  GLO: 2,
  AIRTEL: 4,
  '9MOBILE': 3,
  ETISALAT: 3,
};

const profitConfig = {
  MTN: 3,      
  GLO: 4,
  AIRTEL: 3,
  '9MOBILE': 2,
};

exports.purchaseAirtime = async (req, res, next) => {
  try {
    const { phoneNumber, network, amount, transactionPin } = req.body;

    if (!phoneNumber || !network || !amount || !transactionPin)
      return next(new AppError('All fields required', 400));

    const user = await User.findById(req.user.id)
      .select('+transactionPin walletBalance');

    if (!(await user.compareTransactionPin(transactionPin)))
      return next(new AppError('Invalid transaction PIN', 401));

    if (user.walletBalance < amount)
      return next(new AppError('Insufficient balance', 400));

    const networkCode = networkMap[network.toUpperCase()];
    if (!networkCode)
      return next(new AppError('Invalid network selected', 400));

    const requestId = `AIR-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    const profitPercent = profitConfig[network.toUpperCase()] || 0;
    const profit = (profitPercent / 100) * amount;

    user.walletBalance -= amount;
    await user.save();

    const transaction = await Transaction.create({
      reference: requestId,
      user: user._id,
      type: 'airtime_recharge',
      category: 'telecom',
      amount,
      profit,
      totalAmount: amount,
      status: 'pending',
      description: `${network} airtime for ${phoneNumber}`,
      service: { provider: network, phoneNumber },
      statusHistory: [
        { status: 'pending', note: 'Transaction initiated', timestamp: new Date() },
      ],
    });

    let apiResponse;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        attempts++;

        apiResponse = await axios.get(
          'https://www.nellobytesystems.com/APIAirtimeV1.asp',
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

        break;
      } catch (err) {
        if (attempts >= maxAttempts) throw err;
      }
    }

    if (apiResponse?.data?.includes?.('SUCCESS')) {
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: 'Provider instant success',
        timestamp: new Date(),
      });
      await transaction.save();
    }

    res.status(200).json({
      status: 'success',
      message: 'Airtime request submitted',
      data: { reference: requestId },
    });

  } catch (error) {
    next(error);
  }
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