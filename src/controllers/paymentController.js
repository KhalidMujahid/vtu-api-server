const axios = require('axios');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

const FUNDING_FEE = 50;

function calculateNetFundingAmount(grossAmount) {
  const parsedAmount = Number(grossAmount) || 0;

  return {
    grossAmount: parsedAmount,
    fee: FUNDING_FEE,
    netAmount: Math.max(parsedAmount - FUNDING_FEE, 0),
  };
}

async function applyFundingToTransaction(transaction, grossAmount, metadata = {}, note = 'Payment confirmed') {
  const { grossAmount: resolvedGrossAmount, fee, netAmount } = calculateNetFundingAmount(grossAmount);

  let wallet = await Wallet.findOne({ user: transaction.user });
  const previousBalance = wallet?.balance || 0;

  if (wallet) {
    wallet.balance += netAmount;
    wallet.totalFunded += netAmount;
    wallet.lastTransaction = new Date();
    await wallet.save();
  } else {
    wallet = await Wallet.create({
      user: transaction.user,
      balance: netAmount,
      totalFunded: netAmount,
      lastTransaction: new Date(),
    });
  }

  transaction.status = 'successful';
  transaction.amount = netAmount;
  transaction.fee = fee;
  transaction.totalAmount = resolvedGrossAmount;
  transaction.previousBalance = previousBalance;
  transaction.newBalance = wallet.balance;
  transaction.completedAt = new Date();
  transaction.metadata = {
    ...(transaction.metadata || {}),
    grossAmount: resolvedGrossAmount,
    fundingFee: fee,
    netAmount,
    ...metadata,
  };
  transaction.statusHistory.push({
    status: 'successful',
    note: `${note}. Gross ₦${resolvedGrossAmount}, fee ₦${fee}, net credited ₦${netAmount}`,
    timestamp: new Date(),
  });
  await transaction.save();

  return { wallet, grossAmount: resolvedGrossAmount, fee, netAmount };
}

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
      type: 'fund_wallet',
      category: 'funding',
      amount,
      fee: FUNDING_FEE,
      totalAmount: amount,
      reference,
      status: 'pending',
      metadata: {
        provider: 'paystack',
        initiatedAt: new Date(),
        grossAmount: amount,
        fundingFee: FUNDING_FEE,
        expectedNetAmount: Math.max(Number(amount) - FUNDING_FEE, 0),
      },
      statusHistory: [{ status: 'pending', note: 'Payment initiated', timestamp: new Date() }],
    });

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: user.email,
        amount: amount * 100,
        reference,
        currency: 'NGN',
        callback_url: `${process.env.FRONTEND_URL}/wallet/funding/callback`,
        metadata: { userId, transactionId: transaction._id.toString(), type: 'fund_wallet' },
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } }
    );

    logger.info(`Payment initialized: ${reference}, Amount: ₦${amount}, User: ${user.email}`);

    res.status(200).json({
      status: 'success',
      data: {
        authorization_url: response.data.data.authorization_url,
        reference,
        transactionId: transaction._id,
        fundingFee: FUNDING_FEE,
        expectedNetAmount: Math.max(Number(amount) - FUNDING_FEE, 0),
      },
    });
  } catch (error) {
    logger.error('Error initializing Paystack payment:', error);

    if (error.response?.data?.transactionId) {
      await Transaction.findByIdAndUpdate(error.response.data.transactionId, {
        status: 'failed',
        $push: { statusHistory: { status: 'failed', note: 'Payment initialization failed', timestamp: new Date() } },
      });
    }

    next(new AppError(error.response?.data?.message || 'Payment initialization failed', 400));
  }
};

exports.verifyPaystackPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });

    const paymentData = response.data.data;

    if (paymentData.status === 'success') {
      const transaction = await Transaction.findOne({ reference });
      if (transaction && transaction.status === 'pending') {
        const { grossAmount, netAmount } = await applyFundingToTransaction(
          transaction,
          paymentData.amount ? paymentData.amount / 100 : transaction.totalAmount || transaction.amount,
          { paymentData },
          'Payment verified successfully'
        );

        logger.info(`Payment verified: ${reference}, Gross: ₦${grossAmount}, Net Credited: ₦${netAmount}`);
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
      if (transaction.status === 'successful') return res.status(200).json({ status: 'success' });

      const { grossAmount, netAmount } = await applyFundingToTransaction(
        transaction,
        paymentData.amount ? paymentData.amount / 100 : transaction.totalAmount || transaction.amount,
        {
          webhookData: paymentData,
          confirmedAt: new Date(),
        },
        'Payment confirmed via webhook'
      );

      logger.info(`Wallet funded via webhook: ${reference}, Gross: ₦${grossAmount}, Net Credited: ₦${netAmount}`);
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
        fee: transaction.fee || 0,
        totalAmount: transaction.totalAmount,
        status: transaction.status,
        type: transaction.type,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
        user: transaction.user,
      },
    });
  } catch (error) {
    logger.error('Error getting payment status:', error);
    next(new AppError('Failed to get payment status', 500));
  }
};
