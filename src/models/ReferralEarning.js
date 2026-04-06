const mongoose = require('mongoose');

const referralEarningSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sourceTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
      unique: true,
    },
    sourceType: {
      type: String,
      required: true,
    },
    baseAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    percent: {
      type: Number,
      required: true,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['credited'],
      default: 'credited',
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

referralEarningSchema.index({ referrer: 1, createdAt: -1 });
referralEarningSchema.index({ referredUser: 1, createdAt: -1 });

module.exports = mongoose.model('ReferralEarning', referralEarningSchema);

