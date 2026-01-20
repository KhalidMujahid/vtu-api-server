const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AdminLog = require('../models/AdminLog');
const logger = require('../utils/logger');

module.exports = {
  adminAuth: async (req, res, next) => {
    try {
      let token;
      
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      }
      
      if (!token) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required.',
        });
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'Admin user not found.',
        });
      }
      
      if (!['admin', 'super_admin', 'staff'].includes(user.role)) {
        return res.status(403).json({
          status: 'error',
          message: 'Admin access required.',
        });
      }
      
      if (!user.isActive) {
        return res.status(401).json({
          status: 'error',
          message: 'Admin account is deactivated.',
        });
      }
      
      req.admin = user;
      next();
    } catch (error) {
      logger.error('Admin auth error:', error);
      return res.status(401).json({
        status: 'error',
        message: 'Invalid authentication token.',
      });
    }
  },
  
  logAction: (action, entity) => {
    return async (req, res, next) => {
      const originalSend = res.send;
      
      res.send = function(data) {
        res.send = originalSend;
        
        let responseData;
        try {
          responseData = JSON.parse(data);
        } catch (e) {
          responseData = data;
        }
        
        AdminLog.log({
          admin: req.admin._id,
          adminEmail: req.admin.email,
          adminRole: req.admin.role,
          action,
          entity,
          entityId: req.params.id || req.body.id,
          changes: {
            old: req.oldData,
            new: req.body,
          },
          description: `${action} ${entity} by ${req.admin.email}`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          status: res.statusCode < 400 ? 'success' : 'failed',
          errorMessage: responseData.message,
          metadata: {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
          },
        }).catch(err => {
          logger.error('Failed to log admin action:', err);
        });
        
        return originalSend.call(this, data);
      };
      
      next();
    };
  },
  
  superAdminOnly: (req, res, next) => {
    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({
        status: 'error',
        message: 'Super admin access required.',
      });
    }
    next();
  },
  
  staffOnly: (req, res, next) => {
    if (!['staff', 'admin', 'super_admin'].includes(req.admin.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Staff access required.',
      });
    }
    next();
  },
};