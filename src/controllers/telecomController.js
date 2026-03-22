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
const vtuConfig = require('../config/vtuProviders');
const crypto = require('crypto');

const SERVER_URL = process.env.SERVER_URL || 'https://api.yareemadata.com';
const AIRTIME_CALLBACK_URL = process.env.AIRTIME_CALLBACK_URL || `${SERVER_URL}/api/v1/telecom/airtime/webhook`;

function generateReference(prefix = 'TX') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

exports.getDataPlans = async (req, res, next) => {
  try {
    const { network, source } = req.query;
    
    // Get active provider from config (API console setting) - always fetches fresh from DB
    const activeProviderId = await vtuConfig.getProviderIdForService('data');
    const activeProvider = vtuConfig.providers[activeProviderId];
    const providerSource = activeProvider?.source || 'nellobytes';
    
    // If source is explicitly specified in query, use that
    const selectedSource = source || providerSource;
    
    console.log('getDataPlans - activeProviderId:', activeProviderId, 'providerSource:', providerSource, 'selectedSource:', selectedSource);
    
    // Get the service class based on source
    const DataService = vtuConfig.getDataPlansService(selectedSource);
    
    if (DataService && DataService.getDataPlans) {
      // Fetch from provider API
      const rawPlans = await DataService.getDataPlans(network);
      
      // Transform to unified format
      const unifiedPlans = vtuConfig.transformDataPlans(selectedSource, rawPlans);
      
      // Filter by network if specified
      let responseData = unifiedPlans;
      if (network) {
        const normalizedNetwork = network.toLowerCase();
        responseData = { [normalizedNetwork]: unifiedPlans[normalizedNetwork] || [] };
      }
      
      return res.status(200).json({
        status: 'success',
        data: responseData,
        source: selectedSource,
        provider: activeProviderId,
      });
    }
    
    // Fallback: fetch from database if provider not recognized
    console.log('getDataPlans - falling back to database, selectedSource:', selectedSource);
    const query = { serviceType: 'data_recharge', isActive: true, isAvailable: true };

    if (network) {
      const allowedNetworks = ['mtn', 'glo', 'airtel', '9mobile'];
      if (!allowedNetworks.includes(network.toLowerCase())) {
        return next(new AppError('Invalid network provider', 400));
      }
      query.network = network.toLowerCase();
    }

    const dataPlans = await ServicePricing.find(query)
      .sort({ sellingPrice: 1 })
      .select('-costPrice -profitMargin -createdBy -updatedBy')
      .lean();

    const groupedPlans = dataPlans.reduce((acc, plan) => {
      acc[plan.network] = acc[plan.network] || [];
      acc[plan.network].push({
        id: plan._id,
        planCode: plan.planCode,
        planName: plan.planName,
        size: plan.size,
        price: plan.sellingPrice,
        validity: plan.validity,
      });
      return acc;
    }, {});

    res.status(200).json({ status: 'success', results: dataPlans.length, data: groupedPlans, source: 'database', provider: activeProviderId });
  } catch (error) {
    console.error('getDataPlans error:', error);
    next(error);
  }
};

