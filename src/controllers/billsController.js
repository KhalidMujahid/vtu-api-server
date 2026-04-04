const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const NelloBytesService = require('../services/nelloBytesService');
const PluginngService = require('../services/pluginngService');
const NotificationService = require('../services/NotificationService');
const ProviderPurchaseGuardService = require('../services/providerPurchaseGuardService');
const vtuConfig = require('../config/vtuProviders');

const SERVER_URL = process.env.SERVER_URL || 'https://api.yareemadata.com';

async function resolveBillProvider(serviceType) {
  const activeProvider = await vtuConfig.getProviderIdForService(serviceType);
  return {
    activeProvider,
    activeSource: vtuConfig.providers[activeProvider]?.source || activeProvider,
  };
}

function normalizeElectricityDiscos(rawDiscos) {
  if (Array.isArray(rawDiscos)) {
    return rawDiscos.map((item) => {
      if (typeof item === 'string') {
        return { code: item, name: item };
      }

      return {
        code: item.code || item.id || item.disco_code || item.value || item.name,
        name: item.name || item.disco || item.label || item.code || item.id,
      };
    });
  }

  if (rawDiscos && typeof rawDiscos === 'object') {
    return Object.entries(rawDiscos).map(([code, value]) => ({
      code,
      name: typeof value === 'string' ? value : value?.name || value?.disco || code,
    }));
  }

  return [];
}

