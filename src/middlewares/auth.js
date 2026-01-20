const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

module.exports = {
  protect: async (req, res, next) => {
    try {
      let token;
      
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      }
      
      if (!token) {
        return res.status(401).json({
          status: 'error',
          message: 'You are not logged in. Please log in to get access.',
        });
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      const user = await User.findById(decoded.id).select('+lastLogin +lastLoginIp');
      
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'The user belonging to this token no longer exists.',
        });
      }
      
      if (!user.isActive) {
        return res.status(401).json({
          status: 'error',
          message: 'Your account has been deactivated. Please contact support.',
        });
      }
      
      if (user.isLocked()) {
        return res.status(401).json({
          status: 'error',
          message: 'Your account is locked. Please try again later or contact support.',
        });
      }
      
      user.lastLogin = new Date();
      user.lastLoginIp = req.ip;
      user.lastLoginDevice = req.get('user-agent');
      await user.save();
      
      req.user = user;
      next();
    } catch (error) {
      logger.error('Auth middleware error:', error);
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          status: 'error',
          message: 'Invalid token. Please log in again.',
        });
      }
      
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          status: 'error',
          message: 'Your token has expired. Please log in again.',
        });
      }
      
      return res.status(500).json({
        status: 'error',
        message: 'An error occurred during authentication.',
      });
    }
  },
  
  restrictTo: (...roles) => {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({
          status: 'error',
          message: 'You do not have permission to perform this action.',
        });
      }
      next();
    };
  },
  
  requireTransactionPin: async (req, res, next) => {
    try {
      const { transactionPin } = req.body;
      
      if (!transactionPin) {
        return res.status(400).json({
          status: 'error',
          message: 'Transaction PIN is required.',
        });
      }
      
      const user = await User.findById(req.user.id).select('+transactionPin');
      
      if (!user.transactionPin) {
        return res.status(400).json({
          status: 'error',
          message: 'Please set your transaction PIN first.',
        });
      }
      
      const isPinValid = await user.compareTransactionPin(transactionPin);
      
      if (!isPinValid) {
        await user.incrementLoginAttempts();
        
        return res.status(401).json({
          status: 'error',
          message: 'Invalid transaction PIN.',
        });
      }
      
      next();
    } catch (error) {
      logger.error('Transaction PIN verification error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'An error occurred during PIN verification.',
      });
    }
  },
};