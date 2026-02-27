const WalletService = require('../services/walletService');
const TransactionService = require('../services/transactionService');
const { AppError } = require('../middlewares/errorHandler');
const Wallet = require("../models/Wallet");
const User = require("../models/User");
const logger = require('../utils/logger');

exports.getWalletBalance = async (req, res, next) => {
  try {
    const wallet = await WalletService.getWallet(req.user.id);
    
    res.status(200).json({
      status: 'success',
      data: {
        balance: wallet.balance,
        currency: wallet.currency,
        locked: wallet.locked,
        totalFunded: wallet.totalFunded,
        totalWithdrawn: wallet.totalWithdrawn,
        totalSpent: wallet.totalSpent,
        lastTransaction: wallet.lastTransaction,
        accounts: wallet.accountNumbers,
        primaryAccount: wallet.primaryAccountNumber,
      },
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({
        status: 'error',
        message: 'Wallet not found. Please create a wallet first.',
        data: {
          needsWalletCreation: true
        }
      });
    }
    next(error);
  }
};

exports.getWalletAccounts = async (req, res, next) => {
  try {
    const accounts = await WalletService.getFundingAccounts(req.user.id);
    
    res.status(200).json({
      status: 'success',
      data: accounts
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({
        status: 'error',
        message: 'Wallet not found. Please create a wallet first.',
        data: {
          needsWalletCreation: true
        }
      });
    }
    next(error);
  }
};

exports.checkWalletStatus = async (req, res, next) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    
    res.status(200).json({
      status: 'success',
      data: {
        hasWallet: !!wallet,
        walletExists: !!wallet,
        ...(wallet && {
          balance: wallet.balance,
          currency: wallet.currency,
          locked: wallet.locked,
          accountsCount: wallet.monnifyAccounts?.length || 0
        })
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.refreshWalletAccounts = async (req, res, next) => {
  try {
    const wallet = await WalletService.refreshMonnifyAccounts(req.user.id);
    
    res.status(200).json({
      status: 'success',
      message: 'Wallet accounts refreshed successfully',
      data: {
        accounts: wallet.accountNumbers,
        primaryAccount: wallet.primaryAccountNumber
      }
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({
        status: 'error',
        message: 'Wallet not found. Please create a wallet first.'
      });
    }
    next(error);
  }
};

exports.fundWallet = async (req, res, next) => {
  try {
    const { amount, paymentMethod } = req.body;
    
    if (!amount || amount <= 0) {
      return next(new AppError('Please provide a valid amount', 400));
    }
    
    const reference = `FUND-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const transaction = await TransactionService.createTransaction({
      reference,
      user: req.user.id,
      type: 'fund_wallet',
      category: 'funding',
      amount,
      fee: 0,
      totalAmount: amount,
      previousBalance: 0,
      newBalance: 0,
      status: 'pending',
      description: `Wallet funding via ${paymentMethod}`,
      paymentGateway: {
        name: paymentMethod,
      },
      metadata: {
        amount,
        paymentMethod,
      },
    });
    
    let paymentUrl;
    switch (paymentMethod) {
      case 'paystack':
        paymentUrl = `https://paystack.com/pay/${reference}`;
        break;
      case 'monnify':
        paymentUrl = `https://monnify.com/pay/${reference}`;
        break;
      case 'flutterwave':
        paymentUrl = `https://flutterwave.com/pay/${reference}`;
        break;
      default:
        return next(new AppError('Invalid payment method', 400));
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Payment initialized',
      data: {
        transaction,
        paymentUrl,
        reference,
      },
    });
    
    logger.info(`Wallet funding initiated: User ${req.user.id}, Amount: ${amount}, Method: ${paymentMethod}`);
  } catch (error) {
    next(error);
  }
};

exports.transferToUser = async (req, res, next) => {
  try {
    const { recipientEmail, recipientPhone, amount, transactionPin, description } = req.body;
    
    if (!amount || amount <= 0) {
      return next(new AppError('Please provide a valid amount', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
    }
    
    let recipient;
    if (recipientEmail) {
      recipient = await User.findOne({ email: recipientEmail });
    } else if (recipientPhone) {
      recipient = await User.findOne({ phoneNumber: recipientPhone });
    } else {
      return next(new AppError('Please provide recipient email or phone', 400));
    }
    
    if (!recipient) {
      return next(new AppError('Recipient not found', 404));
    }
    
    if (recipient._id.toString() === req.user.id.toString()) {
      return next(new AppError('Cannot transfer to yourself', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const result = await WalletService.transferFunds(
      req.user.id,
      recipient._id,
      amount,
      transactionPin
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Transfer successful',
      data: {
        transferReference: result.transferTransaction.reference,
        amount,
        fee: result.feeTransaction.amount,
        recipient: {
          id: recipient._id,
          name: recipient.fullName,
          email: recipient.email,
          phone: recipient.phoneNumber,
        },
        newBalance: result.senderWallet.balance,
      },
    });
    
    logger.info(`Transfer completed: From ${req.user.id} to ${recipient._id}, Amount: ${amount}`);
  } catch (error) {
    next(error);
  }
};

exports.withdrawToBank = async (req, res, next) => {
  try {
    const { amount, bankCode, accountNumber, transactionPin } = req.body;
    
    if (!amount || amount <= 0) {
      return next(new AppError('Please provide a valid amount', 400));
    }
    
    if (!bankCode || !accountNumber) {
      return next(new AppError('Bank details are required', 400));
    }
    
    if (!transactionPin) {
      return next(new AppError('Transaction PIN is required', 400));
    }
    
    const user = await User.findById(req.user.id).select('+transactionPin');
    const isPinValid = await user.compareTransactionPin(transactionPin);
    
    if (!isPinValid) {
      return next(new AppError('Invalid transaction PIN', 401));
    }
    
    const wallet = await WalletService.getWallet(req.user.id);
    
    if (wallet.locked) {
      return next(new AppError('Wallet is locked', 400));
    }
    
    const fee = Math.max(50, amount * 0.015);
    const totalAmount = amount + fee;
    
    if (wallet.balance < totalAmount) {
      return next(new AppError('Insufficient balance to cover amount and fee', 400));
    }
    
    const reference = `WDL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const transaction = await TransactionService.createTransaction({
      reference,
      user: req.user.id,
      type: 'withdrawal',
      category: 'transfer',
      amount,
      fee,
      totalAmount: totalAmount,
      previousBalance: wallet.balance,
      newBalance: wallet.balance - totalAmount,
      status: 'pending',
      description: `Bank withdrawal to ${accountNumber}`,
      metadata: {
        bankCode,
        accountNumber,
        feeBreakdown: {
          withdrawalFee: fee,
        },
      },
    });
    
    await WalletService.debitWallet(
      req.user.id,
      totalAmount,
      reference,
      `Bank withdrawal to ${accountNumber}`
    );
    
    setTimeout(async () => {
      try {
        await Transaction.findByIdAndUpdate(transaction._id, {
          status: 'successful',
          statusHistory: [
            ...transaction.statusHistory,
            {
              status: 'successful',
              note: 'Bank transfer completed',
              timestamp: new Date(),
            },
          ],
          completedAt: new Date(),
        });
      } catch (error) {
        logger.error('Error updating withdrawal transaction:', error);
      }
    }, 5000);
    
    res.status(200).json({
      status: 'success',
      message: 'Withdrawal request submitted',
      data: {
        reference,
        amount,
        fee,
        totalDebited: totalAmount,
        estimatedDelivery: 'Within 24 hours',
        transaction,
      },
    });
    
    logger.info(`Withdrawal requested: User ${req.user.id}, Amount: ${amount}, Bank: ${bankCode}`);
  } catch (error) {
    next(error);
  }
};

exports.getTransactionHistory = async (req, res, next) => {
  try {
    const { page, limit, type, status, startDate, endDate, search } = req.query;
    
    const filters = {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      type,
      status,
      startDate,
      endDate,
      search,
    };
    
    const result = await TransactionService.getUserTransactions(req.user.id, filters);
    
    res.status(200).json({
      status: 'success',
      data: {
        transactions: result.transactions,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.createWallet = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { nin, bvn } = req.body;

    const verificationId = bvn || nin;

    if (!verificationId) {
      return next(new AppError('BVN or NIN is required to create a wallet', 400));
    }

    if (!/^\d{11}$/.test(verificationId)) {
      return next(new AppError('BVN/NIN must be exactly 11 digits', 400));
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const existingWallet = await Wallet.findOne({ user: userId });
    if (existingWallet) {
      return next(new AppError('Wallet already exists for this user', 400));
    }

    logger.info(`Creating wallet for user: ${userId}`);

    const wallet = await WalletService.createWallet(user, { bvn, nin });

    res.status(201).json({
      status: 'success',
      message: 'Wallet created successfully',
      data: {
        wallet: {
          balance: wallet.balance,
          currency: wallet.currency,
          locked: wallet.locked,
          accounts: wallet.monnifyAccounts.map(acc => ({
            bankName: acc.bankName,
            accountNumber: acc.accountNumber,
            accountName: acc.accountName,
            isDefault: acc.isDefault
          })),
          primaryAccount: wallet.monnifyAccounts.find(a => a.isDefault)?.accountNumber,
          totalFunded: wallet.totalFunded,
          totalSpent: wallet.totalSpent,
          createdAt: wallet.createdAt
        }
      }
    });

  } catch (error) {
    logger.error('Error creating wallet:', error);

    if (error.message.includes('Monnify')) {
      return next(new AppError('Unable to create wallet at this time. Please try again later.', 503));
    }

    next(error);
  }
};

exports.setTransactionPin = async (req, res, next) => {
  try {
    const { transactionPin, confirmPin } = req.body;
    
    if (!transactionPin || !confirmPin) {
      return next(new AppError('Please provide transaction PIN and confirmation', 400));
    }
    
    if (transactionPin !== confirmPin) {
      return next(new AppError('PINs do not match', 400));
    }
    
    if (transactionPin.length !== 4 || !/^\d+$/.test(transactionPin)) {
      return next(new AppError('Transaction PIN must be 4 digits', 400));
    }
    
    const user = await User.findById(req.user.id);
    
    if (user.transactionPin) {
      return next(new AppError('Transaction PIN already set', 400));
    }
    
    user.transactionPin = transactionPin;
    await user.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Transaction PIN set successfully',
    });
    
    logger.info(`Transaction PIN set for user: ${req.user.id}`);
  } catch (error) {
    next(error);
  }
};


exports.updateTransactionPin = async (req, res, next) => {
  try {
    const { transactionPin, confirmPin } = req.body;
    
    if (!transactionPin || !confirmPin) {
      return next(new AppError('Please provide transaction PIN and confirmation', 400));
    }
    
    if (transactionPin !== confirmPin) {
      return next(new AppError('PINs do not match', 400));
    }
    
    if (transactionPin.length !== 4 || !/^\d+$/.test(transactionPin)) {
      return next(new AppError('Transaction PIN must be 4 digits', 400));
    }
    
    const user = await User.findById(req.user.id);
    
    if (user.transactionPin) {
      return next(new AppError('Transaction PIN already set', 400));
    }
    
    user.transactionPin = transactionPin;
    await user.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Transaction PIN set successfully',
    });
    
    logger.info(`Transaction PIN set for user: ${req.user.id}`);
  } catch (error) {
    next(error);
  }
};

exports.updateTransactionPin = async (req, res, next) => {
  try {
    const { oldPin, transactionPin, confirmPin } = req.body;

    if (!oldPin || !transactionPin || !confirmPin) {
      return next(
        new AppError("Please provide old PIN, new PIN and confirmation", 400)
      );
    }

    if (transactionPin !== confirmPin) {
      return next(new AppError("New PIN and confirmation PIN do not match", 400));
    }

    if (!/^\d{4}$/.test(transactionPin)) {
      return next(new AppError("Transaction PIN must be exactly 4 digits", 400));
    }

    const user = await User.findById(req.user.id).select("+transactionPin");

    if (!user) {
      return next(new AppError("User not found", 404));
    }

    if (!user.transactionPin) {
      return next(new AppError("Transaction PIN has not been set yet", 400));
    }

    const isCorrectPin = await bcrypt.compare(oldPin, user.transactionPin);

    if (!isCorrectPin) {
      return next(new AppError("Incorrect old PIN", 400));
    }

    const isSamePin = await bcrypt.compare(transactionPin, user.transactionPin);
    if (isSamePin) {
      return next(new AppError("New PIN cannot be the same as old PIN", 400));
    }

    const hashedPin = await bcrypt.hash(transactionPin, 12);

    user.transactionPin = hashedPin;
    await user.save();

    logger.info(`Transaction PIN updated for user: ${req.user.id}`);

    res.status(200).json({
      status: "success",
      message: "Transaction PIN updated successfully",
    });
  } catch (error) {
    next(error);
  }
};