function normalizePluginngTitle(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function matchPluginngProviderItem(items = [], needle = '') {
  const normalizedNeedle = normalizePluginngTitle(needle);
  if (!normalizedNeedle) return null;

  return items.find((item) => {
    const title = normalizePluginngTitle(item?.title);
    const serviceId = normalizePluginngTitle(item?.serviceID);
    return title.includes(normalizedNeedle)
      || serviceId.includes(normalizedNeedle)
      || normalizedNeedle.includes(title)
      || normalizedNeedle.includes(serviceId);
  }) || null;
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeExamTypeKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeCallbackStatus(input = '') {
  return String(input || '').trim().toUpperCase();
}

function extractNelloCallbackFields(data = {}) {
  return {
    orderId: String(data.orderid || data.orderId || '').trim(),
    requestId: String(data.requestid || data.requestId || '').trim(),
    statusCode: String(data.statuscode || data.statusCode || '').trim(),
    orderStatus: normalizeCallbackStatus(data.orderstatus || data.orderStatus),
    rawStatus: normalizeCallbackStatus(data.status),
    remark: data.orderremark || data.orderRemark || data.remark || data.status || data.message || '',
  };
}

function classifyNelloCallbackStatus({ statusCode = '', orderStatus = '', rawStatus = '' } = {}) {
  const code = String(statusCode).trim();
  const normalizedOrderStatus = normalizeCallbackStatus(orderStatus);
  const normalizedRawStatus = normalizeCallbackStatus(rawStatus);
  const statusSignals = [normalizedOrderStatus, normalizedRawStatus].filter(Boolean);

  if (code === '200' || statusSignals.includes('ORDER_COMPLETED')) {
    return 'successful';
  }

  if (code === '100' || statusSignals.includes('ORDER_RECEIVED') || statusSignals.includes('ORDER_ONHOLD')) {
    return 'pending';
  }

  const explicitFailureStatuses = new Set([
    'FAILED',
    'FAIL',
    'ERROR',
    'REJECTED',
    'CANCELLED',
    'ORDER_CANCELLED',
    'ORDER_FAILED',
    'INVALID_ACCOUNTNO',
    'INVALID_METERNO',
    'INSUFFICIENT_BALANCE',
  ]);

  if (code && !['100', '200'].includes(code)) {
    return 'failed';
  }

  if (statusSignals.some((signal) => explicitFailureStatuses.has(signal))) {
    return 'failed';
  }

  return 'unknown';
}

function resolveEducationExamType(value = '') {
  const normalized = normalizeExamTypeKey(value);
  const aliases = {
    'waec-result-checker': 'waecdirect',
    'waec-result-checker-pin': 'waecdirect',
    'waec-direct': 'waecdirect',
    'waecdirect': 'waecdirect',
    'waec-registration': 'waec-registration',
    'jamb-direct-entry': 'de',
    'direct-entry': 'de',
    'de': 'de',
    'jamb-utme-mock': 'utme-mock',
    'utme-mock': 'utme-mock',
    'jamb-utme-no-mock': 'utme-no-mock',
    'utme-no-mock': 'utme-no-mock',
    jamb: 'de',
  };
  return aliases[normalized] || normalized;
}

function extractAmountValue(input) {
  const numeric = Number(input);
  if (!Number.isNaN(numeric) && numeric > 0) return numeric;
  const text = String(input || '');
  const match = text.match(/N\s*([\d,]+(?:\.\d+)?)/i) || text.match(/([\d,]+(?:\.\d+)?)/);
  if (!match) return 0;
  const parsed = Number(String(match[1]).replace(/,/g, ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeEducationPackageItems(raw) {
  const items = [];

  const pushCandidate = (item, fallbackCode = '') => {
    if (item === null || item === undefined) return;
    if (typeof item === 'string') {
      const combined = `${fallbackCode || ''} ${item}`.trim();
      items.push({ code: fallbackCode || item, title: item, amount: extractAmountValue(combined), raw: item });
      return;
    }
    if (typeof item !== 'object') return;

    const code = String(
      item.code
      || item.product_code
      || item.PRODUCT_CODE
      || item.examtype
      || item.examType
      || item.id
      || item.key
      || item.planCode
      || item.providerPlanId
      || fallbackCode
      || ''
    ).trim();
    const title = String(
      item.title
      || item.product_description
      || item.PRODUCT_DESCRIPTION
      || item.name
      || item.description
      || item.plan
      || item.package
      || code
    ).trim();
    const amount = extractAmountValue(
      item.amount
      || item.product_amount
      || item.PRODUCT_AMOUNT
      || item.price
      || item.cost
      || item.sellingPrice
      || item.amountcharged
      || `${title} ${code}`
      || JSON.stringify(item)
    );
    items.push({ code, title, amount, raw: item });
  };

  if (Array.isArray(raw)) {
    raw.forEach((item) => pushCandidate(item));
    return items;
  }

  if (raw && typeof raw === 'object') {
    ['data', 'packages', 'results', 'list'].forEach((key) => {
      if (Array.isArray(raw[key])) {
        raw[key].forEach((item) => pushCandidate(item));
      }
    });

    Object.entries(raw).forEach(([key, value]) => {
      if (Array.isArray(value)) return;
      pushCandidate(value, key);
    });
  }

  return items;
}

async function resolveEducationAmountByProvider({ activeProvider, activeSource, examTypeInput, resolvedExamType }) {
  if (activeProvider === 'pluginng' || activeSource === 'pluginng') {
    const providers = await PluginngService.getExamProviders();
    const matchedExam = matchPluginngProviderItem(providers, examTypeInput) || matchPluginngProviderItem(providers, resolvedExamType);
    if (!matchedExam) {
      throw new AppError('Exam type not found on Pluginng', 404);
    }

    const amount = extractAmountValue(
      matchedExam.amount
      || matchedExam.price
      || matchedExam.variation_amount
      || matchedExam.title
    );
    if (!amount) {
      throw new AppError('Unable to determine exam amount from Pluginng', 400);
    }

    return {
      unitAmount: amount,
      displayName: matchedExam.title || examTypeInput || resolvedExamType,
      pluginngExam: matchedExam,
    };
  }

  if (activeProvider === 'clubkonnect' || activeSource === 'nellobytes') {
    const defaultAmountMap = {
      waecdirect: 3900,
      'waec-registration': 2000,
      de: 2000,
      'utme-mock': 2000,
      'utme-no-mock': 2000,
    };
    const fallbackAmount = Number(
      process.env.CLUBKONNECT_EDUPIN_DEFAULT_AMOUNT || defaultAmountMap[resolvedExamType] || 2000
    );

    const isJamb = ['de', 'utme-mock', 'utme-no-mock'].includes(resolvedExamType) || resolvedExamType.includes('jamb');
    let packageItems = [];
    try {
      const packagesRaw = isJamb
        ? await NelloBytesService.getJAMBPackages()
        : await NelloBytesService.getWAECPackages();
      packageItems = normalizeEducationPackageItems(packagesRaw);
    } catch (error) {
      logger.warn(
        `ClubKonnect package list lookup failed for '${resolvedExamType}'. Falling back to ${fallbackAmount}. Reason: ${error.message}`
      );
      return {
        unitAmount: fallbackAmount,
        displayName: examTypeInput || resolvedExamType,
        pluginngExam: null,
      };
    }

    const targetKeys = [
      normalizeExamTypeKey(examTypeInput),
      normalizeExamTypeKey(resolvedExamType),
      normalizeExamTypeKey(String(examTypeInput || '').replace(/\s+/g, '')),
      normalizeExamTypeKey(String(resolvedExamType || '').replace(/\s+/g, '')),
    ].filter(Boolean);

    const matched = packageItems.find((item) => {
      const codeKey = normalizeExamTypeKey(item.code || '');
      const titleKey = normalizeExamTypeKey(item.title || '');
      return targetKeys.some((target) => (
        codeKey === target
        || titleKey === target
        || codeKey.includes(target)
        || titleKey.includes(target)
        || target.includes(codeKey)
        || target.includes(titleKey)
      ));
    });

    if (!matched || !matched.amount) {
      logger.warn(
        `Unable to determine education amount from ClubKonnect package list for '${resolvedExamType}'. Falling back to ${fallbackAmount}.`
      );
      return {
        unitAmount: fallbackAmount,
        displayName: examTypeInput || resolvedExamType,
        pluginngExam: null,
      };
    }

    return {
      unitAmount: matched.amount,
      displayName: matched.title || matched.code || examTypeInput || resolvedExamType,
      pluginngExam: null,
    };
  }

  throw new AppError(`Education PIN provider ${activeProvider} is not implemented`, 400);
}

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

exports.getElectricityDiscos = async (req, res, next) => {
  try {
    const { activeProvider, activeSource } = await resolveBillProvider('electricity');

    if (activeProvider === 'pluginng' || activeSource === 'pluginng') {
      const providers = await PluginngService.getElectricityProviders();
      const discos = providers.map((item) => ({
        code: item.serviceID || item.title,
        name: item.title || item.serviceID,
        serviceID: item.serviceID || item.title,
        subcategoryId: item.subcategory_id ? String(item.subcategory_id) : null,
      }));

      return res.status(200).json({
        status: 'success',
        data: {
          discos,
          raw: providers,
        },
        provider: activeProvider,
        source: 'pluginng',
      });
    }

    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Electricity disco listing is not implemented for ${activeProvider}`, 400));
    }

    const electricityDiscos = await NelloBytesService.getElectricityDiscos();
    const discos = electricityDiscos.discos || normalizeElectricityDiscos(electricityDiscos);

    return res.status(200).json({
      status: 'success',
      data: {
        discos,
        raw: electricityDiscos.raw || electricityDiscos,
      },
      provider: activeProvider,
      source: 'nellobytes',
    });
  } catch (error) {
    logger.error(`NelloBytes electricity discos error: ${error.message}`);
    next(new AppError(error.message || 'Unable to fetch electricity discos', 500));
  }
};

exports.verifyElectricityCustomer = async (req, res, next) => {
  try {
    const { meterNumber, disco, meterType = 'prepaid' } = req.body;
    
    if (!meterNumber || !disco) {
      return next(new AppError('Please provide meter number and DISCO', 400));
    }
    
    const { activeProvider, activeSource } = await resolveBillProvider('electricity');

    if (activeProvider === 'clubkonnect' || activeSource === 'nellobytes') {
      try {
        const result = await NelloBytesService.verifyElectricityMeter({
          electricCompany: disco,
          meterNo: meterNumber,
          meterType,
        });
        
        return res.status(200).json({
          status: 'success',
          message: 'Customer verification successful',
          data: {
            meterNumber,
            disco,
            meterType,
            customerName: result.customerName,
            verified: result.valid,
            provider: activeProvider,
          },
        });
      } catch (error) {
        logger.error(`NelloBytes electricity verification error: ${error.message}`);
        return next(new AppError('Unable to verify meter number', 500));
      }
    }

    if (activeProvider === 'pluginng' || activeSource === 'pluginng') {
      const providers = await PluginngService.getElectricityProviders();
      const matched = matchPluginngProviderItem(providers, disco);
      if (!matched) {
        return next(new AppError('Electricity provider not found on Pluginng', 404));
      }

      const verifyResult = await PluginngService.verifyCard({
        plan: matched.serviceID || matched.title,
        cardno: meterNumber,
        type: meterType,
      });

      const verificationData = verifyResult?.data || verifyResult || {};
      return res.status(200).json({
        status: 'success',
        message: 'Customer verification request sent',
        data: {
          meterNumber,
          disco: matched.title || disco,
          meterType,
          customerName:
            verificationData.customer_name
            || verificationData.name
            || verificationData.customerName
            || null,
          verified:
            Boolean(verificationData.success)
            || Boolean(verificationData.valid)
            || Boolean(verificationData.status)
            || true,
          provider: activeProvider,
          raw: verifyResult,
        },
      });
    }
    
    return next(new AppError(`Electricity verification is not implemented for ${activeProvider}`, 400));
  } catch (error) {
    next(error);
  }
};

exports.purchaseElectricity = async (req, res, next) => {
  try {
    const { meterNumber, disco, amount, phoneNumber, meterType = 'prepaid', transactionPin } = req.body;
    const parsedAmount = Number(amount);

    const { activeProvider, activeSource } = await resolveBillProvider('electricity');

    if (!meterNumber || !disco || !amount || !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }

    if (Number.isNaN(parsedAmount) || parsedAmount < 500 || parsedAmount > 100000) {
      return next(new AppError('Amount must be between NGN 500 and NGN 100,000', 400));
    }

    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);

    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    if (wallet.balance < parsedAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await ProviderPurchaseGuardService.assertSufficientProviderBalance(
      activeProvider,
      parsedAmount,
      { serviceType: 'electricity', meterNumber, disco }
    );

    await wallet.debit(parsedAmount, `Electricity bill payment: ${disco}`);

    const reference = `ELEC-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/bills/webhook/nellobytes`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'electricity',
      category: 'bills',
      amount: parsedAmount,
      totalAmount: parsedAmount,
      previousBalance: wallet.balance + parsedAmount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${String(disco).toUpperCase()} electricity bill payment of NGN ${amount} for meter ${meterNumber}`,
      service: {
        provider: activeProvider,
        disco,
        meterNumber,
        meterType,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: `Payment initiated via ${activeProvider}`, timestamp: new Date() }],
    });

    try {
      if (activeProvider === 'pluginng' || activeSource === 'pluginng') {
        const providers = await PluginngService.getElectricityProviders();
        const matched = matchPluginngProviderItem(providers, disco);
        if (!matched) {
          throw new Error('Electricity provider not found on Pluginng');
        }

        const apiResponse = await PluginngService.purchaseElectricity({
          plan: matched.title || disco,
          phoneNumber: phoneNumber || user.phoneNumber,
          amount: parsedAmount,
          cardno: meterNumber,
          variationCode: String(meterType).toLowerCase() === 'postpaid' ? 'Postpaid' : 'Prepaid',
          serviceID: matched.serviceID || matched.title || disco,
          customReference: reference,
        });

        transaction.status = apiResponse.pending ? 'pending' : (apiResponse.success ? 'successful' : 'failed');
        transaction.service.orderId = apiResponse.orderId || reference;
        transaction.providerResponse = apiResponse.raw || apiResponse;
        transaction.statusHistory.push({
          status: transaction.status,
          note: apiResponse.note || `Pluginng status: ${apiResponse.status || 'unknown'}`,
          timestamp: new Date(),
        });
        await transaction.save();

        if (transaction.status === 'failed') {
          await refundTransactionToWallet(transaction, 'Electricity payment refund', parsedAmount);
          await transaction.save();
          throw new Error(apiResponse.note || 'Payment failed');
        }

        return res.status(200).json({
          status: 'success',
          message: transaction.status === 'successful'
            ? 'Electricity bill payment successful'
            : 'Electricity bill payment initiated',
          data: {
            reference,
            orderId: apiResponse.orderId || reference,
            meterNumber,
            disco: matched.title || disco,
            amount: parsedAmount,
            status: transaction.status,
            provider: activeProvider,
          },
        });
      }

      if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
        throw new Error(`Electricity provider ${activeProvider} is not implemented`);
      }

      const apiResponse = await NelloBytesService.payElectricityBill({
        electricCompany: disco,
        meterNo: meterNumber,
        meterType,
        amount: parsedAmount,
        phoneNo: phoneNumber || user.phoneNumber,
        requestId: reference,
        callBackURL: callbackUrl,
      });

      if (apiResponse.success || apiResponse.statusCode === '100' || apiResponse.statusCode === '200') {
        const providerStatus = String(apiResponse.status || '').toUpperCase();
        const shouldMarkSuccessful = apiResponse.statusCode === '200' || providerStatus === 'ORDER_COMPLETED';
        transaction.status = shouldMarkSuccessful ? 'successful' : 'pending';
        transaction.service.orderId = apiResponse.orderId;
        transaction.service.requestId = apiResponse.requestId || reference;
        transaction.service.callbackUrl = callbackUrl;
        transaction.providerResponse = apiResponse.response;
        transaction.statusHistory.push({
          status: transaction.status,
          note: shouldMarkSuccessful
            ? `Order completed: ${apiResponse.orderId}`
            : `Order received: ${apiResponse.orderId}`,
          timestamp: new Date(),
        });
        await transaction.save();

        return res.status(200).json({
          status: 'success',
          message: shouldMarkSuccessful ? 'Electricity bill payment successful' : 'Electricity bill payment initiated',
          data: {
            reference,
            orderId: apiResponse.orderId,
            requestId: apiResponse.requestId || reference,
            meterNumber,
            disco,
            amount: parsedAmount,
            status: transaction.status,
          },
        });
      }

      throw new Error(apiResponse.response?.status || 'Payment failed');
    } catch (apiErr) {
      await refundTransactionToWallet(transaction, 'Electricity payment refund', parsedAmount);

      transaction.status = 'failed';
      transaction.failureReason = apiErr.message;
      transaction.statusHistory.push({ status: 'failed', note: apiErr.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`Electricity payment failed: ${apiErr.message}`);
      return next(new AppError(`Payment failed: ${apiErr.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

exports.queryElectricityTransaction = async (req, res, next) => {
  try {
    const { orderId, requestId } = req.body;
    const { activeProvider, activeSource } = await resolveBillProvider('electricity');

    if (!orderId && !requestId) {
      return next(new AppError('Please provide orderId or requestId', 400));
    }

    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Electricity transaction query is not implemented for ${activeProvider}`, 400));
    }

    const queryResult = await NelloBytesService.queryElectricityTransaction({ orderId, requestId });
    return res.status(200).json({
      status: 'success',
      data: {
        provider: activeProvider,
        orderId: queryResult.orderId,
        requestId: requestId || null,
        providerStatusCode: queryResult.statusCode,
        providerStatus: queryResult.status,
        providerRemark: queryResult.remark,
        providerDate: queryResult.date,
        raw: queryResult.response,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelElectricityTransaction = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const { activeProvider, activeSource } = await resolveBillProvider('electricity');

    if (!orderId) {
      return next(new AppError('Please provide orderId', 400));
    }

    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Electricity transaction cancel is not implemented for ${activeProvider}`, 400));
    }

    const cancelResult = await NelloBytesService.cancelElectricityTransaction(orderId);
    return res.status(200).json({
      status: cancelResult.success ? 'success' : 'error',
      data: {
        provider: activeProvider,
        orderId: cancelResult.orderId || orderId,
        providerStatus: cancelResult.status,
        raw: cancelResult.response,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getCablePlans = async (req, res, next) => {
  try {
    const { provider } = req.query;
    const { activeProvider, activeSource } = await resolveBillProvider('cable');

    if (activeProvider === 'clubkonnect' || activeSource === 'nellobytes') {
      const plans = await NelloBytesService.getCablePackages(provider);
      return res.status(200).json({
        status: 'success',
        data: plans,
        provider: activeProvider,
        source: 'nellobytes',
      });
    }

    if (activeProvider === 'pluginng' || activeSource === 'pluginng') {
      if (!provider) {
        return next(new AppError('Provider is required for Pluginng cable plans', 400));
      }

      const plans = await PluginngService.fetchBouquet(String(provider).toLowerCase());
      return res.status(200).json({
        status: 'success',
        data: plans,
        provider: activeProvider,
        source: 'pluginng',
      });
    }

    return next(new AppError(`Cable plan listing is not implemented for ${activeProvider}`, 400));
  } catch (error) {
    next(error);
  }
};

exports.purchaseCableTV = async (req, res, next) => {
  try {
    const { smartCardNumber, provider, planId, months = 1, transactionPin } = req.body;
    const { activeProvider } = await resolveBillProvider('cable');
    
    if (!smartCardNumber || !provider || !planId || !transactionPin) {
      return next(new AppError('Please provide all required fields', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }
    
    let totalAmount;
    
    
    if (activeProvider === 'clubkonnect') {
      let transaction;
      try {
        
        const verifyResult = await NelloBytesService.verifyCableSmartCard({
          cableTV: provider,
          smartCardNo: smartCardNumber,
        });
        
        if (!verifyResult.valid) {
          return next(new AppError('Invalid smartcard number', 400));
        }
        
        
        const packages = await NelloBytesService.getCablePackages(provider);
        plan = packages[provider]?.find(p => p.code === planId || p.variation_code === planId);
        
        if (!plan) {
          return next(new AppError('Plan not found', 404));
        }
        
        totalAmount = plan.sellingPrice * months;
        
        if (wallet.balance < totalAmount) {
          return next(new AppError('Insufficient wallet balance', 400));
        }

        await ProviderPurchaseGuardService.assertSufficientProviderBalance(
          activeProvider,
          totalAmount,
          { serviceType: 'cable_tv', provider, smartCardNumber }
        );
        
        
        await wallet.debit(totalAmount, `Cable TV: ${provider}`);
        
        const reference = `CABLE-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const callbackUrl = `${SERVER_URL}/api/v1/bills/webhook/nellobytes`;
        
        transaction = await Transaction.create({
          reference,
          user: user._id,
          type: 'cable_tv',
          category: 'bills',
          amount: totalAmount,
          totalAmount,
          previousBalance: wallet.balance + totalAmount,
          newBalance: wallet.balance,
          status: 'pending',
          description: `${provider.toUpperCase()} subscription for ${smartCardNumber}`,
          service: {
            provider: activeProvider,
            cableProvider: provider,
            smartCardNumber,
            package: planId,
            customerName: verifyResult.customerName,
            months,
          },
          statusHistory: [{ status: 'pending', note: `Subscription initiated via ${activeProvider}`, timestamp: new Date() }],
        });
        
        
        const apiResponse = await NelloBytesService.purchaseCableTV({
          cableTV: provider,
          packageCode: planId,
          smartCardNo: smartCardNumber,
          phoneNo: user.phoneNumber,
          requestId: reference,
          callBackURL: callbackUrl,
        });
        
        if (apiResponse.success || apiResponse.statusCode === '100' || apiResponse.statusCode === '200') {
          const providerStatus = String(apiResponse.status || '').toUpperCase();
          const shouldMarkSuccessful = apiResponse.statusCode === '200' || providerStatus === 'ORDER_COMPLETED';
          transaction.status = shouldMarkSuccessful ? 'successful' : 'pending';
          transaction.service.orderId = apiResponse.orderId;
          transaction.service.requestId = apiResponse.requestId || reference;
          transaction.service.callbackUrl = callbackUrl;
          transaction.providerResponse = apiResponse.response;
          transaction.statusHistory.push({
            status: transaction.status,
            note: shouldMarkSuccessful
              ? `Order completed: ${apiResponse.orderId}`
              : `Order received: ${apiResponse.orderId}`,
            timestamp: new Date()
          });
          await transaction.save();
          
          return res.status(200).json({
            status: 'success',
            message: shouldMarkSuccessful ? 'Cable TV subscription successful' : 'Cable TV subscription initiated',
            data: {
              reference,
              orderId: apiResponse.orderId,
              requestId: apiResponse.requestId || reference,
              smartCardNumber,
              provider,
              customerName: verifyResult.customerName,
              months,
              amount: totalAmount,
              status: transaction.status,
            },
          });
        }
        
        throw new Error(apiResponse.response?.status || 'Purchase failed');
        
      } catch (error) {
        
        if (transaction) {
          await refundTransactionToWallet(transaction, 'Cable TV refund', totalAmount);
          transaction.status = 'failed';
          transaction.failureReason = error.message;
          transaction.statusHistory.push({
            status: 'failed',
            note: error.message || 'Cable TV purchase failed',
            timestamp: new Date(),
          });
          await transaction.save();
        }
        
        logger.error(`Cable TV purchase failed: ${error.message}`);
        return next(new AppError(`Purchase failed: ${error.message}`, 500));
      }
    }

    if (activeProvider === 'pluginng') {
      let transaction;
      try {
        const providerKey = String(provider || '').toLowerCase();
        const verifyResult = await PluginngService.verifyCard({
          plan: providerKey,
          cardno: smartCardNumber,
        });

        const bouquet = await PluginngService.fetchBouquet(providerKey);
        const variants = Array.isArray(bouquet?.data) ? bouquet.data : [];
        const selectedPlan = variants.find((item) => (
          String(item?.variation_code || '').toLowerCase() === String(planId || '').toLowerCase()
        ));

        if (!selectedPlan) {
          return next(new AppError('Plan not found on Pluginng', 404));
        }

        const unitAmount = Number(selectedPlan?.variation_amount || selectedPlan?.amount || 0);
        if (!unitAmount || Number.isNaN(unitAmount)) {
          return next(new AppError('Unable to determine plan amount from Pluginng', 400));
        }

        totalAmount = unitAmount * Number(months || 1);
        if (wallet.balance < totalAmount) {
          return next(new AppError('Insufficient wallet balance', 400));
        }

        await ProviderPurchaseGuardService.assertSufficientProviderBalance(
          activeProvider,
          totalAmount,
          { serviceType: 'cable_tv', provider, smartCardNumber }
        );

        await wallet.debit(totalAmount, `Cable TV: ${provider}`);

        const reference = `CABLE-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        transaction = await Transaction.create({
          reference,
          user: user._id,
          type: 'cable_tv',
          category: 'bills',
          amount: totalAmount,
          totalAmount,
          previousBalance: wallet.balance + totalAmount,
          newBalance: wallet.balance,
          status: 'pending',
          description: `${String(provider).toUpperCase()} subscription for ${smartCardNumber}`,
          service: {
            provider: activeProvider,
            cableProvider: provider,
            smartCardNumber,
            package: planId,
            customerName: verifyResult?.data?.customer_name || verifyResult?.data?.name || null,
            months,
          },
          statusHistory: [{ status: 'pending', note: `Subscription initiated via ${activeProvider}`, timestamp: new Date() }],
        });

        const apiResponse = await PluginngService.purchaseCable({
          plan: providerKey,
          phoneNumber: user.phoneNumber,
          amount: totalAmount,
          cardno: smartCardNumber,
          variationCode: selectedPlan.variation_code,
          customReference: reference,
        });

        transaction.status = apiResponse.pending ? 'pending' : (apiResponse.success ? 'successful' : 'failed');
        transaction.service.orderId = apiResponse.orderId || reference;
        transaction.providerResponse = apiResponse.raw || apiResponse;
        transaction.statusHistory.push({
          status: transaction.status,
          note: apiResponse.note || `Pluginng status: ${apiResponse.status || 'unknown'}`,
          timestamp: new Date(),
        });
        await transaction.save();

        if (transaction.status === 'failed') {
          await refundTransactionToWallet(transaction, 'Cable TV refund', totalAmount);
          await transaction.save();
          throw new Error(apiResponse.note || 'Purchase failed');
        }

        return res.status(200).json({
          status: 'success',
          message: transaction.status === 'successful'
            ? 'Cable TV subscription successful'
            : 'Cable TV subscription initiated',
          data: {
            reference,
            orderId: apiResponse.orderId || reference,
            smartCardNumber,
            provider,
            customerName: verifyResult?.data?.customer_name || verifyResult?.data?.name || null,
            months,
            amount: totalAmount,
            status: transaction.status,
            providerSource: activeProvider,
          },
        });
      } catch (error) {
        if (transaction) {
          await refundTransactionToWallet(transaction, 'Cable TV refund', totalAmount);
          transaction.status = 'failed';
          transaction.failureReason = error.message;
          transaction.statusHistory.push({
            status: 'failed',
            note: error.message || 'Cable TV purchase failed',
            timestamp: new Date(),
          });
          await transaction.save();
        }
        logger.error(`Pluginng cable purchase failed: ${error.message}`);
        return next(new AppError(`Purchase failed: ${error.message}`, 500));
      }
    }
    
    return next(new AppError(`Cable purchase is not implemented for ${activeProvider}`, 400));
  } catch (error) {
    next(error);
  }
};

exports.queryCableTransaction = async (req, res, next) => {
  try {
    const { orderId, requestId } = req.body;
    const { activeProvider, activeSource } = await resolveBillProvider('cable');

    if (!orderId && !requestId) {
      return next(new AppError('Please provide orderId or requestId', 400));
    }

    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Cable transaction query is not implemented for ${activeProvider}`, 400));
    }

    const queryResult = await NelloBytesService.queryCableTransaction({ orderId, requestId });
    return res.status(200).json({
      status: 'success',
      data: {
        provider: activeProvider,
        orderId: queryResult.orderId,
        requestId: requestId || null,
        providerStatusCode: queryResult.statusCode,
        providerStatus: queryResult.status,
        providerRemark: queryResult.remark,
        providerDate: queryResult.date,
        raw: queryResult.response,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelCableTransaction = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const { activeProvider, activeSource } = await resolveBillProvider('cable');

    if (!orderId) {
      return next(new AppError('Please provide orderId', 400));
    }

    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Cable transaction cancel is not implemented for ${activeProvider}`, 400));
    }

    const cancelResult = await NelloBytesService.cancelCableTransaction(orderId);
    return res.status(200).json({
      status: cancelResult.success ? 'success' : 'error',
      data: {
        provider: activeProvider,
        orderId: cancelResult.orderId || orderId,
        providerStatus: cancelResult.status,
        raw: cancelResult.response,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.purchaseEducationPin = async (req, res, next) => {
  try {
    const { examType, quantity = 1, transactionPin, phoneNumber, examNumber } = req.body;
    
    if (!examType || !transactionPin) {
      return next(new AppError('Please provide exam type and transaction PIN', 400));
    }

    if (Number(quantity) !== 1) {
      return next(new AppError('ClubKonnect education PIN purchase currently supports quantity 1 only', 400));
    }

    const { activeProvider, activeSource } = await resolveBillProvider('education');

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const resolvedExamType = resolveEducationExamType(examType);
    const { unitAmount, displayName, pluginngExam } = await resolveEducationAmountByProvider({
      activeProvider,
      activeSource,
      examTypeInput: examType,
      resolvedExamType,
    });

    const totalAmount = Number(unitAmount) * Number(quantity || 1);
    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    if (wallet.balance < totalAmount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await ProviderPurchaseGuardService.assertSufficientProviderBalance(
      activeProvider,
      totalAmount,
      { serviceType: 'education_pin', examType: resolvedExamType, quantity: 1 }
    );

    await wallet.debit(totalAmount, `Education PIN purchase: ${displayName}`);

    const reference = `EDU-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/bills/webhook/nellobytes`;
    const normalizedExamType = resolvedExamType;
    const isJamb = normalizedExamType.includes('jamb') || ['de', 'utme-mock', 'utme-no-mock'].includes(normalizedExamType);
    const candidateCardNumber = examNumber || phoneNumber || user.phoneNumber;
    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'education_pin',
      category: 'education',
      amount: totalAmount,
      totalAmount,
      previousBalance: wallet.balance + totalAmount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${displayName} PIN`,
      service: {
        provider: activeProvider,
        plan: displayName,
        phoneNumber: phoneNumber || user.phoneNumber,
      },
      metadata: { examType: normalizedExamType, examTypeInput: examType, quantity: 1, unitPrice: Number(unitAmount), examNumber: candidateCardNumber },
      statusHistory: [{ status: 'pending', note: `Education PIN purchase initiated via ${activeProvider}`, timestamp: new Date() }],
    });

    try {
      if (activeProvider === 'pluginng' || activeSource === 'pluginng') {
        const matchedExam = pluginngExam || null;
        if (!matchedExam) {
          throw new Error('Exam type not found on Pluginng');
        }

        const verifyResult = await PluginngService.verifyCard({
          plan: matchedExam.title || examType,
          cardno: candidateCardNumber,
        });

        const purchaseResult = await PluginngService.purchaseExam({
          plan: matchedExam.title || examType,
          phoneNumber: phoneNumber || user.phoneNumber,
          cardno: candidateCardNumber,
          variationCode: matchedExam.variation_code || matchedExam.variationCode || normalizedExamType,
          customReference: reference,
        });

        transaction.service.orderId = purchaseResult.orderId || reference;
        transaction.providerResponse = purchaseResult.raw || purchaseResult;

        if (purchaseResult.success && !purchaseResult.pending) {
          transaction.status = 'successful';
          transaction.statusHistory.push({
            status: 'successful',
            note: purchaseResult.note || 'Education PIN delivered successfully',
            timestamp: new Date(),
          });
        } else if (purchaseResult.pending) {
          transaction.status = 'pending';
          transaction.statusHistory.push({
            status: 'pending',
            note: purchaseResult.note || 'Order received by provider',
            timestamp: new Date(),
          });
        } else {
          throw new Error(purchaseResult.note || 'Education PIN purchase failed');
        }
        await transaction.save();

        return res.status(200).json({
          status: 'success',
          message: transaction.status === 'successful'
            ? 'Education PIN purchased successfully'
            : 'Education PIN purchase initiated',
          data: {
            reference,
            orderId: purchaseResult.orderId || reference,
            examType: matchedExam.title || normalizedExamType,
            amount: totalAmount,
            cardDetails: verifyResult?.data || null,
            provider: activeProvider,
            status: transaction.status,
          },
        });
      }

      if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
        throw new Error(`Education PIN provider ${activeProvider} is not implemented`);
      }

      const providerResponse = isJamb
        ? await NelloBytesService.buyJAMPEPIN({
            examType: normalizedExamType,
            phoneNo: phoneNumber || user.phoneNumber,
            requestId: reference,
            callBackURL: callbackUrl,
          })
        : await NelloBytesService.buyWAECEPIN({
            examType: normalizedExamType,
            phoneNo: phoneNumber || user.phoneNumber,
            requestId: reference,
            callBackURL: callbackUrl,
          });

      transaction.service.orderId = providerResponse.orderId || reference;
      transaction.service.requestId = providerResponse.requestId || reference;
      transaction.service.callbackUrl = callbackUrl;
      transaction.providerResponse = providerResponse.response;

      const providerStatus = String(providerResponse.status || '').toUpperCase();
      const isCompleted = providerResponse.statusCode === '200' || providerStatus === 'ORDER_COMPLETED';
      const isReceived = providerResponse.statusCode === '100' || providerStatus === 'ORDER_RECEIVED' || providerStatus === 'ORDER_ONHOLD';

      if (isCompleted) {
        transaction.status = 'successful';
        transaction.statusHistory.push({
          status: 'successful',
          note: providerResponse.response?.remark || 'Education PIN delivered successfully',
          timestamp: new Date(),
        });
      } else if (isReceived) {
        transaction.status = 'pending';
        transaction.statusHistory.push({
          status: 'pending',
          note: providerResponse.response?.remark || 'Order received by provider',
          timestamp: new Date(),
        });
      } else {
        throw new Error(providerResponse.response?.status || 'Education PIN purchase failed');
      }
      await transaction.save();

      return res.status(200).json({
        status: 'success',
        message: isCompleted
          ? 'Education PIN purchased successfully'
          : 'Education PIN purchase initiated',
        data: {
          reference,
          orderId: providerResponse.orderId || reference,
          requestId: providerResponse.requestId || reference,
          examType: normalizedExamType,
          amount: totalAmount,
          cardDetails: providerResponse.cardDetails || null,
          provider: activeProvider,
          status: transaction.status,
        },
      });
    } catch (error) {
      await refundTransactionToWallet(transaction, 'Education PIN refund', totalAmount);

      transaction.status = 'failed';
      transaction.failureReason = error.message;
      transaction.statusHistory.push({
        status: 'failed',
        note: error.message || 'Education PIN purchase failed',
        timestamp: new Date(),
      });
      await transaction.save();

      logger.error(`Education PIN purchase failed: ${error.message}`);
      return next(new AppError(`Education PIN purchase failed: ${error.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

exports.verifyEducationProfile = async (req, res, next) => {
  try {
    const { examType, profileId } = req.body;
    const { activeProvider, activeSource } = await resolveBillProvider('education');

    if (!examType || !profileId) {
      return next(new AppError('Please provide examType and profileId', 400));
    }

    const normalizedExamType = resolveEducationExamType(examType);
    const isJamb = normalizedExamType.includes('jamb') || ['de', 'utme-mock', 'utme-no-mock'].includes(normalizedExamType);
    if (!isJamb) {
      return next(new AppError('Profile verification is currently supported for JAMB exam types only', 400));
    }

    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Education profile verification is not implemented for ${activeProvider}`, 400));
    }

    const result = await NelloBytesService.verifyJAMBProfile({
      examType: normalizedExamType,
      profileId,
    });

    return res.status(200).json({
      status: 'success',
      data: {
        examType: normalizedExamType,
        profileId,
        customerName: result.customerName || null,
        verified: Boolean(result.valid),
        provider: activeProvider,
        raw: result.response,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.queryEducationTransaction = async (req, res, next) => {
  try {
    const { orderId, requestId } = req.body;
    const { activeProvider, activeSource } = await resolveBillProvider('education');

    if (!orderId && !requestId) {
      return next(new AppError('Please provide orderId or requestId', 400));
    }

    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Education transaction query is not implemented for ${activeProvider}`, 400));
    }

    const result = await NelloBytesService.queryWAECTransaction({ orderId, requestId });
    return res.status(200).json({
      status: 'success',
      data: {
        provider: activeProvider,
        orderId: result.orderId,
        requestId: result.requestId || requestId || null,
        providerStatusCode: result.statusCode,
        providerStatus: result.status,
        providerRemark: result.remark,
        providerDate: result.date,
        cardDetails: result.cardDetails || null,
        raw: result.response,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelEducationTransaction = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const { activeProvider, activeSource } = await resolveBillProvider('education');

    if (!orderId) {
      return next(new AppError('Please provide orderId', 400));
    }

    if (!(activeProvider === 'clubkonnect' || activeSource === 'nellobytes')) {
      return next(new AppError(`Education transaction cancel is not implemented for ${activeProvider}`, 400));
    }

    const result = await NelloBytesService.cancelWAECTransaction(orderId);
    return res.status(200).json({
      status: result.success ? 'success' : 'error',
      data: {
        provider: activeProvider,
        orderId: result.orderId || orderId,
        providerStatus: result.status,
        raw: result.response,
      },
    });
  } catch (error) {
    next(error);
  }
};




exports.nelloBytesWebhook = async (req, res, next) => {
  try {
    const queryData = req.query || {};
    const bodyData = req.body || {};
    const payloads = Array.isArray(bodyData)
      ? bodyData
      : (Array.isArray(bodyData?.events) ? bodyData.events : [bodyData]);
    const mergedPayloads = payloads.map((item) => ({ ...(item || {}), ...queryData }));

    for (const data of mergedPayloads) {
      const { orderId, requestId, statusCode, orderStatus, rawStatus, remark } = extractNelloCallbackFields(data);

      if (!orderId && !requestId) {
        logger.warn('NelloBytes bills webhook received without orderid/requestid');
        continue;
      }

      logger.info(`NelloBytes bills webhook received: ${orderId || requestId}`, { data });

      const transaction = await Transaction.findOne({
        $or: [
          ...(orderId ? [{ 'service.orderId': orderId }, { reference: orderId }] : []),
          ...(requestId ? [{ 'service.requestId': requestId }, { reference: requestId }] : []),
        ],
      });

      if (!transaction) {
        logger.warn(`Transaction not found for NelloBytes callback. orderId=${orderId} requestId=${requestId}`);
        continue;
      }

      if (transaction.status === 'successful' || transaction.status === 'failed') {
        continue;
      }

      transaction.providerResponse = {
        ...(transaction.providerResponse || {}),
        callback: data,
      };

      const mappedStatus = classifyNelloCallbackStatus({ statusCode, orderStatus, rawStatus });

      if (mappedStatus === 'successful') {
        transaction.status = 'successful';
        transaction.statusHistory.push({
          status: 'successful',
          note: remark || 'Payment completed successfully',
          timestamp: new Date(),
        });
        await transaction.save();

        if (transaction.type === 'electricity') {
          await NotificationService.create({
            user: transaction.user,
            title: 'Electricity Payment Successful',
            message: `Your electricity payment of NGN ${transaction.amount} was successful.`,
            type: 'electricity',
            reference: transaction.reference,
          });
        } else if (transaction.type === 'cable_tv') {
          await NotificationService.create({
            user: transaction.user,
            title: 'Cable TV Subscription Successful',
            message: `Your cable TV subscription of NGN ${transaction.amount} was successful.`,
            type: 'cable_tv',
            reference: transaction.reference,
          });
        }
      } else if (mappedStatus === 'pending' || mappedStatus === 'unknown') {
        transaction.status = 'pending';
        transaction.statusHistory.push({
          status: 'pending',
          note: remark || rawStatus || orderStatus || 'Payment received, processing',
          timestamp: new Date(),
        });
        await transaction.save();
      } else {
        await refundTransactionToWallet(transaction, 'Payment failed - refund', transaction.amount);

        transaction.status = 'failed';
        transaction.statusHistory.push({
          status: 'failed',
          note: remark || rawStatus || orderStatus || 'Payment failed',
          timestamp: new Date(),
        });
        await transaction.save();

        await NotificationService.create({
          user: transaction.user,
          title: 'Payment Failed',
          message: `Your ${transaction.type || 'payment'} of NGN ${transaction.amount} failed. Amount has been refunded.`,
          type: 'payment_failed',
          reference: transaction.reference,
        });
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('NelloBytes bills webhook error:', error);
    res.status(500).send('Webhook error');
  }
};
