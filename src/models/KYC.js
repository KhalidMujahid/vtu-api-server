const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  
  level: {
    type: String,
    enum: ['basic', 'advanced', 'verified'],
    default: 'basic',
  },
  
  bvn: {
    type: String,
    unique: true,
    sparse: true,
  },
  nin: {
    type: String,
    unique: true,
    sparse: true,
  },
  
  identificationType: {
    type: String,
    enum: ['nin', 'drivers_license', 'voters_card', 'international_passport', 'none'],
  },
  identificationNumber: String,
  identificationFront: String, 
  identificationBack: String,
  identificationVerified: {
    type: Boolean,
    default: false,
  },
  
  selfiePhoto: String,
  selfieVerified: {
    type: Boolean,
    default: false,
  },
  
  proofOfAddress: String,
  proofOfAddressVerified: {
    type: Boolean,
    default: false,
  },
  
  bankAccounts: [{
    bankName: String,
    accountNumber: String,
    accountName: String,
    isVerified: {
      type: Boolean,
      default: false,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  }],
  
  limits: {
    dailyFunding: {
      type: Number,
      default: 50000,
    },
    monthlyFunding: {
      type: Number,
      default: 300000,
    },
    dailyWithdrawal: {
      type: Number,
      default: 50000,
    },
    monthlyWithdrawal: {
      type: Number,
      default: 300000,
    },
    dailyTransaction: {
      type: Number,
      default: 100000,
    },
    monthlyTransaction: {
      type: Number,
      default: 500000,
    },
  },
  
  submittedAt: Date,
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  reviewedAt: Date,
  reviewNotes: String,
  
  status: {
    type: String,
    enum: ['pending', 'under_review', 'approved', 'rejected'],
    default: 'pending',
  },
  rejectionReason: String,
  
  metadata: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

kycSchema.index({ user: 1 });
kycSchema.index({ status: 1 });
kycSchema.index({ bvn: 1 }, { sparse: true });
kycSchema.index({ nin: 1 }, { sparse: true });

const KYC = mongoose.model('KYC', kycSchema);
module.exports = KYC;