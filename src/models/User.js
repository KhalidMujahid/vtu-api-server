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
    enum: ['user', 'staff', 'admin', 'super_admin'],
    default: 'user',
  },
  isActive: {
    type: Boolean,
    default: true,
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

const User = mongoose.model('User', userSchema);
module.exports = User;