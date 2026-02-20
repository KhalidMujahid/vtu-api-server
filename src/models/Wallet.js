const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  locked: {
    type: Boolean,
    default: false,
  },
  lockReason: String,
  lockedAt: Date,
  unlockedAt: Date,
  totalFunded: {
    type: Number,
    default: 0,
  },
  totalWithdrawn: {
    type: Number,
    default: 0,
  },
  totalSpent: {
    type: Number,
    default: 0,
  },
  lastTransaction: Date,
  currency: {
    type: String,
    default: 'NGN',
    enum: ['NGN'],
  },
  
  monnifyAccounts: [{
    bankName: String,
    accountNumber: String,
    accountName: String,
    bankCode: String,
    isDefault: {
      type: Boolean,
      default: false,
    },
    accountReference: String,
    createdAt: {
      type: Date,
      default: Date.now,
    },
  }],
  
  accountReference: String,
  collectionChannel: String,
  reservationReference: String,
  
  virtualCard: {
    cardId: String,
    cardNumber: String,
    cvv: String,
    expiry: String,
    status: String,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

walletSchema.index({ user: 1 });
walletSchema.index({ balance: 1 });
walletSchema.index({ 'monnifyAccounts.accountNumber': 1 });

walletSchema.methods.canDebit = function(amount) {
  if (this.locked) return false;
  if (this.balance < amount) return false;
  return true;
};

walletSchema.methods.debit = async function(amount, reason) {
  if (!this.canDebit(amount)) {
    throw new Error('Insufficient balance or wallet locked');
  }
  
  this.balance -= amount;
  this.totalSpent += amount;
  this.lastTransaction = Date.now();
  
  await this.save();
  return this;
};

walletSchema.methods.credit = async function(amount, reason) {
  this.balance += amount;
  this.totalFunded += amount;
  this.lastTransaction = Date.now();
  
  await this.save();
  return this;
};

walletSchema.virtual('primaryAccountNumber').get(function() {
  if (this.monnifyAccounts && this.monnifyAccounts.length > 0) {
    const defaultAccount = this.monnifyAccounts.find(acc => acc.isDefault);
    return defaultAccount ? defaultAccount.accountNumber : this.monnifyAccounts[0].accountNumber;
  }
  return null;
});

walletSchema.virtual('accountNumbers').get(function() {
  if (this.monnifyAccounts && this.monnifyAccounts.length > 0) {
    return this.monnifyAccounts.map(acc => ({
      bankName: acc.bankName,
      accountNumber: acc.accountNumber,
      accountName: acc.accountName,
    }));
  }
  return [];
});

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;