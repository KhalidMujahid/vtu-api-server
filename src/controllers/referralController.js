const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const ReferralEarning = require('../models/ReferralEarning');
const { AppError } = require('../middlewares/errorHandler');

exports.getReferralList = async (req, res, next) => {
  try {
    const referrals = await User.find({ referredBy: req.user.id })
      .select('firstName lastName email phoneNumber createdAt')
      .sort({ createdAt: -1 });

    const referralIds = referrals.map((u) => u._id);
    const earningsAgg = await ReferralEarning.aggregate([
      {
        $match: {
          referrer: referrals[0]?.referredBy || req.user.id,
          referredUser: { $in: referralIds },
          status: 'credited',
        },
      },
      {
        $group: {
          _id: '$referredUser',
          totalEarned: { $sum: '$amount' },
        },
      },
    ]);
    const earningsMap = new Map(
      earningsAgg.map((item) => [String(item._id), Number(item.totalEarned || 0)])
    );

    const payload = referrals.map((refUser) => ({
      id: refUser._id,
      firstName: refUser.firstName,
      lastName: refUser.lastName,
      email: refUser.email,
      phoneNumber: refUser.phoneNumber,
      createdAt: refUser.createdAt,
      totalEarned: earningsMap.get(String(refUser._id)) || 0,
      earned: earningsMap.get(String(refUser._id)) || 0,
    }));

    res.status(200).json({
      status: 'success',
      data: {
        referrals: payload,
        totalReferrals: payload.length,
        totalEarned: payload.reduce((sum, item) => sum + Number(item.totalEarned || 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.moveBonusToWallet = async (req, res, next) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }

    const bonusAmount = Number(wallet.referralBonus || 0);
    if (bonusAmount <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No referral bonus available to move',
      });
    }

    const previousBalance = Number(wallet.balance || 0);
    wallet.balance = previousBalance + bonusAmount;
    wallet.totalFunded = Number(wallet.totalFunded || 0) + bonusAmount;
    wallet.totalReferralBonusMoved = Number(wallet.totalReferralBonusMoved || 0) + bonusAmount;
    wallet.referralBonus = 0;
    wallet.lastTransaction = new Date();
    await wallet.save();

    const reference = `REFBONUS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await Transaction.create({
      reference,
      user: req.user.id,
      type: 'fund_wallet',
      category: 'funding',
      amount: bonusAmount,
      fee: 0,
      totalAmount: bonusAmount,
      previousBalance,
      newBalance: wallet.balance,
      status: 'successful',
      description: 'Referral bonus moved to wallet',
      metadata: {
        source: 'referral_bonus',
      },
      statusHistory: [
        {
          status: 'successful',
          note: 'Referral bonus moved to wallet balance',
          timestamp: new Date(),
        },
      ],
    });

    res.status(200).json({
      status: 'success',
      message: 'Bonus moved to wallet successfully',
      data: {
        movedAmount: bonusAmount,
        balance: wallet.balance,
        referralBonus: wallet.referralBonus,
      },
    });
  } catch (error) {
    next(error);
  }
};
