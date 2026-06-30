const mongoose = require('mongoose');

const giftCardOrderSchema = new mongoose.Schema({
  reference: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GiftCardProduct',
    required: true,
  },
  productId: {
    type: String,
    required: true,
    index: true,
  },
  provider: {
    type: String,
    required: true,
    index: true,
  },
  providerProductId: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  nairaAmount: {
    type: Number,
    min: 0,
  },
  currency: {
    type: String,
    default: 'USD',
  },
  recipientEmail: String,
  recipientName: String,
  senderName: String,
  message: String,
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  },
  walletBefore: Number,
  walletAfter: Number,
  providerReference: String,
  providerResponse: mongoose.Schema.Types.Mixed,
  failureReason: String,
  completedAt: Date,
  purchasedAt: Date,
}, {
  timestamps: true,
});

giftCardOrderSchema.index({ user: 1, createdAt: -1 });

const GiftCardOrder = mongoose.models.GiftCardOrder || mongoose.model('GiftCardOrder', giftCardOrderSchema);

module.exports = GiftCardOrder;
