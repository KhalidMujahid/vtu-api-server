const mongoose = require('mongoose');

const giftCardProductSchema = new mongoose.Schema({
  provider: {
    type: String,
    required: true,
    index: true,
  },
  providerProductId: {
    type: String,
    required: true,
    index: true,
  },
  productId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    index: true,
  },
  description: String,
  country: String,
  currency: {
    type: String,
    default: 'USD',
    index: true,
  },
  fixed: {
    type: Boolean,
    default: false,
  },
  fixedAmounts: {
    type: [Number],
    default: [],
  },
  minAmount: Number,
  maxAmount: Number,
  logo: String,
  active: {
    type: Boolean,
    default: true,
  },
  raw: mongoose.Schema.Types.Mixed,
  cachedAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: Date,
}, {
  timestamps: true,
});

giftCardProductSchema.index({ provider: 1, providerProductId: 1 }, { unique: true });
giftCardProductSchema.index({ country: 1, currency: 1, active: 1 });

const GiftCardProduct = mongoose.models.GiftCardProduct || mongoose.model('GiftCardProduct', giftCardProductSchema);

module.exports = GiftCardProduct;
