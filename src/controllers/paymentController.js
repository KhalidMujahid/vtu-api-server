<<<<<<< HEAD
const axios = require('axios');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

exports.initializePaystackPayment = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount < 100) {
      return next(new AppError('Amount must be at least ₦100', 400));
    }

    const user = await User.findById(userId);
    if (!user) return next(new AppError('User not found', 404));

    const reference = `FUND-${Date.now()}-${userId.slice(-6)}-${Math.random().toString(36).substring(7)}`;

    const transaction = await Transaction.create({
      user: userId,
      type: 'wallet_funding',
      amount,
      totalAmount: amount,
      reference,
      status: 'pending',
      paymentMethod: 'paystack',
      metadata: { provider: 'paystack', initiatedAt: new Date() },
      statusHistory: [{ status: 'pending', note: 'Payment initiated', timestamp: new Date() }]
    });

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: user.email,
        amount: amount * 100,
        reference,
        currency: 'NGN',
        callback_url: `${process.env.FRONTEND_URL}/wallet/funding/callback`,
        metadata: { userId, transactionId: transaction._id.toString(), type: 'wallet_funding' }
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } }
    );

    logger.info(`Payment initialized: ${reference}, Amount: ₦${amount}, User: ${user.email}`);

    res.status(200).json({
      status: 'success',
      data: {
        authorization_url: response.data.data.authorization_url,
        reference,
        transactionId: transaction._id
      }
    });

  } catch (error) {
    logger.error('Error initializing Paystack payment:', error);

    if (error.response?.data?.transactionId) {
      await Transaction.findByIdAndUpdate(error.response.data.transactionId, {
        status: 'failed',
        $push: { statusHistory: { status: 'failed', note: 'Payment initialization failed', timestamp: new Date() } }
      });
    }

    next(new AppError(error.response?.data?.message || 'Payment initialization failed', 400));
  }
};

exports.verifyPaystackPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });

    const paymentData = response.data.data;

    if (paymentData.status === 'success') {
      const transaction = await Transaction.findOne({ reference });
      if (transaction && transaction.status === 'pending') {
        const wallet = await Wallet.findOneAndUpdate(
          { user: transaction.user },
          { $inc: { balance: transaction.amount }, $push: { transactions: { type: 'credit', amount: transaction.amount, reference, description: 'Wallet funding via Paystack', balance: transaction.amount } } },
          { new: true }
        );

        if (!wallet) {
          await Wallet.create({ user: transaction.user, balance: transaction.amount, transactions: [{ type: 'credit', amount: transaction.amount, reference, description: 'Wallet funding via Paystack', balance: transaction.amount }] });
        }

        transaction.status = 'completed';
        transaction.statusHistory.push({ status: 'completed', note: 'Payment verified successfully', timestamp: new Date() });
        transaction.completedAt = new Date();
        transaction.metadata.paymentData = paymentData;
        await transaction.save();

        logger.info(`Payment verified: ${reference}, Amount: ₦${transaction.amount}`);
      }
    }

    res.status(200).json({ status: 'success', data: paymentData });

  } catch (error) {
    logger.error('Error verifying payment:', error);
    next(new AppError('Payment verification failed', 400));
  }
};

exports.paystackWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest('hex');

    if (hash !== signature) {
      logger.error('Invalid Paystack webhook signature');
      return res.status(400).json({ status: 'error', message: 'Invalid signature' });
    }

    const event = req.body;
    logger.info(`Paystack webhook received: ${event.event}`);

    if (event.event === 'charge.success') {
      const paymentData = event.data;
      const { reference } = paymentData;

      const transaction = await Transaction.findOne({ reference });
      if (!transaction) return res.status(200).json({ status: 'success' });
      if (transaction.status === 'completed') return res.status(200).json({ status: 'success' });

      const wallet = await Wallet.findOneAndUpdate(
        { user: transaction.user },
        { $inc: { balance: transaction.amount }, $push: { transactions: { type: 'credit', amount: transaction.amount, reference, description: 'Wallet funding via Paystack', balance: transaction.amount } } },
        { new: true }
      );

      if (!wallet) {
        await Wallet.create({ user: transaction.user, balance: transaction.amount, transactions: [{ type: 'credit', amount: transaction.amount, reference, description: 'Wallet funding via Paystack', balance: transaction.amount }] });
      }

      transaction.status = 'completed';
      transaction.completedAt = new Date();
      transaction.statusHistory.push({ status: 'completed', note: 'Payment confirmed via webhook', timestamp: new Date() });
      transaction.metadata = { ...transaction.metadata, webhookData: paymentData, confirmedAt: new Date() };
      await transaction.save();

      logger.info(`Wallet funded via webhook: ${reference}, Amount: ₦${transaction.amount}`);
    }

    res.status(200).json({ status: 'success' });

  } catch (error) {
    logger.error('Paystack webhook error:', error);
    res.status(200).json({ status: 'success' });
  }
};

exports.getPaymentStatus = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const transaction = await Transaction.findOne({ reference }).populate('user', 'email firstName lastName');

    if (!transaction) return next(new AppError('Transaction not found', 404));

    res.status(200).json({
      status: 'success',
      data: {
        reference: transaction.reference,
        amount: transaction.amount,
        status: transaction.status,
        type: transaction.type,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
        user: transaction.user
      }
    });

  } catch (error) {
    logger.error('Error getting payment status:', error);
    next(new AppError('Failed to get payment status', 500));
  }
