require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const ReferralEarning = require('../models/ReferralEarning');
const logger = require('../utils/logger');

const COMMISSION_TYPES = ['commission_earned', 'commission_transfer', 'commission_withdrawal'];
const COMMISSION_SERVICE_TYPES = new Set([
  'data_recharge',
  'airtime_recharge',
  'recharge_pin',
  'electricity',
  'cable_tv',
  'education_pin',
  'bulk_sms',
]);

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function referralPercent() {
  const p = Number(process.env.REFERRAL_EARNING_PERCENT || 1);
  return Number.isNaN(p) || p < 0 ? 1 : p;
}

function referralFixed() {
  const f = Number(process.env.REFERRAL_EARNING_FIXED_AMOUNT || 0);
  return Number.isNaN(f) || f < 0 ? 0 : f;
}

async function backfillAgentCommissions() {
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // All successful, eligible agent purchase transactions that have not yet had
  // commission attached to them. We no longer require a pre-existing
  // commission_earned ledger; we reconstruct commission from scratch per agent.
  const purchaseTransactions = await Transaction.find({
    category: { $ne: 'commission' },
    type: { $nin: COMMISSION_TYPES },
    status: 'successful',
    'metadata.commission': { $exists: false },
  })
    .select('_id reference user amount totalAmount type service createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const users = await User.find({
    _id: { $in: [...new Set(purchaseTransactions.map((tx) => tx.user))] },
  })
    .select('_id role roles agentInfo.commissionRate')
    .lean();

  // agentId -> rate
  const rateByAgent = new Map();
  for (const user of users) {
    const isAgent = user.role === 'agent' || (Array.isArray(user.roles) && user.roles.includes('agent'));
    if (!isAgent) continue;
    const r = Number(user.agentInfo?.commissionRate || 0);
    rateByAgent.set(String(user._id), r > 0 ? r : 1);
  }

  const running = new Map();

  for (const tx of purchaseTransactions) {
    const agentId = String(tx.user);
    const rate = rateByAgent.get(agentId);

    if (!rate) {
      skipped += 1; // not an agent (or agent doc missing)
      continue;
    }

    processed += 1;

    // Skip if a commission ledger for this purchase already exists.
    const existingLedger = await Transaction.exists({
      user: tx.user,
      type: 'commission_earned',
      'metadata.sourceTransaction': tx.reference,
    });
    if (existingLedger) {
      skipped += 1;
      continue;
    }

    try {
      const baseAmount = Number(tx.amount || 0);
      const commission = round2((rate / 100) * baseAmount);
      if (!Number.isFinite(commission) || commission <= 0) {
        skipped += 1;
        continue;
      }

      // Attach commission to the purchase transaction so the dashboard's
      // per-service breakdown reflects it.
      await Transaction.updateOne(
        { _id: tx._id },
        {
          $set: {
            'metadata.commission': commission,
            'metadata.commissionRate': rate,
            'metadata.commissionEarned': true,
            'metadata.agentCommission': {
              amount: commission,
              rate,
              purchaseAmount: baseAmount,
              backfilled: true,
            },
          },
        }
      );

      // Create a commission_earned ledger entry mirroring live crediting.
      try {
        await Transaction.create({
          reference: `COM-EARN-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          user: tx.user,
          type: 'commission_earned',
          category: 'commission',
          amount: commission,
          fee: 0,
          totalAmount: commission,
          status: 'successful',
          description: `Commission earned (${rate}%) from ${tx.type} purchase`,
          metadata: {
            commission,
            commissionEarned: true,
            commissionRate: rate,
            purchaseAmount: baseAmount,
            sourceTransaction: tx.reference,
            serviceType: tx.type,
            backfilled: true,
          },
          completedAt: new Date(),
        });
      } catch (ledgerInnerError) {
        if (ledgerInnerError?.code !== 11000) {
          throw ledgerInnerError;
        }
      }

      const agg = running.get(agentId) || {
        totalCommissionEarned: 0,
        availableCommission: 0,
        totalTransactions: 0,
        totalTransactionAmount: 0,
      };
      agg.totalCommissionEarned = round2(agg.totalCommissionEarned + commission);
      agg.availableCommission = round2(agg.availableCommission + commission);
      agg.totalTransactions += 1;
      agg.totalTransactionAmount = round2(agg.totalTransactionAmount + baseAmount);
      running.set(agentId, agg);

      updated += 1;
    } catch (error) {
      errors += 1;
      logger.error(`Agent commission backfill error for tx ${tx.reference}: ${error.message}`);
    }
  }

  // Persist running totals onto agent docs.
  for (const [agentId, agg] of running.entries()) {
    try {
      await User.updateOne(
        { _id: agentId },
        {
          $inc: {
            'agentInfo.totalCommissionEarned': agg.totalCommissionEarned,
            'agentInfo.availableCommission': agg.availableCommission,
            'agentInfo.totalTransactions': agg.totalTransactions,
            'agentInfo.totalTransactionAmount': agg.totalTransactionAmount,
          },
        }
      );
    } catch (error) {
      errors += 1;
      logger.error(`Agent running-total update error for ${agentId}: ${error.message}`);
    }
  }

  return { processed, updated, skipped, errors };
}

async function backfillReferrals() {
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  const percent = referralPercent();
  const fixedAmount = referralFixed();

  const eligible = await Transaction.find({
    status: 'successful',
    type: { $in: [...COMMISSION_SERVICE_TYPES] },
  })
    .select('_id reference user amount type category createdAt')
    .sort({ createdAt: 1 })
    .lean();

  for (const tx of eligible) {
    processed += 1;
    try {
      const existing = await ReferralEarning.findOne({ sourceTransaction: tx._id }).lean();
      if (existing) {
        skipped += 1;
        continue;
      }

      const user = await User.findById(tx.user).select('_id referredBy');
      if (!user?.referredBy) {
        skipped += 1;
        continue;
      }

      const baseAmount = Number(tx.amount || 0);
      if (Number.isNaN(baseAmount) || baseAmount <= 0) {
        skipped += 1;
        continue;
      }

      const percentEarning = round2((percent / 100) * baseAmount);
      const earning = fixedAmount > 0 ? Math.max(fixedAmount, percentEarning) : percentEarning;
      if (earning <= 0) {
        skipped += 1;
        continue;
      }

      await ReferralEarning.create({
        referrer: user.referredBy,
        referredUser: user._id,
        sourceTransaction: tx._id,
        sourceType: tx.type,
        baseAmount,
        percent,
        amount: earning,
        status: 'credited',
        metadata: {
          reference: tx.reference,
          category: tx.category,
          fixedAmount,
          backfilled: true,
          earningMode: fixedAmount > 0 ? 'max(fixed,percent)' : 'percent',
        },
      });

      await Wallet.findOneAndUpdate(
        { user: user.referredBy },
        {
          $inc: { referralBonus: earning },
          $set: { lastTransaction: new Date() },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      updated += 1;
    } catch (error) {
      if (error?.code === 11000) {
        skipped += 1;
        continue;
      }
      errors += 1;
      logger.error(`Referral backfill error for tx ${tx.reference}: ${error.message}`);
    }
  }

  return { processed, updated, skipped, errors };
}

async function runCommissionsReferralBackfill(options = {}) {
  const { doCommissions = true, doReferrals = true } = options;

  console.log('=== Backfilling agent commissions ===');
  const commissionSummary = doCommissions
    ? await backfillAgentCommissions()
    : { processed: 0, updated: 0, skipped: 0, errors: 0, skippedByFlag: true };
  console.log('Commission summary:', JSON.stringify(commissionSummary));

  console.log('=== Backfilling referral earnings ===');
  const referralSummary = doReferrals
    ? await backfillReferrals()
    : { processed: 0, updated: 0, skipped: 0, errors: 0, skippedByFlag: true };
  console.log('Referral summary:', JSON.stringify(referralSummary));

  return { commission: commissionSummary, referral: referralSummary };
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const doReferrals = !args.includes('--commissions-only');
    const doCommissions = !args.includes('--referrals-only');
    try {
      await connectDB();
      await runCommissionsReferralBackfill({ doCommissions, doReferrals });
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      logger.error('Backfill script failed:', err);
      await mongoose.disconnect();
      process.exit(1);
    }
  })();
}

module.exports = { backfillAgentCommissions, backfillReferrals, runCommissionsReferralBackfill };
