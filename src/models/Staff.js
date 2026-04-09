const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');

const staffSchema = new mongoose.Schema(
  {
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
      trim: true,
      validate: [validator.isEmail, 'Please provide a valid email'],
    },
    phoneNumber: {
      type: String,
      unique: true,
      sparse: true,
      validate: {
        validator: function (v) {
          if (!v) return true;
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
    role: {
      type: String,
      enum: ['superadmin', 'super_admin', 'admin', 'staff', 'support'],
      default: 'support',
    },
    roles: {
      type: [String],
      enum: ['superadmin', 'super_admin', 'admin', 'staff', 'support'],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: true,
    },
    isPhoneVerified: {
      type: Boolean,
      default: true,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: Date,
    twoFactor: {
      enabled: {
        type: Boolean,
        default: false,
      },
      method: {
        type: String,
        enum: ['email', 'authenticator'],
        default: 'email',
      },
      emailOtpHash: String,
      emailOtpExpires: Date,
      authenticatorSecret: String,
      pendingAuthenticatorSecret: String,
      lastVerifiedAt: Date,
    },
    lastLogin: Date,
    lastLoginIp: String,
    lastLoginDevice: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

staffSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

staffSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

staffSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

staffSchema.methods.incrementLoginAttempts = function () {
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

staffSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model('Staff', staffSchema);
