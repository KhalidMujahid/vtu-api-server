const mongoose = require('mongoose');

const giftCardCodeSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GiftCardOrder',
    required: true,
    unique: true,
    index: true,
  },
  code: String,
  pin: String,
  serial: String,
  expiresAt: Date,
  providerPayload: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

const GiftCardCode = mongoose.models.GiftCardCode || mongoose.model('GiftCardCode', giftCardCodeSchema);

module.exports = GiftCardCode;
