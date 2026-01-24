const mongoose = require('mongoose');

const providerStatusSchema = new mongoose.Schema({
  providerName: {
    type: String,
    required: true,
    unique: true,
  },
  
  supportedServices: [{
    type: String,
    enum: [
      'data_recharge',
      'airtime_recharge',
      'electricity',
      'cable_tv',
      'education_pin',
      'airtime_swap',
      'sme_data',
      'recharge_pin'
    ],
  }],
  
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance', 'degraded'],
    default: 'active',
  },
  lastChecked: Date,
  uptime: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
  },
  
  successRate: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
  },
  averageResponseTime: Number,
  totalRequests: {
    type: Number,
    default: 0,
  },
  successfulRequests: {
    type: Number,
    default: 0,
  },
  failedRequests: {
    type: Number,
    default: 0,
  },
  
  apiKey: String,
  apiSecret: String,
  baseUrl: String,
  callbackUrl: String,
  isDefault: {
    type: Boolean,
    default: false,
  },
  priority: {
    type: Number,
    default: 1,
  },
  
  rateLimit: {
    requestsPerMinute: Number,
    requestsPerHour: Number,
    requestsPerDay: Number,
  },
  rateLimitReset: Date,
  
  healthCheckEndpoint: String,
  healthCheckInterval: {
    type: Number,
    default: 300000,
  },
  
  fallbackTo: [String], 
  
  maintenanceMessage: String,
  maintenanceStart: Date,
  maintenanceEnd: Date,
  
  description: String,
  contactEmail: String,
  contactPhone: String,
  
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

providerStatusSchema.methods.incrementRequest = function(success) {
  this.totalRequests += 1;
  if (success) {
    this.successfulRequests += 1;
  } else {
    this.failedRequests += 1;
  }
  
  if (this.totalRequests > 0) {
    this.successRate = (this.successfulRequests / this.totalRequests) * 100;
  }
  
  return this.save();
};

providerStatusSchema.methods.isAvailable = function() {
  if (this.status === 'inactive' || this.status === 'maintenance') {
    return false;
  }
  
  if (this.maintenanceStart && this.maintenanceEnd) {
    const now = new Date();
    if (now >= this.maintenanceStart && now <= this.maintenanceEnd) {
      return false;
    }
  }
  
  return true;
};

const ProviderStatus = mongoose.model('ProviderStatus', providerStatusSchema);
module.exports = ProviderStatus;