=======
const axios = require('axios');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

exports.initializePaystackPayment = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount < 100) {
      return next(new AppError('Amount must be at least ₦100', 400));
    }

    const user = await User.findById(userId);
    if (!user) return next(new AppError('User not found', 404));

    const reference = `FUND-${Date.now()}-${userId.slice(-6)}-${Math.random().toString(36).substring(7)}`;

    const transaction = await Transaction.create({
      user: userId,
      type: 'wallet_funding',
      amount,
      totalAmount: amount,
      reference,
      status: 'pending',
      paymentMethod: 'paystack',
      metadata: { provider: 'paystack', initiatedAt: new Date() },
      statusHistory: [{ status: 'pending', note: 'Payment initiated', timestamp: new Date() }]
    });

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: user.email,
        amount: amount * 100,
        reference,
        currency: 'NGN',
        callback_url: `${process.env.FRONTEND_URL}/wallet/funding/callback`,
        metadata: { userId, transactionId: transaction._id.toString(), type: 'wallet_funding' }
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } }
    );

    logger.info(`Payment initialized: ${reference}, Amount: ₦${amount}, User: ${user.email}`);

    res.status(200).json({
      status: 'success',
      data: {
        authorization_url: response.data.data.authorization_url,
        reference,
        transactionId: transaction._id
      }
    });

  } catch (error) {
    logger.error('Error initializing Paystack payment:', error);

    if (error.response?.data?.transactionId) {
      await Transaction.findByIdAndUpdate(error.response.data.transactionId, {
        status: 'failed',
        $push: { statusHistory: { status: 'failed', note: 'Payment initialization failed', timestamp: new Date() } }
      });
    }

    next(new AppError(error.response?.data?.message || 'Payment initialization failed', 400));
  }
};

exports.verifyPaystackPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });

    const paymentData = response.data.data;

    if (paymentData.status === 'success') {
      const transaction = await Transaction.findOne({ reference });
      if (transaction && transaction.status === 'pending') {
        const wallet = await Wallet.findOneAndUpdate(
          { user: transaction.user },
          { $inc: { balance: transaction.amount }, $push: { transactions: { type: 'credit', amount: transaction.amount, reference, description: 'Wallet funding via Paystack', balance: transaction.amount } } },
          { new: true }
        );

        if (!wallet) {
          await Wallet.create({ user: transaction.user, balance: transaction.amount, transactions: [{ type: 'credit', amount: transaction.amount, reference, description: 'Wallet funding via Paystack', balance: transaction.amount }] });
        }

        transaction.status = 'completed';
        transaction.statusHistory.push({ status: 'completed', note: 'Payment verified successfully', timestamp: new Date() });
        transaction.completedAt = new Date();
        transaction.metadata.paymentData = paymentData;
        await transaction.save();

        logger.info(`Payment verified: ${reference}, Amount: ₦${transaction.amount}`);
      }
    }

    res.status(200).json({ status: 'success', data: paymentData });

  } catch (error) {
    logger.error('Error verifying payment:', error);
    next(new AppError('Payment verification failed', 400));
  }
};

exports.paystackWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest('hex');

    if (hash !== signature) {
      logger.error('Invalid Paystack webhook signature');
      return res.status(400).json({ status: 'error', message: 'Invalid signature' });
    }

    const event = req.body;
    logger.info(`Paystack webhook received: ${event.event}`);

    if (event.event === 'charge.success') {
      const paymentData = event.data;
      const { reference } = paymentData;

      const transaction = await Transaction.findOne({ reference });
      if (!transaction) return res.status(200).json({ status: 'success' });
      if (transaction.status === 'completed') return res.status(200).json({ status: 'success' });

      const wallet = await Wallet.findOneAndUpdate(
        { user: transaction.user },
        { $inc: { balance: transaction.amount }, $push: { transactions: { type: 'credit', amount: transaction.amount, reference, description: 'Wallet funding via Paystack', balance: transaction.amount } } },
        { new: true }
      );

      if (!wallet) {
        await Wallet.create({ user: transaction.user, balance: transaction.amount, transactions: [{ type: 'credit', amount: transaction.amount, reference, description: 'Wallet funding via Paystack', balance: transaction.amount }] });
      }

      transaction.status = 'completed';
      transaction.completedAt = new Date();
      transaction.statusHistory.push({ status: 'completed', note: 'Payment confirmed via webhook', timestamp: new Date() });
      transaction.metadata = { ...transaction.metadata, webhookData: paymentData, confirmedAt: new Date() };
      await transaction.save();

      logger.info(`Wallet funded via webhook: ${reference}, Amount: ₦${transaction.amount}`);
    }

    res.status(200).json({ status: 'success' });

  } catch (error) {
    logger.error('Paystack webhook error:', error);
    res.status(200).json({ status: 'success' });
  }
};

exports.getPaymentStatus = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const transaction = await Transaction.findOne({ reference }).populate('user', 'email firstName lastName');

    if (!transaction) return next(new AppError('Transaction not found', 404));

    res.status(200).json({
      status: 'success',
      data: {
        reference: transaction.reference,
        amount: transaction.amount,
        status: transaction.status,
        type: transaction.type,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
        user: transaction.user
      }
    });

  } catch (error) {
    logger.error('Error getting payment status:', error);
    next(new AppError('Failed to get payment status', 500));
  }
>>>>>>> 8afeb82 (another commit)
};