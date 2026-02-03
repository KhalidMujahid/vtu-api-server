const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email'],
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    validate: {
      validator: function(v) {
        return /^(?:\+234|0)[789][01]\d{8}$/.test(v);
      },
      message: 'Please provide a valid Nigerian phone number',
    },
  },
  
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 8,
    select: false,
  },
  transactionPin: {
    type: String,
    select: false,
  },
  
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  isPhoneVerified: {
    type: Boolean,
    default: false,
  },
  verificationToken: String,
  verificationTokenExpires: Date,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
  failedLoginAttempts: {
    type: Number,
    default: 0,
  },
  lockUntil: Date,
  lastLogin: Date,
  lastLoginIp: String,
  lastLoginDevice: String,
  
  kycStatus: {
    type: String,
    enum: ['pending', 'basic', 'advanced', 'verified'],
    default: 'pending',
  },
  kycSubmittedAt: Date,
  kycVerifiedAt: Date,
  
  role: {
    type: String,
    enum: ['user', 'agent', 'staff', 'admin', 'super_admin'],
    default: 'user',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  
  // Agent specific fields
  agentInfo: {
    agentId: {
      type: String,
      unique: true,
      sparse: true,
    },
    commissionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 50, // Maximum 50% commission
    },
    totalCommissionEarned: {
      type: Number,
      default: 0,
    },
    availableCommission: {
      type: Number,
      default: 0,
    },
    totalTransactions: {
      type: Number,
      default: 0,
    },
    totalTransactionAmount: {
      type: Number,
      default: 0,
    },
    performanceRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationDocuments: [{
      documentType: String,
      documentUrl: String,
      verified: {
        type: Boolean,
        default: false,
      },
      uploadedAt: Date,
    }],
    assignedArea: {
      state: String,
      city: String,
      lga: String,
    },
    bankDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String,
      isVerified: {
        type: Boolean,
        default: false,
      },
    },
    activationDate: Date,
    lastCommissionWithdrawal: Date,
  },
  
  dateOfBirth: Date,
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
  },
  address: {
    street: String,
    city: String,
    state: String,
    country: {
      type: String,
      default: 'Nigeria',
    },
    postalCode: String,
  },
  
  referralCode: {
    type: String,
    unique: true,
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: Date,
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('transactionPin')) return next();
  
  if (this.transactionPin) {
    this.transactionPin = await bcrypt.hash(this.transactionPin, 8);
  }
  next();
});

userSchema.pre('save', async function(next) {
  if (!this.referralCode) {
    this.referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  
  if (this.role === 'agent' && !this.agentInfo?.agentId) {
    this.agentInfo = this.agentInfo || {};
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.agentInfo.agentId = `AGT${timestamp}${random}`;
    
    if (!this.agentInfo.referralCode) {
      this.agentInfo.referralCode = `AGENT${this.referralCode}`;
    }
  }
  
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.compareTransactionPin = async function(candidatePin) {
  if (!this.transactionPin) return false;
  return await bcrypt.compare(candidatePin, this.transactionPin);
};

userSchema.methods.isLocked = function() {
  return this.lockUntil && this.lockUntil > Date.now();
};


userSchema.methods.incrementLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { failedLoginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }
  
  const updates = { $inc: { failedLoginAttempts: 1 } };
  
  if (this.failedLoginAttempts + 1 >= 5) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 };
  }
  
  return this.updateOne(updates);
};

userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual('isAgent').get(function() {
  return this.role === 'agent';
});


userSchema.statics.findByAgentId = function(agentId) {
  return this.findOne({ 'agentInfo.agentId': agentId });
};

userSchema.methods.calculatePerformanceRating = async function() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const recentTransactions = await mongoose.model('Transaction').countDocuments({
    user: this._id,
    createdAt: { $gte: thirtyDaysAgo },
    status: 'successful'
  });
  
  let rating = 0;
  if (recentTransactions >= 50) rating = 5;
  else if (recentTransactions >= 30) rating = 4;
  else if (recentTransactions >= 15) rating = 3;
  else if (recentTransactions >= 5) rating = 2;
  else if (recentTransactions > 0) rating = 1;
  
  return rating;
};

const User = mongoose.model('User', userSchema);
module.exports = User;