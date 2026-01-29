const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const WalletService = require('../services/walletService');
const { sendOTPEmail, sendOTPSMS } = require('../utils/emailService');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../utils/logger');
const { normalizePhone } = require('../utils/normalizePhone');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

const signRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRE,
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const refreshToken = signRefreshToken(user._id);
  
  user.password = undefined;
  user.transactionPin = undefined;
  
  res.status(statusCode).json({
    status: 'success',
    token,
    refreshToken,
    data: {
      user,
    },
  });
};

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

exports.register = async (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phoneNumber,
      password,
      referralCode,
    } = req.body;

    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone) {
      return next(
        new AppError('Invalid phone number', 400)
      );
    }
    
    const existingUser = await User.findOne({
      $or: [{ email }, { phoneNumber }],
    });
    
    if (existingUser) {
      return next(new AppError('User with this email or phone already exists', 400));
    }
    
    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        referredBy = referrer._id;
      }
    }
    
    const user = await User.create({
      firstName,
      lastName,
      email,
      phoneNumber,
      password,
      referredBy,
    });
    
    await WalletService.createWallet(user._id);
    
    const otp = generateOTP();
    const verificationToken = crypto
      .createHash('sha256')
      .update(otp)
      .digest('hex');
    
    user.verificationToken = verificationToken;
    user.verificationTokenExpires = Date.now() + 10 * 60 * 1000; 
    await user.save();
    
    // await sendOTPEmail(user.email, otp);
    // await sendOTPSMS(user.phoneNumber, otp);
    
    createSendToken(user, 201, res);
    
    logger.info(`New user registered: ${user.email}`);
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password, deviceInfo } = req.body;
    
    if (!email || !password) {
      return next(new AppError('Please provide email and password', 400));
    }
    
    const user = await User.findOne({ email }).select('+password +failedLoginAttempts +lockUntil');
    
    if (!user || !(await user.comparePassword(password))) {
      if (user) {
        await user.incrementLoginAttempts();
      }
      
      return next(new AppError('Incorrect email or password', 401));
    }
    
    if (user.isLocked()) {
      return next(new AppError('Account is locked. Please try again later or contact support.', 401));
    }
    
    if (!user.isActive) {
      return next(new AppError('Your account has been deactivated. Please contact support.', 401));
    }
    
    if (user.failedLoginAttempts > 0) {
      user.failedLoginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }
    
    user.lastLogin = new Date();
    user.lastLoginIp = req.ip;
    user.lastLoginDevice = req.get('user-agent');
    await user.save();
    
    createSendToken(user, 200, res);
    
    logger.info(`User logged in: ${user.email}`);
  } catch (error) {
    next(error);
  }
};

exports.verifyOTP = async (req, res, next) => {
  try {
    const { email, otp, verificationType = 'email' } = req.body;
    
    if (!email || !otp) {
      return next(new AppError('Please provide email and OTP', 400));
    }
    
    const user = await User.findOne({ email });
    
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    const hashedToken = crypto
      .createHash('sha256')
      .update(otp)
      .digest('hex');
    
    if (
      user.verificationToken !== hashedToken ||
      user.verificationTokenExpires < Date.now()
    ) {
      return next(new AppError('Invalid or expired OTP', 400));
    }
    
    if (verificationType === 'email') {
      user.isEmailVerified = true;
    } else if (verificationType === 'phone') {
      user.isPhoneVerified = true;
    }
    
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();
    
    res.status(200).json({
      status: 'success',
      message: 'OTP verified successfully',
      data: {
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
      },
    });
    
    logger.info(`User verified ${verificationType}: ${user.email}`);
  } catch (error) {
    next(error);
  }
};

exports.resendOTP = async (req, res, next) => {
  try {
    const { email, verificationType = 'email' } = req.body;
    
    const user = await User.findOne({ email });
    
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    const otp = generateOTP();
    const verificationToken = crypto
      .createHash('sha256')
      .update(otp)
      .digest('hex');
    
    user.verificationToken = verificationToken;
    user.verificationTokenExpires = Date.now() + 10 * 60 * 1000; 
    await user.save();
    
    if (verificationType === 'email') {
      await sendOTPEmail(user.email, otp);
    } else if (verificationType === 'phone') {
      await sendOTPSMS(user.phoneNumber, otp);
    }
    
    res.status(200).json({
      status: 'success',
      message: 'OTP sent successfully',
    });
    
    logger.info(`OTP resent to ${verificationType}: ${user.email}`);
  } catch (error) {
    next(error);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    
    const user = await User.findOne({ email });
    
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    const resetToken = crypto.randomBytes(32).toString('hex');
    const passwordResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    
    user.resetPasswordToken = passwordResetToken;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; 
    await user.save();
    
    const resetURL = `${req.protocol}://${req.get('host')}/api/v1/auth/reset-password/${resetToken}`;
    
    logger.info(`Password reset URL: ${resetURL}`);
    
    res.status(200).json({
      status: 'success',
      message: 'Password reset token sent to email',
    });
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });
    
    if (!user) {
      return next(new AppError('Token is invalid or has expired', 400));
    }
    
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    createSendToken(user, 200, res);
    
    logger.info(`Password reset for user: ${user.email}`);
  } catch (error) {
    next(error);
  }
};

exports.setTransactionPin = async (req, res, next) => {
  try {
    const { transactionPin } = req.body;
    
    if (!transactionPin || transactionPin.length !== 4) {
      return next(new AppError('Transaction PIN must be 4 digits', 400));
    }
    
    const user = await User.findById(req.user.id);
    
    if (user.transactionPin) {
      return next(new AppError('Transaction PIN already set', 400));
    }
    
    user.transactionPin = transactionPin;
    await user.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Transaction PIN set successfully',
    });
    
    logger.info(`Transaction PIN set for user: ${user.email}`);
  } catch (error) {
    next(error);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    const user = await User.findById(req.user.id).select('+password');
    
    if (!(await user.comparePassword(currentPassword))) {
      return next(new AppError('Current password is incorrect', 401));
    }
    
    user.password = newPassword;
    await user.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Password changed successfully',
    });
    
    logger.info(`Password changed for user: ${user.email}`);
  } catch (error) {
    next(error);
  }
};

exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    res.status(200).json({
      status: 'success',
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, dateOfBirth, gender, address } = req.body;
    
    const user = await User.findById(req.user.id);
    
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (gender) user.gender = gender;
    if (address) {
      user.address = {
        ...user.address,
        ...address,
      };
    }
    
    await user.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        user,
      },
    });
    
    logger.info(`Profile updated for user: ${user.email}`);
  } catch (error) {
    next(error);
  }

};
