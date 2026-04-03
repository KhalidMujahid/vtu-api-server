const axios = require('axios');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Wallet = require("../models/Wallet");
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const NelloBytesService = require('../services/nelloBytesService');
const VtuProviderService = require('../services/vtuProviderService');
const AirtimeNigeriaService = require('../services/airtimeNigeriaService');
const SmePlugService = require('../services/smePlugService');
const PluginngService = require('../services/pluginngService');
const ProviderPurchaseGuardService = require('../services/providerPurchaseGuardService');
const vtuConfig = require('../config/vtuProviders');
const crypto = require('crypto');

const SERVER_URL = process.env.SERVER_URL || 'https://api.yareemadata.com';
const AIRTIME_CALLBACK_URL = process.env.AIRTIME_CALLBACK_URL || `${SERVER_URL}/api/v1/telecom/airtime/webhook`;

function generateReference(prefix = 'TX') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

const SOURCE_TO_PROVIDER = {
  nellobytes: 'clubkonnect',
  airtimenigeria: 'airtimenigeria',
  smeplug: 'smeplug',
  pluginng: 'pluginng',
};

const DATA_NETWORKS = ['mtn', 'glo', 'airtel', '9mobile'];
const DATA_TYPE_ALIASES = {
  sme: 'sme',
  direct: 'direct',
  awoof: 'awoof',
  gift: 'gifting',
  gifting: 'gifting',
  corporate: 'corporate',
  night: 'night',
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  all: 'all',
};

function normalizeNetwork(network) {
  if (!network) {
    return network;
  }

  const rawValue = Array.isArray(network) ? network[0] : network;
  const sanitized = String(rawValue)
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/g, '');

  const aliases = {
    '01': 'mtn',
    '1': 'mtn',
    '02': 'glo',
    '2': 'glo',
    '03': '9mobile',
    '3': '9mobile',
    '04': 'airtel',
    '4': 'airtel',
    etisalat: '9mobile',
    m_9mobile: '9mobile',
    '9mobile': '9mobile',
    mtn: 'mtn',
    airtel: 'airtel',
    glo: 'glo',
  };

  return aliases[sanitized] || sanitized;
}

function buildDataPlansResponse(plans) {
  return plans.reduce((acc, plan) => {
    const network = normalizeNetwork(plan.network);
    if (!network) {
      return acc;
    }

    if (!acc[network]) {
      acc[network] = [];
    }

    acc[network].push({
      id: plan._id || plan.id || plan.planId || plan.plan_id || '',
      planCode: plan.planCode || plan.plan_code || '',
      providerPlanId: plan.providerPlanId || plan.planId || plan.plan_id || plan.planCode || plan.plan_code || '',
      variationCode: plan.variationCode || null,
      provider: plan.provider || null,
      planName: plan.planName || plan.name || plan.size || '',
      size: plan.size || plan.dataAmount,
      price: Number(plan.sellingPrice ?? plan.price ?? 0),
      costPrice: Number(plan.costPrice ?? 0),
      validity: plan.validity,
      isAvailable: plan.isAvailable !== false,
      availabilityMessage: plan.availabilityMessage || null,
      providerPlanType: plan.providerPlanType || null,
      providerMeta: plan.providerMeta || null,
    });
    return acc;
  }, {});
}

function normalizeDataType(dataType) {
  if (!dataType) return null;
  const key = String(dataType).trim().toLowerCase();
  return DATA_TYPE_ALIASES[key] || key;
}

function extractDataTypeFromPlanName(planName = '') {
  const normalized = String(planName).toLowerCase();
  if (!normalized) return 'other';
  if (normalized.includes('awoof')) return 'awoof';
  if (normalized.includes('direct')) return 'direct';
  if (normalized.includes('sme')) return 'sme';
  if (normalized.includes('corporate')) return 'corporate';
  if (normalized.includes('gifting') || normalized.includes('gift')) return 'gifting';
  if (normalized.includes('night')) return 'night';
  if (normalized.includes('daily')) return 'daily';
  if (normalized.includes('weekly')) return 'weekly';
  if (normalized.includes('monthly')) return 'monthly';
  return 'other';
}

function applyDataTypeOnUnifiedPlans(unifiedPlans = {}, dataType = null) {
  const normalizedType = normalizeDataType(dataType);
  if (!normalizedType || normalizedType === 'all') return unifiedPlans;

  const filtered = {};
  for (const [network, plans] of Object.entries(unifiedPlans)) {
    filtered[network] = (plans || []).filter(plan => {
      const planType = normalizeDataType(plan.providerPlanType || extractDataTypeFromPlanName(plan.planName || plan.size || ''));
      return planType === normalizedType;
    });
  }

  return filtered;
}

const DATA_TYPE_SORT_ORDER = [
  'sme',
  'direct',
  'gifting',
  'corporate',
  'awoof',
  'daily',
  'weekly',
  'monthly',
  'night',
  'other',
];

function sortDataTypes(dataTypes = []) {
  return [...new Set(dataTypes)].sort((a, b) => {
    const indexA = DATA_TYPE_SORT_ORDER.indexOf(a);
    const indexB = DATA_TYPE_SORT_ORDER.indexOf(b);
    const orderA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
    const orderB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;

    if (orderA !== orderB) return orderA - orderB;
    return String(a).localeCompare(String(b));
  });
}

function resolvePlanDataType(plan = {}) {
  const planType =
    normalizeDataType(plan.providerPlanType) ||
    normalizeDataType(extractDataTypeFromPlanName(plan.planName || plan.size || plan.dataAmount || '')) ||
    'other';

  return planType === 'all' ? null : planType;
}

function buildAvailableDataTypesFromGroupedPlans(groupedPlans = {}) {
  const byNetwork = {};
  const allTypesSet = new Set();

  for (const [networkKey, plans] of Object.entries(groupedPlans)) {
    const network = normalizeNetwork(networkKey);
    if (!network) continue;

    const typeSet = new Set();

    for (const plan of plans || []) {
      const planType = resolvePlanDataType(plan);
      if (!planType) continue;
      typeSet.add(planType);
      allTypesSet.add(planType);
    }

    byNetwork[network] = sortDataTypes(Array.from(typeSet));
  }

  return {
    byNetwork,
    all: sortDataTypes(Array.from(allTypesSet)),
  };
}

function formatAvailableDataTypes(availableTypes = {}, network = null) {
  if (network) {
    return availableTypes?.byNetwork?.[network] || [];
  }
  return availableTypes?.byNetwork || {};
}

async function getConfiguredDataPlans(providerId, network = null, includeUnavailable = true, dataType = null) {
  const providerConfig = vtuConfig.providers[providerId];
  if (!providerConfig) return [];

  const source = providerConfig.source || providerId;
  const DataService = vtuConfig.getDataPlansService(source);
  if (!DataService || !DataService.getDataPlans) return [];

  const rawPlans = await DataService.getDataPlans(normalizeNetwork(network));
  const groupedPlans = vtuConfig.transformDataPlans(source, rawPlans) || {};
  const flatPlans = [];

  for (const [networkKey, plans] of Object.entries(groupedPlans)) {
    const normalizedNetwork = normalizeNetwork(networkKey);
    for (const plan of plans || []) {
      flatPlans.push({
        ...plan,
        network: normalizeNetwork(plan.network || normalizedNetwork),
        provider: providerId,
        providerMeta: plan.providerMeta || null,
        sellingPrice: Number(plan.sellingPrice ?? plan.price ?? 0),
        isAvailable: plan.isAvailable !== false,
      });
    }
  }

  const normalizedType = normalizeDataType(dataType);
  return flatPlans.filter((plan) => {
    if (!includeUnavailable && plan.isAvailable === false) return false;
    if (network && normalizeNetwork(plan.network) !== normalizeNetwork(network)) return false;
    if (normalizedType && normalizedType !== 'all') {
      const planType = normalizeDataType(plan.providerPlanType || extractDataTypeFromPlanName(plan.planName || plan.size || ''));
      return planType === normalizedType;
    }
    return true;
  });
}

