const crypto = require('crypto');
const WalletService = require('../services/walletService');
const NotificationService = require('../services/NotificationService');
const SmePlugService = require('../services/smePlugService');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

const FUNDING_FEE = 50;

async function refundTransactionToWallet(transaction, reason = 'Transaction refund', amountOverride = null) {
  if (!transaction) return null;

  const alreadyRefunded =
    transaction?.metadata?.refundProcessed === true ||
    (
      typeof transaction.previousBalance === 'number' &&
      typeof transaction.newBalance === 'number' &&
      transaction.newBalance === transaction.previousBalance
    );

  if (alreadyRefunded) {
    return Wallet.findOne({ user: transaction.user });
  }

  const wallet = await Wallet.findOne({ user: transaction.user });
  if (!wallet) return null;

  const refundAmount = Number(amountOverride ?? transaction.amount ?? 0);
  if (refundAmount > 0) {
    await wallet.credit(refundAmount, reason);
  }

  transaction.metadata = {
    ...(transaction.metadata || {}),
    refundProcessed: true,
    refundProcessedAt: new Date().toISOString(),
    refundReason: reason,
  };

  if (typeof transaction.previousBalance === 'number') {
    transaction.newBalance = transaction.previousBalance;
  } else {
    transaction.newBalance = wallet.balance;
  }

  return wallet;
}

function calculateNetFundingAmount(grossAmount) {
  const parsedAmount = Number(grossAmount) || 0;
  return {
    grossAmount: parsedAmount,
    fee: FUNDING_FEE,
    netAmount: Math.max(parsedAmount - FUNDING_FEE, 0),
  };
}

async function applyFundingSuccess({ transaction, grossAmount, note, metadata = {} }) {
  const wallet = await Wallet.findOne({ user: transaction.user });

  if (!wallet) {
    throw new AppError('Wallet not found', 404);
  }

  const { netAmount, fee } = calculateNetFundingAmount(grossAmount);
  const previousBalance = wallet.balance;

  wallet.balance += netAmount;
  wallet.totalFunded += netAmount;
  wallet.lastTransaction = new Date();
  await wallet.save();

  transaction.status = 'successful';
  transaction.amount = netAmount;
  transaction.fee = fee;
  transaction.totalAmount = Number(grossAmount) || transaction.totalAmount || transaction.amount;
  transaction.previousBalance = previousBalance;
  transaction.newBalance = wallet.balance;
  transaction.completedAt = new Date();
  transaction.metadata = {
    ...(transaction.metadata || {}),
    grossAmount: Number(grossAmount) || 0,
    fundingFee: fee,
    netAmount,
    ...metadata,
  };
  transaction.statusHistory.push({
    status: 'successful',
    note,
    timestamp: new Date(),
  });
  await transaction.save();

  return { wallet, netAmount, fee };
}

/**
 * SMEPlug Webhook Handler
 */
exports.smePlugWebhook = async (req, res) => {
  try {
    const payload = Object.keys(req.body || {}).length ? req.body : req.query;
    logger.info('SMEPlug webhook received:', payload);

    const result = SmePlugService.verifyCallback(payload);

    if (!result) {
      return res.status(400).send('Invalid payload');
    }

    logger.info('Parsed webhook result:', result);

    const lookupValues = [result.reference, result.customerReference]
      .filter(Boolean);

    const transaction = await Transaction.findOne({
      $or: [
        { 'service.orderId': { $in: lookupValues } },
        { reference: { $in: lookupValues } },
      ],
    });

    if (!transaction) {
      logger.warn(`Transaction not found for reference: ${result.reference}`);
      return res.status(200).send('OK');
    }

    if (['successful', 'failed'].includes(transaction.status)) {
      return res.status(200).send('Already processed');
    }

    const status = result.status?.toLowerCase();

    const successStatuses = ['success', 'successful'];

    if (successStatuses.includes(status)) {
      transaction.status = 'successful';
      transaction.providerResponse = payload;
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

      logger.info(`Transaction successful: ${transaction.reference}`);
    } else {

      if (transaction.status === 'failed') {
        return res.status(200).send('Already refunded');
      }

      transaction.status = 'failed';
      transaction.providerResponse = payload;
      transaction.statusHistory.push({
        status: 'failed',
        note: result.message || 'Delivery failed',
        timestamp: new Date(),
      });

      await transaction.save();
      await refundTransactionToWallet(transaction, 'Purchase refund due to failure');
      await transaction.save();

      await NotificationService.create({
        user: transaction.user,
        title: 'Purchase Failed',
        message: `Your ${transaction.type} of ₦${transaction.amount} failed. Amount has been refunded.`,
        type: 'purchase_failed',
        reference: transaction.reference,
      });

      logger.warn(`Transaction failed: ${transaction.reference}`);
    }

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('SMEPlug webhook error:', error);
    return res.status(200).send('OK');
  }
};

exports.budpayWebhook = async (req, res) => {
  try {

    const event = req.body;

    if (event.notify !== "transaction") {
      return res.status(200).send("Ignored");
    }

    if (event.notifyType !== "successful") {
      return res.status(200).send("Transaction not successful");
    }

    const data = event.transferDetails;

    const amount = Number(data.amount);
    const accountNumber = data.craccount;
    const reference = data.paymentReference;
    const { netAmount, fee } = calculateNetFundingAmount(amount);

    const existingTx = await Transaction.findOne({ reference });

    if (existingTx) {
      return res.status(200).send("Already processed");
    }

    const wallet = await Wallet.findOne({
      "virtualAccount.accountNumber": accountNumber
    });

    if (!wallet) {
      console.log("Wallet not found for:", accountNumber);
      return res.status(404).send("Wallet not found");
    }

    await Wallet.updateOne(
      { _id: wallet._id },
      {
        $inc: {
          balance: netAmount,
          totalFunded: netAmount
        },
        $set: {
          lastTransaction: new Date()
        },
      }
    );

    await Transaction.create({
      reference,
      user: wallet.user,
      type: "fund_wallet",
      category: "funding",
      amount: netAmount,
      fee,
      totalAmount: amount,
      status: "successful",
      description: "Wallet funded via BudPay virtual account",
      metadata: {
        grossAmount: amount,
        fundingFee: fee,
        netAmount,
      },
      statusHistory: [
        {
          status: "successful",
          note: `Funding confirmed from BudPay webhook. Gross ₦${amount}, fee ₦${fee}, net credited ₦${netAmount}`,
          timestamp: new Date()
        }
      ]
    });

    return res.status(200).send("OK");

  } catch (error) {
    console.error("BudPay Webhook Error:", error);
    return res.status(500).send("Webhook error");
  }
};

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
    
    switch (providerName.toLowerCase()) {
      case 'mtn':
      case 'airtel':
      case 'glo':
      case '9mobile':
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
    
    const { netAmount } = await applyFundingSuccess({
      transaction,
      grossAmount: amount,
      note: `Payment confirmed via webhook. Gross ₦${amount}, fee ₦${FUNDING_FEE}, net credited ₦${Math.max(Number(amount || 0) - FUNDING_FEE, 0)}`,
      metadata: {
        providerWebhookData: paymentData,
      },
    });
    
    logger.info(`Payment successful via webhook: ${reference}, Gross: ${amount}, Net Credited: ${netAmount}`);
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
