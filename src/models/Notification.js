const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
    },

    message: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: [
        'wallet_credit',
        'wallet_debit',
        'airtime',
        'data',
        'login',
        'security',
        'system'
      ],
      default: 'system',
    },

    reference: {
      type: String,
    },

    isRead: {
      type: Boolean,
      default: false,
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

module.exports = mongoose.model('Notification', notificationSchema);