async function resolveDataPricing({ providerId, network, planIdentifier, allowUnavailable = false, fallbackPlan = null, dataType = null }) {
  const planValue = String(planIdentifier || '').trim().toLowerCase();
  const normalizedType = normalizeDataType(dataType);
  const plans = await getConfiguredDataPlans(
    providerId,
    normalizeNetwork(network),
    allowUnavailable,
    normalizedType
  );

  const matchesPlan = (plan = {}) => {
    const candidates = [
      plan.planCode,
      plan.providerPlanId,
      plan.variationCode,
      plan.planName,
      plan.id,
      plan.planId,
      plan.plan_id,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase());

    return candidates.includes(planValue);
  };

  let pricing = plans.find(matchesPlan) || null;

  if (!pricing && fallbackPlan) {
    const fallbackName = String(fallbackPlan.planName || fallbackPlan.size || fallbackPlan.dataAmount || '').trim().toLowerCase();
    pricing = plans.find((plan) => String(plan.planName || plan.size || plan.dataAmount || '').trim().toLowerCase() === fallbackName) || null;
  }

  if (!pricing) return null;

  return {
    ...pricing,
    sellingPrice: Number(pricing.sellingPrice ?? pricing.price ?? 0),
    providerPlanId: pricing.providerPlanId || pricing.planId || pricing.plan_id || pricing.planCode || planIdentifier,
    planCode: pricing.planCode || pricing.providerPlanId || planIdentifier,
  };
}

function isProviderBalanceError(error) {
  const message = `${error?.response?.data?.message || ''} ${error?.message || ''}`.toLowerCase();
  return message.includes('insufficient') && message.includes('balance');
}

function shouldBypassProviderBalanceCheck(providerConfig, error) {
  if (providerConfig?.source !== 'pluginng') {
    return false;
  }

  const message = String(error?.message || '').toLowerCase();
  return message.includes('unable to verify') || message.includes('not exposed');
}

function getProviderAttemptOrder(network, preferredProvider) {
  const ordered = [];

  if (preferredProvider) {
    ordered.push(preferredProvider);
  }

  for (const provider of VtuProviderService.getProvidersForNetwork(network)) {
    if (!ordered.includes(provider.id) && provider.supportedServices.includes('data_recharge')) {
      ordered.push(provider.id);
    }
  }

  return ordered;
}

function normalizePhoneForSmePlug(phoneNumber) {
  if (phoneNumber.startsWith('0')) {
    return `234${phoneNumber.substring(1)}`;
  }
  if (!phoneNumber.startsWith('234')) {
    return `234${phoneNumber}`;
  }
  return phoneNumber;
}

