const PrestmitService = require('../services/prestmitService');
const ZenditService = require('../services/zenditService');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function refundToWallet(transaction, reason, amount) {
  try {
    const wallet = await Wallet.findOne({ user: transaction.user });
    if (wallet) {
      await wallet.credit(amount, reason);
    }
  } catch (err) {
    logger.error('Gift card refund failed', { ref: transaction.reference, err: err.message });
  }
}

// ─── Prestmit (Primary) ───────────────────────────────────────────────────────

exports.getPrestmitBalance = async (req, res, next) => {
  try {
    const data = await PrestmitService.getBalance();
    return res.status(200).json({ status: 'success', data });
  } catch (error) {
    return next(error);
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const data = await PrestmitService.getCategories();
    return res.status(200).json({ status: 'success', data });
  } catch (error) {
    return next(error);
  }
};

exports.getProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, category, country } = req.query;
    const data = await PrestmitService.getProducts({ page, limit, category, country });
    return res.status(200).json({ status: 'success', data });
  } catch (error) {
    return next(error);
  }
};

exports.getProduct = async (req, res, next) => {
  try {
    const data = await PrestmitService.getProduct(req.params.productId);
    return res.status(200).json({ status: 'success', data });
  } catch (error) {
    return next(error);
  }
};

exports.purchaseGiftCard = async (req, res, next) => {
  try {
    const { productId, value, quantity = 1, recipientEmail, transactionPin } = req.body;
    const user = req.user;

    if (!productId || !value) {
      return next(new AppError('productId and value are required', 400));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) return next(new AppError('Wallet not found', 404));

    // Fetch product to get NGN price
    let product;
    try {
      const productData = await PrestmitService.getProduct(productId);
      product = productData?.data || productData;
    } catch {
      return next(new AppError('Gift card product not found', 404));
    }

    // The charged amount is in NGN — platforms price in NGN then buy in USD
    const chargedAmount = Number(req.body.amountNgn || value);
    if (!chargedAmount || chargedAmount <= 0) {
      return next(new AppError('Invalid amount', 400));
    }

    if (wallet.balance < chargedAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await wallet.debit(chargedAmount, `Gift card purchase: ${productId}`);

    const reference = `GC-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'gift_card',
      category: 'giftcards',
      amount: chargedAmount,
      totalAmount: chargedAmount,
      previousBalance: wallet.balance + chargedAmount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `Gift card purchase (${productId})`,
      service: { provider: 'prestmit', orderId: null },
      metadata: { productId, value: Number(value), quantity: Number(quantity), recipientEmail },
      statusHistory: [{ status: 'pending', note: 'Gift card purchase initiated', timestamp: new Date() }],
    });

    try {
      const apiResponse = await PrestmitService.buyGiftCard({ productId, value: Number(value), quantity: Number(quantity), recipientEmail });
      const success = String(apiResponse?.status || '').toLowerCase() === 'success' ||
                      apiResponse?.data?.status === 'completed' ||
                      !!apiResponse?.data?.orderId ||
                      !!apiResponse?.data?.id;

      transaction.status = success ? 'successful' : 'failed';
      transaction.service.orderId = apiResponse?.data?.orderId || apiResponse?.data?.id || null;
      transaction.statusHistory.push({
        status: transaction.status,
        note: apiResponse?.message || (success ? 'Gift card issued' : 'Purchase failed'),
        timestamp: new Date(),
      });
      if (success) transaction.completedAt = new Date();

      if (!success) {
        await refundToWallet(transaction, 'Gift card purchase refund', chargedAmount);
      }

      await transaction.save();

      return res.status(success ? 200 : 400).json({
        status: success ? 'success' : 'error',
        message: apiResponse?.message || (success ? 'Gift card purchased successfully' : 'Purchase failed'),
        data: {
          reference,
          provider: 'prestmit',
          productId,
          value: Number(value),
          quantity: Number(quantity),
          amount: chargedAmount,
          orderId: transaction.service.orderId,
          raw: apiResponse?.data || apiResponse,
        },
      });
    } catch (error) {
      await refundToWallet(transaction, 'Gift card purchase refund', chargedAmount);
      transaction.status = 'failed';
      transaction.failureReason = error.message;
      transaction.statusHistory.push({ status: 'failed', note: error.message, timestamp: new Date() });
      await transaction.save();
      return next(new AppError('Gift card purchase failed. Please try again.', 500));
    }
  } catch (error) {
    return next(error);
  }
};

exports.getOrder = async (req, res, next) => {
  try {
    const data = await PrestmitService.getOrder(req.params.orderId);
    return res.status(200).json({ status: 'success', data });
  } catch (error) {
    return next(error);
  }
};

exports.listOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const data = await PrestmitService.listOrders({ page, limit, status });
    return res.status(200).json({ status: 'success', data });
  } catch (error) {
    return next(error);
  }
};

// ─── Zendit (Backup) ──────────────────────────────────────────────────────────

exports.getZenditProducts = async (req, res, next) => {
  try {
    const { limit = 50, offset = 0, brand, country } = req.query;
    const data = await ZenditService.listVouchers({ limit, offset, brand, country });
    return res.status(200).json({ status: 'success', provider: 'zendit', data });
  } catch (error) {
    return next(error);
  }
};

exports.getZenditProduct = async (req, res, next) => {
  try {
    const data = await ZenditService.getVoucher(req.params.offerId);
    return res.status(200).json({ status: 'success', provider: 'zendit', data });
  } catch (error) {
    return next(error);
  }
};

exports.purchaseZenditGiftCard = async (req, res, next) => {
  try {
    const { offerId, value, quantity = 1, fields = [], transactionPin } = req.body;
    const user = req.user;

    if (!offerId) {
      return next(new AppError('offerId is required', 400));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) return next(new AppError('Wallet not found', 404));

    const chargedAmount = Number(req.body.amountNgn);
    if (!chargedAmount || chargedAmount <= 0) {
      return next(new AppError('amountNgn (NGN cost) is required', 400));
    }

    if (wallet.balance < chargedAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await wallet.debit(chargedAmount, `Zendit gift card: ${offerId}`);

    const reference = `GCZ-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'gift_card',
      category: 'giftcards',
      amount: chargedAmount,
      totalAmount: chargedAmount,
      previousBalance: wallet.balance + chargedAmount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `Zendit gift card (${offerId})`,
      service: { provider: 'zendit', orderId: null },
      metadata: { offerId, value, quantity: Number(quantity), fields },
      statusHistory: [{ status: 'pending', note: 'Zendit gift card purchase initiated', timestamp: new Date() }],
    });

    try {
      const apiResponse = await ZenditService.purchaseVoucher({ offerId, value, quantity: Number(quantity), fields });
      const txId = apiResponse?.transactionId || apiResponse?.id;
      const txStatus = String(apiResponse?.purchaseStatus || apiResponse?.status || '').toLowerCase();
      const success = ['completed', 'successful', 'success', 'in progress'].includes(txStatus) || !!txId;

      transaction.status = success ? 'successful' : 'failed';
      transaction.service.orderId = txId || null;
      transaction.statusHistory.push({
        status: transaction.status,
        note: apiResponse?.message || (success ? 'Zendit gift card issued' : 'Purchase failed'),
        timestamp: new Date(),
      });
      if (success) transaction.completedAt = new Date();

      if (!success) {
        await refundToWallet(transaction, 'Zendit gift card refund', chargedAmount);
      }

      await transaction.save();

      return res.status(success ? 200 : 400).json({
        status: success ? 'success' : 'error',
        message: success ? 'Gift card purchased successfully' : 'Purchase failed',
        data: {
          reference,
          provider: 'zendit',
          offerId,
          quantity: Number(quantity),
          amount: chargedAmount,
          transactionId: txId,
          raw: apiResponse,
        },
      });
    } catch (error) {
      await refundToWallet(transaction, 'Zendit gift card refund', chargedAmount);
      transaction.status = 'failed';
      transaction.failureReason = error.message;
      transaction.statusHistory.push({ status: 'failed', note: error.message, timestamp: new Date() });
      await transaction.save();
      return next(new AppError('Gift card purchase failed. Please try again.', 500));
    }
  } catch (error) {
    return next(error);
  }
};

exports.getZenditPurchase = async (req, res, next) => {
  try {
    const data = await ZenditService.getPurchase(req.params.transactionId);
    return res.status(200).json({ status: 'success', provider: 'zendit', data });
  } catch (error) {
    return next(error);
  }
};

exports.getZenditBrands = async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const data = await ZenditService.getBrands({ limit, offset });
    return res.status(200).json({ status: 'success', provider: 'zendit', data });
  } catch (error) {
    return next(error);
  }
};
