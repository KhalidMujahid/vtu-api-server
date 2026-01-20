const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  adminEmail: String,
  adminRole: String,
  
  action: {
    type: String,
    required: true,
    enum: [
      'create',
      'read',
      'update',
      'delete',
      'approve',
      'reject',
      'suspend',
      'activate',
      'credit',
      'debit',
      'refund',
      'login',
      'logout',
      'export',
      'import',
    ],
  },
  entity: {
    type: String,
    required: true,
    enum: [
      'user',
      'wallet',
      'transaction',
      'kyc',
      'pricing',
      'provider',
      'system',
      'notification',
    ],
  },
  entityId: mongoose.Schema.Types.ObjectId,
  
  changes: {
    old: mongoose.Schema.Types.Mixed,
    new: mongoose.Schema.Types.Mixed,
  },
  
  description: String,
  ipAddress: String,
  userAgent: String,
  
  status: {
    type: String,
    enum: ['success', 'failed', 'pending'],
    default: 'success',
  },
  errorMessage: String,
  
  metadata: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

adminLogSchema.index({ admin: 1, createdAt: -1 });
adminLogSchema.index({ action: 1, createdAt: -1 });
adminLogSchema.index({ entity: 1, entityId: 1 });
adminLogSchema.index({ createdAt: -1 });

adminLogSchema.statics.log = async function(data) {
  try {
    const log = new this(data);
    await log.save();
    return log;
  } catch (error) {
    console.error('Failed to log admin action:', error);
  }
};

const AdminLog = mongoose.model('AdminLog', adminLogSchema);
module.exports = AdminLog;