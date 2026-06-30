const PrestmitService = require('../services/prestmitService');
const ZenditService = require('../services/zenditService');
const ReloadlyGiftCardService = require('../services/reloadlyGiftCardService');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const GiftCardProduct = require('../models/GiftCardProduct');
const GiftCardOrder = require('../models/GiftCardOrder');
const GiftCardCode = require('../models/GiftCardCode');
const FxRateService = require('../services/fxRateService');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const crypto = require('crypto');

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

const normalizeCatalogId = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const makeGiftCardProductId = (provider, productId) => `${provider}:${normalizeCatalogId(productId)}`;

const makeGiftCardReference = (prefix = 'GCO') =>
  `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

const extractProviderList = (response) => {
  if (Array.isArray(response)) return response;
  return response?.content || response?.data || response?.products || response?.items || response?.results || [];
};

const resolveCountryLabel = (...values) => {
  for (const value of values) {
    if (value == null) {
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed && trimmed.toLowerCase() !== '[object object]') {
        return trimmed;
      }
      continue;
    }

    if (typeof value === 'object') {
      const codeCandidate = [
        value.countryCode,
        value.country_code,
        value.code,
        value.isoCode,
        value.iso_code,
        value.iso2,
        value.alpha2,
        value.alpha_2,
      ].find((item) => typeof item === 'string' && item.trim());

      if (codeCandidate) {
        return codeCandidate.trim().toUpperCase();
      }

      const nameCandidate = [
        value.countryName,
        value.country_name,
        value.name,
        value.label,
        value.text,
      ].find((item) => typeof item === 'string' && item.trim());

      if (nameCandidate) {
        return nameCandidate.trim();
      }
    }
  }

  return undefined;
};

const resolveCountryDetails = (product) => {
  const countrySource = resolveCountryLabel(
    product?.country,
    product?.raw?.country,
    product?.raw?.countryCode,
    product?.raw?.country_code,
    product?.raw?.countryName,
    product?.raw?.country_name
  );

  if (!countrySource) {
    return null;
  }

  const codeCandidate = String(countrySource).trim();
  const isCountryCode = /^[A-Z]{2}$/i.test(codeCandidate);

  if (isCountryCode) {
    return {
      code: codeCandidate.toUpperCase(),
      name:
        resolveCountryLabel(
          product?.raw?.countryName,
          product?.raw?.country_name,
          product?.raw?.countryLabel,
          product?.raw?.country_label
        ) || codeCandidate.toUpperCase(),
    };
  }

  return {
    code:
      resolveCountryLabel(
        product?.raw?.countryCode,
        product?.raw?.country_code,
        product?.raw?.code,
        product?.countryCode
      )?.toUpperCase() || null,
    name: codeCandidate,
  };
};

const normalizeGiftCardProduct = (provider, rawProduct) => {
  const providerProductId = String(
    rawProduct?.id ||
    rawProduct?.offerId ||
    rawProduct?.productId ||
    rawProduct?.product_id ||
    rawProduct?.sku ||
    rawProduct?.code ||
    ''
  ).trim();

  const currency = String(rawProduct?.currency || rawProduct?.currencyCode || 'USD').toUpperCase();
  const minAmount = Number(rawProduct?.minAmount || rawProduct?.min || rawProduct?.minimum || 0) || undefined;
  const maxAmount = Number(rawProduct?.maxAmount || rawProduct?.max || rawProduct?.maximum || 0) || undefined;
  const fixedAmounts = Array.isArray(rawProduct?.fixedAmounts)
    ? rawProduct.fixedAmounts.map((amount) => Number(amount)).filter((amount) => Number.isFinite(amount))
    : Array.isArray(rawProduct?.denominations)
      ? rawProduct.denominations.map((amount) => Number(amount)).filter((amount) => Number.isFinite(amount))
      : [];

  return {
    provider,
    providerProductId,
    productId: makeGiftCardProductId(provider, providerProductId),
    name: String(rawProduct?.name || rawProduct?.brand || rawProduct?.title || providerProductId).trim(),
    description: String(rawProduct?.description || rawProduct?.summary || '').trim() || undefined,
    country: resolveCountryLabel(rawProduct?.country, rawProduct?.countryCode, rawProduct?.country_name, rawProduct?.countryName),
    currency,
    fixed: Boolean(rawProduct?.fixed || fixedAmounts.length > 0),
    fixedAmounts,
    minAmount,
    maxAmount,
    logo: rawProduct?.logo || rawProduct?.image || rawProduct?.imageUrl || rawProduct?.logoUrl || undefined,
    active: rawProduct?.active !== false && rawProduct?.status !== 'inactive',
    raw: rawProduct,
    cachedAt: new Date(),
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  };
};

const syncGiftCardCatalog = async () => {
  const providers = [
    { name: 'prestmit', service: PrestmitService },
    { name: 'zendit', service: ZenditService },
  ];

  const normalizedProducts = [];

  for (const provider of providers) {
    try {
      const response = provider.name === 'prestmit'
        ? await provider.service.getProducts({ page: 1, limit: 100 })
        : await provider.service.listVouchers({ limit: 100, offset: 0 });
      const items = extractProviderList(response);
      for (const item of items) {
        const product = normalizeGiftCardProduct(provider.name, item);
        if (product.providerProductId) {
          normalizedProducts.push(product);
        }
      }
    } catch (error) {
      logger.warn(`Gift card catalog sync skipped for ${provider.name}: ${error.message}`);
    }
  }

  if (normalizedProducts.length) {
    const bulkOps = normalizedProducts.map((product) => ({
      updateOne: {
        filter: { productId: product.productId },
        update: { $set: product },
        upsert: true,
      },
    }));
    await GiftCardProduct.bulkWrite(bulkOps, { ordered: false });
  }

  return GiftCardProduct.find({ provider: 'reloadly', active: true }).sort({ name: 1 }).lean();
};

const getGiftCardCatalog = async ({ forceRefresh = false } = {}) => {
  const cacheExpiry = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const cachedProducts = await GiftCardProduct.find({
    active: true,
    cachedAt: { $gte: cacheExpiry },
  }).sort({ name: 1 }).lean();

  if (cachedProducts.length > 0 && !forceRefresh) {
    return cachedProducts;
  }

  return syncGiftCardCatalog();
};

const serializeGiftCardProduct = (product) => ({
  id: product.productId,
  name: product.name,
  description: product.description || `${product.name} Gift Card`,
  country: resolveCountryDetails(product),
  logo: product.logo || null,
  currency: product.currency,
  fixed: product.fixed,
  fixedAmounts: product.fixedAmounts || [],
  minAmount: product.minAmount || null,
  maxAmount: product.maxAmount || null,
  provider: product.provider,
});

const serializeGiftCardOrder = (order) => ({
  id: order.reference,
  reference: order.reference,
  status: order.status,
  amount: order.amount,
  nairaAmount: order.nairaAmount ?? order.amount,
  fxRate: order.fxRate ?? (Number(order.amount) > 0
    ? Number((Number(order.nairaAmount ?? order.amount) / Number(order.amount)).toFixed(4))
    : null),
  currency: order.currency,
  product: {
    id: order.productId,
    provider: order.provider,
    providerProductId: order.providerProductId,
  },
  recipientEmail: order.recipientEmail,
  recipientName: order.recipientName,
  senderName: order.senderName,
  message: order.message,
  walletBefore: order.walletBefore ?? null,
  walletAfter: order.walletAfter ?? null,
  providerReference: order.providerReference || null,
  failureReason: order.failureReason || null,
  completedAt: order.completedAt || null,
  purchasedAt: order.purchasedAt || null,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

const serializeGiftCardCode = (code) => ({
  code: code.code || null,
  pin: code.pin || null,
  serial: code.serial || null,
  expiresAt: code.expiresAt || null,
  providerPayload: code.providerPayload || null,
});

const findCatalogProductById = async (catalogId) => {
  const normalizedId = normalizeCatalogId(catalogId);
  return GiftCardProduct.findOne({
    $or: [
      { productId: catalogId },
      { productId: normalizedId },
      { providerProductId: catalogId },
      { providerProductId: normalizedId },
    ],
  }).lean();
};

const validateGiftCardAmount = (product, amount) => {
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    throw new AppError('amount is required and must be a positive number', 400);
  }

  const fixedAmounts = Array.isArray(product.fixedAmounts) ? product.fixedAmounts.map(Number).filter(Number.isFinite) : [];
  if (fixedAmounts.length > 0) {
    if (!fixedAmounts.includes(amountNumber)) {
      throw new AppError(`amount must be one of: ${fixedAmounts.join(', ')}`, 400);
    }
    return amountNumber;
  }

  const minAmount = Number(product.minAmount || 0);
  const maxAmount = Number(product.maxAmount || 0);
  if (Number.isFinite(minAmount) && minAmount > 0 && amountNumber < minAmount) {
    throw new AppError(`amount must be at least ${minAmount}`, 400);
  }
  if (Number.isFinite(maxAmount) && maxAmount > 0 && amountNumber > maxAmount) {
    throw new AppError(`amount must not exceed ${maxAmount}`, 400);
  }

  return amountNumber;
};

const resolveGiftCardNairaAmount = (product, amount) => {
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return null;
  }

  const senderAmount = ReloadlyGiftCardService.extractSenderAmountFromProduct(product, amountNumber);
  if (Number.isFinite(senderAmount) && senderAmount > 0) {
    return senderAmount;
  }

  return amountNumber;
};

const getGiftCardNairaQuote = async (product, amount) => {
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return { nairaAmount: null, fxRate: null, source: 'invalid-amount' };
  }

  const currencyCode = String(product?.currency || 'USD').toUpperCase();
  if (currencyCode === 'NGN') {
    return {
      nairaAmount: amountNumber,
      fxRate: 1,
      source: 'local-currency',
      currencyCode,
    };
  }

  try {
    const fxQuote = await FxRateService.convert(amountNumber, currencyCode, 'NGN');
    if (Number.isFinite(fxQuote.amount) && fxQuote.amount > 0 && Number.isFinite(fxQuote.rate) && fxQuote.rate > 0) {
      return {
        nairaAmount: Number(fxQuote.amount.toFixed(2)),
        fxRate: Number(fxQuote.rate.toFixed(4)),
        source: fxQuote.source || 'fx-api',
        currencyCode,
        fxDate: fxQuote.date || null,
      };
    }
  } catch (error) {
    logger.warn('FX lookup failed for gift card', {
      currencyCode,
      amount: amountNumber,
      message: error.message,
    });
  }

  const senderAmount = ReloadlyGiftCardService.extractSenderAmountFromProduct(product, amountNumber);
  if (Number.isFinite(senderAmount) && senderAmount > 0) {
    return {
      nairaAmount: senderAmount,
      fxRate: Number((senderAmount / amountNumber).toFixed(4)),
      source: 'product-exchange-rate',
      currencyCode,
    };
  }

  return {
    nairaAmount: amountNumber,
    fxRate: 1,
    source: 'fallback-amount',
    currencyCode,
  };
};

const normalizeReloadlyProduct = (rawProduct) => {
  const providerProductId = String(
    rawProduct?.productId ||
    rawProduct?.id ||
    rawProduct?.offerId ||
    rawProduct?.sku ||
    ''
  ).trim();

  const currency = String(rawProduct?.currencyCode || rawProduct?.currency || 'USD').toUpperCase();
  const fixedAmounts = Array.isArray(rawProduct?.fixedRecipientDenominations)
    ? rawProduct.fixedRecipientDenominations.map((value) => Number(value)).filter(Number.isFinite)
    : Array.isArray(rawProduct?.fixedAmounts)
      ? rawProduct.fixedAmounts.map((value) => Number(value)).filter(Number.isFinite)
      : [];

  const minimum = Number(rawProduct?.minRecipientDenomination || rawProduct?.minAmount || rawProduct?.minimumAmount || 0);
  const maximum = Number(rawProduct?.maxRecipientDenomination || rawProduct?.maxAmount || rawProduct?.maximumAmount || 0);

  return {
    provider: 'reloadly',
    providerProductId,
    productId: makeGiftCardProductId('reloadly', providerProductId),
    name: String(rawProduct?.productName || rawProduct?.name || rawProduct?.brand || providerProductId).trim(),
    description: String(rawProduct?.description || rawProduct?.summary || '').trim() || undefined,
    country: resolveCountryLabel(rawProduct?.countryCode, rawProduct?.country, rawProduct?.country_name, rawProduct?.countryName),
    currency,
    fixed: Boolean(rawProduct?.fixed || fixedAmounts.length > 0),
    fixedAmounts,
    minAmount: Number.isFinite(minimum) && minimum > 0 ? minimum : undefined,
    maxAmount: Number.isFinite(maximum) && maximum > 0 ? maximum : undefined,
    logo: rawProduct?.logoUrls?.[0] || rawProduct?.logo || rawProduct?.image || rawProduct?.imageUrl || undefined,
    active: rawProduct?.active !== false && rawProduct?.status !== 'inactive',
    raw: rawProduct,
    cachedAt: new Date(),
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  };
};

const syncReloadlyCatalog = async () => {
  const response = await ReloadlyGiftCardService.getProducts({ page: 1, size: 200 });
  const items = extractProviderList(response);
  const normalizedProducts = [];

  for (const item of items) {
    const product = normalizeReloadlyProduct(item);
    if (product.providerProductId) {
      normalizedProducts.push(product);
    }
  }

  if (normalizedProducts.length > 0) {
    const bulkOps = normalizedProducts.map((product) => ({
      updateOne: {
        filter: { productId: product.productId },
        update: { $set: product },
        upsert: true,
      },
    }));
    await GiftCardProduct.bulkWrite(bulkOps, { ordered: false });
  }

  return GiftCardProduct.find({ active: true }).sort({ name: 1 }).lean();
};

const getReloadlyCatalog = async ({ forceRefresh = false } = {}) => {
  const cacheExpiry = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const cachedProducts = await GiftCardProduct.find({
    provider: 'reloadly',
    active: true,
    cachedAt: { $gte: cacheExpiry },
  }).sort({ name: 1 }).lean();

  if (cachedProducts.length > 0 && !forceRefresh) {
    return cachedProducts;
  }

  return syncReloadlyCatalog();
};

const findOrderForUser = async (userId, identifier) => {
  const normalizedId = normalizeCatalogId(identifier);
  return GiftCardOrder.findOne({
    user: userId,
    $or: [
      { _id: identifier },
      { reference: identifier },
      { reference: normalizedId },
    ],
  }).populate('product').lean();
};

const extractProviderCodes = (providerResponse) => {
  const source =
    providerResponse?.data ||
    providerResponse?.cards ||
    providerResponse?.giftCards ||
    providerResponse?.results ||
    providerResponse;

  if (Array.isArray(source)) return source;
  if (source && typeof source === 'object') return [source];
  return [];
};

exports.getCatalog = async (req, res, next) => {
  try {
    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const countryCode = String(req.query.countryCode || req.query.country || '').trim().toUpperCase();

    if (countryCode) {
      const response = await ReloadlyGiftCardService.getProductsByCountry(countryCode);
      const products = extractProviderList(response).map(normalizeReloadlyProduct);
      return res.status(200).json({
        status: 'success',
        data: products.map(serializeGiftCardProduct),
        countryCode,
      });
    }

    const products = await getReloadlyCatalog({ forceRefresh });
    return res.status(200).json({
      status: 'success',
      data: products.map(serializeGiftCardProduct),
    });
  } catch (error) {
    return next(error);
  }
};

exports.getCatalogProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      return next(new AppError('id is required', 400));
    }

    let product = await findCatalogProductById(id);
    if (!product) {
      await getReloadlyCatalog({ forceRefresh: true });
      product = await findCatalogProductById(id);
    }

    if (!product) {
      return next(new AppError('Gift card product not found', 404));
    }

    return res.status(200).json({
      status: 'success',
      data: serializeGiftCardProduct(product),
    });
  } catch (error) {
    return next(error);
  }
};

exports.getGiftCardQuote = async (req, res, next) => {
  try {
    const { productId, amount } = req.body;

    if (!productId) {
      return next(new AppError('productId is required', 400));
    }

    if (!amount) {
      return next(new AppError('amount is required', 400));
    }

    let product = await findCatalogProductById(productId);
    if (!product) {
      await getReloadlyCatalog({ forceRefresh: true });
      product = await findCatalogProductById(productId);
    }

    if (!product) {
      return next(new AppError('Gift card product not found', 404));
    }

    const normalizedAmount = validateGiftCardAmount(product, amount);
    const pricing = await getGiftCardNairaQuote(product, normalizedAmount);

    return res.status(200).json({
      status: 'success',
      data: {
        product: serializeGiftCardProduct(product),
        amount: normalizedAmount,
        currency: product.currency || 'USD',
        nairaAmount: pricing.nairaAmount,
        fxRate: pricing.fxRate,
        pricingSource: pricing.source,
      },
    });
  } catch (error) {
    return next(error);
  }
};

exports.createOrder = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { productId, amount, recipientEmail, recipientName, senderName, message } = req.body;

    if (!productId) {
      return next(new AppError('productId is required', 400));
    }

    if (!recipientEmail) {
      return next(new AppError('recipientEmail is required', 400));
    }

    let product = await findCatalogProductById(productId);
    if (!product) {
      await getReloadlyCatalog({ forceRefresh: true });
      product = await findCatalogProductById(productId);
    }

    if (!product) {
      return next(new AppError('Gift card product not found', 404));
    }

    const normalizedAmount = validateGiftCardAmount(product, amount);
    const pricing = await getGiftCardNairaQuote(product, normalizedAmount);
    const nairaAmount = pricing.nairaAmount;
    const fxRate = pricing.fxRate;
    const senderDisplayName = senderName || `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || 'Customer';

    const order = await GiftCardOrder.create({
      reference: makeGiftCardReference('GCO'),
      user: userId,
      product: product._id,
      productId: product.productId,
      provider: product.provider,
      providerProductId: product.providerProductId,
      amount: normalizedAmount,
      nairaAmount,
      fxRate,
      currency: product.currency || 'USD',
      recipientEmail,
      recipientName,
      senderName: senderDisplayName,
      message,
      status: 'pending',
    });

    return res.status(201).json({
      status: 'success',
      data: serializeGiftCardOrder(order.toObject()),
    });
  } catch (error) {
    return next(error);
  }
};

