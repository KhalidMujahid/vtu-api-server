const crypto = require('crypto');
const WalletService = require('../services/walletService');
const Transaction = require('../models/Transaction');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

exports.paystackWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    
    if (!signature) {
      return next(new AppError('No signature provided', 400));
    }
    
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');
    
    if (hash !== signature) {
      return next(new AppError('Invalid signature', 400));
    }
    
    const event = req.body;
    
    switch (event.event) {
      case 'charge.success':
        await handleSuccessfulPayment(event.data);
        break;
        
      case 'charge.failed':
        await handleFailedPayment(event.data);
        break;
        
      case 'transfer.success':
        await handleSuccessfulTransfer(event.data);
        break;
        
      case 'transfer.failed':
      case 'transfer.reversed':
        await handleFailedTransfer(event.data);
        break;
    }
    
    res.status(200).json({ status: 'success' });
  } catch (error) {
    logger.error('Paystack webhook error:', error);
    res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.monnifyWebhook = async (req, res, next) => {
  try {
    const { paymentReference, amountPaid, paidOn, transactionHash } = req.body;
    
    const apiKey = process.env.MONNIFY_API_KEY;
    const contractCode = 'mock_contract_code';
    const secretKey = process.env.MONNIFY_SECRET_KEY;
    
    const computedHash = crypto
      .createHmac('sha512', secretKey)
      .update(apiKey + paymentReference + amountPaid + paidOn + contractCode)
      .digest('hex');
    
    if (computedHash !== transactionHash) {
      return next(new AppError('Invalid transaction hash', 400));
    }
    
    await handleSuccessfulPayment({
      reference: paymentReference,
      amount: amountPaid / 100,
      status: 'success',
    });
    
    res.status(200).json({ status: 'success' });
  } catch (error) {
    logger.error('Monnify webhook error:', error);
    res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.flutterwaveWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['verif-hash'];
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
    
    if (!signature || signature !== secretHash) {
      return next(new AppError('Invalid signature', 400));
    }
    
    const event = req.body;
    
    if (event.status === 'successful') {
      await handleSuccessfulPayment({
        reference: event.txRef,
        amount: event.amount,
        status: 'success',
      });
    } else {
      await handleFailedPayment({
        reference: event.txRef,
        status: 'failed',
      });
    }
    
    res.status(200).json({ status: 'success' });
  } catch (error) {
    logger.error('Flutterwave webhook error:', error);
    res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.providerCallback = async (req, res, next) => {
  try {
    const { providerName } = req.params;
    const callbackData = req.body;
    
    logger.info(`Provider callback received from ${providerName}:`, callbackData);
    
    // Process provider callback based on provider
    switch (providerName.toLowerCase()) {
      case 'mtn':
      case 'airtel':
      case 'glo':
      case '9mobile':
        // Handle provider-specific callback logic
        // You might want to update transaction status based on the callback
        break;
      default:
        logger.warn(`Unknown provider callback: ${providerName}`);
    }
    
    res.status(200).json({ status: 'success' });
  } catch (error) {
    logger.error('Provider callback error:', error);
    res.status(400).json({ status: 'error', message: error.message });
  }
};

async function handleSuccessfulPayment(paymentData) {
  try {
    const { reference, amount } = paymentData;
    
    const transaction = await Transaction.findOne({
      reference,
      type: 'fund_wallet',
      status: 'pending',
    });
    
    if (!transaction) {
      logger.error(`Transaction not found for reference: ${reference}`);
      return;
    }
    
    await WalletService.creditWallet(
      transaction.user,
      amount,
      reference,
      'Wallet funding via payment gateway'
    );
    
    transaction.status = 'successful';
    transaction.statusHistory.push({
      status: 'successful',
      note: 'Payment confirmed via webhook',
      timestamp: new Date(),
    });
    transaction.completedAt = new Date();
    await transaction.save();
    
    logger.info(`Payment successful via webhook: ${reference}, Amount: ${amount}`);
  } catch (error) {
    logger.error('Error handling successful payment:', error);
    throw error;
  }
}

async function handleFailedPayment(paymentData) {
  try {
    const { reference } = paymentData;
    
    const transaction = await Transaction.findOne({
      reference,
      type: 'fund_wallet',
      status: 'pending',
    });
    
    if (!transaction) {
      logger.error(`Transaction not found for reference: ${reference}`);
      return;
    }
    
    transaction.status = 'failed';
    transaction.statusHistory.push({
      status: 'failed',
      note: 'Payment failed via webhook',
      timestamp: new Date(),
    });
    transaction.completedAt = new Date();
    await transaction.save();
    
    logger.info(`Payment failed via webhook: ${reference}`);
  } catch (error) {
    logger.error('Error handling failed payment:', error);
    throw error;
  }
}

async function handleSuccessfulTransfer(transferData) {
  try {
    const { reference, amount } = transferData;
    
    const transaction = await Transaction.findOne({
      reference,
      type: 'withdrawal',
      status: 'pending',
    });
    
    if (!transaction) {
      logger.error(`Withdrawal transaction not found: ${reference}`);
      return;
    }
    
    transaction.status = 'successful';
    transaction.statusHistory.push({
      status: 'successful',
      note: 'Bank transfer completed via webhook',
      timestamp: new Date(),
    });
    transaction.completedAt = new Date();
    await transaction.save();
    
    logger.info(`Withdrawal successful via webhook: ${reference}, Amount: ${amount}`);
  } catch (error) {
    logger.error('Error handling successful transfer:', error);
    throw error;
  }
}

async function handleFailedTransfer(transferData) {
  try {
    const { reference } = transferData;
    
    const transaction = await Transaction.findOne({
      reference,
      type: 'withdrawal',
      status: 'pending',
    });
    
    if (!transaction) {
      logger.error(`Withdrawal transaction not found: ${reference}`);
      return;
    }
    
    await WalletService.creditWallet(
      transaction.user,
      transaction.totalAmount,
      `REFUND-${reference}`,
      'Refund for failed withdrawal'
    );
    
    transaction.status = 'refunded';
    transaction.statusHistory.push({
      status: 'refunded',
      note: 'Withdrawal failed, amount refunded via webhook',
      timestamp: new Date(),
    });
    transaction.completedAt = new Date();
    await transaction.save();
    
    logger.info(`Withdrawal failed and refunded via webhook: ${reference}`);
  } catch (error) {
    logger.error('Error handling failed transfer:', error);
    throw error;
  }
}