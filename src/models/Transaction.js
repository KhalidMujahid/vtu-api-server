const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const ReferralEarningService = require('../services/referralEarningService');

const transactionSchema = new mongoose.Schema({
  reference: {
    type: String,
    required: true,
    unique: true,
  },
  userReference: {
    type: String,
    
  },
  
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  userPhone: String,
  userEmail: String,
  
  type: {
    type: String,
    required: true,
    enum: [
      'fund_wallet',
      'wallet_transfer',
      'withdrawal',
      'data_recharge',
      'airtime_recharge',
      'airtime_swap',
      'sme_data',
      'recharge_pin',
      'electricity',
      'cable_tv',
      'education_pin',
      'rrr_payment',
      'bulk_sms',
      'gift_card',
    ],
  },
  category: {
    type: String,
    enum: ['telecom', 'bills', 'education', 'transfer', 'funding'],
    required: true,
  },
  
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  fee: {
    type: Number,
    default: 0,
  },
  totalAmount: {
    type: Number,
    required: true,
  },
  previousBalance: {
    type: Number,
    
  },
  newBalance: {
    type: Number,
    
  },
  currency: {
    type: String,
    default: 'NGN',
  },
  
  service: {
    provider: String, 
    plan: String,
    network: String,
    orderId: String,   
    requestId: String,
    phoneNumber: String,
    meterNumber: String,
    smartCardNumber: String,
    customerName: String,
    disco: String,
    package: String,
  },
  
  recipient: {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    phone: String,
    email: String,
    name: String,
  },
  
  provider: {
    name: String,     
    alternate: String, 
    providerReference: String,
    providerResponse: mongoose.Schema.Types.Mixed,
  },
  
  paymentGateway: {
    name: String,
    reference: String,
    authorizationUrl: String,
  },
  
  status: {
    type: String,
    enum: ['pending', 'processing', 'successful', 'failed', 'cancelled', 'refunded'],
    default: 'pending',
  },
  statusHistory: [{
    status: String,
    timestamp: {
      type: Date,
      default: Date.now,
    },
    note: String,
  }],
  
  retryCount: {
    type: Number,
    default: 0,
  },
  maxRetries: {
    type: Number,
    default: 3,
  },
  nextRetry: Date,
  
  callbackUrl: String,
  webhookAttempts: {
    type: Number,
    default: 0,
  },
  webhookDelivered: {
    type: Boolean,
    default: false,
  },
  
  ipAddress: String,
  userAgent: String,
  deviceFingerprint: String,
  
  description: String,
  metadata: mongoose.Schema.Types.Mixed,
  
  initiatedAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: Date,
  expiresAt: Date,
}, {
  timestamps: true,
});

transactionSchema.index({ reference: 1 });
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ status: 1, nextRetry: 1 });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ 'service.provider': 1 });
transactionSchema.index({ createdAt: -1 });

transactionSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    if (!this.statusHistory) {
      this.statusHistory = [];
    }
    this.statusHistory.push({
      status: this.status,
      timestamp: new Date(),
      note: `Status changed to ${this.status}`,
    });
  }
  next();
});

transactionSchema.post('save', async function(doc) {
  try {
    if (doc.status !== 'successful') return;

    // Atomically claim referral processing — prevents double-award if save is called
    // multiple times on the same document (e.g. status polling loop).
    const claimed = await this.constructor.findOneAndUpdate(
      { _id: doc._id, 'metadata.referralLedgerProcessed': { $ne: true } },
      {
        $set: {
          'metadata.referralLedgerProcessed': true,
          'metadata.referralLedgerProcessedAt': new Date().toISOString(),
        },
      }
    );

    if (!claimed) return;

    await ReferralEarningService.processSuccessfulTransaction(doc);
  } catch (error) {
    console.error('Referral ledger post-save hook failed:', error.message);
  }
});

transactionSchema.statics.generateReference = function() {
  return `YAREEMA${uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase()}`;
};

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
