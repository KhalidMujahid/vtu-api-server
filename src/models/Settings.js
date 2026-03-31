const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  category: {
    type: String,
    enum: ['general', 'payment', 'fees', 'limits', 'security', 'kyc', 'notification', 'other'],
    default: 'general',
  },
  description: String,
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

settingsSchema.index({ category: 1, key: 1 });

const Settings = mongoose.model('Settings', settingsSchema);
module.exports = Settings;