function normalizeNigerianPhoneNumber(phoneNumber = '') {
  const digits = String(phoneNumber || '').replace(/\D/g, '');

  if (!digits) return '';

  if (digits.length === 13 && digits.startsWith('234')) {
    return `0${digits.substring(3)}`;
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    return digits;
  }

  if (digits.length === 10 && /^[789][01]\d{8}$/.test(digits)) {
    return `0${digits}`;
  }

  return '';
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
    remark: data.orderremark || data.orderRemark || data.remark || data.message || '',
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
    'INVALID_CREDENTIALS',
    'MISSING_CREDENTIALS',
    'MISSING_USERID',
    'MISSING_APIKEY',
    'MISSING_MOBILENETWORK',
    'MISSING_AMOUNT',
    'INVALID_AMOUNT',
    'MINIMUM_50',
    'MINIMUM_200000',
    'INVALID_RECIPIENT',
    'FAILED',
    'FAIL',
    'ERROR',
    'REJECTED',
    'CANCELLED',
    'ORDER_CANCELLED',
    'ORDER_FAILED',
    'INVALID_MOBILE_NUMBER',
    'INVALID_ACCOUNTNO',
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

async function resolvePluginngDataSubcategory({ attemptPricing = {}, network, planIdentifier }) {
  const fromPricing = (
    attemptPricing?.providerMeta?.subcategoryId ||
    attemptPricing?.variationCode ||
    attemptPricing?.providerMeta?.subcategory_id ||
    null
  );

  if (fromPricing) {
    return String(fromPricing);
  }

  return PluginngService.resolveDataSubcategoryId(network, attemptPricing?.providerPlanId || attemptPricing?.planCode || attemptPricing?.planName || planIdentifier);
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

exports.getDataPlans = async (req, res, next) => {
  try {
    const { network, source, dataType } = req.query;
    const normalizedNetwork = normalizeNetwork(network);
    const normalizedDataType = normalizeDataType(dataType);

    if (normalizedNetwork && !DATA_NETWORKS.includes(normalizedNetwork)) {
      return next(new AppError('Invalid network provider', 400));
    }

    const activeProviderId = await vtuConfig.getProviderIdForService('data');
    const activeProvider = vtuConfig.providers[activeProviderId];
    const providerSource = activeProvider?.source || 'nellobytes';
    const selectedSource = source || providerSource;
    const selectedProviderId = SOURCE_TO_PROVIDER[selectedSource] || activeProviderId;

    const DataService = vtuConfig.getDataPlansService(selectedSource);
    
    if (DataService && DataService.getDataPlans) {
      const rawPlans = await DataService.getDataPlans(normalizedNetwork);
      const unifiedPlans = vtuConfig.transformDataPlans(selectedSource, rawPlans);
      const availableTypes = buildAvailableDataTypesFromGroupedPlans(unifiedPlans);
      let responseData = applyDataTypeOnUnifiedPlans(unifiedPlans, normalizedDataType);
      if (normalizedNetwork) {
        responseData = { [normalizedNetwork]: responseData[normalizedNetwork] || [] };
      }

      if (normalizedNetwork && !normalizedDataType) {
        return res.status(200).json({
          status: 'success',
          availableDataTypes: formatAvailableDataTypes(availableTypes, normalizedNetwork),
          filters: {
            network: normalizedNetwork,
            dataType: null,
          },
          source: selectedSource,
          provider: selectedProviderId,
        });
      }
      
      return res.status(200).json({
        status: 'success',
        data: responseData,
        availableDataTypes: formatAvailableDataTypes(availableTypes, normalizedNetwork),
        filters: {
          network: normalizedNetwork || null,
          dataType: normalizedDataType || 'all',
        },
        source: selectedSource,
        provider: selectedProviderId,
      });
    }

    return next(new AppError(`Data plans endpoint is not implemented for provider source '${selectedSource}'`, 400));
  } catch (error) {
    console.error('getDataPlans error:', error);
    next(error);
  }
};

exports.purchaseData = async (req, res, next) => {
  try {
    const { phoneNumber, network, dataPlan, planId, transactionPin, amount, dataType } = req.body;
    const planIdentifier = dataPlan || planId;
    const normalizedNetwork = normalizeNetwork(network);
    const normalizedDataType = normalizeDataType(dataType);
    const defaultProvider = await vtuConfig.getProviderIdForService('data');
    const requestedProvider = defaultProvider;
    
    if (!phoneNumber) {
      return next(new AppError('Phone number is required', 400));
    }
    if (!normalizedNetwork) {
      return next(new AppError('Network is required', 400));
    }
    if (!DATA_NETWORKS.includes(normalizedNetwork)) {
      return next(new AppError('Invalid network provider', 400));
    }
    if (!planIdentifier) {
      return next(new AppError('Data plan is required (dataPlan or planId)', 400));
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

    const requestedPricing = await resolveDataPricing({
      providerId: requestedProvider,
      network: normalizedNetwork,
      planIdentifier,
      allowUnavailable: true,
      dataType: normalizedDataType,
    });

    if (requestedPricing && requestedPricing.isAvailable === false) {
      return next(new AppError(requestedPricing.availabilityMessage || 'Service Temporarily Unavailable', 503));
    }

    let sellingPrice = requestedPricing?.sellingPrice || 0;

    if (amount && !isNaN(amount) && parseFloat(amount) > 0) {
      sellingPrice = parseFloat(amount);
    }

    if (!sellingPrice) {
      return next(new AppError('Data plan pricing is not configured for this provider', 404));
    }

    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await wallet.debit(sellingPrice, `Data purchase: ${network} ${planIdentifier}`);

    const reference = generateReference('DATA');
    const nelloCallbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/nellobytes`;
    const airtimeNigeriaCallbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/airtimenigeria`;
    const smePlugCallbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;

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
      description: `${normalizedNetwork.toUpperCase()} ${requestedPricing?.planName || planIdentifier} for ${phoneNumber}`,
      service: {
        provider: requestedProvider,
        network: normalizedNetwork,
        plan: planIdentifier,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: `Purchase initiated via ${requestedProvider}`, timestamp: new Date() }],
    });

    try {
      let apiResponse;
      let successfulProvider = requestedProvider;
      let activePricing = requestedPricing;
      let lastProviderError;

      for (const providerId of getProviderAttemptOrder(normalizedNetwork, requestedProvider)) {
        const providerConfig = vtuConfig.providers[providerId];
        if (!providerConfig) {
          continue;
        }

        const attemptPricing = providerId === requestedProvider
          ? requestedPricing
          : await resolveDataPricing({
              providerId,
              network: normalizedNetwork,
              planIdentifier,
              fallbackPlan: requestedPricing,
              dataType: normalizedDataType,
            });

        if (!attemptPricing || attemptPricing.isAvailable === false) {
          continue;
        }

        try {
          try {
            await ProviderPurchaseGuardService.assertSufficientProviderBalance(
              providerId,
              Number(attemptPricing?.sellingPrice || sellingPrice),
              { serviceType: 'data_recharge', network: normalizedNetwork, phoneNumber }
            );
          } catch (balanceCheckError) {
            if (!shouldBypassProviderBalanceCheck(providerConfig, balanceCheckError)) {
              throw balanceCheckError;
            }
            logger.warn(`Skipping provider balance guard for ${providerId}: ${balanceCheckError.message}`);
          }

          if (providerConfig.source === 'airtimenigeria') {
            apiResponse = await AirtimeNigeriaService.purchaseData({
              phone: phoneNumber,
              variationCode: attemptPricing.variationCode,
              packageCode: attemptPricing.planCode || attemptPricing.providerPlanId || planIdentifier,
              planId: attemptPricing.providerPlanId,
              callbackUrl: airtimeNigeriaCallbackUrl,
              customerReference: reference,
            });
          } else if (providerConfig.source === 'smeplug') {
            apiResponse = await SmePlugService.purchaseData({
              phone: normalizePhoneForSmePlug(phoneNumber),
              network: normalizedNetwork,
              planId: attemptPricing.providerPlanId || attemptPricing.planCode || planIdentifier,
              customerReference: reference,
              callbackUrl: smePlugCallbackUrl,
            });
          } else if (providerConfig.source === 'pluginng') {
            const subcategoryId = await resolvePluginngDataSubcategory({
              attemptPricing,
              network: normalizedNetwork,
              planIdentifier,
            });
            if (!subcategoryId) {
              throw new AppError('Pluginng data plan is missing subcategory configuration', 400);
            }

            apiResponse = await PluginngService.purchaseData({
              planId: attemptPricing.providerPlanId || attemptPricing.planCode || attemptPricing.planName || planIdentifier,
              phoneNumber,
              subcategoryId,
              customReference: reference,
            });
          } else {
            apiResponse = await NelloBytesService.purchaseData({
              network: normalizedNetwork,
              dataPlan: attemptPricing.providerPlanId || attemptPricing.planCode || planIdentifier,
              mobileNumber: phoneNumber,
              callBackURL: nelloCallbackUrl,
            });
          }

          successfulProvider = providerId;
          activePricing = attemptPricing;
          break;
        } catch (providerError) {
          lastProviderError = providerError;
          if (!isProviderBalanceError(providerError)) {
            throw providerError;
          }
        }
      }

      if (!apiResponse) {
        throw lastProviderError || new AppError('Service Temporarily Unavailable', 503);
      }

      if (
        apiResponse.success
        || apiResponse.status === 'success'
        || apiResponse.status === 'pending'
        || apiResponse.statusCode === '100'
        || apiResponse.statusCode === '0'
      ) {
        transaction.status = 'pending';
        transaction.service.provider = successfulProvider;
        transaction.service.plan = activePricing?.providerPlanId || activePricing?.variationCode || activePricing?.planCode || planIdentifier;
        transaction.service.orderId = apiResponse.reference || apiResponse.orderId;
        transaction.providerResponse = apiResponse;
        transaction.statusHistory.push({ 
          status: 'pending', 
          note: `Order received from ${successfulProvider}: ${apiResponse.reference || apiResponse.orderId}`, 
          timestamp: new Date() 
        });
        await transaction.save();

        res.status(200).json({
          status: 'success',
          message: 'Data purchase initiated successfully',
          data: {
            reference,
            orderId: apiResponse.reference || apiResponse.orderId,
            phoneNumber,
            network: normalizedNetwork,
          dataPlan: activePricing?.planName || planIdentifier,
          dataType: normalizeDataType(activePricing?.providerPlanType || extractDataTypeFromPlanName(activePricing?.planName || '')) || 'other',
          amount: sellingPrice,
          status: 'pending',
          provider: successfulProvider,
          },
        });
      } else {
        throw new AppError(apiResponse.message || 'Purchase failed', 400);
      }
    } catch (err) {
      // Refund wallet on failure
      await refundTransactionToWallet(transaction, 'Data purchase refund', sellingPrice);

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
  GLO: 8,
  AIRTEL: 3,
  "9MOBILE": 7,
};

exports.purchaseAirtime = async (req, res, next) => {
  try {
    const { phoneNumber, network, amount, transactionPin, bonusType } = req.body;
    const normalizedNetwork = normalizeNetwork(network);
    const normalizedPhoneNumber = normalizeNigerianPhoneNumber(phoneNumber);
    const parsedAmount = Number(amount);

    if (!phoneNumber || !network || !amount || !transactionPin) {
      return next(new AppError("All fields required", 400));
    }

    if (!normalizedNetwork || !DATA_NETWORKS.includes(normalizedNetwork)) {
      return next(new AppError("Invalid network selected", 400));
    }

    if (!normalizedPhoneNumber || !/^0[789][01]\d{8}$/.test(normalizedPhoneNumber)) {
      return next(new AppError("Invalid phone number", 400));
    }

    if (Number.isNaN(parsedAmount) || parsedAmount < 50 || parsedAmount > 200000) {
      return next(new AppError("Airtime amount must be between 50 and 200000", 400));
    }

    const defaultProvider = await vtuConfig.getProviderIdForService('airtime');
    const activeProvider = defaultProvider;
    const providerConfig = vtuConfig.providers[activeProvider];

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

    if (wallet.balance < parsedAmount) {
      return next(new AppError("Insufficient wallet balance", 400));
    }

    try {
      await ProviderPurchaseGuardService.assertSufficientProviderBalance(
        activeProvider,
        parsedAmount,
        { serviceType: 'airtime_recharge', network: normalizedNetwork, phoneNumber: normalizedPhoneNumber }
      );
    } catch (balanceCheckError) {
      if (!shouldBypassProviderBalanceCheck(providerConfig, balanceCheckError)) {
        throw balanceCheckError;
      }
      logger.warn(`Skipping provider balance guard for ${activeProvider}: ${balanceCheckError.message}`);
    }

    const networkCode = networkMap[normalizedNetwork.toUpperCase()];
    if (!networkCode) {
      return next(new AppError("Invalid network selected", 400));
    }

    const requestId = `AIR-${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")}`;

    const profitPercent = profitConfig[normalizedNetwork.toUpperCase()] || 0;
    const profit = (profitPercent / 100) * parsedAmount;

    await wallet.debit(parsedAmount, "Airtime purchase");

    const transaction = await Transaction.create({
      reference: requestId,
      user: user._id,
      type: "airtime_recharge",
      category: "telecom",
      amount: parsedAmount,
      profit,
      totalAmount: parsedAmount,
      status: "pending",
      description: `${normalizedNetwork} airtime for ${normalizedPhoneNumber}`,
      service: {
        provider: activeProvider,
        network: normalizedNetwork,
        phoneNumber: normalizedPhoneNumber,
      },
      statusHistory: [
        {
          status: "pending",
          note: `Transaction initiated via ${activeProvider}`,
          timestamp: new Date(),
        },
      ],
    });

    let apiResponse;
    let responseData;
    const airtimeCallbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/airtimenigeria`;

    // Route to the appropriate provider
    if (providerConfig?.source === 'airtimenigeria') {
      apiResponse = await AirtimeNigeriaService.purchaseAirtime({
        network: normalizedNetwork,
        phone: normalizedPhoneNumber,
        amount: parsedAmount,
        maxAmount: parsedAmount,
        callbackUrl: airtimeCallbackUrl,
        customerReference: requestId,
      });
      responseData = {
        status: apiResponse.success ? "ORDER_RECEIVED" : "FAILED",
        orderid: apiResponse.reference,
        raw: apiResponse,
      };
      
    } else if (providerConfig?.source === 'smeplug') {
      const smeCallbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
      apiResponse = await SmePlugService.purchaseAirtime({
        phone: normalizePhoneForSmePlug(normalizedPhoneNumber),
        network: normalizedNetwork,
        amount: parsedAmount,
        customerReference: requestId,
        callbackUrl: smeCallbackUrl,
      });
      responseData = {
        status: apiResponse.success ? "ORDER_RECEIVED" : "FAILED",
        orderid: apiResponse.reference,
        raw: apiResponse,
      };
    } else if (providerConfig?.source === 'pluginng') {
      const subcategoryId = await PluginngService.getAirtimeSubcategoryId(normalizedNetwork);
      if (!subcategoryId) {
        throw new AppError(`Pluginng airtime subcategory was not found for ${normalizedNetwork}`, 400);
      }

      apiResponse = await PluginngService.purchaseAirtime({
        amount: parsedAmount,
        phoneNumber: normalizedPhoneNumber,
        subcategoryId,
        customReference: requestId,
      });

      const providerStatus = String(apiResponse.status || '').toLowerCase();
      responseData = {
        status: ['success', 'pending'].includes(providerStatus) ? "ORDER_RECEIVED" : "FAILED",
        orderid: apiResponse.orderId || apiResponse.reference || requestId,
        raw: apiResponse,
      };
      
    } else {
      apiResponse = await NelloBytesService.purchaseAirtime({
        network: normalizedNetwork,
        amount: parsedAmount,
        mobileNumber: normalizedPhoneNumber,
        requestId,
        callBackURL: AIRTIME_CALLBACK_URL,
        bonusType,
      });
      responseData = apiResponse.response;
    }

    const providerStatus = String(responseData?.status || responseData?.orderstatus || '').toUpperCase();
    const providerStatusCode = String(responseData?.statuscode || '');
    const isOrderReceived = providerStatusCode === '100' || providerStatus === 'ORDER_RECEIVED' || providerStatus === 'ORDER_ONHOLD';
    const isOrderCompleted = providerStatusCode === '200' || providerStatus === 'ORDER_COMPLETED';

    if (isOrderReceived || isOrderCompleted) {
      transaction.status = isOrderCompleted ? "successful" : "pending";

      transaction.service = {
        ...transaction.service,
        orderId: apiResponse?.orderId || apiResponse?.reference || responseData?.orderid || requestId,
        requestId: apiResponse?.requestId || responseData?.requestid || requestId,
        callbackUrl: providerConfig?.source === 'airtimenigeria'
          ? airtimeCallbackUrl
          : (providerConfig?.source === 'smeplug'
            ? `${SERVER_URL}/api/v1/telecom/webhook/smeplug`
            : AIRTIME_CALLBACK_URL),
      };

      transaction.statusHistory.push({
        status: transaction.status,
        note: isOrderCompleted ? "Order completed by provider" : "Order received by provider",
        timestamp: new Date(),
      });

      await transaction.save();

      if (isOrderCompleted) {
        await NotificationService.airtimePurchase(
          transaction.user,
          transaction.service?.network,
          transaction.amount,
          transaction.service?.phoneNumber
        );
      }
    } else {
      transaction.status = "failed";

      transaction.statusHistory.push({
        status: "failed",
        note: responseData.orderremark || responseData.status || responseData.orderstatus || "Provider rejected request",
        timestamp: new Date(),
      });

      await transaction.save();

      await refundTransactionToWallet(transaction, 'Airtime refund', parsedAmount);
      await transaction.save();
    }

    res.status(200).json({
      status: "success",
      message: transaction.status === 'successful' ? "Airtime purchase successful" : "Airtime purchase processing",
      data: {
        reference: requestId,
        provider: activeProvider,
        status: transaction.status,
        orderId: transaction.service?.orderId || null,
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
    const data = { ...(req.body || {}), ...(req.query || {}) };
    const { orderId, requestId, statusCode, orderStatus, rawStatus, remark } = extractNelloCallbackFields(data);

    if (!orderId && !requestId) {
      return res.status(400).send('Missing orderid/requestid');
    }

    const transaction = await Transaction.findOne({
      $or: [
        ...(orderId ? [{ "service.orderId": orderId }, { reference: orderId }] : []),
        ...(requestId ? [{ "service.requestId": requestId }, { reference: requestId }] : []),
      ],
    });

    if (!transaction) {
      return res.send("Transaction not found");
    }

    if (transaction.status === "successful" || transaction.status === 'failed') {
      return res.send("Already processed");
    }

    transaction.providerResponse = {
      ...(transaction.providerResponse || {}),
      callback: data,
    };

    const mappedStatus = classifyNelloCallbackStatus({ statusCode, orderStatus, rawStatus });

    if (mappedStatus === "successful") {
      transaction.status = "successful";

      transaction.statusHistory.push({
        status: "successful",
        note: remark || "Airtime delivered successfully",
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

    } else if (mappedStatus === "pending") {
      transaction.status = "pending";
      transaction.statusHistory.push({
        status: "pending",
        note: remark || "Order received, processing",
        timestamp: new Date()
      });
      await transaction.save();
    } else if (mappedStatus === 'failed') {

      transaction.status = "failed";

      transaction.statusHistory.push({
        status: "failed",
        note: remark || rawStatus || orderStatus || "Provider reported failure",
        timestamp: new Date()
      });

      await transaction.save();
      
      // Refund wallet and send notification
      await refundTransactionToWallet(transaction, 'Airtime purchase refund');
      await transaction.save();
      
      await NotificationService.create({
        user: transaction.user,
        title: 'Airtime Purchase Failed',
        message: `Your airtime purchase of ₦${transaction.amount} to ${transaction.service?.phoneNumber} failed. Amount has been refunded.`,
        type: 'airtime_failed',
        reference: transaction.reference,
      });
    } else {
      transaction.status = "pending";
      transaction.statusHistory.push({
        status: "pending",
        note: remark || rawStatus || orderStatus || "Callback received, awaiting terminal provider status",
        timestamp: new Date()
      });
      await transaction.save();

    }

    res.send("OK");

  } catch (error) {
    console.error("Callback Error:", error);
    res.send("OK");
  }
};

exports.queryAirtimeStatus = async (requestId) => {
  return NelloBytesService.queryAirtimeTransaction({ requestId });
};

exports.queryAirtimeTransaction = async (req, res, next) => {
  try {
    const { orderId, requestId } = req.body;
    const activeProvider = await vtuConfig.getProviderIdForService('airtime');
    const providerSource = vtuConfig.providers[activeProvider]?.source || activeProvider;

    if (!orderId && !requestId) {
      return next(new AppError('Please provide orderId or requestId', 400));
    }

    if (!(activeProvider === 'clubkonnect' || providerSource === 'nellobytes')) {
      return next(new AppError(`Airtime transaction query is not implemented for ${activeProvider}`, 400));
    }

    const result = await NelloBytesService.queryAirtimeTransaction({ orderId, requestId });
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
        raw: result.response,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelAirtimeTransaction = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const activeProvider = await vtuConfig.getProviderIdForService('airtime');
    const providerSource = vtuConfig.providers[activeProvider]?.source || activeProvider;

    if (!orderId) {
      return next(new AppError('Please provide orderId', 400));
    }

    if (!(activeProvider === 'clubkonnect' || providerSource === 'nellobytes')) {
      return next(new AppError(`Airtime transaction cancel is not implemented for ${activeProvider}`, 400));
    }

    const result = await NelloBytesService.cancelAirtimeTransaction(orderId);
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

exports.airtimeWebhook = async (req, res) => {
  try {
    const data = { ...(req.body || {}), ...(req.query || {}) };
    const { orderId, requestId, statusCode, orderStatus, rawStatus, remark } = extractNelloCallbackFields(data);

    if (!orderId && !requestId) {
      return res.status(400).send('Missing orderid/requestid');
    }

    const transaction = await Transaction.findOne({
      $or: [
        ...(orderId ? [{ 'service.orderId': orderId }, { reference: orderId }] : []),
        ...(requestId ? [{ 'service.requestId': requestId }, { reference: requestId }] : []),
      ],
    });
    if (!transaction) return res.status(404).send('Transaction not found');

    if (transaction.status === 'successful' || transaction.status === 'failed') {
      return res.status(200).send('Already processed');
    }

    transaction.providerResponse = {
      ...(transaction.providerResponse || {}),
      callback: data,
    };
    const mappedStatus = classifyNelloCallbackStatus({ statusCode, orderStatus, rawStatus });

    if (mappedStatus === 'pending') {
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: remark || rawStatus || orderStatus || 'Order received',
        timestamp: new Date(),
      });

    } else if (mappedStatus === 'successful') {
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: remark || rawStatus || 'Confirmed by provider',
        timestamp: new Date(),
      });

      // Send notification for successful airtime purchase
      await NotificationService.airtimePurchase(
        transaction.user,
        transaction.service?.network,
        transaction.amount,
        transaction.service?.phoneNumber
      );

    } else if (mappedStatus === 'failed') {
      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: remark || rawStatus || orderStatus || 'Provider failure',
        timestamp: new Date(),
      });

      // Refund wallet on failure
      await refundTransactionToWallet(transaction, 'Airtime purchase refund');

      // Send notification for failed airtime purchase
      await NotificationService.create({
        user: transaction.user,
        title: 'Airtime Purchase Failed',
        message: `Your airtime purchase of ₦${transaction.amount} to ${transaction.service?.phoneNumber} failed. Amount has been refunded.`,
        type: 'airtime_failed',
        reference: transaction.reference,
      });
    } else {
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: remark || rawStatus || orderStatus || 'Callback received, awaiting terminal provider status',
        timestamp: new Date(),
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
    const { network, pinType, value, quantity = 1, transactionPin } = req.body;
    const normalizedNetwork = normalizeNetwork(network);
    const parsedQuantity = Number(quantity);
    const parsedValue = Number(
      String(value ?? pinType)
        .replace(/[^\d]/g, '')
    );

    if (!network || (!pinType && !value) || !transactionPin) {
      return next(new AppError('All fields required', 400));
    }

    if (!normalizedNetwork || !DATA_NETWORKS.includes(normalizedNetwork)) {
      return next(new AppError('Invalid network selected', 400));
    }

    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 100) {
      return next(new AppError('Quantity must be between 1 and 100', 400));
    }

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    if (!(await user.compareTransactionPin(transactionPin))) {
      return next(new AppError('Invalid transaction PIN', 401));
    }

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    if (![100, 200, 500].includes(parsedValue)) {
      return next(new AppError('Recharge PIN value must be 100, 200, or 500', 400));
    }

    const activeProvider = await vtuConfig.getProviderIdForService('airtimepin');
    const providerConfig = vtuConfig.providers[activeProvider];

    if (!providerConfig) {
      return next(new AppError(`Configured recharge PIN provider '${activeProvider}' is invalid`, 400));
    }

    if (!(providerConfig.supportedServices || []).includes('recharge_pin')) {
      return next(new AppError(`Recharge PIN is not supported for configured provider '${activeProvider}'`, 400));
    }

    const pinValue = parsedValue;
    const totalAmount = pinValue * parsedQuantity;
    if (wallet.balance < totalAmount) {
      return next(new AppError('Insufficient balance', 400));
    }

    await ProviderPurchaseGuardService.assertSufficientProviderBalance(
      activeProvider,
      totalAmount,
      { serviceType: 'recharge_pin', network: normalizedNetwork, quantity: parsedQuantity }
    );

    await wallet.debit(totalAmount, 'Recharge PIN purchase');

    const reference = generateReference('PIN');
    const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/nellobytes`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'recharge_pin',
      category: 'telecom',
      amount: totalAmount,
      totalAmount,
      previousBalance: wallet.balance + totalAmount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${normalizedNetwork.toUpperCase()} ${pinValue} x${parsedQuantity}`,
      service: {
        provider: activeProvider,
        network: normalizedNetwork,
        plan: String(pinValue),
        quantity: parsedQuantity,
      },
      statusHistory: [{ status: 'pending', note: `Recharge PIN purchase initiated via ${activeProvider}`, timestamp: new Date() }],
    });

    try {
      if (!(activeProvider === 'clubkonnect' || providerConfig.source === 'nellobytes')) {
        throw new AppError(`Recharge PIN purchase is not implemented for provider '${activeProvider}'`, 400);
      }

      const providerResponse = await NelloBytesService.buyEPIN({
        mobileNetwork: normalizedNetwork,
        value: pinValue,
        quantity: parsedQuantity,
        requestId: reference,
        callBackURL: callbackUrl,
      });

      transaction.service.orderId = providerResponse.orderId || reference;
      transaction.providerResponse = providerResponse;

      if (providerResponse.epins?.length) {
        transaction.status = 'successful';
        transaction.statusHistory.push({
          status: 'successful',
          note: 'Recharge PIN generated by provider',
          timestamp: new Date(),
        });
      } else {
        transaction.status = 'pending';
        transaction.statusHistory.push({
          status: 'pending',
          note: providerResponse.status || 'Recharge PIN request queued',
          timestamp: new Date(),
        });
      }

      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: providerResponse.epins?.length
          ? 'Recharge PIN generated successfully'
          : 'Recharge PIN request submitted successfully',
        data: {
          reference,
          orderId: providerResponse.orderId || reference,
          network: normalizedNetwork,
          pinType: String(pinValue),
          quantity: parsedQuantity,
          pins: providerResponse.epins || [],
          provider: activeProvider,
          providerStatus: providerResponse.status,
        },
      });
    } catch (err) {
      await refundTransactionToWallet(transaction, 'Recharge PIN refund', totalAmount);

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({
        status: 'failed',
        note: err.message || 'Recharge PIN purchase failed',
        timestamp: new Date(),
      });
      await transaction.save();

      return next(new AppError(`Recharge PIN purchase failed: ${err.message}`, 500));
    }
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
      await refundTransactionToWallet(transaction, 'Transaction failed via webhook - refund');

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
    const queryData = req.query || {};
    const bodyData = req.body || {};
    const payloads = Array.isArray(bodyData)
      ? bodyData
      : (Array.isArray(bodyData?.events) ? bodyData.events : [bodyData]);
    const mergedPayloads = payloads.map((item) => ({ ...(item || {}), ...queryData }));

    for (const data of mergedPayloads) {
      const { orderId, requestId, statusCode, orderStatus, rawStatus, remark } = extractNelloCallbackFields(data);

      if (!orderId && !requestId) {
        logger.warn('NelloBytes webhook received without orderid/requestid');
        continue;
      }

      logger.info(`NelloBytes webhook received: ${orderId || requestId}`, { data });

      const transaction = await Transaction.findOne({
        $or: [
          ...(orderId ? [{ 'service.orderId': orderId }, { reference: orderId }] : []),
          ...(requestId ? [{ 'service.requestId': requestId }, { reference: requestId }] : []),
        ],
      });

      if (!transaction) {
        logger.warn(`Transaction not found for callback. orderId=${orderId} requestId=${requestId}`);
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
          note: remark || 'Transaction completed successfully',
          timestamp: new Date(),
        });
        await transaction.save();

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
      } else if (mappedStatus === 'pending' || mappedStatus === 'unknown') {
        transaction.status = 'pending';
        transaction.statusHistory.push({
          status: 'pending',
          note: remark || rawStatus || orderStatus || 'Order received, processing',
          timestamp: new Date(),
        });
        await transaction.save();
      } else {
        await refundTransactionToWallet(transaction, 'Transaction failed - refund');

        transaction.status = 'failed';
        transaction.statusHistory.push({
          status: 'failed',
          note: remark || rawStatus || orderStatus || 'Transaction failed',
          timestamp: new Date(),
        });
        await transaction.save();

        await NotificationService.create({
          user: transaction.user,
          title: 'Transaction Failed',
          message: `Your ${transaction.type || 'transaction'} of ₦${transaction.amount} has failed. Amount has been refunded to your wallet.`,
          type: 'transaction_failed',
          reference: transaction.reference,
        });

        logger.info(`Transaction ${transaction.reference} marked as failed, wallet refunded`);
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('NelloBytes webhook error:', error);
    return res.status(500).send('Webhook error');
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
};

/**
 * Get current VTU provider (for frontend)
 */
exports.getCurrentProvider = async (req, res, next) => {
  try {
    const provider = await VtuProviderService.getPrimaryProvider();
    const allProviders = await VtuProviderService.getAllProvidersWithStatus();
    
    res.status(200).json({
      status: 'success',
      data: {
        currentProvider: provider,
        providers: allProviders,
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get AirtimeNigeria data plans
 */
exports.getAirtimeNigeriaDataPlans = async (req, res, next) => {
  try {
    const { network } = req.query;
    const plans = await AirtimeNigeriaService.getDataPlans(network);
    
    res.status(200).json({
      status: 'success',
      data: plans.data,
      source: 'airtimenigeria',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Purchase data using AirtimeNigeria
 */
exports.purchaseAirtimeNigeriaData = async (req, res, next) => {
  try {
    const { phoneNumber, network, packageCode, planId, transactionPin, dataType } = req.body;
    const requestedDataType = normalizeDataType(dataType);
    
    if (!phoneNumber || !network) {
      return next(new AppError('Phone number and network are required', 400));
    }
    
    if (!packageCode && !planId) {
      return next(new AppError('Package code or plan ID is required', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
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

    // Get pricing - for now, we'll need to get the price from AirtimeNigeria
    const plansResult = await AirtimeNigeriaService.getDataPlans(network);
    let plan = null;
    const networkPlans = plansResult.data[network.toLowerCase()] || [];
    
    if (packageCode) {
      plan = networkPlans.find(p => p.planCode === packageCode);
    } else if (planId) {
      plan = networkPlans.find(p => p.planId === parseInt(planId));
    }
    
    if (!plan) {
      return next(new AppError('Data plan not found', 404));
    }

    const planType = normalizeDataType(
      plan.plan_type || plan.category || extractDataTypeFromPlanName(plan.planName || '')
    ) || 'other';
    if (requestedDataType && requestedDataType !== 'all' && requestedDataType !== planType) {
      return next(new AppError(`Selected plan is '${planType}' type, but '${requestedDataType}' was requested`, 400));
    }
    
    const sellingPrice = plan.price;
    
    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await ProviderPurchaseGuardService.assertSufficientProviderBalance(
      'airtimenigeria',
      sellingPrice,
      { serviceType: 'data_recharge', network, phoneNumber }
    );

    // Debit wallet
    await wallet.debit(sellingPrice, `AirtimeNigeria Data: ${network} ${plan.planName}`);

    const reference = `AN-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/airtimenigeria`;

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
      description: `${network.toUpperCase()} ${plan.planName} for ${phoneNumber}`,
      service: {
        provider: 'airtimenigeria',
        network: network.toLowerCase(),
        plan: packageCode || planId,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Purchase initiated via AirtimeNigeria', timestamp: new Date() }],
    });

    try {
      const apiResponse = await AirtimeNigeriaService.purchaseData({
        phone: phoneNumber,
        packageCode,
        planId: planId ? parseInt(planId) : undefined,
        callbackUrl,
        customerReference: reference,
      });

      transaction.status = 'pending';
      transaction.service.orderId = apiResponse.reference;
      transaction.providerResponse = apiResponse;
      transaction.statusHistory.push({ 
        status: 'pending', 
        note: `Order received: ${apiResponse.reference}`, 
        timestamp: new Date() 
      });
      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: 'Data purchase initiated successfully',
        data: {
          reference,
          orderId: apiResponse.reference,
          phoneNumber,
          network,
          plan: plan.planName,
          dataType: planType,
          amount: sellingPrice,
          status: 'pending',
          provider: 'airtimenigeria',
        },
      });
    } catch (err) {
      // Refund wallet on failure
      await refundTransactionToWallet(transaction, 'Data purchase refund', sellingPrice);

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`AirtimeNigeria data purchase failed → ${err.message}`);
      return next(new AppError(`Data purchase failed: ${err.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Purchase airtime using AirtimeNigeria
 */
exports.purchaseAirtimeNigeriaAirtime = async (req, res, next) => {
  try {
    const { phoneNumber, network, amount, transactionPin } = req.body;
    
    if (!phoneNumber || !network || !amount) {
      return next(new AppError('Phone number, network, and amount are required', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
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

    if (wallet.balance < amount) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await ProviderPurchaseGuardService.assertSufficientProviderBalance(
      'airtimenigeria',
      Number(amount),
      { serviceType: 'airtime_recharge', network, phoneNumber }
    );

    // Debit wallet
    await wallet.debit(amount, `AirtimeNigeria Airtime: ${network} ${amount}`);

    const reference = `AN-AIR-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/airtimenigeria`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'airtime_recharge',
      category: 'telecom',
      amount,
      totalAmount: amount,
      previousBalance: wallet.balance + amount,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${network.toUpperCase()} ${amount} airtime for ${phoneNumber}`,
      service: {
        provider: 'airtimenigeria',
        network: network.toLowerCase(),
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Airtime purchase initiated via AirtimeNigeria', timestamp: new Date() }],
    });

    try {
      const apiResponse = await AirtimeNigeriaService.purchaseAirtime({
        network: network.toLowerCase(),
        phone: phoneNumber,
        amount: parseInt(amount),
        maxAmount: parseInt(amount),
        callbackUrl,
        customerReference: reference,
      });

      transaction.status = 'pending';
      transaction.service.orderId = apiResponse.reference;
      transaction.providerResponse = apiResponse;
      transaction.statusHistory.push({ 
        status: 'pending', 
        note: `Order received: ${apiResponse.reference}`, 
        timestamp: new Date() 
      });
      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: 'Airtime purchase initiated successfully',
        data: {
          reference,
          orderId: apiResponse.reference,
          phoneNumber,
          network,
          amount,
          status: 'pending',
          provider: 'airtimenigeria',
        },
      });
    } catch (err) {
      // Refund wallet on failure
      await refundTransactionToWallet(transaction, 'Airtime purchase refund', amount);

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`AirtimeNigeria airtime purchase failed → ${err.message}`);
      return next(new AppError(`Airtime purchase failed: ${err.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get AirtimeNigeria wallet balance
 */
exports.getAirtimeNigeriaBalance = async (req, res, next) => {
  try {
    const balance = await AirtimeNigeriaService.getWalletBalance();
    
    res.status(200).json({
      status: 'success',
      data: balance.data,
      provider: 'airtimenigeria',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * AirtimeNigeria Webhook Handler
 */
exports.airtimeNigeriaWebhook = async (req, res) => {
  try {
    const payload = Object.keys(req.body || {}).length ? req.body : req.query;
    logger.info('AirtimeNigeria webhook received:', payload);

    const callbackResults = AirtimeNigeriaService.verifyCallbackBatch(payload);
    if (!callbackResults.length) {
      return res.status(400).send('Invalid payload');
    }

    for (const result of callbackResults) {
      const lookupValues = [result.reference, result.customerReference]
        .filter(Boolean)
        .map((value) => String(value));

      if (!lookupValues.length) {
        logger.warn('AirtimeNigeria webhook item skipped: missing reference and customer_reference');
        continue;
      }

      const transaction = await Transaction.findOne({
        $or: [
          { 'service.orderId': { $in: lookupValues } },
          { reference: { $in: lookupValues } },
        ],
      });

      if (!transaction) {
        logger.warn(`AirtimeNigeria transaction not found for reference(s): ${lookupValues.join(', ')}`);
        continue;
      }

      if (transaction.status === 'successful' || transaction.status === 'failed') {
        continue;
      }

      transaction.provider = {
        ...(transaction.provider || {}),
        providerResponse: result,
      };

      const rawStatus = String(result.status || '').trim();
      const noteMessage = result.message || (rawStatus ? `Provider status: ${rawStatus}` : 'Callback received');

      if (AirtimeNigeriaService.isSuccessfulDeliveryStatus(result.status)) {
        transaction.status = 'successful';
        transaction.completedAt = new Date();
        transaction.statusHistory.push({
          status: 'successful',
          note: noteMessage,
          timestamp: new Date(),
        });

        await transaction.save();

        await NotificationService.create({
          user: transaction.user,
          title: 'Purchase Successful',
          message: `Your ${transaction.type} of NGN ${transaction.amount} was successful.`,
          type: 'purchase_success',
          reference: transaction.reference,
        });
      } else if (AirtimeNigeriaService.isFailedDeliveryStatus(result.status)) {
        transaction.status = 'failed';
        transaction.completedAt = new Date();
        transaction.statusHistory.push({
          status: 'failed',
          note: noteMessage,
          timestamp: new Date(),
        });

        await transaction.save();

        await refundTransactionToWallet(transaction, 'Purchase refund due to AirtimeNigeria callback failure');
        await transaction.save();

        await NotificationService.create({
          user: transaction.user,
          title: 'Purchase Failed',
          message: `Your ${transaction.type} of NGN ${transaction.amount} failed. Amount has been refunded.`,
          type: 'purchase_failed',
          reference: transaction.reference,
        });
      } else {
        transaction.status = 'pending';
        transaction.statusHistory.push({
          status: 'pending',
          note: noteMessage,
          timestamp: new Date(),
        });
        await transaction.save();
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('AirtimeNigeria webhook error:', error);
    return res.status(200).send('OK'); // Always return OK to prevent retries
  }
};

/**
 * Pluginng Webhook Handler
 */
exports.pluginngWebhook = async (req, res) => {
  try {
    const payload = Object.keys(req.body || {}).length ? req.body : req.query;
    logger.info('Pluginng webhook received:', payload);

    const callbackResults = PluginngService.verifyCallbackBatch(payload);
    if (!callbackResults.length) {
      return res.status(400).send('Invalid payload');
    }

    for (const result of callbackResults) {
      const lookupValues = [result.reference, result.orderId]
        .filter(Boolean)
        .map((value) => String(value));

      if (!lookupValues.length) {
        logger.warn('Pluginng webhook item skipped: missing custom_reference and ref');
        continue;
      }

      const transaction = await Transaction.findOne({
        $or: [
          { reference: { $in: lookupValues } },
          { 'service.orderId': { $in: lookupValues } },
        ],
      });

      if (!transaction) {
        logger.warn(`Pluginng transaction not found for reference: ${lookupValues.join(', ')}`);
        continue;
      }

      if (transaction.status === 'successful' || transaction.status === 'failed') {
        continue;
      }

      transaction.provider = {
        ...(transaction.provider || {}),
        providerResponse: result,
      };

      if (PluginngService.isSuccessfulStatus(result.statusCode)) {
        transaction.status = 'successful';
        transaction.completedAt = new Date();
        transaction.statusHistory.push({
          status: 'successful',
          note: result.message || 'Delivered successfully',
          timestamp: new Date(),
        });

        await transaction.save();
        await NotificationService.create({
          user: transaction.user,
          title: 'Purchase Successful',
          message: `Your ${transaction.type} of NGN ${transaction.amount} was successful.`,
          type: 'purchase_success',
          reference: transaction.reference,
        });
      } else if (PluginngService.isPendingStatus(result.statusCode)) {
        transaction.status = 'pending';
        transaction.statusHistory.push({
          status: 'pending',
          note: result.message || 'Provider is still processing the transaction',
          timestamp: new Date(),
        });
        await transaction.save();
      } else {
        transaction.status = 'failed';
        transaction.completedAt = new Date();
        transaction.statusHistory.push({
          status: 'failed',
          note: result.message || 'Provider reported failure',
          timestamp: new Date(),
        });
        await transaction.save();

        await refundTransactionToWallet(transaction, 'Purchase refund due to provider failure');
        await transaction.save();

        await NotificationService.create({
          user: transaction.user,
          title: 'Purchase Failed',
          message: `Your ${transaction.type} of NGN ${transaction.amount} failed. Amount has been refunded.`,
          type: 'purchase_failed',
          reference: transaction.reference,
        });
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('Pluginng webhook error:', error);
    return res.status(200).send('OK');
  }
};

/**
 * Get SMEPlug networks
 */
exports.getSmePlugNetworks = async (req, res, next) => {
  try {
    const networks = await SmePlugService.getNetworks();
    
    res.status(200).json({
      status: 'success',
      data: networks.networks,
      provider: 'smeplug',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get SMEPlug wallet balance
 */
exports.getSmePlugBalance = async (req, res, next) => {
  try {
    const balance = await SmePlugService.getWalletBalance();
    
    res.status(200).json({
      status: 'success',
      data: {
        balance: balance.balance,
        currency: balance.currency,
      },
      provider: 'smeplug',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Purchase data using SMEPlug
 */
exports.purchaseSmePlugData = async (req, res, next) => {
  try {
    const { phoneNumber, network, planId, transactionPin, dataType } = req.body;
    const normalizedNetwork = normalizeNetwork(network);
    const requestedDataType = normalizeDataType(dataType);
    
    if (!phoneNumber || !network || !planId) {
      return next(new AppError('Phone number, network, and plan ID are required', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
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

    const pricing = await resolveDataPricing({
      providerId: 'smeplug',
      network: normalizedNetwork,
      planIdentifier: planId,
    });

    if (!pricing) {
      return next(new AppError('Data plan pricing is not configured for SMEPlug', 404));
    }

    const pricingType = normalizeDataType(
      pricing.providerPlanType || extractDataTypeFromPlanName(pricing.planName || pricing.size || '')
    ) || 'other';
    if (requestedDataType && requestedDataType !== 'all' && requestedDataType !== pricingType) {
      return next(new AppError(`Selected plan is '${pricingType}' type, but '${requestedDataType}' was requested`, 400));
    }

    const sellingPrice = pricing.sellingPrice;
    
    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await ProviderPurchaseGuardService.assertSufficientProviderBalance(
      'smeplug',
      sellingPrice,
      { serviceType: 'data_recharge', network: normalizedNetwork, phoneNumber }
    );

    // Debit wallet
    await wallet.debit(sellingPrice, `SMEPlug Data: ${network} ${planId}`);

    const reference = `SP-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

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
      description: `${network.toUpperCase()} data for ${phoneNumber}`,
      service: {
        provider: 'smeplug',
        network: normalizedNetwork,
        plan: pricing.providerPlanId || pricing.planCode || planId,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Purchase initiated via SMEPlug', timestamp: new Date() }],
    });

    try {
      const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
      const apiResponse = await SmePlugService.purchaseData({
        phone: normalizePhoneForSmePlug(phoneNumber),
        network: normalizedNetwork,
        planId: pricing.providerPlanId || pricing.planCode || planId,
        customerReference: reference,
        callbackUrl,
      });

      transaction.status = 'pending';
      transaction.service.orderId = apiResponse.reference;
      transaction.providerResponse = apiResponse;
      transaction.statusHistory.push({ 
        status: 'pending', 
        note: `Order received: ${apiResponse.reference}`, 
        timestamp: new Date() 
      });
      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: 'Data purchase initiated successfully',
        data: {
          reference,
          orderId: apiResponse.reference,
          phoneNumber,
          network,
          planId,
          dataType: pricingType,
          amount: sellingPrice,
          status: 'pending',
          provider: 'smeplug',
        },
      });
    } catch (err) {
      // Refund wallet on failure
      await refundTransactionToWallet(transaction, 'Data purchase refund', sellingPrice);

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`SMEPlug data purchase failed → ${err.message}`);
      return next(new AppError(`Data purchase failed: ${err.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Purchase airtime using SMEPlug
 */
exports.purchaseSmePlugAirtime = async (req, res, next) => {
  try {
    const { phoneNumber, network, amount, transactionPin } = req.body;
    const normalizedNetwork = normalizeNetwork(network);
    
    if (!phoneNumber || !network || !amount) {
      return next(new AppError('Phone number, network, and amount are required', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
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

    const sellingPrice = parseFloat(amount);
    
    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    await ProviderPurchaseGuardService.assertSufficientProviderBalance(
      'smeplug',
      sellingPrice,
      { serviceType: 'airtime_recharge', network: normalizedNetwork, phoneNumber }
    );

    // Debit wallet
    await wallet.debit(sellingPrice, `SMEPlug Airtime: ${network} ${amount}`);

    const reference = `SP-AIR-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'airtime_recharge',
      category: 'telecom',
      amount: sellingPrice,
      totalAmount: sellingPrice,
      previousBalance: wallet.balance + sellingPrice,
      newBalance: wallet.balance,
      status: 'pending',
      description: `${network.toUpperCase()} ${amount} airtime for ${phoneNumber}`,
      service: {
        provider: 'smeplug',
        network: normalizedNetwork,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Airtime purchase initiated via SMEPlug', timestamp: new Date() }],
    });

    try {
      const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
      const apiResponse = await SmePlugService.purchaseAirtime({
        phone: normalizePhoneForSmePlug(phoneNumber),
        network: normalizedNetwork,
        amount: parseFloat(amount),
        customerReference: reference,
        callbackUrl,
      });

      transaction.status = 'pending';
      transaction.service.orderId = apiResponse.reference;
      transaction.providerResponse = apiResponse;
      transaction.statusHistory.push({ 
        status: 'pending', 
        note: `Order received: ${apiResponse.reference}`, 
        timestamp: new Date() 
      });
      await transaction.save();

      res.status(200).json({
        status: 'success',
        message: 'Airtime purchase initiated successfully',
        data: {
          reference,
          orderId: apiResponse.reference,
          phoneNumber,
          network,
          amount: sellingPrice,
          status: 'pending',
          provider: 'smeplug',
        },
      });
    } catch (err) {
      // Refund wallet on failure
      await refundTransactionToWallet(transaction, 'Airtime purchase refund', sellingPrice);

      transaction.status = 'failed';
      transaction.failureReason = err.message;
      transaction.statusHistory.push({ status: 'failed', note: err.message, timestamp: new Date() });
      await transaction.save();

      logger.error(`SMEPlug airtime purchase failed → ${err.message}`);
      return next(new AppError(`Airtime purchase failed: ${err.message}`, 500));
    }
  } catch (error) {
    next(error);
  }
};
