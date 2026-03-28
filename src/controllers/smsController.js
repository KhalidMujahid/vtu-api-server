const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const BulkSmsNigeriaService = require('../services/bulkSmsNigeriaService');

const SERVER_URL = process.env.SERVER_URL || 'https://api.yareemadata.com';
const ALLOWED_GATEWAYS = new Set(['direct-refund', 'direct-corporate', 'otp', 'dual-backup']);
const ALLOWED_APPEND_SENDER = new Set(['none', 'hosted', 'all']);

function generateReference(prefix = 'SMS') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

exports.getBulkSmsBalance = async (req, res, next) => {
  try {
    const balance = await BulkSmsNigeriaService.getBalance();

    res.status(200).json({
      status: 'success',
      data: balance.data,
      provider: 'bulksmsnigeria',
    });
  } catch (error) {
    next(new AppError(error.message || 'Unable to fetch Bulk SMS balance', error.statusCode || 500));
  }
};

exports.sendBulkSms = async (req, res, next) => {
  try {
    const {
      from,
      to,
      body,
      gateway,
      appendSender = 'hosted',
      callbackUrl,
      customerReference,
      transactionPin,
    } = req.body;

    if (!from || !to || !body || !transactionPin) {
      return next(new AppError('from, to, body, and transactionPin are required', 400));
    }

    if (String(from).trim().length > 11) {
      return next(new AppError('Sender ID must not exceed 11 characters', 400));
    }

    if (gateway && !ALLOWED_GATEWAYS.has(gateway)) {
      return next(new AppError('Invalid SMS gateway selected', 400));
    }

    if (appendSender && !ALLOWED_APPEND_SENDER.has(appendSender)) {
      return next(new AppError('Invalid appendSender option', 400));
    }

    const normalizedRecipients = BulkSmsNigeriaService.normalizeRecipients(to);
    if (!normalizedRecipients.recipients.length) {
      return next(new AppError('No valid recipients found', 400));
    }

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    if (wallet.balance <= 0) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    const reference = customerReference || generateReference('SMS');
    const resolvedCallbackUrl = callbackUrl || `${SERVER_URL}/api/v1/sms/webhook/bulksmsnigeria`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'bulk_sms',
      category: 'telecom',
      amount: 0,
      totalAmount: 0,
      previousBalance: wallet.balance,
      newBalance: wallet.balance,
      status: 'pending',
      description: `Bulk SMS to ${normalizedRecipients.recipients.length} recipient(s)`,
      service: {
        provider: 'bulksmsnigeria',
        phoneNumber: normalizedRecipients.to,
      },
      metadata: {
        senderId: from,
        recipients: normalizedRecipients.recipients,
        body,
        gateway: gateway || null,
        appendSender,
        callbackUrl: resolvedCallbackUrl,
      },
      statusHistory: [{ status: 'pending', note: 'Bulk SMS request initiated', timestamp: new Date() }],
    });

    try {
      const providerResponse = await BulkSmsNigeriaService.sendSms({
        from,
        to: normalizedRecipients.recipients,
        body,
        gateway,
        appendSender,
        callbackUrl: resolvedCallbackUrl,
        customerReference: reference,
      });

      const smsCost = Number(providerResponse.data?.cost || 0);
      if (Number.isNaN(smsCost) || smsCost <= 0) {
        throw new AppError('Bulk SMS provider did not return a valid SMS cost', 500);
      }

      if (wallet.balance < smsCost) {
        transaction.status = 'failed';
        transaction.providerResponse = providerResponse.raw;
        transaction.failureReason = 'Provider accepted request but user wallet balance is insufficient for the final SMS cost';
        transaction.statusHistory.push({
          status: 'failed',
          note: transaction.failureReason,
          timestamp: new Date(),
        });
        await transaction.save();
        return next(new AppError('Insufficient wallet balance for SMS cost', 400));
      }

      await wallet.debit(smsCost, 'Bulk SMS purchase');

      transaction.amount = smsCost;
      transaction.totalAmount = smsCost;
      transaction.previousBalance = wallet.balance + smsCost;
      transaction.newBalance = wallet.balance;
      transaction.status = 'successful';
      transaction.service.orderId = providerResponse.data?.message_id || reference;
      transaction.providerResponse = providerResponse.raw;
      transaction.statusHistory.push({
        status: 'successful',
        note: providerResponse.message || 'SMS sent successfully',
        timestamp: new Date(),
      });
      await transaction.save();

      await NotificationService.create({
        user: user._id,
        title: 'Bulk SMS Sent',
        message: `Bulk SMS sent to ${providerResponse.data?.recipients_count || normalizedRecipients.recipients.length} recipient(s).`,
        type: 'bulk_sms',
        reference,
      });

      return res.status(200).json({
        status: 'success',
        message: providerResponse.message || 'Message sent successfully',
        data: {
          reference,
          messageId: providerResponse.data?.message_id || null,
          cost: smsCost,
          currency: providerResponse.data?.currency || 'NGN',
          recipientsCount: providerResponse.data?.recipients_count || normalizedRecipients.recipients.length,
          gatewayUsed: providerResponse.data?.gateway_used || null,
          provider: 'bulksmsnigeria',
        },
      });
    } catch (error) {
      transaction.status = 'failed';
      transaction.failureReason = error.message;
      transaction.statusHistory.push({
        status: 'failed',
        note: error.message || 'Bulk SMS request failed',
        timestamp: new Date(),
      });
      await transaction.save();

      logger.error('Bulk SMS send failed:', error.providerPayload || error.message);
      return next(new AppError(error.message || 'Bulk SMS request failed', error.statusCode || 500));
    }
  } catch (error) {
    next(error);
  }
};

exports.bulkSmsWebhook = async (req, res) => {
  try {
    const payload = Object.keys(req.body || {}).length ? req.body : req.query;
    const reference =
      payload.customer_reference ||
      payload.reference ||
      payload.message_id ||
      payload.messageId ||
      null;

    if (!reference) {
      logger.warn('Bulk SMS webhook received without reference', payload);
      return res.status(400).send('Missing reference');
    }

    const transaction = await Transaction.findOne({
      $or: [
        { reference },
        { 'service.orderId': reference },
      ],
    });

    if (!transaction) {
      logger.warn(`Bulk SMS transaction not found for reference: ${reference}`);
      return res.status(200).send('OK');
    }

    transaction.metadata = {
      ...(transaction.metadata || {}),
      deliveryCallback: payload,
    };
    transaction.statusHistory.push({
      status: transaction.status,
      note: 'Bulk SMS delivery callback received',
      timestamp: new Date(),
    });
    await transaction.save();

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('Bulk SMS webhook error:', error);
    return res.status(200).send('OK');
  }
};
