const axios = require('axios');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ServicePricing = require('../models/ServicePricing');
const Wallet = require("../models/Wallet");
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const NelloBytesService = require('../services/nelloBytesService');
const VtuProviderService = require('../services/vtuProviderService');
const AirtimeNigeriaService = require('../services/airtimeNigeriaService');
const SmePlugService = require('../services/smePlugService');
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
    etisalat: '9mobile',
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
      id: plan._id,
      planCode: plan.planCode,
      providerPlanId: plan.providerPlanId || plan.planCode,
      variationCode: plan.variationCode || null,
      provider: plan.provider,
      planName: plan.planName,
      size: plan.size || plan.dataAmount,
      price: plan.sellingPrice,
      costPrice: plan.costPrice,
      validity: plan.validity,
      isAvailable: plan.isAvailable,
      availabilityMessage: plan.availabilityMessage || null,
      providerPlanType: plan.providerPlanType || null,
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

async function getConfiguredDataPlans(providerId, network = null, includeUnavailable = true, dataType = null) {
  const query = {
    serviceType: 'data_recharge',
    provider: providerId,
    isActive: true,
  };

  if (!includeUnavailable) {
    query.isAvailable = true;
  }

  if (network) {
    query.network = normalizeNetwork(network);
  }

  const normalizedType = normalizeDataType(dataType);
  if (normalizedType && normalizedType !== 'all') {
    query.providerPlanType = normalizedType;
  }

  return ServicePricing.find(query)
    .sort({ priority: 1, sellingPrice: 1, planName: 1 })
    .select('-createdBy -updatedBy')
    .lean();
}

async function resolveDataPricing({ providerId, network, planIdentifier, allowUnavailable = false, fallbackPlan = null, dataType = null }) {
  const normalizedNetwork = normalizeNetwork(network);
  const normalizedType = normalizeDataType(dataType);
  const availabilityFilter = allowUnavailable ? [true, false] : [true];
  const planValue = String(planIdentifier);

  const baseQuery = {
    serviceType: 'data_recharge',
    provider: providerId,
    network: normalizedNetwork,
    isActive: true,
    isAvailable: { $in: availabilityFilter },
  };

  if (normalizedType && normalizedType !== 'all') {
    baseQuery.providerPlanType = normalizedType;
  }

  let pricing = await ServicePricing.findOne({
    ...baseQuery,
    $or: [
      { planCode: planValue },
      { providerPlanId: planValue },
      { variationCode: planValue },
      { planName: planValue },
    ],
  });

  if (!pricing && fallbackPlan) {
    pricing = await ServicePricing.findOne({
      ...baseQuery,
      $or: [
        { planName: fallbackPlan.planName },
        { size: fallbackPlan.size },
        { dataAmount: fallbackPlan.dataAmount },
      ].filter((entry) => Object.values(entry)[0]),
    });
  }

  return pricing;
}

function isProviderBalanceError(error) {
  const message = `${error?.response?.data?.message || ''} ${error?.message || ''}`.toLowerCase();
  return message.includes('insufficient') && message.includes('balance');
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

    const configuredPlans = await getConfiguredDataPlans(selectedProviderId, normalizedNetwork, true, normalizedDataType);
    if (configuredPlans.length > 0) {
      const responseData = buildDataPlansResponse(configuredPlans);
      return res.status(200).json({
        status: 'success',
        results: configuredPlans.length,
        data: responseData,
        filters: {
          network: normalizedNetwork || null,
          dataType: normalizedDataType || 'all',
        },
        source: 'admin',
        provider: selectedProviderId,
      });
    }

    const DataService = vtuConfig.getDataPlansService(selectedSource);
    
    if (DataService && DataService.getDataPlans) {
      const rawPlans = await DataService.getDataPlans(normalizedNetwork);
      const unifiedPlans = vtuConfig.transformDataPlans(selectedSource, rawPlans);
      let responseData = applyDataTypeOnUnifiedPlans(unifiedPlans, normalizedDataType);
      if (normalizedNetwork) {
        responseData = { [normalizedNetwork]: responseData[normalizedNetwork] || [] };
      }
      
      return res.status(200).json({
        status: 'success',
        data: responseData,
        filters: {
          network: normalizedNetwork || null,
          dataType: normalizedDataType || 'all',
        },
        source: selectedSource,
        provider: selectedProviderId,
      });
    }

    const fallbackQuery = {
      serviceType: 'data_recharge',
      isActive: true,
      ...(normalizedNetwork ? { network: normalizedNetwork } : {}),
    };
    if (normalizedDataType && normalizedDataType !== 'all') {
      fallbackQuery.providerPlanType = normalizedDataType;
    }

    const fallbackPlans = await ServicePricing.find(fallbackQuery)
      .sort({ priority: 1, sellingPrice: 1 })
      .select('-createdBy -updatedBy')
      .lean();

    res.status(200).json({
      status: 'success',
      results: fallbackPlans.length,
      data: buildDataPlansResponse(fallbackPlans),
      filters: {
        network: normalizedNetwork || null,
        dataType: normalizedDataType || 'all',
      },
      source: 'database',
      provider: selectedProviderId,
    });
  } catch (error) {
    console.error('getDataPlans error:', error);
    next(error);
  }
};

