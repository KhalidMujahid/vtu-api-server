const mongoose = require('mongoose');

const servicePricingSchema = new mongoose.Schema({
  serviceType: {
    type: String,
    required: true,
    enum: [
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
  
  provider: {
    type: String,
    required: true,
  },
  network: {
    type: String,
    enum: ['mtn', 'airtel', 'glo', '9mobile'],
  },
  disco: {
    type: String,
    enum: ['aedc', 'ikedc', 'ekedc', 'kaedco', 'others'],
  },
  cableProvider: {
    type: String,
    enum: ['dstv', 'gotv', 'startimes'],
  },
  
  planName: {
    type: String,
    required: true,
  },
  planCode: String,
  validity: String,
  dataAmount: String,
  
  costPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  sellingPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  profitMargin: {
    type: Number,
    default: 0,
  },
  discount: {
    type: Number,
    default: 0,
  },
  vat: {
    type: Number,
    default: 7.5,
  },
  
  isActive: {
    type: Boolean,
    default: true,
  },
  isAvailable: {
    type: Boolean,
    default: true,
  },
  availabilityMessage: String,
  
  priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 10,
  },
  
  minAmount: Number,
  maxAmount: Number,
  
  userCommission: Number,
  agentCommission: Number,

  description: String,
  terms: String,
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

servicePricingSchema.index({ serviceType: 1, provider: 1, isActive: 1 });
servicePricingSchema.index({ serviceType: 1, network: 1, isActive: 1 });
servicePricingSchema.index({ serviceType: 1, planCode: 1, isActive: 1 });

const ServicePricing = mongoose.model('ServicePricing', servicePricingSchema);
module.exports = ServicePricing;