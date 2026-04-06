const User = require('../models/User');
const Wallet = require('../models/Wallet');
const ReferralEarning = require('../models/ReferralEarning');
const logger = require('../utils/logger');

class ReferralEarningService {
  static ELIGIBLE_TRANSACTION_TYPES = new Set([
    'data_recharge',
    'airtime_recharge',
    'recharge_pin',
    'electricity',
    'cable_tv',
    'education_pin',
    'bulk_sms',
  ]);

  static getPercent() {
    const configured = Number(process.env.REFERRAL_EARNING_PERCENT || 1);
    if (Number.isNaN(configured) || configured < 0) return 1;
    return configured;
  }

  static round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  static async processSuccessfulTransaction(transaction) {
    if (!transaction || !transaction._id) return { processed: false, reason: 'invalid_transaction' };
    if (transaction.status !== 'successful') return { processed: false, reason: 'not_successful' };
    if (!this.ELIGIBLE_TRANSACTION_TYPES.has(transaction.type)) return { processed: false, reason: 'ineligible_type' };

    const user = await User.findById(transaction.user).select('_id referredBy');
    if (!user?.referredBy) return { processed: false, reason: 'no_referrer' };

    const baseAmount = Number(transaction.amount || 0);
    if (Number.isNaN(baseAmount) || baseAmount <= 0) return { processed: false, reason: 'invalid_amount' };

    const percent = this.getPercent();
    const earningAmount = this.round2((percent / 100) * baseAmount);
    if (earningAmount <= 0) return { processed: false, reason: 'zero_earning' };

    let ledger;
    try {
      ledger = await ReferralEarning.create({
        referrer: user.referredBy,
        referredUser: user._id,
        sourceTransaction: transaction._id,
        sourceType: transaction.type,
        baseAmount,
        percent,
        amount: earningAmount,
        status: 'credited',
        metadata: {
          reference: transaction.reference,
          category: transaction.category,
        },
      });
    } catch (error) {
      if (error?.code === 11000) {
        return { processed: false, reason: 'already_credited' };
      }
      throw error;
    }

    await Wallet.findOneAndUpdate(
      { user: user.referredBy },
      {
        $inc: { referralBonus: earningAmount },
        $set: { lastTransaction: new Date() },
      },
      { new: true }
    );

    logger.info(
      `Referral earning credited: tx=${transaction.reference || transaction._id}, referrer=${user.referredBy}, amount=${earningAmount}`
    );

    return {
      processed: true,
      amount: earningAmount,
      percent,
      ledgerId: ledger._id,
    };
  }
}

module.exports = ReferralEarningService;