exports.purchaseData = async (req, res, next) => {
  try {
    const { phoneNumber, network, dataPlan, planId, transactionPin, amount, provider, source, dataType } = req.body;
    const planIdentifier = dataPlan || planId;
    const normalizedNetwork = normalizeNetwork(network);
    const normalizedDataType = normalizeDataType(dataType);
    const defaultProvider = await vtuConfig.getProviderIdForService('data');
    const requestedProvider = source
      ? (SOURCE_TO_PROVIDER[source] || defaultProvider)
      : (provider || defaultProvider);
    
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

    // Debit wallet
    await wallet.debit(sellingPrice, `Data purchase: ${network} ${planIdentifier}`);

    const reference = generateReference('DATA');
    const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/nellobytes`;

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
          await ProviderPurchaseGuardService.assertSufficientProviderBalance(
            providerId,
            Number(attemptPricing?.sellingPrice || sellingPrice),
            { serviceType: 'data_recharge', network: normalizedNetwork, phoneNumber }
          );

          if (providerConfig.source === 'airtimenigeria') {
            apiResponse = await AirtimeNigeriaService.purchaseData({
              phone: phoneNumber,
              variationCode: attemptPricing.variationCode,
              packageCode: attemptPricing.planCode || attemptPricing.providerPlanId || planIdentifier,
              planId: attemptPricing.providerPlanId,
              callbackUrl,
              customerReference: reference,
            });
          } else if (providerConfig.source === 'smeplug') {
            apiResponse = await SmePlugService.purchaseData({
              phone: normalizePhoneForSmePlug(phoneNumber),
              network: normalizedNetwork,
              planId: attemptPricing.providerPlanId || attemptPricing.planCode || planIdentifier,
              customerReference: reference,
              callbackUrl: `${SERVER_URL}/api/v1/telecom/webhook/smeplug`,
            });
          } else {
            apiResponse = await NelloBytesService.purchaseData({
              network: normalizedNetwork,
              dataPlan: attemptPricing.providerPlanId || attemptPricing.planCode || planIdentifier,
              mobileNumber: phoneNumber,
              callBackURL: callbackUrl,
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

      if (apiResponse.success || apiResponse.status === 'success' || apiResponse.statusCode === '100') {
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
      await wallet.credit(sellingPrice, 'Data purchase refund');

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
  GLO: 4,
  AIRTEL: 3,
  "9MOBILE": 2,
};

exports.purchaseAirtime = async (req, res, next) => {
  try {
    const { phoneNumber, network, amount, transactionPin, provider, source, bonusType } = req.body;
    const normalizedNetwork = normalizeNetwork(network);
    const parsedAmount = Number(amount);

    if (!phoneNumber || !network || !amount || !transactionPin) {
      return next(new AppError("All fields required", 400));
    }

    if (!normalizedNetwork || !DATA_NETWORKS.includes(normalizedNetwork)) {
      return next(new AppError("Invalid network selected", 400));
    }

    if (Number.isNaN(parsedAmount) || parsedAmount < 50 || parsedAmount > 200000) {
      return next(new AppError("Airtime amount must be between 50 and 200000", 400));
    }

    const defaultProvider = await vtuConfig.getProviderIdForService('airtime');
    const activeProvider = source
      ? (SOURCE_TO_PROVIDER[source] || defaultProvider)
      : (provider || defaultProvider);
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

    await ProviderPurchaseGuardService.assertSufficientProviderBalance(
      activeProvider,
      parsedAmount,
      { serviceType: 'airtime_recharge', network: normalizedNetwork, phoneNumber }
    );

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
      description: `${normalizedNetwork} airtime for ${phoneNumber}`,
      service: {
        provider: activeProvider,
        network: normalizedNetwork,
        phoneNumber,
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
        phone: phoneNumber,
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
        phone: normalizePhoneForSmePlug(phoneNumber),
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
      
    } else {
      apiResponse = await NelloBytesService.purchaseAirtime({
        network: normalizedNetwork,
        amount: parsedAmount,
        mobileNumber: phoneNumber,
        requestId,
        callBackURL: AIRTIME_CALLBACK_URL,
        bonusType,
      });
      responseData = apiResponse.response;
    }

    if (responseData.status === "ORDER_RECEIVED") {
      transaction.status = "pending";

      transaction.service = {
        ...transaction.service,
        orderId: apiResponse?.reference || responseData?.orderid || requestId
      };

      transaction.statusHistory.push({
        status: "pending",
        note: "Order received by provider",
        timestamp: new Date(),
      });

      await transaction.save();
    } else {
      transaction.status = "failed";

      transaction.statusHistory.push({
        status: "failed",
        note: responseData.status || "Provider rejected request",
        timestamp: new Date(),
      });

      await transaction.save();

      await wallet.credit(parsedAmount, "Airtime refund");
    }

    res.status(200).json({
      status: "success",
      message: "Airtime purchase processing",
      data: {
        reference: requestId,
        provider: activeProvider,
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

    const { orderid, orderstatus, statuscode, orderremark } = req.query;

    const transaction = await Transaction.findOne({
      "service.orderId": orderid
    });

    if (!transaction) {
      return res.send("Transaction not found");
    }

    if (transaction.status === "successful") {
      return res.send("Already processed");
    }

    if (orderstatus === "ORDER_COMPLETED" || statuscode === "200") {

      transaction.status = "successful";

      transaction.statusHistory.push({
        status: "successful",
        note: orderremark || "Airtime delivered successfully",
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

    } else {

      transaction.status = "failed";

      transaction.statusHistory.push({
        status: "failed",
        note: orderremark || "Provider reported failure",
        timestamp: new Date()
      });

      await transaction.save();
      
      // Refund wallet and send notification
      const wallet = await Wallet.findOne({ user: transaction.user });
      if (wallet) {
        await wallet.credit(transaction.amount, 'Airtime purchase refund');
      }
      
      await NotificationService.create({
        user: transaction.user,
        title: 'Airtime Purchase Failed',
        message: `Your airtime purchase of ₦${transaction.amount} to ${transaction.service?.phoneNumber} failed. Amount has been refunded.`,
        type: 'airtime_failed',
        reference: transaction.reference,
      });

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

exports.airtimeWebhook = async (req, res) => {
  try {
    const data = { ...(req.body || {}), ...(req.query || {}) };
    const { orderid, statuscode, status, orderstatus, orderremark } = data;

    const transaction = await Transaction.findOne({
      $or: [
        { 'service.orderId': orderid },
        { reference: orderid },
      ],
    });
    if (!transaction) return res.status(404).send('Transaction not found');

    if (transaction.status === 'successful' || transaction.status === 'failed') {
      return res.status(200).send('Already processed');
    }

    transaction.providerResponse = data;

    if (statuscode === "100" || orderstatus === 'ORDER_RECEIVED') {
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: orderremark || status || orderstatus || 'Order received',
        timestamp: new Date(),
      });

    } else if (statuscode === "200" || orderstatus === 'ORDER_COMPLETED') {
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: orderremark || status || 'Confirmed by provider',
        timestamp: new Date(),
      });

      // Send notification for successful airtime purchase
      await NotificationService.airtimePurchase(
        transaction.user,
        transaction.service?.network,
        transaction.amount,
        transaction.service?.phoneNumber
      );

    } else {
      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: orderremark || status || orderstatus || 'Provider failure',
        timestamp: new Date(),
      });

      // Refund wallet on failure
      const wallet = await Wallet.findOne({ user: transaction.user });
      if (wallet) {
        await wallet.credit(transaction.amount, 'Airtime purchase refund');
      }

      // Send notification for failed airtime purchase
      await NotificationService.create({
        user: transaction.user,
        title: 'Airtime Purchase Failed',
        message: `Your airtime purchase of ₦${transaction.amount} to ${transaction.service?.phoneNumber} failed. Amount has been refunded.`,
        type: 'airtime_failed',
        reference: transaction.reference,
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

    const pinValue = parsedValue;
    const totalAmount = pinValue * parsedQuantity;
    if (wallet.balance < totalAmount) {
      return next(new AppError('Insufficient balance', 400));
    }

    await ProviderPurchaseGuardService.assertSufficientProviderBalance(
      'clubkonnect',
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
        provider: 'clubkonnect',
        network: normalizedNetwork,
        plan: String(pinValue),
        quantity: parsedQuantity,
      },
      statusHistory: [{ status: 'pending', note: 'Recharge PIN purchase initiated', timestamp: new Date() }],
    });

    try {
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
          provider: 'clubkonnect',
          providerStatus: providerResponse.status,
        },
      });
    } catch (err) {
      await wallet.credit(totalAmount, 'Recharge PIN refund');

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

/**
 * NelloBytes Webhook Handler
 * Handles callbacks from NelloBytes for data, cable TV, electricity, EPIN, WAEC, JAMB
 */
exports.nelloBytesWebhook = async (req, res, next) => {
  try {
    // NelloBytes sends data as query string or JSON body
    const queryData = req.query;
    const bodyData = req.body;
    
    // Merge both - query params take precedence
    const data = { ...bodyData, ...queryData };
    
    const { orderid, orderstatus, statuscode, orderremark, orderdate } = data;

    if (!orderid) {
      logger.warn('NelloBytes webhook received without orderid');
      return res.status(400).send('Missing orderid');
    }

    logger.info(`NelloBytes webhook received: ${orderid}`, { data });

    // Find transaction by orderId
    const transaction = await Transaction.findOne({
      $or: [
        { 'service.orderId': orderid },
        { reference: orderid }
      ]
    });

    if (!transaction) {
      logger.warn(`Transaction not found for orderid: ${orderid}`);
      return res.status(404).send('Transaction not found');
    }

    // Skip if already processed
    if (transaction.status === 'successful' || transaction.status === 'failed') {
      logger.info(`Transaction ${transaction.reference} already processed`);
      return res.status(200).send('Already processed');
    }

    const user = await User.findById(transaction.user);

    // Handle different status codes
    if (statuscode === '200' || orderstatus === 'ORDER_COMPLETED') {
      // Success
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: orderremark || 'Transaction completed successfully',
        timestamp: new Date(),
      });
      await transaction.save();
      
      // Send notification based on transaction type
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
      
    } else if (statuscode === '100' || orderstatus === 'ORDER_RECEIVED') {
      // Order received, still processing
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: orderremark || 'Order received, processing',
        timestamp: new Date(),
      });
      await transaction.save();
      
    } else if (orderstatus === 'ORDER_ONHOLD') {
      // Order on hold
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: orderremark || 'Order on hold',
        timestamp: new Date(),
      });
      await transaction.save();
      
    } else {
      // Failed - refund wallet
      if (user) {
        const wallet = await Wallet.findOne({ user: user._id });
        if (wallet) {
          await wallet.credit(transaction.amount, 'Transaction failed - refund');
        }
      }

      transaction.status = 'failed';
      transaction.statusHistory.push({
        status: 'failed',
        note: orderremark || 'Transaction failed',
        timestamp: new Date(),
      });
      await transaction.save();

      // Send failure notification
      await NotificationService.create({
        user: transaction.user,
        title: 'Transaction Failed',
        message: `Your ${transaction.type || 'transaction'} of ₦${transaction.amount} has failed. Amount has been refunded to your wallet.`,
        type: 'transaction_failed',
        reference: transaction.reference,
      });
      
      logger.info(`Transaction ${transaction.reference} marked as failed, wallet refunded`);
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('NelloBytes webhook error:', error);
    res.status(500).send('Webhook error');
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
      await wallet.credit(sellingPrice, 'Data purchase refund');

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
      await wallet.credit(amount, 'Airtime purchase refund');

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
    
    // Parse the callback payload
    const result = AirtimeNigeriaService.verifyCallback(payload);
    
    if (!result) {
      return res.status(400).send('Invalid payload');
    }
    
    // Find transaction by reference
    const lookupValues = [result.reference, result.customerReference].filter(Boolean);
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
    
    if (transaction.status === 'successful' || transaction.status === 'failed') {
      return res.status(200).send('Already processed');
    }
    
    // Update transaction based on delivery status
    if (result.status === 'success') {
      transaction.status = 'successful';
      transaction.providerResponse = payload;
      transaction.statusHistory.push({
        status: 'successful',
        note: result.message || 'Delivered successfully',
        timestamp: new Date(),
      });
      
      await transaction.save();
      
      // Send notification
      await NotificationService.create({
        user: transaction.user,
        title: 'Purchase Successful',
        message: `Your ${transaction.type} of ₦${transaction.amount} was successful.`,
        type: 'purchase_success',
        reference: transaction.reference,
      });
    } else {
      transaction.status = 'failed';
      transaction.providerResponse = payload;
      transaction.statusHistory.push({
        status: 'failed',
        note: result.message || 'Delivery failed',
        timestamp: new Date(),
      });
      
      await transaction.save();
      
      // Refund wallet
      const wallet = await Wallet.findOne({ user: transaction.user });
      if (wallet) {
        await wallet.credit(transaction.amount, 'Purchase refund due to failure');
      }
      
      // Send notification
      await NotificationService.create({
        user: transaction.user,
        title: 'Purchase Failed',
        message: `Your ${transaction.type} of ₦${transaction.amount} failed. Amount has been refunded.`,
        type: 'purchase_failed',
        reference: transaction.reference,
      });
    }
    
    res.status(200).send('OK');
  } catch (error) {
    logger.error('AirtimeNigeria webhook error:', error);
    res.status(200).send('OK'); // Always return OK to prevent retries
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
      await wallet.credit(sellingPrice, 'Data purchase refund');

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
      await wallet.credit(sellingPrice, 'Airtime purchase refund');

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
