const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  reference: {
    type: String,
    required: true,
    unique: true,
  },
  userReference: {
    type: String,
    required: true,
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
    required: true,
  },
  newBalance: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'NGN',
  },
  
  service: {
    provider: String, 
    plan: String,     
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

transactionSchema.statics.generateReference = function() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `YAREEMA${timestamp}${random}`;
};

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;