exports.buyGiftCard = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const {
      productId,
      amount,
      recipientEmail,
      recipientName,
      senderName,
      message,
      transactionPin,
    } = req.body;

    if (!productId) {
      return next(new AppError('productId is required', 400));
    }

    if (!recipientEmail) {
      return next(new AppError('recipientEmail is required', 400));
    }

    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
    }

    const user = await User.findById(userId).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const isPinValid = await user.compareTransactionPin(transactionPin);
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }

    let product = await findCatalogProductById(productId);
    if (!product) {
      await getReloadlyCatalog({ forceRefresh: true });
      product = await findCatalogProductById(productId);
    }

    if (!product) {
      return next(new AppError('Gift card product not found', 404));
    }

    const normalizedAmount = validateGiftCardAmount(product, amount);
    const pricing = await getGiftCardNairaQuote(product, normalizedAmount);
    const nairaAmount = pricing.nairaAmount;
    const fxRate = pricing.fxRate;
    const senderDisplayName = senderName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || 'Customer';

    const wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    const walletBefore = wallet.balance;
    let debitedWallet;
    try {
      debitedWallet = await wallet.safeDebit(nairaAmount);
    } catch (error) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    const reference = makeGiftCardReference('GCO');
    const order = await GiftCardOrder.create({
      reference,
      user: userId,
      product: product._id,
      productId: product.productId,
      provider: product.provider,
      providerProductId: product.providerProductId,
      amount: normalizedAmount,
      nairaAmount,
      fxRate,
      currency: product.currency || 'USD',
      recipientEmail,
      recipientName,
      senderName: senderDisplayName,
      message,
      status: 'processing',
      walletBefore,
      walletAfter: debitedWallet.balance,
      purchasedAt: new Date(),
    });

    const transaction = await Transaction.create({
      reference,
      user: userId,
      type: 'gift_card',
      category: 'giftcards',
      amount: nairaAmount,
      totalAmount: nairaAmount,
      previousBalance: walletBefore,
      newBalance: debitedWallet.balance,
      status: 'pending',
      description: `Gift card purchase for ${product.name}`,
      service: {
        provider: 'reloadly',
        plan: order.productId,
        orderId: null,
      },
      metadata: {
        orderReference: order.reference,
        productId: order.productId,
        providerProductId: order.providerProductId,
        recipientEmail: order.recipientEmail,
        nairaAmount,
        fxRate,
      },
      statusHistory: [
        { status: 'pending', note: 'Gift card purchase initiated', timestamp: new Date() },
      ],
    });

    try {
      const apiResponse = await ReloadlyGiftCardService.orderGiftCard({
        customIdentifier: order.reference,
        preOrder: false,
        productId: order.providerProductId,
        quantity: 1,
        recipientEmail: order.recipientEmail,
        senderName: order.senderName,
        unitPrice: order.amount,
      });

      const providerStatus = String(apiResponse?.status || '').toUpperCase();
      const providerReference = String(apiResponse?.transactionId || apiResponse?.id || '').trim() || null;
      let codeDocument = null;

      if (providerReference) {
        try {
          const redeemResponse = await ReloadlyGiftCardService.getRedeemCode(providerReference, 'v2');
          const redeemCodes = extractProviderCodes(redeemResponse);
          const firstCode = redeemCodes[0] || {};
          codeDocument = await GiftCardCode.findOneAndUpdate(
            { order: order._id },
            {
              order: order._id,
              code: firstCode.code || firstCode.pinCode || firstCode.redeemCode || null,
              pin: firstCode.pin || firstCode.pinCode || null,
              serial: firstCode.serial || null,
              expiresAt: firstCode.expiresAt || null,
              providerPayload: redeemResponse,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } catch (codeError) {
          logger.warn(`Gift card redeem code not ready for ${order.reference}: ${codeError.message}`);
        }
      }

      const orderCompleted = Boolean(codeDocument?.code || providerStatus === 'SUCCESSFUL');
      order.status = orderCompleted ? 'completed' : (['FAILED', 'REFUNDED'].includes(providerStatus) ? 'failed' : 'processing');
      order.providerReference = providerReference;
      order.providerResponse = apiResponse;
      order.fxRate = fxRate;
      if (orderCompleted) {
        order.completedAt = new Date();
      }

      transaction.status = orderCompleted ? 'successful' : order.status;
      transaction.service.orderId = providerReference;
      transaction.provider = {
        name: 'reloadly',
        providerReference,
        providerResponse: apiResponse,
      };
      transaction.completedAt = orderCompleted ? new Date() : undefined;
      transaction.metadata.codeStored = Boolean(codeDocument?.code);
      transaction.metadata.providerStatus = providerStatus;
      await transaction.save();
      await order.save();

      return res.status(200).json({
        status: 'success',
        data: {
          order: serializeGiftCardOrder(order.toObject()),
          code: codeDocument ? serializeGiftCardCode(codeDocument.toObject()) : null,
          providerStatus,
          providerReference,
          nairaAmount,
          fxRate,
        },
      });
    } catch (error) {
      await debitedWallet.credit(nairaAmount);
      order.status = 'failed';
      order.failureReason = error.message;
      await order.save();

      transaction.status = 'failed';
      transaction.failureReason = error.message;
      await transaction.save();

      return next(new AppError('Gift card purchase failed. Please try again.', 500));
    }
  } catch (error) {
    return next(error);
  }
};

