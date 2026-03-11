const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
{
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },

  balance: {
    type: Number,
    default: 0,
    min: 0,
  },

  currency: {
    type: String,
    default: "NGN",
    enum: ["NGN"],
  },

  locked: {
    type: Boolean,
    default: false,
  },

  lockReason: String,

  totalFunded: {
    type: Number,
    default: 0,
  },

  totalSpent: {
    type: Number,
    default: 0,
  },

  totalWithdrawn: {
    type: Number,
    default: 0,
  },

  lastTransaction: Date,

  budpayCustomerCode: String,

  virtualAccount: {
    bankName: String,
    accountNumber: {
      type: String,
      index: true
    },
    accountName: String,
    bankCode: String,
    reference: String,
  },

  virtualCard: {
    cardId: String,
    cardNumber: String,
    cvv: String,
    expiry: String,
    status: String,
  },

  accountReference: String,
},
{
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
}
);

walletSchema.index({ user: 1 });

walletSchema.virtual('accountNumbers').get(function() {
  if (!this.virtualAccount) {
    return [];
  }
  return [{
    bankName: this.virtualAccount.bankName,
    accountNumber: this.virtualAccount.accountNumber,
    accountName: this.virtualAccount.accountName,
    bankCode: this.virtualAccount.bankCode,
    isDefault: true,
  }];
});

walletSchema.virtual('primaryAccountNumber').get(function() {
  if (!this.virtualAccount) {
    return null;
  }
  return {
    bankName: this.virtualAccount.bankName,
    accountNumber: this.virtualAccount.accountNumber,
    accountName: this.virtualAccount.accountName,
    bankCode: this.virtualAccount.bankCode,
  };
});

walletSchema.methods.canDebit = function (amount) {
  if (this.locked) return false;
  if (this.balance < amount) return false;
  return true;
};

walletSchema.methods.debit = async function (amount) {

  if (!this.canDebit(amount)) {
    throw new Error("Insufficient balance or wallet locked");
  }

  this.balance -= amount;
  this.totalSpent += amount;
  this.lastTransaction = Date.now();

  await this.save();
  return this;
};

walletSchema.methods.credit = async function (amount) {

  this.balance += amount;
  this.totalFunded += amount;
  this.lastTransaction = Date.now();

  await this.save();
  return this;
};

walletSchema.methods.safeDebit = async function(amount) {

  const wallet = await this.constructor.findOneAndUpdate(
    {
      _id: this._id,
      balance: { $gte: amount },
      locked: false
    },
    {
      $inc: { balance: -amount, totalSpent: amount },
      $set: { lastTransaction: new Date() }
    },
    { new: true }
  );

  if (!wallet) throw new Error("Insufficient balance");

  return wallet;
};

const Wallet =
  mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);

module.exports = Wallet;