exports.purchaseData = async (req, res, next) => {
  try {
    const { phoneNumber, network, dataPlan, planId, transactionPin, amount, provider, source } = req.body;
    
    // Support both dataPlan and planId for backward compatibility
    const planIdentifier = dataPlan || planId;
    
    // Get default provider for data from config - always fetches fresh from DB
    const defaultProvider = await vtuConfig.getProviderIdForService('data');
    
    // Determine active provider: source parameter overrides default config
    // source maps to provider's source property (nellobytes, airtimenigeria, smeplug)
    let activeProvider;
    if (source) {
      // Map source to provider ID
      const sourceToProvider = {
        'nellobytes': 'clubkonnect',
        'airtimenigeria': 'airtimenigeria',
        'smeplug': 'smeplug'
      };
      activeProvider = sourceToProvider[source] || defaultProvider;
    } else if (provider) {
      activeProvider = provider;
    } else {
      activeProvider = defaultProvider;
    }
    
    // Get provider info to determine which source/service to use
    const providerConfig = vtuConfig.providers[activeProvider];
    const activeSource = providerConfig?.source || 'nellobytes';
    
    // More specific validation
    if (!phoneNumber) {
      return next(new AppError('Phone number is required', 400));
    }
    if (!network) {
      return next(new AppError('Network is required', 400));
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

    // Get pricing from database, provider API, or use provided amount
    let pricing = null;
    let sellingPrice = 0;

    if (amount && !isNaN(amount) && parseFloat(amount) > 0) {
      // Use amount provided by user
      sellingPrice = parseFloat(amount);
      pricing = { sellingPrice };
    } else {
      // Try to get pricing from database first
      pricing = await ServicePricing.findOne({
        serviceType: 'data_recharge',
        network: network.toLowerCase(),
        planCode: planIdentifier,
        isActive: true,
        isAvailable: true,
      });

      if (!pricing) {
        // If not in database, try to get from provider API
        console.log('Plan not in database, trying provider API for:', planIdentifier);
        
        // Get price from provider API based on activeSource
        try {
          let providerPrice = null;
          
          if (activeSource === 'airtimenigeria') {
            // Get price from AirtimeNigeria
            const plans = await AirtimeNigeriaService.getDataPlans(network.toLowerCase());
            const plan = plans?.data?.[network.toLowerCase()]?.find(p => 
              p.planId == planIdentifier || p.planCode === planIdentifier || p.planName === planIdentifier
            );
            providerPrice = plan?.price;
          } else if (activeSource === 'smeplug') {
            // Get price from SMEPlug
            const plans = await SmePlugService.getDataPlans(network.toLowerCase());
            const plan = plans?.plans?.[network.toLowerCase()]?.find(p => 
              p.id == planIdentifier || p.planCode === planIdentifier || p.planName === planIdentifier
            );
            providerPrice = plan?.price;
          } else {
            // Default: Get price from NelloBytes
            const plans = await NelloBytesService.getDataPlans(network.toLowerCase());
            // Find in nested structure
            const mobileNetwork = plans?.MOBILE_NETWORK || {};
            for (const networkKey of Object.values(mobileNetwork)) {
              if (Array.isArray(networkKey)) {
                const plan = networkKey.find(p => 
                  p.PRODUCT_ID == planIdentifier || p.PRODUCT_CODE === planIdentifier || p.PRODUCT_NAME === planIdentifier
                );
                if (plan) {
                  providerPrice = parseFloat(plan.PRODUCT_AMOUNT);
                  break;
                }
              }
            }
          }
          
          if (providerPrice) {
            sellingPrice = providerPrice;
            console.log('Found price from provider API:', sellingPrice);
          } else {
            return next(new AppError('Data plan not found. Please provide an amount.', 404));
          }
        } catch (apiError) {
          console.error('Error fetching price from provider API:', apiError.message);
          return next(new AppError('Data plan not available. Please provide an amount.', 404));
        }
      } else {
        sellingPrice = pricing.sellingPrice;
      }
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
      description: `${network.toUpperCase()} ${planIdentifier} for ${phoneNumber}`,
      service: {
        provider: activeProvider,
        network: network.toLowerCase(),
        plan: planIdentifier,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: `Purchase initiated via ${activeProvider}`, timestamp: new Date() }],
    });

    try {
      let apiResponse;
      
      // Route to the appropriate provider based on source
      // activeSource comes from provider config (nellobytes, airtimenigeria, smeplug)
      if (activeSource === 'airtimenigeria') {
        // Use AirtimeNigeria API
        
        // Resolve plan name to plan ID if needed
        let resolvedPlanId = planIdentifier;
        if (isNaN(parseInt(planIdentifier)) && !planIdentifier.includes('_')) {
          // It's a plan name, not an ID - fetch from API to get the ID
          try {
            const plansData = await AirtimeNigeriaService.getDataPlans(network.toLowerCase());
            const plans = plansData?.data?.[network.toLowerCase()] || [];
            const foundPlan = plans.find(p => p.planName === planIdentifier || p.planId == planIdentifier || p.planCode === planIdentifier);
            if (foundPlan) {
              resolvedPlanId = foundPlan.planId?.toString() || foundPlan.planCode;
              console.log('Resolved AirtimeNigeria plan:', planIdentifier, '->', resolvedPlanId);
            }
          } catch (e) {
            console.error('Error resolving plan ID:', e.message);
          }
        }
        
        apiResponse = await AirtimeNigeriaService.purchaseData({
          phone: phoneNumber,
          packageCode: resolvedPlanId,
          callbackUrl,
          customerReference: reference,
        });
        transaction.service.provider = 'airtimenigeria';
        
      } else if (activeSource === 'smeplug') {
        // Use SMEPlug API
        const smeCallbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
        
        // Format phone number for SMEPlug (remove leading 0, add 234)
        let formattedPhone = phoneNumber;
        if (phoneNumber.startsWith('0')) {
          formattedPhone = '234' + phoneNumber.substring(1);
        } else if (!phoneNumber.startsWith('234')) {
          formattedPhone = '234' + phoneNumber;
        }
        console.log('SMEPlug formatted phone:', formattedPhone);
        
        // Resolve plan name to plan ID if needed
        let resolvedPlanId = planIdentifier;
        
        // First check if it's a numeric ID already
        if (!isNaN(parseInt(planIdentifier))) {
          resolvedPlanId = parseInt(planIdentifier).toString();
          console.log('SMEPlug using numeric planId:', resolvedPlanId);
        } else {
          // It's a plan name, not an ID - fetch from API to get the ID
          try {
            console.log('SMEPlug resolving plan name:', planIdentifier, 'network:', network.toLowerCase());
            const plansData = await SmePlugService.getDataPlans(network.toLowerCase());
            console.log('SMEPlug plans response keys:', Object.keys(plansData || {}));
            const plans = plansData?.plans?.[network.toLowerCase()] || [];
            console.log('SMEPlug plans for', network, ':', plans.length, 'plans');
            
            const foundPlan = plans.find(p => p.planName === planIdentifier);
            if (foundPlan) {
              resolvedPlanId = foundPlan.id.toString();
              console.log('Resolved SMEPlug plan:', planIdentifier, '-> id:', resolvedPlanId);
            } else {
              console.log('Plan not found in SMEPlug plans, trying direct purchase with name');
            }
          } catch (e) {
            console.error('Error resolving plan ID:', e.message);
          }
        }
        
        console.log('SMEPlug final - phone:', formattedPhone, 'planId:', resolvedPlanId, 'network:', network.toLowerCase());
        
        apiResponse = await SmePlugService.purchaseData({
          phone: formattedPhone,
          network: network.toLowerCase(),
          planId: resolvedPlanId,
          customerReference: reference,
          callbackUrl: smeCallbackUrl,
        });
        transaction.service.provider = 'smeplug';
        
      } else {
        // Default: Use NelloBytes (Club Konnect) - also handles 'nellobytes' source
        apiResponse = await NelloBytesService.purchaseData({
          network: network.toLowerCase(),
          dataPlan: planIdentifier,
          mobileNumber: phoneNumber,
          callBackURL: callbackUrl,
        });
        transaction.service.provider = activeProvider; // Use the actual provider ID
        transaction.service.provider = 'nellobytes';
      }

      // Check if successful
      if (apiResponse.success || apiResponse.status === 'success' || apiResponse.statusCode === '100') {
        transaction.status = 'pending';
        transaction.service.orderId = apiResponse.reference || apiResponse.orderId;
        transaction.providerResponse = apiResponse;
        transaction.statusHistory.push({ 
          status: 'pending', 
          note: `Order received: ${apiResponse.reference || apiResponse.orderId}`, 
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
            network,
            dataPlan: planIdentifier,
            amount: sellingPrice,
            status: 'pending',
            provider: activeProvider,
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
    const { phoneNumber, network, amount, transactionPin, provider } = req.body;

    if (!phoneNumber || !network || !amount || !transactionPin) {
      return next(new AppError("All fields required", 400));
    }

    // Get default provider for airtime from config - always fetches fresh from DB
    const defaultProvider = await vtuConfig.getProviderIdForService('airtime');
    const activeProvider = provider || defaultProvider;

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

    if (wallet.balance < amount) {
      return next(new AppError("Insufficient wallet balance", 400));
    }

    const networkCode = networkMap[network.toUpperCase()];
    if (!networkCode) {
      return next(new AppError("Invalid network selected", 400));
    }

    const requestId = `AIR-${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")}`;

    const profitPercent = profitConfig[network.toUpperCase()] || 0;
    const profit = (profitPercent / 100) * amount;

    await wallet.debit(amount, "Airtime purchase");

    const transaction = await Transaction.create({
      reference: requestId,
      user: user._id,
      type: "airtime_recharge",
      category: "telecom",
      amount,
      profit,
      totalAmount: amount,
      status: "pending",
      description: `${network} airtime for ${phoneNumber}`,
      service: {
        provider: activeProvider,
        network,
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

    // Route to the appropriate provider
    if (activeProvider === 'airtimenigeria') {
      // Use AirtimeNigeria API
      apiResponse = await AirtimeNigeriaService.purchaseAirtime({
        network: network.toLowerCase(),
        phone: phoneNumber,
        amount: parseInt(amount),
        maxAmount: parseInt(amount),
        customerReference: requestId,
      });
      responseData = { status: apiResponse.status === 'success' ? 'ORDER_RECEIVED' : 'FAILED' };
      
    } else if (activeProvider === 'smeplug') {
      // Use SMEPlug API
      const smeCallbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
      apiResponse = await SmePlugService.purchaseAirtime({
        phone: phoneNumber,
        network: network.toLowerCase(),
        amount: parseInt(amount),
        customerReference: requestId,
        callbackUrl: smeCallbackUrl,
      });
      responseData = { status: apiResponse.status === 'success' ? 'ORDER_RECEIVED' : 'FAILED' };
      
    } else {
      // Default: Use NelloBytes
      apiResponse = await axios.get(
        "https://www.nellobytesystems.com/APIAirtimeV1.asp",
        {
          params: {
            UserID: process.env.NELLO_USER_ID,
            APIKey: process.env.NELLO_API_KEY,
            MobileNetwork: networkCode,
            Amount: amount,
            MobileNumber: phoneNumber,
            RequestID: requestId,
            CallBackURL: AIRTIME_CALLBACK_URL,
          },
          timeout: 10000,
        }
      );
      responseData = apiResponse.data;
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

      await wallet.credit(amount, "Airtime refund");
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

  const response = await axios.get(
    "https://www.nellobytesystems.com/APIQueryV1.asp",
    {
      params: {
        UserID: process.env.NELLO_USER_ID,
        APIKey: process.env.NELLO_API_KEY,
        RequestID: requestId,
      },
    }
  );

  return response.data;
};

exports.airtimeWebhook = async (req, res) => {
  try {
    const { orderid, statuscode, status } = req.body;

    const transaction = await Transaction.findOne({ reference: orderid });
    if (!transaction) return res.status(404).send('Transaction not found');

    if (transaction.status === 'successful' || transaction.status === 'failed') {
      return res.status(200).send('Already processed');
    }

    if (statuscode === "100") {
      transaction.status = 'pending';
      transaction.statusHistory.push({
        status: 'pending',
        note: status,
        timestamp: new Date(),
      });

    } else if (statuscode === "200") {
      transaction.status = 'successful';
      transaction.statusHistory.push({
        status: 'successful',
        note: 'Confirmed by provider',
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
        note: status || 'Provider failure',
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
    const { network, pinType, quantity = 1, transactionPin } = req.body;
    if (!network || !pinType || !transactionPin) return next(new AppError('All fields required', 400));

    const user = await User.findById(req.user.id).select('+transactionPin walletBalance');
    if (!(await user.compareTransactionPin(transactionPin))) return next(new AppError('Invalid transaction PIN', 401));

    const pricing = await ServicePricing.findOne({ serviceType: 'recharge_pin', network, planName: pinType, isActive: true });
    if (!pricing) return next(new AppError('PIN not available', 404));

    const totalAmount = pricing.sellingPrice * quantity;
    if (user.walletBalance < totalAmount) return next(new AppError('Insufficient balance', 400));

    user.walletBalance -= totalAmount;
    await user.save();

    const reference = generateReference('PIN');
    const pins = Array.from({ length: quantity }, (_, i) => ({
      pin: Math.floor(1000000000 + Math.random() * 9000000000).toString(),
      serial: `SN${Date.now()}${i}`.substring(0, 12),
      expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }));

    const transaction = await Transaction.create({
      reference,
      user: user._id,
      type: 'recharge_pin',
      category: 'telecom',
      amount: totalAmount,
      totalAmount,
      status: 'successful',
      description: `${network.toUpperCase()} ${pinType} x${quantity}`,
      service: { provider: network, plan: pinType, quantity },
      providerResponse: { pins },
      statusHistory: [{ status: 'successful', note: 'Recharge PIN generated', timestamp: new Date() }],
    });

    res.status(200).json({
      status: 'success',
      message: 'Recharge PIN generated successfully',
      data: { reference, network, pinType, quantity, pins },
    });
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
    const { phoneNumber, network, packageCode, planId, transactionPin } = req.body;
    
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
    
    const sellingPrice = plan.price;
    
    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

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
    const payload = req.body;
    logger.info('AirtimeNigeria webhook received:', payload);
    
    // Parse the callback payload
    const result = AirtimeNigeriaService.verifyCallback(payload);
    
    if (!result) {
      return res.status(400).send('Invalid payload');
    }
    
    // Find transaction by reference
    const transaction = await Transaction.findOne({ 'service.orderId': result.reference });
    
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
    const { phoneNumber, network, planId, transactionPin } = req.body;
    
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

    // For SMEPlug, we'll use a default price since we don't have the plan list
    // In production, you should fetch the plan price first
    const sellingPrice = 200; // Default placeholder - should fetch from API
    
    if (wallet.balance < sellingPrice) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

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
        network: network.toLowerCase(),
        plan: planId,
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Purchase initiated via SMEPlug', timestamp: new Date() }],
    });

    try {
      const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
      const apiResponse = await SmePlugService.purchaseData({
        phone: phoneNumber,
        network: network.toLowerCase(),
        planId,
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
        network: network.toLowerCase(),
        phoneNumber,
      },
      statusHistory: [{ status: 'pending', note: 'Airtime purchase initiated via SMEPlug', timestamp: new Date() }],
    });

    try {
      const callbackUrl = `${SERVER_URL}/api/v1/telecom/webhook/smeplug`;
      const apiResponse = await SmePlugService.purchaseAirtime({
        phone: phoneNumber,
        network: network.toLowerCase(),
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

/**
 * SMEPlug Webhook Handler
 */
exports.smePlugWebhook = async (req, res) => {
  try {
    const payload = req.body;
    logger.info('SMEPlug webhook received:', payload);

    const result = SmePlugService.verifyCallback(payload);

    if (!result) {
      return res.status(400).send('Invalid payload');
    }

    logger.info('Parsed webhook result:', result);

    const transaction = await Transaction.findOne({
      'service.orderId': result.reference,
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
      transaction.statusHistory.push({
        status: 'failed',
        note: result.message || 'Delivery failed',
        timestamp: new Date(),
      });

      await transaction.save();
      const wallet = await Wallet.findOne({ user: transaction.user });

      if (wallet) {
        await wallet.credit(
          transaction.amount,
          'Purchase refund due to failure'
        );
      }

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