exports.getOrders = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { status, page = 1, limit = 20 } = req.query;
    const query = { user: userId };

    if (status) {
      query.status = String(status).toLowerCase();
    }

    const pageNumber = Math.max(Number(page) || 1, 1);
    const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNumber - 1) * limitNumber;

    const [orders, total] = await Promise.all([
      GiftCardOrder.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNumber).lean(),
      GiftCardOrder.countDocuments(query),
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        items: orders.map(serializeGiftCardOrder),
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          pages: Math.ceil(total / limitNumber) || 0,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
};

exports.getOrder = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    const order = await GiftCardOrder.findOne({
      user: userId,
      $or: [{ _id: id }, { reference: id }],
    }).lean();

    if (!order) {
      return next(new AppError('Order not found', 404));
    }

    return res.status(200).json({
      status: 'success',
      data: serializeGiftCardOrder(order),
    });
  } catch (error) {
    return next(error);
  }
};

exports.purchaseOrder = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const order = await GiftCardOrder.findOne({
      user: userId,
      $or: [{ _id: id }, { reference: id }],
    }).populate('product');

    if (!order) {
      return next(new AppError('Order not found', 404));
    }

    if (order.status !== 'pending') {
      return next(new AppError(`Order is already ${order.status}`, 400));
    }

    const product = order.product || await findCatalogProductById(order.productId);
    if (!product) {
      return next(new AppError('Gift card product not found', 404));
    }

    const wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    const chargedAmount = Number(order.nairaAmount ?? order.amount);
    if (!Number.isFinite(chargedAmount) || chargedAmount <= 0) {
      return next(new AppError('Unable to resolve gift card Naira amount', 400));
    }

    const walletBefore = wallet.balance;
    let debitedWallet;
    try {
      debitedWallet = await wallet.safeDebit(chargedAmount);
    } catch (error) {
      return next(new AppError('Insufficient wallet balance', 400));
    }
    const reference = order.reference || makeGiftCardReference('GCO');

    const transaction = await Transaction.create({
      reference,
      user: userId,
      type: 'gift_card',
      category: 'giftcards',
      amount: chargedAmount,
      totalAmount: chargedAmount,
      previousBalance: walletBefore,
      newBalance: debitedWallet.balance,
      status: 'pending',
      description: `Gift card purchase for ${product.name}`,
      service: {
        provider: 'reloadly',
        plan: order.productId,
        orderId: null,
      },
      metadata: {
        orderReference: order.reference,
        productId: order.productId,
        providerProductId: order.providerProductId,
        recipientEmail: order.recipientEmail,
        nairaAmount: chargedAmount,
      },
      statusHistory: [
        { status: 'pending', note: 'Gift card purchase initiated', timestamp: new Date() },
      ],
    });

    order.status = 'processing';
    order.walletBefore = walletBefore;
    order.walletAfter = debitedWallet.balance;
    order.purchasedAt = new Date();
    order.nairaAmount = chargedAmount;
    await order.save();

    try {
      const apiResponse = await ReloadlyGiftCardService.orderGiftCard({
        customIdentifier: order.reference,
        preOrder: false,
        productId: order.providerProductId,
        quantity: 1,
        recipientEmail: order.recipientEmail,
        senderName: order.senderName,
        unitPrice: order.amount,
      });

      const providerStatus = String(apiResponse?.status || '').toUpperCase();
      const providerReference = String(apiResponse?.transactionId || apiResponse?.id || '').trim() || null;
      let codeDocument = null;

      if (providerReference) {
        try {
          const redeemResponse = await ReloadlyGiftCardService.getRedeemCode(providerReference, 'v2');
          const redeemCodes = extractProviderCodes(redeemResponse);
          const firstCode = redeemCodes[0] || {};
          codeDocument = await GiftCardCode.findOneAndUpdate(
            { order: order._id },
            {
              order: order._id,
              code: firstCode.code || firstCode.pinCode || firstCode.redeemCode || null,
              pin: firstCode.pin || firstCode.pinCode || null,
              serial: firstCode.serial || null,
              expiresAt: firstCode.expiresAt || null,
              providerPayload: redeemResponse,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } catch (codeError) {
          logger.warn(`Gift card redeem code not ready for ${order.reference}: ${codeError.message}`);
        }
      }

      const orderCompleted = Boolean(codeDocument?.code || providerStatus === 'SUCCESSFUL');
      order.status = orderCompleted ? 'completed' : (['FAILED', 'REFUNDED'].includes(providerStatus) ? 'failed' : 'processing');
      order.providerReference = providerReference;
      order.providerResponse = apiResponse;
      if (orderCompleted) {
        order.completedAt = new Date();
      }

      transaction.status = orderCompleted ? 'successful' : order.status;
      transaction.service.orderId = providerReference;
      transaction.provider = {
        name: 'reloadly',
        providerReference,
        providerResponse: apiResponse,
      };
      transaction.completedAt = orderCompleted ? new Date() : undefined;
      transaction.metadata.codeStored = Boolean(codeDocument?.code);
      transaction.metadata.providerStatus = providerStatus;
      await transaction.save();
      await order.save();

      return res.status(200).json({
        status: 'success',
        data: {
          order: serializeGiftCardOrder(order.toObject()),
          code: codeDocument ? serializeGiftCardCode(codeDocument.toObject()) : null,
          providerStatus,
          providerReference,
        },
      });
    } catch (error) {
      await debitedWallet.credit(order.amount);
      order.status = 'failed';
      order.failureReason = error.message;
      await order.save();

      transaction.status = 'failed';
      transaction.failureReason = error.message;
      await transaction.save();

      return next(new AppError('Gift card purchase failed. Please try again.', 500));
    }
  } catch (error) {
    return next(error);
  }
};

exports.getOrderCode = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    const order = await GiftCardOrder.findOne({
      user: userId,
      $or: [{ _id: id }, { reference: id }],
    }).lean();

    if (!order) {
      return next(new AppError('Order not found', 404));
    }

    const code = await GiftCardCode.findOne({ order: order._id }).lean();
    if (!code) {
      return next(new AppError('Gift card code not available yet', 404));
    }

    return res.status(200).json({
      status: 'success',
      data: serializeGiftCardCode(code),
    });
  } catch (error) {
    return next(error);
  }
};

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
